// Test de la cote (rating.js), sans serveur, sur un stockage local temporaire :
// - Glicko-2 : exemple de l'article de Glickman (1500/200 contre 1400, 1550, 1700 → ≈ 1464 / 151,5) ;
// - hasard du QCM : une bonne réponse à 4 choix rapporte moins qu'une bonne réponse tapée ;
// - une question déjà vue ne compte plus ; absent (moins de la moitié des manches) : partie ignorée ;
// - les questions bougent (réussie → plus facile) ; placement après RATING.placement réponses ;
// - saison suivante : reset léger vers 1500 ; incertitude qui grandit avec l'absence, note inchangée.
// Usage : node test/rating-test.js (inclus dans npm test)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-cote-'));
process.env.STATS_LOCAL = '1';
const { createStore } = await import('../server/store.js');
const { createStats } = await import('../server/stats.js');
const { glicko, questionKey, publicRating, RATING, seasonOf, guessOf } = await import('../server/rating.js');

// ---- Glicko-2 : exemple de référence (Glickman, « Example of the Glicko-2 system »)
{
  const r = glicko({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, s: 1 },
    { rating: 1550, rd: 100, s: 0 },
    { rating: 1700, rd: 300, s: 0 },
  ]);
  assert.ok(Math.abs(r.rating - 1464.06) < 0.1, `cote ${r.rating}`);
  assert.ok(Math.abs(r.rd - 151.52) < 0.1, `rd ${r.rd}`);
  assert.ok(Math.abs(r.vol - 0.05999) < 0.0001, `volatilité ${r.vol}`);
  console.log('✓ Glicko-2 conforme à l’exemple de référence');
}

// ---- Hasard : réussir un QCM à 4 choix rapporte moins que réussir en tapant
{
  const p = { rating: 1500, rd: 200, vol: 0.06 };
  const typed = glicko(p, [{ rating: 1500, rd: 100, s: 1, c: 0 }]);
  const qcm = glicko(p, [{ rating: 1500, rd: 100, s: 1, c: 0.25 }]);
  assert.ok(typed.rating > qcm.rating && qcm.rating > 1500);
  const failQcm = glicko(p, [{ rating: 1500, rd: 100, s: 0, c: 0.25 }]);
  assert.ok(1500 - failQcm.rating > qcm.rating - 1500, 'rater un QCM coûte plus que le réussir ne rapporte');
  assert.equal(guessOf({ kind: 'qcm', choices: ['a', 'b', 'c', 'd'] }), 0.25);
  assert.equal(guessOf({ kind: 'qcm', choices: ['Vrai', 'Faux'] }), 0.5);
  assert.equal(guessOf({ kind: 'cover', input: 'text', choices: ['a', 'b', 'c', 'd'] }), 0);
  assert.equal(questionKey('bande', { text: 'x' }), null, 'Ta bande : pas de cote');
  assert.equal(questionKey('quiz', { text: ' Qui  est Mario ? ' }), questionKey('quiz', { text: 'Qui est Mario ?' }), 'clé stable');
  console.log('✓ part de hasard et clés des questions');
}

