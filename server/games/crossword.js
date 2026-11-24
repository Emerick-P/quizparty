/**
 * Mots croisés, partie au chrono : une seule manche, d'une durée fixe (5 à 20 min), pendant laquelle chacun
 * enchaîne des grilles de 10 mots à son rythme. Les grilles sont les mêmes pour tout le monde, dans le même ordre.
 *
 * - Le client n'a que la forme de sa grille en cours et les définitions, jamais les lettres.
 * - On choisit une définition et on tape le mot entier ; le serveur dit s'il est juste. Un mot juste est
 *   verrouillé pour ce joueur ; un mot faux peut être retenté autant de fois qu'on veut.
 * - Une grille est validée dès 8 mots trouvés sur 10 (pour ne pas rester bloqué sur une référence) :
 *   le joueur passe aussitôt à la grille suivante.
 * - Classement : le plus de grilles validées ; à égalité, le plus de mots dans la grille en cours ; à égalité
 *   encore, le premier à avoir trouvé son dernier mot. Points = 1000 par grille validée + 100 par mot de la
 *   grille en cours (l'ordre des points suit exactement ce classement, l'heure départage les ex aequo).
 */
import crypto from 'node:crypto';
import { CROSSWORD_WORDS } from '../data/crosswords.js';

export const GRID_MAX = 9; // 9 colonnes max : lisible sur un téléphone
export const TARGET_WORDS = 10;
export const VALIDATE_AT = 8; // mots à trouver pour valider une grille
const MIN_WORDS = 5;

const rand = (n) => crypto.randomInt(n);
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const clueWords = (s) => new Set(plain(s).split(/[^A-Z]+/).filter(Boolean));

/**
 * Place des mots en croix, façon mots fléchés « américains » : chaque mot croise au moins un autre,
 * deux mots parallèles ne se touchent jamais, la grille tient dans GRID_MAX × GRID_MAX.
 * Renvoie { width, height, words: [{ word, clue, row, col, dir }] } ou null.
 */
function tryLayout(entries, target) {
  const cells = new Map(); // "r,c" → { ch, dirs: Set }
  const placed = [];
  let minR = 0, maxR = 0, minC = 0, maxC = 0;
  const at = (r, c) => cells.get(`${r},${c}`);

  const fits = (word, r0, c0, dir) => {
    const dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0;
    const r1 = r0 + dr * (word.length - 1), c1 = c0 + dc * (word.length - 1);
    if (Math.max(maxR, r1) - Math.min(minR, r0) + 1 > GRID_MAX) return -1;
    if (Math.max(maxC, c1) - Math.min(minC, c0) + 1 > GRID_MAX) return -1;
    if (at(r0 - dr, c0 - dc) || at(r1 + dr, c1 + dc)) return -1; // rien juste avant ni juste après
    let crossings = 0;
    for (let i = 0; i < word.length; i++) {
      const r = r0 + dr * i, c = c0 + dc * i;
      const cell = at(r, c);
      if (cell) {
        if (cell.ch !== word[i] || cell.dirs.has(dir)) return -1;
        crossings++;
      } else if (at(r + dc, c + dr) || at(r - dc, c - dr)) {
        return -1; // une case neuve ne doit pas coller un mot parallèle
      }
    }
    return crossings;
  };
  const put = (e, r0, c0, dir) => {
    const dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0;
    for (let i = 0; i < e.word.length; i++) {
      const r = r0 + dr * i, c = c0 + dc * i;
      const k = `${r},${c}`;
      if (!cells.has(k)) cells.set(k, { ch: e.word[i], dirs: new Set() });
      cells.get(k).dirs.add(dir);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    }
    placed.push({ ...e, row: r0, col: c0, dir });
  };
  // Une définition ne doit pas contenir un autre mot de la grille (« Frère de Mario » avec MARIO)
  const clashes = (e) => placed.some((p) => (p.word.length >= 3 && clueWords(e.clue).has(p.word)) || (e.word.length >= 3 && clueWords(p.clue).has(e.word))
    || p.word.includes(e.word) || e.word.includes(p.word));

  const [first, ...rest] = entries;
  put(first, 0, 0, rand(2) ? 'across' : 'down');
  for (const e of rest) {
    if (placed.length >= target) break;
    if (clashes(e)) continue;
    let best = null;
    for (const p of placed) {
      const dir = p.dir === 'across' ? 'down' : 'across';
      for (let i = 0; i < p.word.length; i++) {
        const r = p.row + (p.dir === 'down' ? i : 0), c = p.col + (p.dir === 'across' ? i : 0);
        for (let j = 0; j < e.word.length; j++) {
          if (e.word[j] !== p.word[i]) continue;
          const r0 = r - (dir === 'down' ? j : 0), c0 = c - (dir === 'across' ? j : 0);
          const x = fits(e.word, r0, c0, dir);
          if (x < 1) continue;
          const score = x * 10 + rand(10);
          if (!best || score > best.score) best = { score, r0, c0, dir };
        }
      }
    }
    if (best) put(e, best.r0, best.c0, best.dir);
  }
  if (placed.length < MIN_WORDS) return null;
  const crossings = [...cells.values()].filter((c) => c.dirs.size === 2).length;
  return {
    width: maxC - minC + 1,
    height: maxR - minR + 1,
    crossings,
    words: placed.map((p) => ({ word: p.word, clue: p.clue, level: p.level, row: p.row - minR, col: p.col - minC, dir: p.dir })),
  };
}

