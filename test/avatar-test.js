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
assert.equal(cleanLook('photo:discord'), 'photo:discord');
assert.equal(cleanLook('photo:steam'), null);
// Compte relié à Discord ET Google : la photo choisie reste la même, quel que soit le service de connexion
const both = { avatar: 'https://g/x.png', provider: 'google', photos: { discord: 'https://d/x.png', google: 'https://g/x.png' } };
assert.deepEqual(lookView('photo:discord', both), { photo: 'https://d/x.png' });
assert.deepEqual(lookView('photo:discord', { ...both, provider: 'discord', avatar: 'https://d/x.png' }), { photo: 'https://d/x.png' });
assert.equal(lookView('photo:discord', { avatar: 'https://g/x.png', provider: 'google', photos: { google: 'https://g/x.png' } }), null);
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
  // Même compte relié aux deux services, connecté ici avec Google (user_metadata = dernier service utilisé)
  'tok-dora-dddddddddddddddddddddddddd': { id: '44444444-4444-4444-8444-444444444444', app_metadata: { provider: 'google' }, user_metadata: { name: 'Dora', picture: 'https://lh3.googleusercontent.com/d', avatar_url: 'https://lh3.googleusercontent.com/d' },
    identities: [
      { provider: 'discord', identity_data: { avatar_url: 'https://cdn.discordapp.com/avatars/4/d.png' } },
      { provider: 'google', identity_data: { picture: 'https://lh3.googleusercontent.com/d' } },
    ] },
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

  // Compte Discord + Google : choisir la photo Discord, puis se reconnecter avec Google → toujours la photo Discord
  const D = client('Dora (Discord + Google)');
  try {
    await D.connected;
    const r = await D.emit('auth:set', { token: 'tok-dora-dddddddddddddddddddddddddd' });
    assert.deepEqual(r.user.photos, { discord: 'https://cdn.discordapp.com/avatars/4/d.png', google: 'https://lh3.googleusercontent.com/d' }, 'les deux photos proposées');
    await D.emit('room:join', { code, name: 'Dora' });
    s = await A.waitFor((x) => x.players.some((p) => p.name === 'Dora'));
    assert.deepEqual(by(s).Dora, { photo: 'https://lh3.googleusercontent.com/d' }, 'sans choix : photo du service de connexion');
    assert.equal((await D.emit('profile:avatar', { look: 'photo:discord' })).ok, true);
    s = await A.waitFor((x) => x.players.find((p) => p.name === 'Dora').look?.photo?.includes('discord'));
    await wait(100);
    D.socket.close();
    const D2 = client('Dora (reconnectée)');
    await D2.connected;
    const r2 = await D2.emit('auth:set', { token: 'tok-dora-dddddddddddddddddddddddddd' });
    assert.equal(r2.user.look, 'photo:discord', 'choix gardé sur le compte');
    await D2.emit('room:join', { code, name: 'Dora2' });
    s = await A.waitFor((x) => x.players.some((p) => p.name === 'Dora2'));
    assert.deepEqual(by(s).Dora2, { photo: 'https://cdn.discordapp.com/avatars/4/d.png' }, 'photo Discord gardée en se connectant avec Google');
    D2.socket.close();
    console.log('✓ photo choisie gardée quel que soit le service de connexion');
  } finally { D.socket.close(); }
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
