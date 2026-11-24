/**
 * Pitch mal expliqué : le résumé tordu (mais exact) d'un jeu, en une ou deux phrases.
 * Plus on trouve tôt, plus on marque.
 *
 * Mêmes façons de répondre que la jaquette (r.input) : 'choice' (4 propositions, 1 tentative)
 * ou 'text' (on tape le titre complet, 3 tentatives). Seuls l'énoncé et la correction changent.
 */
import cover from './cover.js';

export default {
  ...cover,

  publicRound: (r) => ({
    prompt: r.prompt,
    input: r.input,
    pitch: r.pitch,
    ...(r.input === 'choice' ? { choices: r.choices } : {}),
  }),

  reveal(r, answers) {
    const base = { correctText: r.title, year: r.year, pitch: r.pitch, image: r.image ?? null };
    if (r.input !== 'choice') return base;
    const counts = r.choices.map(() => 0);
    for (const { value } of answers.values()) counts[value]++;
    return { ...base, correctIndex: r.correctIndex, counts };
  },
};
