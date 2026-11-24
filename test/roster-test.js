// Test de la liste des joueurs pendant une question : qui a répondu, qui a trouvé.
// Vérifie : en 4 choix / Vrai-Faux on voit seulement « a répondu » (jamais juste ou faux avant
// la correction) ; en réponse tapée on voit « a trouvé », les essais ratés, et « plus d'essais ».
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { PITCHES } from '../server/data/pitches.js';
import { COVER_GAMES } from '../server/data/cover-games.js';

const PORT = 3996;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-roster-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: '', // jamais la vraie base pendant les tests (même si .env la définit)
    COUNTDOWN_MS: '200',
    REVEAL_MS: '300',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
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
const byName = (s) => Object.fromEntries(s.players.map((p) => [p.name, p]));
const titleOf = (r) => COVER_GAMES.find((g) => g.slug === PITCHES.find((p) => p.pitch === r.pitch).slug).title;

let failed = false;
const A = client('A'), B = client('B'), C = client('C');
try {
  await Promise.all([A.connected, B.connected, C.connected]);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  await C.emit('room:join', { code, name: 'Chloé' });

  // ---- Vrai / Faux : « a répondu », sans dire si c'est juste
  await A.emit('room:settings', { mode: 'vraifaux', rounds: 5, duration: 10 });
  await A.waitFor((s) => s.players.length === 3 && s.settings.mode === 'vraifaux');
  assert.equal((await A.emit('game:start')).ok, true);
  let s = await A.waitFor((st) => st.phase === 'question');
  assert.ok(s.players.every((p) => p.status === null), 'personne n\'a encore répondu');
  await A.emit('game:answer', { roundId: s.round.id, answer: 0 });
  await B.emit('game:answer', { roundId: s.round.id, answer: 1 });
  s = await C.waitFor((st) => st.players.filter((p) => p.status).length === 2);
  assert.equal(byName(s).Alice.status, 'answered');
  assert.equal(byName(s).Bob.status, 'answered', 'une réponse fausse ou juste s\'affiche pareil');
  assert.equal(byName(s).Chloé.status, null);
  assert.ok(s.players.every((p) => p.misses === 0));
  assert.ok(!('correct' in byName(s).Alice), 'aucune info juste/faux avant la correction');
  console.log('✓ Vrai/Faux : « a répondu » visible par tous, sans juste/faux');
  await A.emit('game:stop');
  await A.waitFor((st) => st.phase === 'lobby');

  // ---- Pitch, nom tapé : « a trouvé », essais ratés, « plus d'essais »
  await A.emit('room:settings', { mode: 'pitch', rounds: 5, duration: 10, input: 'text' });
  await A.waitFor((st) => st.settings.mode === 'pitch' && st.settings.input === 'text');
  assert.equal((await A.emit('game:start')).ok, true);
  s = await A.waitFor((st) => st.phase === 'question');
  const rid = s.round.id;
  const title = titleOf(s.round);

  const miss = await B.emit('game:answer', { roundId: rid, answer: 'zzzz qqqq' });
  assert.equal(miss.wrong, true);
  s = await C.waitFor((st) => byName(st).Bob.misses === 1);
  assert.equal(byName(s).Bob.status, null, 'un essai raté ne compte pas comme une réponse');
  console.log('✓ un essai raté est vu tout de suite par les autres');

  const hit = await A.emit('game:answer', { roundId: rid, answer: title });
  assert.equal(hit.correct, true, `« ${title} » doit être accepté`);
  s = await C.waitFor((st) => byName(st).Alice.status === 'found');
  assert.equal(byName(s).Alice.misses, 0);
  console.log('✓ « a trouvé » visible par tous');

  await B.emit('game:answer', { roundId: rid, answer: 'zzzz rrrr' });
  await B.emit('game:answer', { roundId: rid, answer: 'zzzz ssss' });
  s = await C.waitFor((st) => byName(st).Bob.status === 'missed');
  assert.equal(byName(s).Bob.misses, 3);
  assert.equal(s.phase, 'question', 'Chloé n\'a pas répondu : la question continue');
  // La réponse n'est jamais dans l'état envoyé pendant la question
  assert.ok(!JSON.stringify(s).toLowerCase().includes(title.toLowerCase()), 'pas de fuite du titre chez Chloé');
  console.log('✓ « plus d\'essais » après 3 erreurs, pas de fuite du titre');

  await C.emit('game:answer', { roundId: rid, answer: title });
  s = await A.waitFor((st) => st.phase === 'reveal');
  assert.equal(byName(s).Chloé.status, 'found');
  await A.emit('game:stop');
  console.log('✓ liste des joueurs OK');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [A, B, C]) c.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
