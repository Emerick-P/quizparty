// Test du mode Mots croisés.
// Vérifie : la banque (lettres A-Z, 3 à 9 lettres, pas de doublon) ; 400 grilles fabriquées (Facile et
// Difficile) : 10 mots, 9 × 9 max, tous reliés, aucune suite de lettres qui ne soit pas un mot, numérotation
// de journal, aucune définition qui donne un autre mot de la grille, niveau respecté ; puis une vraie
// partie à 3 joueurs : chrono fixe, mêmes grilles pour tous, jamais de lettres envoyées avant d'avoir trouvé,
// mot faux refusé, grille validée à 8 mots et passage à la suivante, mot d'une grille quittée refusé,
// reconnexion, pas de fin anticipée, classement grilles → mots → premier au dernier mot, victoire au départage.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { CROSSWORD_WORDS } from '../server/data/crosswords.js';
import { makeGrid, cellsOf, gridAt, GRID_MAX, TARGET_WORDS, VALIDATE_AT } from '../server/games/crossword.js';
import { MODES } from '../server/games/index.js';

// ------------------------------------------------------------------ banque
const words = CROSSWORD_WORDS.map((e) => e.word);
assert.equal(new Set(words).size, words.length, 'mot en double dans la banque');
assert.equal(new Set(CROSSWORD_WORDS.map((e) => e.clue)).size, words.length, 'définition en double');
for (const e of CROSSWORD_WORDS) {
  assert.match(e.word, /^[A-Z]{3,9}$/, `mot invalide : ${e.word}`);
  assert.ok(['easy', 'hard'].includes(e.level), `niveau invalide : ${e.word}`);
  assert.ok(e.clue.length > 3, `définition vide : ${e.word}`);
}
console.log(`✓ banque : ${words.length} mots (${CROSSWORD_WORDS.filter((e) => e.level === 'easy').length} faciles)`);

// ------------------------------------------------------------------ grilles
const LEVEL = new Map(CROSSWORD_WORDS.map((e) => [e.word, e.level]));
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
function checkGrid(g, level) {
  assert.equal(g.words.length, TARGET_WORDS, `${TARGET_WORDS} mots par grille`);
  assert.ok(g.width <= GRID_MAX && g.height <= GRID_MAX, 'grille trop grande pour un téléphone');
  const m = Array.from({ length: g.height }, () => Array(g.width).fill(null));
  for (const w of g.words) {
    assert.ok(LEVEL.has(w.word), `mot hors banque : ${w.word}`);
    if (level === 'easy') assert.equal(LEVEL.get(w.word), 'easy', `mot difficile en Facile : ${w.word}`);
    cellsOf(w).forEach(([r, c], i) => {
      assert.ok(r >= 0 && c >= 0 && r < g.height && c < g.width, 'mot hors de la grille');
      assert.ok(m[r][c] === null || m[r][c] === w.word[i], `lettres en conflit (${w.word})`);
      m[r][c] = w.word[i];
    });
    // Aucune définition ne contient un autre mot de la grille
    for (const o of g.words) if (o !== w) assert.ok(!plain(w.clue).split(/[^A-Z]+/).includes(o.word), `« ${w.clue} » donne ${o.word}`);
  }
  // Chaque suite de 2 lettres ou plus, en ligne ou en colonne, est exactement un mot de la grille
  const runs = [];
  for (const dir of ['across', 'down']) {
    const [H, W] = dir === 'across' ? [g.height, g.width] : [g.width, g.height];
    for (let a = 0; a < H; a++) {
      let start = null;
      for (let b = 0; b <= W; b++) {
        const ch = b < W ? (dir === 'across' ? m[a][b] : m[b][a]) : null;
        if (ch && start === null) start = b;
        if (!ch && start !== null) {
          if (b - start >= 2) runs.push(`${dir}:${dir === 'across' ? `${a},${start}` : `${start},${a}`}:${b - start}`);
          start = null;
        }
      }
    }
  }
  const placed = g.words.map((w) => `${w.dir}:${w.row},${w.col}:${w.word.length}`);
  assert.deepEqual([...runs].sort(), [...placed].sort(), 'suite de lettres qui n\'est pas un mot (mots collés)');
  // Tous les mots sont reliés entre eux
  const seen = new Set([0]);
  const queue = [g.words[0]];
  const key = (w) => new Set(cellsOf(w).map((c) => c.join(',')));
  while (queue.length) {
    const w = queue.pop();
    const cells = key(w);
    g.words.forEach((o, i) => {
      if (!seen.has(i) && cellsOf(o).some((c) => cells.has(c.join(',')))) { seen.add(i); queue.push(o); }
    });
  }
  assert.equal(seen.size, g.words.length, 'grille en plusieurs morceaux');
  // Numérotation de journal : les débuts de mots dans l'ordre de lecture, à partir de 1
  const starts = [...new Set(g.words.map((w) => `${w.row},${w.col}`))].sort((a, b) => {
    const [r1, c1] = a.split(',').map(Number), [r2, c2] = b.split(',').map(Number);
    return r1 - r2 || c1 - c2;
  });
  for (const w of g.words) assert.equal(w.num, starts.indexOf(`${w.row},${w.col}`) + 1, 'numérotation');
  g.words.forEach((w, i) => assert.equal(w.id, i));
}
let hardWords = 0;
for (const level of ['easy', 'hard']) {
  for (let i = 0; i < 200; i++) {
    const g = makeGrid({ level });
    checkGrid(g, level);
    if (level === 'hard') hardWords += g.words.filter((w) => LEVEL.get(w.word) === 'hard').length;
  }
}
assert.ok(hardWords / 200 >= 3, `trop peu de mots difficiles en Difficile (${(hardWords / 200).toFixed(1)} par grille)`);
console.log(`✓ 400 grilles valides (10 mots, ≤ 9 × 9, reliées, sans mots collés) ; Difficile : ${(hardWords / 200).toFixed(1)} mots difficiles par grille`);

