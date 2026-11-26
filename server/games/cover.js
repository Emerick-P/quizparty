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

/**
 * Paliers de pixelisation (colonnes de gros pixels). Anti-triche : le navigateur ne reçoit jamais la
 * jaquette nette pendant la question, seulement chaque palier, servi par /pix à son heure (Room.pixAllowed).
 * Vitesse de découverte : le niveau « devinable par la plupart » (27 colonnes, 7e palier) arrive quand il
 * reste environ 30 % du chrono (4 choix) et 33 % en saisie. Au-delà de 1, les derniers paliers ne sont
 * jamais atteints : l'image reste un peu pixelisée jusqu'au bout, elle n'est nette qu'à la correction.
 */
export const PIX_COLS = [4, 6, 8, 11, 15, 20, 27, 36, 48, 64];
const PIX_LAST_AT = { choice: 1.05, text: 1.0 };
export const PIX_PREFETCH_MS = 800; // un palier peut être téléchargé un peu avant son heure, pour s'afficher pile à l'heure

/** Paliers de la manche, avec l'heure serveur où chacun s'affiche (le même instant pour tous). */
export function pixLevels(r) {
  const last = PIX_LAST_AT[r.input] ?? 1;
  const span = r.endsAt - r.startsAt;
  const out = [{ cols: PIX_COLS[0], at: r.startsAt }];
  for (let k = 1; k < PIX_COLS.length; k++) {
    const at = r.startsAt + Math.ceil(((k * last) / (PIX_COLS.length - 1)) * span);
    if (!(at < r.endsAt)) break;
    out.push({ cols: PIX_COLS[k], at });
  }
  return out;
}
const MAX_GUESS_LENGTH = 60;

const isCorrect = (r, value) => (r.input === 'choice' ? value === r.correctIndex : matches(value, r.accepted));

export default {
  bonusMs: (r) => (r.input === 'text' ? 5000 : 0), // temps pour taper
  tries: (r) => (r.input === 'text' ? TEXT_TRIES : 1),
  isCorrect,

  publicRound: (r) => ({
    prompt: r.prompt,
    input: r.input,
    // Ni l'image nette ni la page du jeu (elles donneraient la réponse) : les paliers, servis à leur heure
    image: { source: r.image.source, levels: pixLevels(r).map((l, k) => ({ ...l, url: r.pix ? `/pix/${r.pix.token}/${k}${r.pix.q}` : null })) },
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
