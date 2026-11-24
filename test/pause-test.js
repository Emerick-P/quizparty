// Test de la pause de l'hôte et des retours sur une question (bouton ⚑ Signaler).
// Vérifie : seul l'hôte peut mettre en pause ; pendant la pause le chrono est figé pour tous
// (aucune fin de question ni passage à la suite, réponses refusées) ; à la reprise, le temps restant
// est exactement celui du moment de la pause ; les retours sont écrits sur disque avec la question.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const PORT = 3994;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-pause-'));
const FEEDBACK_FILE = path.join(tmp, 'feedback.jsonl');
const REVEAL_MS = 400;
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    COUNTDOWN_MS: '200',
    REVEAL_MS: String(REVEAL_MS),
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
    FEEDBACK_FILE,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = () => (fs.existsSync(FEEDBACK_FILE) ? fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  await A.emit('room:settings', { mode: 'quiz' });
  await A.emit('room:settings', { input: 'text' });
  await A.emit('room:settings', { duration: 10 });
  await A.emit('game:start');

  // ---- Pause pendant la question
  let s = await B.waitFor((st) => st.phase === 'question');
  const rid = s.round.id;
  const endsBefore = s.round.endsAt;
  assert.ok((await B.emit('game:pause')).error, 'un joueur ne peut pas mettre en pause');
  assert.ok(!(await A.emit('game:pause')).error);
  const [pa, pb] = await Promise.all([A.waitFor((st) => st.paused), B.waitFor((st) => st.paused)]);
  assert.equal(pa.paused.at, pb.paused.at, 'même heure de pause pour tous');
  assert.equal(pb.paused.by, 'Alice');
  const leftAtPause = endsBefore - pb.paused.at;
  assert.ok(leftAtPause > 0);
  await sleep(300); // au-delà de la compensation de latence : la réponse est bien partie après la pause
  const ans = await B.emit('game:answer', { roundId: rid, answer: 'zzzz' });
  assert.equal(ans.error, 'Partie en pause', 'réponse refusée pendant la pause');
  console.log('✓ pause de l\'hôte vue par tous à la même heure, réponses refusées');

  assert.ok((await B.emit('game:report', { type: 'remove' })).error, 'un joueur ne peut pas envoyer de retour');
  assert.ok((await A.emit('game:report', { type: 'nimporte' })).error, 'type de retour inconnu refusé');
  assert.ok((await A.emit('game:report', { type: 'accept' })).error, 'réponse à accepter obligatoire');
  const r1 = await A.emit('game:report', { type: 'accept', accept: 'Ma réponse', comment: 'Surnom courant' });
  assert.ok(r1.ok && r1.id);
  s = await B.waitFor((st) => st.round?.reported === 1);
  assert.ok(s.paused, 'toujours en pause après un retour sans reprise');
  await sleep(700);
  assert.equal(B.state.phase, 'question');
  assert.ok(B.state.paused);

  const resumedAt = Date.now();
  await A.emit('game:resume');
  s = await B.waitFor((st) => !st.paused);
  const shift = s.round.endsAt - endsBefore;
  assert.ok(shift >= 700, `échéance décalée de la durée de la pause (${shift} ms)`);
  const leftAfter = s.round.endsAt - s.serverNow;
  assert.ok(Math.abs(leftAfter - leftAtPause) < 150, `même temps restant qu'à la pause (${leftAtPause} → ${leftAfter} ms)`);
  assert.equal(s.phaseEndsAt, s.round.endsAt, 'phaseEndsAt décalé aussi');
  assert.ok(Date.now() - resumedAt < 1000);
  console.log(`✓ reprise : chrono décalé de ${shift} ms, ${Math.round(leftAfter / 100) / 10} s restantes comme à la pause`);

  const fb = lines();
  assert.equal(fb.length, 1);
  assert.equal(fb[0].type, 'accept');
  assert.equal(fb[0].accept, 'Ma réponse');
  assert.equal(fb[0].kind, 'typed');
  assert.equal(fb[0].mode, 'quiz');
  assert.ok(fb[0].question.prompt && Array.isArray(fb[0].question.accepted), 'question complète enregistrée');
  assert.ok(!('answers' in fb[0].question) && !('startsAt' in fb[0].question));
  console.log('✓ retour écrit sur disque avec la question complète');

  // ---- Pause pendant la correction : la suite n'arrive pas tant qu'on n'a pas repris
  await B.emit('game:answer', { roundId: rid, answer: 'zzzz aaaa' });
  await B.emit('game:answer', { roundId: rid, answer: 'zzzz bbbb' });
  await B.emit('game:answer', { roundId: rid, answer: 'zzzz cccc' });
  await A.emit('game:skip');
  s = await A.waitFor((st) => st.phase === 'reveal');
  const revealId = s.round.id;
  await A.emit('game:pause');
  await sleep(REVEAL_MS + 500);
  assert.equal(A.state.phase, 'reveal', 'la correction ne passe pas à la suite pendant la pause');
  assert.equal(A.state.round.id, revealId);
  const r2 = await A.emit('game:report', { type: 'wrong', comment: 'Réponse discutable', resume: true });
  assert.ok(r2.ok);
  s = await B.waitFor((st) => st.round && st.round.id !== revealId && !st.paused);
  console.log('✓ pause pendant la correction, puis « Envoyer et reprendre » enchaîne la question suivante');
  const fb2 = lines();
  assert.equal(fb2.length, 2);
  assert.equal(fb2[1].phase, 'reveal');
  assert.ok(fb2[1].answers.some((a) => a.name === 'Bob' && a.answer === 'zzzz cccc' && a.correct === false), 'réponses des joueurs enregistrées');

  // ---- « Passer » pendant une pause lève la pause
  s = await B.waitFor((st) => st.phase === 'question');
  await A.emit('game:pause');
  await B.waitFor((st) => st.paused);
  await A.emit('game:skip');
  s = await B.waitFor((st) => st.phase === 'reveal' && !st.paused);
  // ---- Arrêter pendant une pause
  await A.emit('game:pause');
  await A.emit('game:stop');
  s = await B.waitFor((st) => st.phase === 'lobby');
  assert.equal(s.paused, null);
  console.log('✓ Passer / Arrêter pendant une pause');
  console.log('✓ pause et retours OK');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [A, B]) c.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
