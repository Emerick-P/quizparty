// Test des images de profil : galerie (emoji + couleur), photo du compte, initiale ; vues par les autres joueurs,
// gardées sur le compte (profiles.avatar_look), refusées si invalides.
// Usage : node test/avatar-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { computeStats } from '../server/stats.js';
import { cleanLook, lookView, AVATAR_EMOJIS, AVATAR_HUES } from '../server/avatars.js';

assert.equal(cleanLook(''), '');
assert.equal(cleanLook('photo'), 'photo');
assert.equal(cleanLook('e:3:2'), 'e:3:2');
assert.equal(cleanLook('e:99:0'), null);
assert.equal(cleanLook('e:1:9'), null);
assert.equal(cleanLook('<img>'), null);
assert.deepEqual(lookView('e:5:1'), { emoji: AVATAR_EMOJIS[5], hue: AVATAR_HUES[1] });
assert.equal(lookView('photo', null), null, 'pas de photo sans compte');
assert.equal(lookView(''), null);

const PORT = 3993;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-avatar-'));

// ---- Faux Supabase : auth + tables game_results / answers + fonction player_stats
const USERS = {
  'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa': { id: '11111111-1111-4111-8111-111111111111', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'Alice', avatar_url: 'https://cdn.discordapp.com/avatars/1/a.png' } },
  'tok-chloe-ccccccccccccccccccccccccc': { id: '33333333-3333-4333-8333-333333333333', app_metadata: { provider: 'google' }, user_metadata: { name: 'Chloé' } },
};
const db = { game_results: [], answers: [] };
const profiles = [];
let n = 0;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null;
    res.setHeader('Content-Type', 'application/json');
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (req.url === '/auth/v1/settings') return res.end(JSON.stringify({ external: { discord: true, google: true } }));
    if (req.url === '/auth/v1/user') {
      const u = USERS[bearer];
      res.statusCode = u ? 200 : 401;
      return res.end(JSON.stringify(u ?? { msg: 'invalid JWT' }));
    }
    const now = () => new Date(Date.now() + n++).toISOString();
    if (req.method === 'POST' && req.url === '/rest/v1/profiles') { profiles.push(body); return res.end(''); }
    if (req.method === 'GET' && req.url.startsWith('/rest/v1/profiles?id=eq.')) {
      const id = decodeURIComponent(req.url.split('id=eq.')[1].split('&')[0]);
      const row = profiles.filter((p) => p.id === id).reduce((a, p) => ({ ...a, ...p }), null);
      return res.end(JSON.stringify(row ? [row] : []));
    }
    if (req.method === 'POST' && req.url === '/rest/v1/game_results') {
      const row = { id: `g${db.game_results.length + 1}`, created_at: now(), ...body };
      db.game_results.push(row);
      return res.end(JSON.stringify([row]));
    }
    if (req.method === 'POST' && req.url === '/rest/v1/answers') {
      for (const r of [].concat(body)) db.answers.push({ id: db.answers.length + 1, created_at: now(), ...r });
      return res.end('');
    }
    if (req.method === 'POST' && req.url === '/rest/v1/rpc/player_stats') {
      const s = computeStats(db.game_results.filter((g) => g.user_id === body.uid), db.answers.filter((a) => a.user_id === body.uid));
      for (const m of s.modes) delete m.name; // la fonction SQL ne connaît pas les noms : le serveur les ajoute
      return res.end(JSON.stringify(s));
    }
    res.end('[]');
  });
});
await new Promise((r) => fake.listen(0, r));
const base = `http://localhost:${fake.address().port}`;

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: base,
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    ACCESS_CODE: '',
    COUNTDOWN_MS: '100',
    REVEAL_MS: '250',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
    FEEDBACK_FILE: path.join(tmp, 'feedback.jsonl'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));

function client(label) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { label, socket, state: null, waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 10000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const A = client('Alice (compte)'), B = client('Bob (invité)');
try {
  await Promise.all([A.connected, B.connected]);
  assert.equal((await A.emit('auth:set', { token: 'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa' })).ok, true);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob', look: 'e:2:3' });
  let s = await A.waitFor((x) => x.players.length === 2);
  const by = (st) => Object.fromEntries(st.players.map((p) => [p.name, p.look]));
  assert.deepEqual(by(s).Alice, { photo: 'https://cdn.discordapp.com/avatars/1/a.png' }, 'compte sans choix : sa photo');
  assert.deepEqual(by(s).Bob, { emoji: AVATAR_EMOJIS[2], hue: AVATAR_HUES[3] }, 'choix de l’invité envoyé en rejoignant');
  assert.ok((await B.emit('profile:avatar', { look: 'photo' })).error, 'pas de photo pour un invité');
  assert.ok((await B.emit('profile:avatar', { look: 'e:77:0' })).error, 'image inconnue refusée');
  assert.equal((await A.emit('profile:avatar', { look: 'e:0:0' })).ok, true);
  s = await B.waitFor((x) => x.players.find((p) => p.name === 'Alice').look?.emoji === AVATAR_EMOJIS[0]);
  await wait(100);
  assert.ok(profiles.some((p) => p.id === USERS['tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa'].id && p.avatar_look === 'e:0:0'), 'gardé sur le compte');
  assert.equal((await B.emit('profile:avatar', { look: '' })).ok, true);
  s = await A.waitFor((x) => x.players.find((p) => p.name === 'Bob').look === null);
  console.log('✓ images de profil (galerie, photo du compte, initiale, refus)');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [A, B]) c.socket.close();
  server.kill();
  fake.close();
}
console.log(failed ? 'ÉCHEC' : 'images de profil : OK');
process.exit(failed ? 1 : 0);