/**
 * Numérote les mots dans l'ordre de lecture (comme une grille de journal) et renvoie la grille finale.
 * Les mots sont rangés : horizontaux d'abord, puis verticaux, chacun par numéro.
 */
function finalize(layout) {
  const starts = [...new Set(layout.words.map((w) => `${w.row},${w.col}`))]
    .map((k) => k.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const num = new Map(starts.map(([r, c], i) => [`${r},${c}`, i + 1]));
  const words = layout.words
    .map((w) => ({ ...w, num: num.get(`${w.row},${w.col}`) }))
    .sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1))
    .map((w, i) => ({ id: i, ...w }));
  return { width: layout.width, height: layout.height, words };
}

/**
 * Fabrique une grille. Facile : mots « easy » seulement. Difficile : au moins la moitié de mots « hard »
 * (les mots faciles servent à faire les croisements).
 * avoid(word) : mots à éviter (déjà vus dans le salon) tant qu'il en reste assez.
 */
export function makeGrid({ level = 'easy', target = TARGET_WORDS, avoid = () => false, bank = CROSSWORD_WORDS } = {}) {
  let pool = bank.filter((e) => level === 'hard' || e.level === 'easy');
  const fresh = pool.filter((e) => !avoid(e.word));
  if (fresh.length >= 40) pool = fresh;
  let best = null;
  const rate = (g) => g.words.length * 1000 + g.crossings * 40 - g.width * g.height
    + (level === 'hard' ? g.words.filter((w) => w.level === 'hard').length * 150 : 0);
  for (let t = 0; t < 120; t++) {
    let order = shuffle(pool);
    if (level === 'hard') {
      // Un mot difficile pour démarrer, puis difficiles et faciles alternés
      const hard = order.filter((e) => e.level === 'hard'), easy = order.filter((e) => e.level !== 'hard');
      order = [];
      for (let i = 0; i < Math.max(hard.length, easy.length); i++) {
        if (hard[i]) order.push(hard[i]);
        if (easy[i]) order.push(easy[i]);
      }
    }
    // Premier mot assez long pour accrocher les autres
    const firstIdx = order.findIndex((e) => e.word.length >= 6 && e.word.length <= GRID_MAX);
    if (firstIdx > 0) order.unshift(...order.splice(firstIdx, 1));
    const layout = tryLayout(order, target);
    if (!layout) continue;
    if (!best || rate(layout) > rate(best)) best = layout;
    if (best.words.length >= target && best.crossings >= target - 1 && t >= 20) break;
  }
  if (!best) throw new Error('Impossible de fabriquer une grille');
  return finalize(best);
}

/** Cases d'un mot, dans l'ordre. */
export const cellsOf = (w) => Array.from({ length: w.word.length }, (_, i) => [w.row + (w.dir === 'down' ? i : 0), w.col + (w.dir === 'across' ? i : 0)]);