// ---- Parcours complet sur stockage local
const store = createStore({ SUBMISSIONS_DIR: dir });
const stats = createStats(store);
const ans = (i, correct, extra = {}) => ({ roundIndex: i, mode: 'quiz', kind: 'qcm', answered: true, correct, points: correct ? 500 : 0, timeMs: 1000, questionKey: `quiz:test${i}`, outcome: correct ? 1 : 0, guess: 0.25, ...extra });
const batch = (from, n, correct) => Array.from({ length: n }, (_, k) => ans(from + k, correct));
{
  const g1 = await stats.recordGame({ userId: 'u1', source: 'live', sessionId: 'A', mode: 'quiz', answers: batch(0, 10, true) });
  assert.equal(g1.rating.counted, 10);
  assert.equal(g1.rating.after.placed, false, 'pas encore placé');
  assert.equal(g1.rating.after.rating, null, 'pas de nombre avant le placement');
  assert.equal(g1.rating.after.progress, 10);

  // Salons et défis entre potes : jamais comptés dans la cote
  for (const source of ['party', 'challenge']) {
    const x = await stats.recordGame({ userId: 'u1', source, sessionId: `X-${source}`, mode: 'quiz', answers: batch(900, 10, true) });
    assert.equal(x.rating, null, `${source} : hors cote`);
  }

  // Les mêmes questions une 2e fois : ne comptent plus
  const g2 = await stats.recordGame({ userId: 'u1', source: 'live', sessionId: 'B', mode: 'quiz', answers: batch(0, 10, true) });
  assert.equal(g2.rating, null, 'questions déjà vues : rien ne compte');

  // Absent : 2 réponses sur 10
  const afk = batch(100, 10, false).map((a, i) => (i < 8 ? { ...a, answered: false } : a));
  const g3 = await stats.recordGame({ userId: 'u1', source: 'live', sessionId: 'C', mode: 'quiz', answers: afk });
  assert.equal(g3.rating, null, 'joueur absent : partie ignorée');

  // Les questions réussies deviennent plus faciles
  const q = (await store.query('question_ratings', { inList: { id: ['quiz:test0'] } }))[0];
  assert.ok(q && q.rating < 1500 && q.n === 1, `question ${q?.rating}`);

  // Placement : 30 réponses comptées
  await stats.recordGame({ userId: 'u1', source: 'daily', sessionId: 'D1', mode: 'daily', answers: batch(200, 10, true) });
  const g4 = await stats.recordGame({ userId: 'u1', source: 'live', sessionId: 'E', mode: 'quiz', answers: batch(300, 10, true), versus: [{ userId: 'u2', score: 1 }] });
  assert.equal(g4.rating.after.placed, true);
  assert.ok(g4.rating.after.rating > 1600, `tout juste : cote ${g4.rating.after.rating}`);
  assert.equal(g4.rating.delta, null, 'pas de gain affiché la partie du placement');
  const g5 = await stats.recordGame({ userId: 'u1', source: 'live', sessionId: 'F', mode: 'quiz', answers: batch(400, 10, false) });
  assert.ok(g5.rating.delta < 0, 'tout faux : la cote baisse');
  assert.equal((await stats.ratingOf('u1')).placed, true);
  assert.equal((await store.query('rating_events', { eq: { user_id: 'u1' } })).length, 4);
  console.log('✓ partie, déjà vu, absent, questions, placement, gain');

  // Réponses enregistrées avec leur clé de question
  const saved = await store.where('answers', (a) => a.user_id === 'u1');
  assert.ok(saved.every((a) => a.question_key?.startsWith('quiz:test')));
}

// ---- Absence et saison suivante
{
  const row = (await store.query('player_ratings', { eq: { user_id: 'u1' } }))[0];
  const later = Date.parse(row.last_at) + 90 * 86_400_000;
  const pub = publicRating(row, later);
  assert.equal(pub.rating, Math.round(row.rating), 'l’absence ne change pas la note');
  assert.ok(pub.rd > row.rd + 10, `incertitude ${row.rd} → ${pub.rd}`);
  const next = Date.parse(`${seasonOf()}-01T12:00:00Z`) + 40 * 86_400_000;
  const s2 = await stats.ratingOf('u1', next);
  assert.notEqual(s2.season, row.season);
  assert.equal(s2.rating, Math.round(1500 + RATING.season.keep * (row.rating - 1500)), 'reset léger de saison');
  assert.equal(s2.placed, true, 'le placement reste acquis');
  console.log('✓ absence et changement de saison');
}

// ---- Classement : placés seulement, triés par cote, saison du mois ; un autre mois = nouvelle saison
{
  await store.upsert('profiles', { id: 'u1', name: 'Alice', nickname: 'Ally', avatar_look: 'e:1:2' });
  await store.upsert('player_ratings', { id: `${seasonOf()}:u2`, season: seasonOf(), user_id: 'u2', rating: 1700, rd: 80, vol: 0.06, answers: 40, answers_total: 40, games: 3, peak: 1710 });
  await store.upsert('player_ratings', { id: `${seasonOf()}:u3`, season: seasonOf(), user_id: 'u3', rating: 1900, rd: 300, vol: 0.06, answers: 5, answers_total: 5, games: 1, peak: null });
  const b = await stats.ratingBoard();
  assert.equal(b.season, seasonOf());
  assert.deepEqual(b.list.map((x) => x.userId), b.list.map((x) => x.userId).sort((a, c) => b.list.find((y) => y.userId === c).rating - b.list.find((y) => y.userId === a).rating), 'trié par cote');
  assert.ok(!b.list.some((x) => x.userId === 'u3'), 'non placé : absent');
  assert.equal(b.list.find((x) => x.userId === 'u1')?.name, 'Ally', 'pseudo du profil');
  const later = await stats.ratingBoard(100, Date.parse(`${seasonOf()}-01T12:00:00Z`) + 40 * 86_400_000);
  assert.equal(later.list.length, 0, 'saison suivante : classement vide jusqu’aux premières parties');
  console.log('✓ classement par cote');
}

// ---- Invité : rien
assert.equal(await stats.recordGame({ userId: null, answers: batch(0, 10, true) }), null);
fs.rmSync(dir, { recursive: true, force: true });
console.log('✓ cote : tout est bon');
