import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QCM, TRUE_FALSE, ESTIMATION } from './data/questions.js';
import { COVER_GAMES } from './data/cover-games.js';
import { PITCHES } from './data/pitches.js';
import { EMOJI_PUZZLES } from './data/emojis.js';
import { CROSSWORD_WORDS } from './data/crosswords.js';

/**
 * Copie EN LECTURE du contenu du jeu dans la table Supabase « content », pour que le client puisse
 * filtrer et trier les questions dans le Table Editor de Supabase. La référence reste server/data/… :
 * la table n'est réécrite que si le contenu a changé (empreinte stockée dans la table « meta »).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f, key) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))[key] ?? []; } catch { return []; } };

export function contentRows() {
  const titleOf = new Map(COVER_GAMES.map((g) => [g.slug, g.title]));
  const game = (x) => x.title ?? titleOf.get(x.slug) ?? x.slug ?? null;
  const rows = [];
  const add = (r) => rows.push({ game: null, prompt: null, answer: null, choices: null, level: null, info: null, extra: {}, ...r });
  QCM.forEach((q, i) => add({ id: `quiz:${i}`, mode: 'quiz', prompt: q.q, answer: q.choices[0], choices: q.choices.slice(1), info: q.info ?? null, extra: q.typed ? { typed: q.typed } : {} }));
  TRUE_FALSE.forEach((q, i) => add({ id: `vraifaux:${i}`, mode: 'vraifaux', prompt: q.q, answer: q.a ? 'Vrai' : 'Faux', info: q.info ?? null }));
  ESTIMATION.forEach((q, i) => add({ id: `estimation:${i}`, mode: 'estimation', prompt: q.q, answer: String(q.a), info: q.info ?? null, extra: { ...(q.unit ? { unit: q.unit } : {}), ...(q.year ? { year: true } : {}) } }));
  COVER_GAMES.forEach((g) => add({ id: `covers:${g.slug}`, mode: 'covers', game: g.title, answer: g.title, extra: { slug: g.slug, year: g.year, ...(g.aliases ? { aliases: g.aliases } : {}), ...(g.short ? { short: g.short } : {}) } }));
  PITCHES.forEach((p, i) => add({ id: `pitch:${i}`, mode: 'pitch', game: game(p), prompt: p.pitch, answer: game(p), level: p.level ?? null }));
  EMOJI_PUZZLES.forEach((e, i) => add({ id: `emoji:${i}`, mode: 'emoji', game: game(e), prompt: e.emojis, answer: game(e), level: e.level ?? null, info: e.why ?? null }));
  readJson('data/sounds/sounds.json', 'sounds').forEach((s) => add({ id: `sounds:${s.id}`, mode: 'sounds', game: game(s), prompt: s.what ?? null, answer: game(s), extra: { source: s.source?.site ?? null, seriesWide: !!s.seriesWide } }));
  CROSSWORD_WORDS.forEach((w, i) => add({ id: `crossword:${i}`, mode: 'crossword', prompt: w.clue, answer: w.word, level: w.level ?? null }));
  return rows;
}

export async function syncContent(store) {
  if (store.name !== 'supabase') return { skipped: true };
  const rows = contentRows();
  const hash = crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex');
  if ((await store.getMeta('content_hash')) === hash) return { unchanged: true, count: rows.length };
  await store.replaceAll('content', rows);
  await store.setMeta('content_hash', hash);
  return { updated: true, count: rows.length };
}
