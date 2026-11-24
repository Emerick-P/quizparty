/**
 * Question à choix (QCM 4 choix, ou Vrai/Faux à 2 choix).
 * Score : 1000 points pour une réponse immédiate, 500 au buzzer, 0 si faux.
 */
export default {
  publicRound: (r) => ({ prompt: r.prompt, choices: r.choices }),

  validate(r, raw) {
    const i = Number(raw);
    return Number.isInteger(i) && i >= 0 && i < r.choices.length ? i : null;
  },

  answerText: (r, value) => r.choices[value],

  score(r, answers) {
    const out = new Map();
    for (const [pid, { value, timeMs }] of answers) {
      const correct = value === r.correctIndex;
      const speed = Math.min(1, timeMs / r.durationMs);
      out.set(pid, { correct, points: correct ? Math.round(1000 - 500 * speed) : 0 });
    }
    return out;
  },

  reveal(r, answers) {
    const counts = r.choices.map(() => 0);
    for (const { value } of answers.values()) counts[value]++;
    return { correctIndex: r.correctIndex, correctText: r.choices[r.correctIndex], counts };
  },
};