// Les grilles d'une partie se fabriquent au fur et à mesure, sans répéter un mot dans le salon
const used = new Set();
const [round] = MODES.crossword.build(10, used, { level: 'easy' });
assert.equal(round.grids.length, 0, 'grilles fabriquées à la demande');
const g1 = [0, 1, 2].map((k) => gridAt(round, k));
assert.equal(gridAt(round, 1), g1[1], 'la même grille pour tous');
const w1 = g1.flatMap((g) => g.words.map((w) => w.word));
assert.equal(new Set(w1).size, w1.length, 'un mot deux fois dans la même partie');
const [round2] = MODES.crossword.build(5, used, { level: 'easy' });
assert.ok(gridAt(round2, 0).words.every((w) => !w1.includes(w.word)), 'mot repris d\'une partie précédente');
console.log('✓ grilles fabriquées à la demande, les mêmes pour tous, pas de mot répété dans le salon');

// ------------------------------------------------------------------ partie réelle
const SOLUTION = new Map(CROSSWORD_WORDS.map((e) => [e.clue, e.word]));
const PORT = 3994;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-cw-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    COUNTDOWN_MS: '200',
    REVEAL_MS: '300',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));

function client(label) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { label, socket, state: null, waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 8000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}
const byName = (s) => Object.fromEntries(s.players.map((p) => [p.name, p]));

