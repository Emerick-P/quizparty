// Test bout-en-bout du score global du salon : cumul sur plusieurs parties, victoires,
// partie arrêtée non comptée, retour d'un joueur parti, remise à zéro réservée à l'hôte.
// Usage : npm test
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const PORT = 3997;
const URL = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), COUNTDOWN_MS: '200', REVEAL_MS: '200' },
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

/** Joue une partie complète : chaque joueur répond `pick(client, index)` à chaque question. */
async function playGame(host, all, pick) {
  assert.equal((await host.emit('game:start')).ok, true);
  for (let i = 0; i < 5; i++) {
    const s = await host.waitFor((st) => st.phase === 'question' && st.round.index === i);
    for (const c of all) await c.emit('game:answer', { roundId: s.round.id, answer: pick(c, i) });
    await host.waitFor((st) => st.phase === 'reveal' && st.round.index === i);
  }
  return host.waitFor((st) => st.phase === 'end');
}

const byName = (s) => Object.fromEntries(s.players.map((p) => [p.name, p]));

let failed = false;
try {
  const A = client('A'), B = client('B');
  await Promise.all([A.connected, B.connected]);
  const created = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code: created.code, name: 'Bob' });
  await A.emit('room:settings', { mode: 'vraifaux', rounds: 5, duration: 10 });
  const lobby = await A.waitFor((s) => s.players.length === 2);
  assert.equal(lobby.gamesPlayed, 0, 'aucune partie au départ');
  assert.equal(byName(lobby).Alice.total, 0);

  // --- partie 1 : Alice répond 0, Bob 1 → l'un des deux marque à chaque question
  const end1 = await playGame(A, [A, B], (c) => (c === A ? 0 : 1));
  let p = byName(end1);
  assert.equal(end1.gamesPlayed, 1, '1 partie comptée');
  assert.equal(p.Alice.total, p.Alice.score, 'total = score après 1 partie (Alice)');
  assert.equal(p.Bob.total, p.Bob.score, 'total = score après 1 partie (Bob)');
  const first = { Alice: p.Alice.score, Bob: p.Bob.score };
  const best = Math.max(first.Alice, first.Bob);
  assert.equal(p.Alice.wins + p.Bob.wins >= 1, true, 'au moins un vainqueur');
  assert.equal(p.Alice.wins, first.Alice === best ? 1 : 0);
  console.log('Partie 1 :', first);

  // --- nouvelle partie : le score de partie repart de 0, le global reste
  assert.ok((await B.emit('room:reset-totals')).error, 'un non-hôte ne peut pas remettre à zéro');
  await A.emit('game:stop');
  const back = await A.waitFor((s) => s.phase === 'lobby');
  assert.equal(byName(back).Alice.total, first.Alice, 'global visible dans le salon');

  // --- partie 2 : tout le monde répond pareil
  const end2 = await playGame(A, [A, B], () => 0);
  p = byName(end2);
  assert.equal(end2.gamesPlayed, 2);
  assert.equal(p.Alice.total, first.Alice + p.Alice.score, 'cumul Alice');
  assert.equal(p.Bob.total, first.Bob + p.Bob.score, 'cumul Bob');
  const totals2 = { Alice: p.Alice.total, Bob: p.Bob.total };

  // --- une partie arrêtée en cours ne compte pas
  await A.emit('game:stop');
  await A.waitFor((s) => s.phase === 'lobby');
  await A.emit('game:start');
  const q = await A.waitFor((s) => s.phase === 'question');
  await A.emit('game:answer', { roundId: q.round.id, answer: 0 });
  await B.emit('game:answer', { roundId: q.round.id, answer: 0 });
  await A.waitFor((s) => s.phase === 'reveal');
  assert.ok((await A.emit('room:reset-totals')).error, 'pas de remise à zéro en pleine partie');
  await A.emit('game:stop');
  const stopped = await A.waitFor((s) => s.phase === 'lobby');
  assert.equal(stopped.gamesPlayed, 2, 'partie arrêtée non comptée');
  assert.equal(byName(stopped).Alice.total, totals2.Alice, 'total inchangé après arrêt');

  // --- Bob quitte puis revient sous le même pseudo : il retrouve son global
  await B.emit('room:leave');
  await A.waitFor((s) => s.players.length === 1);
  await B.emit('room:join', { code: created.code, name: 'bob' });
  const rejoined = await A.waitFor((s) => s.players.length === 2);
  assert.equal(rejoined.players.find((x) => x.name === 'bob').total, totals2.Bob, 'Bob retrouve son score global');

  // --- remise à zéro par l'hôte
  assert.equal((await A.emit('room:reset-totals')).ok, true);
  const reset = await B.waitFor((s) => s.gamesPlayed === 0);
  assert.ok(reset.players.every((x) => x.total === 0 && x.wins === 0), 'tout est à zéro');

  for (const c of [A, B]) c.socket.close();
  console.log('✅ Score global : tous les tests passent');
} catch (err) {
  failed = true;
  console.error('❌', err);
} finally {
  server.kill();
  process.exit(failed ? 1 : 0);
}
