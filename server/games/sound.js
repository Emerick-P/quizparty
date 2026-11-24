/**
 * Quel jeu fait ce bruit ? : un son court (pièce de Mario, « Hadouken ! »…), il faut trouver le jeu.
 * Plus on trouve tôt, plus on marque. Le son part pour tout le monde à l'heure de début de la manche
 * (horloge serveur) et chacun peut le réécouter.
 *
 * Mêmes façons de répondre que la jaquette (r.input) : 'choice' (4 propositions, 1 tentative)
 * ou 'text' (on tape le titre, 3 tentatives, validation stricte de fuzzy.js).
 */
import cover from './cover.js';

export default {
  ...cover,

  publicRound: (r) => ({
    prompt: r.prompt,
    input: r.input,
    sound: r.sound, // { url } : nom de fichier aléatoire, il ne trahit pas le jeu
    ...(r.input === 'choice' ? { choices: r.choices } : {}),
  }),

  reveal(r, answers) {
    const base = {
      correctText: r.series ? `Série ${r.title}` : r.title,
      year: r.series ? null : r.year,
      what: r.what,
      credit: r.credit,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      image: r.image ?? null,
    };
    if (r.input !== 'choice') return base;
    const counts = r.choices.map(() => 0);
    for (const { value } of answers.values()) counts[value]++;
    return { ...base, correctIndex: r.correctIndex, counts };
  },
};
