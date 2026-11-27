/**
 * Estimation : chacun propose un nombre, le plus proche gagne.
 * Classement par écart, puis par rapidité en cas d'égalité.
 * - Questions classiques : écart relatif (en %), "exact" à 0,5 % près.
 * - Questions d'année (year: true) : écart en années, "exact" seulement si l'année est juste.
 *   (Un écart relatif n'a pas de sens ici : 1990 au lieu de 1985 ne ferait que 0,25 %.)
 */
const RANK_POINTS = [1000, 750, 550, 400, 300, 250, 200, 150];
const YEAR_SCALE = 50; // 50 ans d'écart = "complètement à côté"
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

export const formatNumber = (n) => nf.format(n);
const formatValue = (r, n) => (r.year ? String(n) : `${formatNumber(n)}${r.unit ? ' ' + r.unit : ''}`);

export default {
  bonusMs: () => 5000, // temps en plus pour taper un nombre
  publicRound: (r) => ({ prompt: r.prompt, unit: r.unit, year: !!r.year }),

  validate(r, raw) {
    const n = typeof raw === 'string' ? Number(raw.replace(/\s/g, '').replace(',', '.')) : Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e13) return null;
    return r.year ? Math.round(n) : n;
  },

  answerText: (r, value) => formatValue(r, value),

  score(r, answers) {
    const target = r.answer;
    const errText = (row) => (r.year
      ? `${row.diff} an${row.diff > 1 ? 's' : ''} d'écart`
      : `écart ${formatNumber(Math.round(row.error * 1000) / 10)} %`);
    const rows = [...answers].map(([pid, { value, timeMs }]) => {
      const diff = Math.abs(value - target);
      return {
        pid,
        timeMs,
        diff,
        error: r.year ? diff / YEAR_SCALE : diff / Math.max(Math.abs(target), 1e-9),
      };
    });
    rows.sort((a, b) => a.error - b.error || a.timeMs - b.timeMs);

    const out = new Map();
    rows.forEach((row, i) => {
      const exact = r.year ? row.diff === 0 : row.error <= 0.005;
      let points;
      if (r.absolute) {
        // Défi du jour (on joue seul) : points selon l'écart, pas selon le rang.
        // 800 pts au plus hors réponse exacte, 0 à partir de 50 % d'écart (ou 25 ans pour une date).
        points = exact ? 1000 : Math.round(800 * Math.max(0, 1 - row.error / 0.5));
        out.set(row.pid, { rank: 1, correct: points > 0, exact, error: row.error, errorText: errText(row), points });
        return;
      }
      if (exact) points = 1000;
      else if (i > 0 && row.error > 1) points = 0; // complètement à côté : rien (sauf s'il est 1er)
      else points = RANK_POINTS[i] ?? 100;
      out.set(row.pid, { rank: i + 1, correct: i === 0 || exact, exact, error: row.error, errorText: errText(row), points });
    });
    return out;
  },

  reveal: (r) => ({ correctValue: r.answer, correctText: formatValue(r, r.answer) }),
};
