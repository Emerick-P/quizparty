// Contenus réservés (sons : droits non acquis), avec un faux Supabase :
// - salon d'un invité ou d'un compte « player » : modes absents de la liste et du Mix, refusés par le serveur ;
// - salon d'un compte « friend » (ou admin) : modes ouverts à tout le salon, invités compris ;
// - fichiers : jamais en accès direct, seulement ceux de la partie du salon, avec sa clé ;
// - l'hôte se déconnecte de son compte : le salon revient à un mode ouvert ; défi du jour sans ces modes.
// Usage : node test/reserved-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { RESERVED_MODES } from '../server/games/index.js';
import { DAILY_PARTS } from '../server/daily.js';

const PORT = 3981;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-reserved-'));
const RESERVED = ['sounds'];
assert.deepEqual([...RESERVED_MODES].sort(), [...RESERVED].sort());
assert.ok(!DAILY_PARTS.some((id) => RESERVED.includes(id)), 'défi du jour sans modes réservés');

// ---- Faux Supabase : un ami (role friend), un joueur (role player)
const FRIEND = '33333333-3333-4333-8333-333333333333', PLAYER = '44444444-4444-4444-8444-444444444444';
const USERS = {
  'tok-friend-aaaaaaaaaaaaaaaaaaaaaaa': { id: FRIEND, email: 'ami@example.com', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'ami' } },
  'tok-player-bbbbbbbbbbbbbbbbbbbbbbb': { id: PLAYER, email: 'joueur@example.com', app_metadata: { provider: 'google' }, user_metadata: { name: 'Joueur' } },
};
const ROLES = { [FRIEND]: 'friend', [PLAYER]: 'player' };
const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (req.url === '/auth/v1/settings') return res.end(JSON.stringify({ external: { discord: true, google: true } }));
    if (req.url === '/auth/v1/user') {
      const u = USERS[bearer];
      res.statusCode = u ? 200 : 401;
      return res.end(JSON.stringify(u ?? { msg: 'invalid JWT' }));
    }
    const m = req.method === 'GET' && /^\/rest\/v1\/profiles\?id=eq\.([\w-]+)/.exec(req.url);
    if (m) return res.end(JSON.stringify(ROLES[m[1]] ? [{ id: m[1], role: ROLES[m[1]] }] : []));
    res.end('[]');
  });
});
await new Promise((r) => fake.listen(0, r));

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env, PORT: String(PORT), SUPABASE_URL: `http://localhost:${fake.address().port}`, SUPABASE_SECRET_KEY: 'sb_secret_test',
    ADMIN_USER_IDS: '', COUNTDOWN_MS: '200', REVEAL_MS: '60000', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp, BLACKLIST_FILE: path.join(tmp, 'blacklist.json'), FEEDBACK_FILE: path.join(tmp, 'feedback.jsonl'),
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
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 8000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}
const modesOf = (s) => s.options.modes.map((m) => m.id);
const hidden = (s) => RESERVED.every((id) => !modesOf(s).includes(id) && !s.options.mixParts.includes(id) && !s.settings.mixParts.includes(id));

