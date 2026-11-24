/**
 * Question à réponse tapée (Quiz classique en « Réponse tapée »).
 * Seules les questions marquées `typed` dans la banque sont utilisées : réponse fermée et univoque.
 *
 * Validation stricte, la même que pour les titres de jeux (fuzzy.js) : casse, accents, ponctuation
 * et article en tête ignorés, rien d'autre. Les autres écritures légitimes sont listées par question.
 * 3 essais. Score : 1000 points pour une réponse immédiate, 500 au buzzer, 0 si pas trouvé.
 */
import { matches } from './fuzzy.js';

export const TEXT_TRIES = 3;
const MAX_GUESS_LENGTH = 60;

const isCorrect = (r, value) => matches(value, r.accepted);

export default {
  bonusMs: () => 5000, // temps pour taper
  tries: () => TEXT_TRIES,
  isCorrect,

  publicRound: (r) => ({ prompt: r.prompt, input: 'text' }),

  validate(_r, raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS_LENGTH);
    return s.length ? s : null;
  },

  answerText: (_r, value) => value,

  score(r, answers) {
    const out = new Map();
    for (const [pid, { value, timeMs }] of answers) {
      const correct = isCorrect(r, value);
      const speed = Math.min(1, timeMs / r.durationMs);
      out.set(pid, { correct, points: correct ? Math.round(1000 - 500 * speed) : 0 });
    }
    return out;
  },

  reveal: (r) => ({ correctText: r.answer }),
};
