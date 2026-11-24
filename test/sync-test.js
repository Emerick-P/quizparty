// Test bout-en-bout : lance un serveur, simule 3 joueurs et joue une partie complète.
// Usage : npm test
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT),
    SUPABASE_URL: '', /* jamais la vraie base pendant les tests */ COUNTDOWN_MS: '400', REVEAL_MS: '400' },
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
  c.waitFor = (pred, ms = 5000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}

let failed = false;
try {
  const A = client('A'), B = client('B'), C = client('C');
  await Promise.all([A.connected, B.connected, C.connected]);

  // --- horloge
  const t0 = Date.now();
  const serverTime = await new Promise((r) => A.socket.emit('time:ping', null, r));
  assert.ok(Math.abs(serverTime - t0) < 200, 'ping horloge cohérent');

  // --- salon
  const created = await A.emit('room:create', { name: 'Alice' });
  assert.ok(created.code && created.token, 'création du salon');
  assert.equal((await B.emit('room:join', { code: created.code.toLowerCase(), name: 'Bob' })).ok, true);
  const joinC = await C.emit('room:join', { code: created.code, name: 'alice' });
  assert.equal(joinC.ok, true);
  const lobby = await A.waitFor((s) => s.players.length === 3);
  assert.deepEqual(lobby.players.map((p) => p.name), ['Alice', 'Bob', 'alice 2'], 'pseudos dédoublonnés');
  assert.equal((await B.emit('room:join', { code: 'ZZZZ', name: 'x' })).error, 'Salon introuvable');

  // --- droits hôte
  assert.ok((await B.emit('game:start')).error, 'un non-hôte ne peut pas lancer');
  assert.ok((await A.emit('room:settings', { rounds: 7 })).error, 'valeur hors liste refusée');
  // Mix en 4 choix (par défaut il mélange 4 choix et réponse tapée) : ce test répond par index
  assert.equal((await A.emit('room:settings', { mode: 'mix', rounds: 5, duration: 10, mixInput: 'choice' })).ok, true);

  // --- partie
  assert.equal((await A.emit('game:start')).ok, true);
  const [sa, sb, sc] = await Promise.all([A, B, C].map((c) => c.waitFor((s) => s.phase === 'countdown')));
  assert.equal(sa.round.id, sb.round.id);
  assert.equal(sa.round.startsAt, sc.round.startsAt, 'même heure de départ pour tous');
  assert.equal(sa.round.endsAt, sb.round.endsAt, 'même échéance pour tous');
  assert.equal(sa.round.correctIndex, undefined, 'la bonne réponse ne fuit pas');
  assert.equal(sa.round.answer, undefined, 'la bonne réponse ne fuit pas');

  // réponse avant le départ → refusée
  assert.equal((await B.emit('game:answer', { roundId: sa.round.id, answer: 0 })).error, 'Trop tôt !');

  let resumedOnce = false;
  for (let i = 0; i < 5; i++) {
    const s = await A.waitFor((st) => st.phase === 'question' && st.round.index === i);
    const answerFor = (c) => (s.round.kind === 'estimation' ? (c === A ? 100 : '1 234,5') : 0);

    const ra = await A.emit('game:answer', { roundId: s.round.id, answer: answerFor(A) });
    assert.equal(ra.ok, true, `réponse A acceptée (manche ${i})`);
    assert.equal((await A.emit('game:answer', { roundId: s.round.id, answer: answerFor(A) })).error, 'Tu as déjà répondu');
    await sleep(150);
    assert.equal((await B.emit('game:answer', { roundId: s.round.id, answer: answerFor(B) })).ok, true);

    if (!resumedOnce) {
      // C perd la connexion puis revient avec son jeton : il retrouve sa place
      resumedOnce = true;
      C.socket.disconnect();
      await A.waitFor((st) => st.players.find((p) => p.name === 'alice 2')?.connected === false);
      // A et B ont répondu, C est déconnecté → la question se termine sans attendre
      await A.waitFor((st) => st.phase === 'reveal' && st.round.index === i);
      C.socket.connect();
      await C.connected;
      assert.ok((await C.emit('room:resume', { code: created.code, token: 'faux' })).error, 'jeton invalide refusé');
      assert.equal((await C.emit('room:resume', { code: created.code, token: joinC.token })).ok, true, 'C reprend sa place');
      const sC = await C.waitFor((st) => st.you === joinC.playerId && st.phase === 'reveal');
      assert.ok(sC.players.find((p) => p.id === joinC.playerId).connected, 'C de nouveau en ligne');
    } else {
      assert.equal((await C.emit('game:answer', { roundId: s.round.id, answer: answerFor(C) })).ok, true);
    }

    const rev = await A.waitFor((st) => st.phase === 'reveal' && st.round.index === i);
    assert.ok(rev.reveal.correctText, 'correction présente');
    const sum = rev.players.reduce((n, p) => n + p.score, 0);
    assert.ok(sum >= 0);
    assert.equal(rev.reveal.results.length, i === 0 ? 2 : 3, 'nombre de réponses');
  }
  const end = await A.waitFor((s) => s.phase === 'end', 8000);
  assert.equal(end.players.length, 3);
  console.log('Classement final :', end.players.map((p) => `${p.name}=${p.score}`).join(', '));

  // --- reconnexion avec jeton valide
  const D = client('D');
  await D.connected;
  const tokenB = await B.emit('room:leave');
  assert.equal(tokenB.ok, true);
  const afterLeave = await A.waitFor((s) => s.players.length === 2);
  assert.ok(afterLeave.players.every((p) => p.name !== 'Bob'), 'Bob a quitté');

  // --- transfert d'hôte quand l'hôte quitte
  await A.emit('room:leave');
  await D.emit('room:join', { code: created.code, name: 'Dan' });
  const sd = await D.waitFor((s) => s.players.length >= 1);
  assert.notEqual(sd.hostId, created.playerId, "l'hôte a été transféré");

  // --- reconnexion réelle avec jeton
  const E = client('E');
  await E.connected;
  const joinE = await E.emit('room:join', { code: created.code, name: 'Eve' });
  E.socket.disconnect();
  const E2 = client('E2');
  await E2.connected;
  const resumed = await E2.emit('room:resume', { code: created.code, token: joinE.token });
  assert.equal(resumed.ok, true, 'reprise de session');
  const se = await E2.waitFor((s) => s.you === joinE.playerId);
  assert.equal(se.players.find((p) => p.id === joinE.playerId).connected, true);

  for (const c of [A, B, C, D, E, E2]) c.socket.close();
  console.log('✅ Tous les tests passent');
} catch (err) {
  failed = true;
  console.error('❌', err);
} finally {
  server.kill();
  process.exit(failed ? 1 : 0);
}
