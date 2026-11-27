// Reprise des réponses déjà en base pour la cote (à lancer une fois, après la migration 2026-11-27-cote.sql).
// Rejoue les parties dans l'ordre chronologique : cote des joueurs, cote des questions, clé question_key
// ajoutée sur chaque réponse. Sans danger si relancé : les réponses qui ont déjà leur clé sont ignorées.
// Usage : node scripts/rating-backfill.js [--dry]   (SUPABASE_URL / SUPABASE_SECRET_KEY dans .env)
import '../server/env.js';
import { store } from '../server/store.js';
import { contentRows } from '../server/content-sync.js';
import { createRatings, questionKey } from '../server/rating.js';

const dry = process.argv.includes('--dry');
if (store.name !== 'supabase') {
  console.error('Pas de Supabase configuré : rien à reprendre.');
  process.exit(1);
}

// content_id (quiz:12, covers:slug…) → clé stable de la question
const keyOf = new Map();
for (const r of contentRows()) {
  const k = questionKey(r.mode, { slug: r.extra?.slug, soundId: r.mode === 'sounds' ? r.id.slice('sounds:'.length) : null, text: r.prompt });
  if (k) keyOf.set(r.id, k);
}

const games = await store.query('game_results', { order: 'created_at.asc', limit: 5000 });
const ratings = createRatings(store);
let done = 0;
let counted = 0;
for (const g of games) {
  const rows = (await store.query('answers', { eq: { game_id: g.id }, order: 'round_index.asc', limit: 500 })).filter((a) => !a.question_key);
  if (!rows.length) continue;
  const answers = rows.map((a) => ({
    id: a.id,
    answered: a.answered,
    correct: a.correct,
    questionKey: a.correct == null ? null : keyOf.get(a.content_id) ?? null,
    outcome: a.correct ? 1 : 0,
    guess: a.input === 'choice' ? (a.mode === 'vraifaux' ? 0.5 : 0.25) : 0,
  }));
  if (dry) {
    console.log(g.created_at, g.source, g.user_id.slice(0, 8), `${answers.filter((a) => a.questionKey).length}/${answers.length} questions reconnues`);
    continue;
  }
  const res = await ratings.recordGame({ userId: g.user_id, source: g.source, sessionId: g.session_id, answers, now: Date.parse(g.created_at) });
  for (const a of answers) if (a.questionKey) await store.update('answers', a.id, { question_key: a.questionKey });
  done++;
  counted += res?.counted ?? 0;
  console.log(g.created_at, g.source, g.user_id.slice(0, 8), res ? `${res.counted} comptées, cote ${Math.round(res.after.rating ?? 0) || '(placement ' + res.after.progress + '/' + res.after.need + ')'}` : 'ignorée');
}
console.log(dry ? 'Essai à blanc terminé.' : `${done} parties reprises, ${counted} réponses comptées.`);