export const GRID_POINTS = 1000, WORD_POINTS = 100;

/** Grille telle que l'envoie le serveur : forme et définitions, sans les lettres (sauf solution). */
const publicGrid = (g, solution = false) => ({
  width: g.width,
  height: g.height,
  words: g.words.map((w) => ({ id: w.id, num: w.num, dir: w.dir, row: w.row, col: w.col, length: w.word.length, clue: w.clue, ...(solution ? { word: w.word } : {}) })),
});

/**
 * Progression d'un joueur, dans r.answers.get(pid).value :
 * { grid: index de la grille en cours, found: { wordId: ms } (grille en cours), grids: grilles validées,
 *   lastAt: ms du dernier mot trouvé (départage) }
 */
export const emptyProgress = () => ({ grid: 0, found: {}, grids: 0, lastAt: null });
const foundCount = (v) => Object.keys(v?.found ?? {}).length;
const pointsOf = (v) => (v ? v.grids * GRID_POINTS + foundCount(v) * WORD_POINTS : 0);

/** La grille k de la partie : fabriquée quand le premier joueur l'atteint, puis la même pour tous. */
export function gridAt(r, k) {
  while (r.grids.length <= k) r.grids.push(r.nextGrid());
  return r.grids[k];
}

export default {
  // Durée fixe de la partie : le réglage « Questions » (5, 10, 15, 20) compte ici des minutes
  durationMs: (_r, settings) => settings.rounds * 60_000,
  isFinished: () => false, // chrono fixe : la partie va jusqu'au bout (ou l'hôte passe)
  isCorrect: () => false,
  revealFactor: 2, // 16 s de correction au lieu de 8 : le temps de lire la solution
  progressOf: (_r, v) => ({ grids: v?.grids ?? 0, found: foundCount(v), total: TARGET_WORDS }),

  publicRound: (r) => ({ prompt: r.prompt, validateAt: VALIDATE_AT }),

  /** Ce que voit un joueur de sa propre partie : sa grille en cours et ses mots trouvés. */
  forPlayer(r, v) {
    const p = v ?? emptyProgress();
    const g = gridAt(r, p.grid);
    return {
      grid: publicGrid(g),
      gridIndex: p.grid,
      yourGrids: p.grids,
      yourWords: Object.fromEntries(Object.keys(p.found).map((id) => [id, g.words[id].word])),
    };
  },

  /** Vérifie un mot : lettres A-Z (accents et casse ignorés) de la bonne longueur. */
  checkWord(g, wordId, letters) {
    const w = g.words[Number(wordId)];
    if (!w || typeof letters !== 'string') return null;
    const s = plain(letters).replace(/[^A-Z]/g, '');
    if (s.length !== w.word.length) return null;
    return { w, correct: s === w.word };
  },

  validate: () => null, // pas de réponse unique : voir Room.crossword()

  answerText: (_r, v) => {
    const n = v.grids, f = foundCount(v);
    return `${n} grille${n > 1 ? 's' : ''} validée${n > 1 ? 's' : ''} · ${f} mot${f > 1 ? 's' : ''} dans la suivante`;
  },

  score(_r, answers) {
    const rows = [...answers].map(([pid, { value }]) => ({ pid, value, points: pointsOf(value), tiebreak: value.lastAt ?? Infinity }));
    rows.sort((a, b) => b.points - a.points || a.tiebreak - b.tiebreak);
    const out = new Map();
    rows.forEach((x, i) => {
      const prev = rows[i - 1];
      const rank = prev && prev.points === x.points && prev.tiebreak === x.tiebreak ? out.get(prev.pid).rank : i + 1;
      out.set(x.pid, {
        rank,
        correct: x.points > 0,
        grids: x.value.grids,
        found: foundCount(x.value),
        points: x.points,
        tiebreak: x.value.lastAt,
      });
    });
    return out;
  },

  reveal: (r) => ({
    correctText: 'Mots croisés',
    validateAt: VALIDATE_AT,
    grids: r.grids.map((g) => publicGrid(g, true)),
  }),
};
