// Test du Quiz classique en « Réponse tapée » : seules les questions marquées `typed` sont posées,
// la réponse ne fuit pas, les écritures listées passent, une réponse fausse coûte un essai (3 essais),
// une faute de frappe est refusée, score selon la rapidité, pas de répétition d'une partie à l'autre.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { QCM } from '../server/data/questions.js';
import { normalize } from '../server/games/fuzzy.js';

const byPrompt = new Map(QCM.map((q) => [q.q, q]));

const PORT = 3996;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-quiztext-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env, PORT: String(PORT),
    SUPABASE_URL: '', /* jamais la vraie base pendant les tests */ COUNTDOWN_MS: '200', REVEAL_MS: '300',
    TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', IMAGE_CACHE_DIR: tmp, BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
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
/** Une faute de frappe : deux lettres voisines inversées (ou une lettre ajoutée si impossible). */
function typo(t) {
  const k = [...t].findIndex((c, j) => /[a-z]/i.test(c) && /[a-z]/i.test(t[j + 1] ?? '') && c.toLowerCase() !== t[j + 1].toLowerCase());
  return k < 0 ? `${t}x` : t.slice(0, k) + t[k + 1] + t[k] + t.slice(k + 2);
}

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);
  assert.equal(A.state.options.modes.find((m) => m.id === 'quiz').inputs, true, 'quiz : choix du format de réponse');

  assert.equal((await A.emit('room:settings', { mode: 'quiz', input: 'text', rounds: 5, duration: 10 })).ok, true);
  const seen = new Set();
  for (let game = 0; game < 2; game++) {
    assert.equal((await A.emit('game:start')).ok, true);
    for (let i = 0; i < 5; i++) {
      const r = (await A.waitFor((x) => x.phase === 'question' && x.round?.index === i)).round;
      assert.equal(r.kind, 'typed');
      assert.equal(r.input, 'text');
      assert.equal(r.choices, undefined, 'pas de propositions');
      assert.equal(r.answer, undefined, 'la réponse ne fuit pas');
      assert.equal(r.accepted, undefined, 'les réponses acceptées ne fuient pas');
      assert.equal(r.tries, 3);
      assert.equal(r.durationMs, 15000, '5 s de plus pour taper');
      const q = byPrompt.get(r.prompt);
      assert.ok(q?.typed, `question marquée typed : « ${r.prompt} »`);
      assert.ok(!seen.has(r.prompt), 'pas de répétition entre deux parties du salon');
      seen.add(r.prompt);
      const answer = q.choices[0];

      // Bob : une réponse fausse, puis une faute de frappe (refusée), puis la bonne réponse écrite autrement
      const wrong = q.choices[1];
      const w1 = await B.emit('game:answer', { roundId: r.id, answer: wrong });
      assert.equal(w1.wrong, true, `« ${wrong} » refusé pour « ${answer} »`);
      assert.equal(w1.triesLeft, 2);
      const t = typo(answer);
      if (normalize(t).replace(/ /g, '') !== normalize(answer).replace(/ /g, '')) {
        const w2 = await B.emit('game:answer', { roundId: r.id, answer: t });
        assert.equal(w2.wrong, true, `faute de frappe « ${t} » refusée`);
      }
      // Alice : la bonne réponse en minuscules, sans accents (ou une écriture listée)
      const alt = Array.isArray(q.typed) && q.typed.length ? q.typed[i % q.typed.length] : answer;
      const plain = alt.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const ra = await A.emit('game:answer', { roundId: r.id, answer: plain });
      assert.equal(ra.correct, true, `« ${plain} » accepté pour « ${answer} »`);
      if (i === 0 && game === 0) await sleep(1200);
      const rb = await B.emit('game:answer', { roundId: r.id, answer });
      assert.equal(rb.correct, true, `« ${answer} » accepté`);

      const rv = (await A.waitFor((x) => x.phase === 'reveal' && x.round.index === i)).reveal;
      assert.equal(rv.correctText, answer);
      assert.equal(rv.info ?? undefined, q.info);
      const a = rv.results.find((x) => x.name === 'Alice'), b = rv.results.find((x) => x.name === 'Bob');
      assert.ok(a.correct && a.points > 900, 'réponse rapide bien payée');
      assert.ok(b.correct && b.points <= a.points, 'réponse plus tardive pas mieux payée');
      if (i === 0 && game === 0) assert.ok(b.points < a.points - 20, 'réponse tardive moins payée');
    }
    await A.waitFor((s) => s.phase === 'end');
  }
  console.log('✓ quiz en réponse tapée : 2 parties, questions marquées seulement, variantes acceptées, fautes refusées');

  // 3 erreurs : plus d'essais
  assert.equal((await A.emit('game:start')).ok, true);
  const r = (await A.waitFor((x) => x.phase === 'question' && x.round?.index === 0)).round;
  for (const n of [2, 1]) assert.equal((await B.emit('game:answer', { roundId: r.id, answer: `faux ${n}` })).triesLeft, n);
  const last = await B.emit('game:answer', { roundId: r.id, answer: 'faux 0' });
  assert.equal(last.correct, false, '3ᵉ erreur : plus d\'essais');
  const st = await B.waitFor((x) => x.round?.yourAnswer != null);
  assert.equal(st.round.yourCorrect, false);
  // Alice : un seul essai raté, puis plus rien. La correction montre les saisies de ceux qui n'ont pas trouvé.
  assert.equal((await A.emit('game:answer', { roundId: r.id, answer: 'essai alice' })).triesLeft, 2);
  await A.emit('game:skip');
  const rv = (await A.waitFor((x) => x.phase === 'reveal' && x.round.id === r.id)).reveal;
  assert.deepEqual(rv.results.find((x) => x.name === 'Bob').guesses, ['faux 2', 'faux 1', 'faux 0'], 'les 3 saisies de Bob');
  assert.deepEqual(rv.missed, [{ playerId: A.state.you, name: 'Alice', guesses: ['essai alice'] }], 'Alice, sans réponse finale, apparaît avec sa saisie');
  console.log('✓ 3 essais maximum, saisies ratées montrées à la correction');
  console.log('✅ Quiz réponse tapée : tous les tests passent');
} catch (e) {
  failed = true;
  console.error('❌', e);
} finally {
  A.socket.close(); B.socket.close(); server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