let failed = false;
const A = client('A'), B = client('B'), C = client('C');
let C2 = null;
const solOf = (grid) => grid.words.map((w) => SOLUTION.get(w.clue));
const word = (c, st, i, letters) => c.emit('game:word', { roundId: st.round.id, grid: st.round.gridIndex, wordId: i, letters });
try {
  await Promise.all([A.connected, B.connected, C.connected]);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  const cJoin = await C.emit('room:join', { code, name: 'Chloé' });
  await A.emit('room:settings', { mode: 'crossword', rounds: 5, level: 'easy' });
  let s = await A.waitFor((st) => st.players.length === 3 && st.settings.mode === 'crossword');
  assert.equal(s.options.modes.find((m) => m.id === 'crossword').grids, true);
  assert.equal((await A.emit('game:start')).ok, true);
  s = await A.waitFor((st) => st.phase === 'question');
  const r = s.round;
  assert.equal(r.kind, 'crossword');
  assert.equal(r.total, 1, 'une seule manche au chrono');
  assert.equal(r.durationMs, 5 * 60_000, 'chrono fixe : 5 min');
  assert.equal(r.validateAt, VALIDATE_AT);
  assert.equal(r.gridIndex, 0);
  assert.equal(r.grid.words.length, 10);
  const sB = await B.waitFor((st) => st.phase === 'question');
  assert.deepEqual(sB.round.grid, r.grid, 'la même grille pour tous');
  assert.ok(r.grid.words.every((w) => !('word' in w)), 'les mots ne sont pas envoyés');
  const sol = solOf(r.grid);
  assert.ok(sol.every((x, i) => x && x.length === r.grid.words[i].length));
  assert.ok(!sol.some((x) => JSON.stringify(s).includes(`"${x}"`)), 'aucun mot dans l\'état envoyé');
  console.log(`✓ partie de ${r.durationMs / 60000} min, même grille de 10 mots pour tous, sans les mots`);

  // Mot faux refusé, mauvaise longueur refusée, mot juste (minuscules acceptées)
  const wrong = sol[0].split('').reverse().join('') === sol[0] ? 'Z'.repeat(sol[0].length) : sol[0].split('').reverse().join('');
  assert.deepEqual(await word(B, sB, 0, wrong), { ok: true, correct: false });
  assert.ok((await word(B, sB, 0, 'AB')).error, 'mauvaise longueur refusée');
  let res = await word(B, sB, 0, sol[0].toLowerCase());
  assert.equal(res.correct, true);
  assert.equal(res.word, sol[0]);
  assert.equal((await word(B, sB, 1, sol[1])).correct, true);
  s = await C.waitFor((st) => byName(st).Bob.progress.found === 2);
  assert.deepEqual(byName(s).Bob.progress, { grids: 0, found: 2, total: 10 });
  assert.ok(!sol.some((x) => JSON.stringify(s).includes(`"${x}"`)), 'Chloé ne reçoit pas les mots de Bob');
  assert.deepEqual(B.state.round.yourWords, { 0: sol[0], 1: sol[1] });
  console.log('✓ mot faux refusé, mot juste verrouillé, progression visible par tous (nombre seulement)');

  // Chloé trouve un mot puis se reconnecte
  assert.equal((await word(C, s, 2, sol[2])).correct, true);
  C.socket.close();
  C2 = client('C2');
  await C2.connected;
  assert.ok(!(await C2.emit('room:resume', { code, token: cJoin.token })).error);
  s = await C2.waitFor((st) => st.round?.id === r.id);
  assert.deepEqual(s.round.yourWords, { 2: sol[2] });
  console.log('✓ reconnexion : la grille et les mots trouvés sont rendus');

  // Alice valide la grille 1 avec 8 mots sur 10
  for (let i = 0; i < VALIDATE_AT; i++) {
    res = await word(A, s, i, sol[i]);
    assert.equal(res.correct, true);
    assert.equal(res.validated, i === VALIDATE_AT - 1, `grille validée au ${VALIDATE_AT}e mot`);
  }
  s = await A.waitFor((st) => st.round.gridIndex === 1);
  assert.equal(s.round.yourGrids, 1);
  assert.deepEqual(s.round.yourWords, {});
  const grid2 = s.round.grid;
  const sol2 = solOf(grid2);
  assert.ok(sol2.every((x) => x && !sol.includes(x)), 'grille 2 : d\'autres mots');
  assert.equal((await word(A, { round: { ...s.round, gridIndex: 0 } }, 8, sol[8])).stale, true, 'mot d\'une grille quittée refusé');
  assert.equal(B.state.round.gridIndex, 0, 'Bob reste sur sa grille');
  assert.deepEqual(byName(B.state).Alice.progress, { grids: 1, found: 0, total: 10 });
  console.log('✓ grille validée à 8 mots, passage à la suivante, mot d\'une grille quittée refusé');

  // Bob valide aussi la grille 1 : il reçoit la même grille 2 qu'Alice
  for (let i = 2; i < VALIDATE_AT; i++) await word(B, B.state, i, sol[i]);
  s = await B.waitFor((st) => st.round.gridIndex === 1);
  assert.deepEqual(s.round.grid, grid2, 'la même grille 2 pour tous');
  // Alice et Bob trouvent 3 mots chacun dans la grille 2 : Alice d'abord
  for (let i = 0; i < 3; i++) await word(A, A.state, i, sol2[i]);
  await new Promise((ok) => setTimeout(ok, 30));
  for (let i = 0; i < 3; i++) await word(B, B.state, i, sol2[i]);
  s = await A.waitFor((st) => byName(st).Bob.progress.found === 3 && byName(st).Alice.progress.found === 3);
  assert.equal(s.phase, 'question', 'pas de fin anticipée : le chrono est fixe');

  await A.emit('game:skip');
  s = await A.waitFor((st) => st.phase === 'reveal');
  const rv = s.reveal;
  assert.equal(rv.grids.length, 2);
  assert.deepEqual(rv.grids[0].words.map((w) => w.word), sol, 'solutions à la correction');
  const res3 = Object.fromEntries(rv.results.map((x) => [x.name, x]));
  assert.equal(res3.Alice.points, 1300);
  assert.equal(res3.Bob.points, 1300);
  assert.equal(res3.Chloé.points, 100);
  assert.ok(res3.Alice.tiebreak <= res3.Bob.tiebreak, 'Alice a trouvé son dernier mot avant Bob');
  assert.deepEqual([res3.Alice.rank, res3.Bob.rank, res3.Chloé.rank], [1, 2, 3], 'départage : premier au dernier mot');
  assert.deepEqual(rv.results.map((x) => x.name), ['Alice', 'Bob', 'Chloé']);
  assert.equal(res3.Alice.answerText, '1 grille validée · 3 mots dans la suivante');
  s = await A.waitFor((st) => st.phase === 'end');
  const p = byName(s);
  assert.equal(p.Alice.wins, 1, 'Alice gagne au départage');
  assert.equal(p.Bob.wins, 0);
  assert.ok(p.Alice.tiebreak < p.Bob.tiebreak);
  console.log(`✓ classement : Alice ${res3.Alice.points} (1re au départage), Bob ${res3.Bob.points}, Chloé ${res3.Chloé.points} ; victoire à Alice`);
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [A, B, C, C2]) c?.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
