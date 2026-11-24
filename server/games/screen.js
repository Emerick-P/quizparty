/**
 * HUD / Écran de chargement : une capture retouchée (indices masqués), il faut trouver le jeu.
 * Plus on trouve tôt, plus on marque. À la correction, la capture d'origine est montrée en entier.
 *
 * Mêmes façons de répondre que la jaquette (r.input) : 'choice' (4 propositions, 1 tentative)
 * ou 'text' (on tape le titre complet, 3 tentatives, validation stricte de fuzzy.js).
 */
import cover from './cover.js';

export default {
  ...cover,

  publicRound: (r) => ({
    prompt: r.prompt,
    input: r.input,
    screen: r.screen, // 'hud' | 'loading'
    image: { url: r.image.url, source: r.image.source },
    ...(r.input === 'choice' ? { choices: r.choices } : {}),
  }),

  reveal(r, answers) {
    const base = { correctText: r.title, year: r.year, image: r.full };
    if (r.input !== 'choice') return base;
    const counts = r.choices.map(() => 0);
    for (const { value } of answers.values()) counts[value]++;
    return { ...base, correctIndex: r.correctIndex, counts };
  },
};