let failed = false;
const F = client('ami'), P = client('joueur'), G = client('invité');
try {
  await Promise.all([F.connected, P.connected, G.connected]);

  // ---- Hôte invité, puis hôte « player » : rien de réservé, et le serveur refuse
  for (const [host, token] of [[G, null], [P, 'tok-player-bbbbbbbbbbbbbbbbbbbbbbb']]) {
    if (token) assert.equal((await host.emit('auth:set', { token })).ok, true);
    const { code } = await host.emit('room:create', { name: 'Hôte' });
    const s = await host.waitFor((x) => x.code === code);
    assert.ok(hidden(s), `${host.label} : modes réservés absents`);
    assert.ok(!/sons/.test(s.options.modes.find((m) => m.id === 'mix').description), 'description du Mix sans eux');
    for (const mode of RESERVED) assert.match((await host.emit('room:settings', { mode })).error, /inconnu/, `${mode} refusé`);
    assert.match((await host.emit('room:settings', { mixPart: 'sounds' })).error, /inconnu/, 'pas dans le Mix');
    assert.equal((await host.emit('room:settings', { mode: 'mix', rounds: 20 })).ok, true);
    assert.equal((await host.emit('game:start')).ok, true);
    const q = await host.waitFor((x) => x.phase === 'question');
    assert.notEqual(q.round.kind, 'sound');
    await host.emit('game:stop');
    await host.emit('room:leave');
  }

  // ---- Hôte « friend » : tout le salon y a droit, invité compris
  assert.equal((await F.emit('auth:set', { token: 'tok-friend-aaaaaaaaaaaaaaaaaaaaaaa' })).ok, true);
  const { code } = await F.emit('room:create', { name: 'Ami' });
  assert.equal((await G.emit('room:join', { code, name: 'Invité' })).ok, true);
  const sg = await G.waitFor((x) => x.code === code && x.players.length === 2);
  for (const id of RESERVED) assert.ok(modesOf(sg).includes(id) && sg.options.mixParts.includes(id), `${id} visible par l'invité du salon`);
  assert.equal((await F.emit('room:settings', { mode: 'sounds', input: 'choice', rounds: 5, duration: 10 })).ok, true);
  assert.equal((await F.emit('game:start')).ok, true);
  const q = (await G.waitFor((x) => x.phase === 'question')).round;
  assert.equal(q.kind, 'sound');
  const url = q.sound.url;
  assert.match(url, new RegExp(`^/sfx/\\w+\\.mp3\\?r=${code}&k=[0-9a-f]{24}$`));
  assert.equal((await fetch(URL + url)).status, 200, 'son de la partie servi');
  assert.equal((await fetch(URL + url.split('?')[0])).status, 404, 'pas sans le salon');
  assert.equal((await fetch(URL + url.replace(/k=\w+/, 'k=' + '0'.repeat(24)))).status, 404, 'pas avec une autre clé');
  await F.emit('game:stop');
  await F.waitFor((x) => x.phase === 'end' || x.phase === 'lobby');

  // ---- L'ami se déconnecte de son compte : retour à un mode ouvert, modes réservés retirés
  await F.emit('room:settings', { mode: 'sounds' });
  await F.emit('auth:clear');
  const after = await G.waitFor((x) => x.settings.mode === 'quiz');
  assert.ok(hidden(after), 'modes réservés retirés après la déconnexion du compte de l\'hôte');
  assert.match((await F.emit('game:start')).ok ? 'ok' : 'x', /ok/);

  console.log('✓ Contenus réservés : cachés et refusés sans le rôle, ouverts au salon d\'un ami, fichiers protégés');

  // ---- Page « Proposer » : modes réservés proposés seulement aux comptes friend/admin
  const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {});
  const options = async (t) => Object.keys((await (await fetch(`${URL}/api/submit/options`, { headers: bearer(t) })).json()).modes);
  const submit = (t) => fetch(`${URL}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(t) }, body: JSON.stringify({ mode: 'sounds', game: 'Doom', file: 'data:audio/mpeg;base64,AAAA' }) });
  const friendIds = await options('tok-friend-aaaaaaaaaaaaaaaaaaaaaaa');
  for (const t of [null, 'tok-player-bbbbbbbbbbbbbbbbbbbbbbb', 'tok-inconnu-ccccccccccccccccccccccc']) {
    const ids = await options(t);
    assert.ok(ids.includes('quiz') && !ids.some((id) => RESERVED.includes(id)), `Proposer sans modes réservés (${t})`);
    assert.equal((await submit(t)).status, 403, `proposition réservée refusée (${t})`);
  }
  assert.ok(RESERVED.every((id) => friendIds.includes(id)), 'Proposer : modes réservés pour un ami');
  assert.notEqual((await submit('tok-friend-aaaaaaaaaaaaaaaaaaaaaaa')).status, 403, 'proposition réservée acceptée pour un ami');
  console.log('✓ Proposer : sons seulement pour un compte ami/admin');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [F, P, G]) c.socket.close();
  server.kill();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
