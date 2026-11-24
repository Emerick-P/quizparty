/**
 * Jaquette pixelisée : une jaquette s'affiche très pixelisée et se précise au fil du chrono.
 * Plus on trouve tôt, plus on marque.
 *
 * Deux façons de répondre (r.input) :
 * - 'choice' : 4 propositions, une seule tentative.
 * - 'text'   : on tape le nom complet (accents, ponctuation et majuscules ignorés), 3 tentatives.
 *
 * La pixelisation est calculée par chaque navigateur à partir de l'horloge serveur
 * (startsAt / endsAt) : tout le monde voit le même niveau de détail au même instant.
 */
import { matches } from './fuzzy.js';

export const TEXT_TRIES = 3;
const MAX_GUESS_LENGTH = 60;

const isCorrect = (r, value) => (r.input === 'choice' ? value === r.correctIndex : matches(value, r.accepted));

export default {
  bonusMs: (r) => (r.input === 'text' ? 5000 : 0), // temps pour taper
  tries: (r) => (r.input === 'text' ? TEXT_TRIES : 1),
  isCorrect,

  publicRound: (r) => ({
    prompt: r.prompt,
    input: r.input,
    image: { url: r.image.url, source: r.image.source }, // pas la page du jeu : elle donnerait la réponse
    ...(r.input === 'choice' ? { choices: r.choices } : {}),
  }),

  validate(r, raw) {
    if (r.input === 'choice') {
      const i = Number(raw);
      return Number.isInteger(i) && i >= 0 && i < r.choices.length ? i : null;
    }
    if (typeof raw !== 'string') return null;
    const s = raw.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS_LENGTH);
    return s.length ? s : null;
  },

  answerText: (r, value) => (r.input === 'choice' ? r.choices[value] : value),

  score(r, answers) {
    const out = new Map();
    for (const [pid, { value, timeMs }] of answers) {
      const correct = isCorrect(r, value);
      const speed = Math.min(1, timeMs / r.durationMs);
      // L'image se précise avec le temps : trouver tôt vaut beaucoup plus qu'au QCM classique
      out.set(pid, { correct, points: correct ? Math.round(1000 - 800 * speed) : 0 });
    }
    return out;
  },

  reveal(r, answers) {
    const base = {
      correctText: r.title,
      year: r.year,
      image: r.image,
    };
    if (r.input !== 'choice') return base;
    const counts = r.choices.map(() => 0);
    for (const { value } of answers.values()) counts[value]++;
    return { ...base, correctIndex: r.correctIndex, counts };
  },
};
