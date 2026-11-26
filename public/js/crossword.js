// QuizParty — Mots croisés : grille, saisie, envoi des mots.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  mots croisés
/**
 * Partie au chrono : chacun enchaîne les mêmes grilles à son rythme. On choisit une définition (ou une case),
 * on tape le mot entier dans la case de saisie : la grille montre la saisie en direct. Le mot part au serveur
 * dès qu'il a toutes ses lettres. Juste : il se verrouille en vert. Faux (ou saisie arrêtée 2 s avant la fin
 * du mot) : il clignote en rouge et la saisie s'efface ; les lettres déjà trouvées restent.
 */
const CW_IDLE_MS = 2000;
const cw = { key: null, sel: null, typed: '', bad: null, idle: null, sending: false };
const cwCells = (w) => Array.from({ length: w.length }, (_, i) => [w.row + (w.dir === 'down' ? i : 0), w.col + (w.dir === 'across' ? i : 0)]);
const cwLetters = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const cwPlaying = () => {
  const r = state?.round;
  return r?.kind === 'crossword' && displayPhase() === 'question' && r.grid ? r : null;
};
/** Lettres verrouillées de la grille en cours : celles des mots trouvés (venues du serveur). */
function cwLocked(r) {
  const out = {};
  for (const [id, word] of Object.entries(r.yourWords || {})) {
    const w = r.grid.words[id];
    if (w) cwCells(w).forEach(([y, x], i) => { out[`${y},${x}`] = word[i]; });
  }
  return out;
}
const cwFound = (r, w) => !!(r.yourWords || {})[w.id];
/** Repère d'un mot : lettre pour les horizontaux (A, B, C…), numéro pour les verticaux (1, 2, 3…), dans l'ordre de lecture. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function cwLabels(grid) {
  const out = new Map();
  for (const dir of ['across', 'down']) {
    grid.words.filter((w) => w.dir === dir).sort((a, b) => a.row - b.row || a.col - b.col)
      .forEach((w, i) => out.set(w.id, dir === 'across' ? LETTERS[i] ?? String(i + 1) : String(i + 1)));
  }
  return out;
}
const cwWord = (r) => (cw.sel === null ? null : r.grid.words[cw.sel] ?? null);

/** Nouvelle grille (début de partie, grille validée, reconnexion) : on repart sur le premier mot à trouver. */
function cwSync(r) {
  const key = `${r.id}:${r.gridIndex}`;
  if (cw.key === key && !(cwWord(r) && cwFound(r, cwWord(r)))) return;
  if (cw.key !== key) { cw.typed = ''; cw.bad = null; }
  cw.key = key;
  cw.sel = (r.grid.words.find((w) => !cwFound(r, w)) ?? r.grid.words[0]).id;
}
function cwSetTyped(v) {
  cw.typed = v;
  const input = $('#cw-word');
  if (input && input.value !== v) input.value = v;
}
/** Passe au mot suivant (ou précédent) pas encore trouvé. */
function cwNext(r, step = 1) {
  const words = r.grid.words;
  const start = cw.sel ?? -1;
  for (let k = 1; k <= words.length; k++) {
    const w = words[(start + k * step + words.length * 2) % words.length];
    if (!cwFound(r, w)) { cw.sel = w.id; break; }
  }
  cwSetTyped('');
  cw.bad = null;
}
function cwChoose(id) {
  const r = cwPlaying();
  const w = r?.grid.words[id];
  if (!w || cwFound(r, w)) return;
  if (cw.sel !== w.id) { cw.sel = w.id; cwSetTyped(''); cw.bad = null; }
  render();
  cwFocus();
}
function cwFocus() {
  const input = $('#cw-word');
  if (input && document.activeElement !== input) input.focus({ preventScroll: true });
}

/** Mot faux : il clignote en rouge (avec ce qui a été tapé), puis la saisie s'efface. */
function cwWrong(r, w, typed) {
  clearTimeout(cw.idle);
  cw.bad = { id: w.id, letters: typed, at: Date.now() };
  cwSetTyped('');
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  render();
  setTimeout(() => { if (cw.bad && Date.now() - cw.bad.at >= 850) { cw.bad = null; render(); } }, 900);
}

async function cwSubmit(r, w, letters) {
  clearTimeout(cw.idle);
  cw.sending = true;
  const res = await send('game:word', { roundId: r.id, grid: r.gridIndex, wordId: w.id, letters });
  cw.sending = false;
  const cur = state?.round;
  if (cur?.id !== r.id) return;
  if (res.error) { cwSetTyped(''); render(); if (!res.stale) toast(res.error); return; }
  if (!res.correct) return cwWrong(r, w, letters);
  if (navigator.vibrate) navigator.vibrate(20);
  if (res.validated) {
    toast(`Grille validée ! Grille ${r.gridIndex + 2}`);
    cwSetTyped('');
    return; // la nouvelle grille arrive avec l'état
  }
  cur.yourWords = { ...(cur.yourWords || {}), [w.id]: res.word };
  if (cur.gridIndex === r.gridIndex) cwNext(cur);
  render();
}

/** Saisie : lettres seulement, pas plus que la longueur du mot ; envoi dès que le mot est complet. */
function cwOnInput(input) {
  const r = cwPlaying();
  const w = r && cwWord(r);
  if (!w) return;
  const v = cwLetters(input.value).slice(0, w.length);
  if (input.value !== v) input.value = v;
  cw.typed = v;
  cw.bad = null;
  clearTimeout(cw.idle);
  if (v.length === w.length) {
    cwSubmit(r, w, v);
  } else if (v.length) {
    // Saisie arrêtée en cours de mot : comptée comme une erreur
    const typed = v;
    cw.idle = setTimeout(() => {
      const now2 = cwPlaying();
      if (now2 && cw.typed === typed && cwWord(now2) === w) cwWrong(now2, w, typed);
    }, CW_IDLE_MS);
  }
  render();
}

Object.assign(actions, {
  cwCell(btn) {
    const r = cwPlaying();
    if (!r) return;
    const row = Number(btn.dataset.r), col = Number(btn.dataset.c);
    const at = r.grid.words.filter((w) => !cwFound(r, w) && cwCells(w).some(([y, x]) => y === row && x === col));
    if (!at.length) return;
    // Case au croisement de deux mots : un second toucher change de sens
    const cur = at.findIndex((w) => w.id === cw.sel);
    cwChoose(at[(cur + 1) % at.length].id);
  },
  cwClue(btn) { cwChoose(Number(btn.dataset.id)); },
  cwFocus() { cwFocus(); },
});

document.addEventListener('input', (e) => { if (e.target.id === 'cw-word') cwOnInput(e.target); });
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'cw-word') return;
  const r = cwPlaying();
  if (!r) return;
  if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    cwNext(r, e.shiftKey || e.key === 'ArrowUp' ? -1 : 1);
    render();
  } else if (e.key === 'Enter') {
    // Entrée sur un mot incomplet : c'est une erreur, comme l'arrêt de la saisie
    e.preventDefault();
    const w = cwWord(r);
    if (w && cw.typed && cw.typed.length < w.length) cwWrong(r, w, cw.typed);
  }
});

/** La grille. solution : lettres de tous les mots (correction) ; sinon mots trouvés + saisie en cours. */
function cwGrid(r, grid, { solution = false, mine = null } = {}) {
  const locked = solution ? {} : cwLocked(r);
  const letters = {};
  const okCells = new Set();
  for (const w of grid.words) {
    cwCells(w).forEach(([y, x], i) => {
      const k = `${y},${x}`;
      if (solution) letters[k] = w.word[i];
      if (solution ? mine?.[w.id] : locked[k]) okCells.add(k);
    });
  }
  const cur = !solution && cwWord(r);
  const curCells = cur ? cwCells(cur).map((c) => c.join(',')) : [];
  const typed = {}; // saisie en direct, ou le mot faux qui clignote
  const bad = !solution && cw.bad && grid.words[cw.bad.id];
  if (bad) cwCells(bad).forEach((c, i) => { if (cw.bad.letters[i]) typed[c.join(',')] = cw.bad.letters[i]; });
  else if (cur) curCells.forEach((k, i) => { if (cw.typed[i]) typed[k] = cw.typed[i]; });
  const badCells = new Set(bad ? cwCells(bad).map((c) => c.join(',')) : []);
  const labels = cwLabels(grid);
  const nums = new Map(); // case de départ → repères (horizontal en haut à gauche, vertical en haut à droite)
  for (const w of grid.words) {
    const k = `${w.row},${w.col}`;
    nums.set(k, { ...nums.get(k), [w.dir]: labels.get(w.id) });
  }
  const live = new Set(grid.words.flatMap((w) => cwCells(w).map((c) => c.join(','))));
  const next = curCells.find((k, i) => !cw.typed[i]); // prochaine lettre à taper
  let html = '';
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const k = `${y},${x}`;
      if (!live.has(k)) { html += '<i class="cw-blank"></i>'; continue; }
      const ch = solution ? letters[k] : typed[k] ?? locked[k] ?? '';
      const cls = [
        'cw-cell',
        okCells.has(k) && !typed[k] ? 'ok' : solution ? 'miss' : '',
        curCells.includes(k) ? 'cur' : '',
        typed[k] && !badCells.has(k) ? 'typed' : '',
        k === next && !bad ? 'sel' : '',
        badCells.has(k) ? 'bad' : '',
      ].filter(Boolean).join(' ');
      const tag = solution ? 'div' : 'button';
      html += `<${tag} class="${cls}" ${solution ? '' : `data-action="cwCell" data-r="${y}" data-c="${x}" type="button"`}>${nums.get(k)?.across ? `<small>${nums.get(k).across}</small>` : ''}${nums.get(k)?.down ? `<small class="dn">${nums.get(k).down}</small>` : ''}<span>${esc(ch)}</span></${tag}>`;
    }
  }
  return `<div class="cw-grid" style="--w:${grid.width}">${html}</div>`;
}
function cwClues(grid, { found = {}, current = null, solution = false } = {}) {
  const labels = cwLabels(grid);
  const list = (dir) => grid.words.filter((w) => w.dir === dir).sort((a, b) => a.row - b.row || a.col - b.col).map((w) => `
      <li class="${found[w.id] ? 'ok' : ''} ${current === w ? 'cur' : ''}" ${solution || found[w.id] ? '' : `data-action="cwClue" data-id="${w.id}"`}>
        <b>${labels.get(w.id)}</b><span>${esc(w.clue)} <em>(${w.length})</em>${solution ? `<strong>${esc(w.word)}</strong>` : ''}</span>
      </li>`).join('');
  return `<div class="cw-clues">
      <div><h3>Horizontalement →</h3><ol>${list('across')}</ol></div>
      <div><h3>Verticalement ↓</h3><ol>${list('down')}</ol></div>
    </div>`;
}

function crosswordQuestion(r) {
  cwSync(r);
  const found = r.yourWords || {};
  const nFound = Object.keys(found).length;
  const total = r.grid.words.length;
  const need = r.validateAt ?? 8;
  const cur = cwWord(r);
  return `
    <main class="screen has-side">
      <div class="play cw">
      <div class="qhead">
        <span class="pill">Grille ${r.gridIndex + 1} · ${nFound} / ${need} mots${r.yourGrids ? ` · ${r.yourGrids} validée${r.yourGrids > 1 ? 's' : ''}` : ''}</span>
        <span class="timer" data-until="${r.endsAt}" data-mode="clock" data-urgent="30000"></span>
      </div>
      <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="30000"></div></div>
      <div class="cw-entry">
        <div class="cw-current" data-action="cwFocus">${cur ? `<b>${cwLabels(r.grid).get(cur.id)} ${cur.dir === 'across' ? '→' : '↓'}</b><span>${esc(cur.clue)} <em>(${cur.length})</em></span>` : ''}</div>
        <form class="guess" data-form="cw" onsubmit="return false">
          <input id="cw-word" maxlength="${cur?.length ?? 9}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="${cur ? `Mot de ${cur.length} lettres` : ''}" aria-label="Ta réponse">
        </form>
      </div>
      <div class="cw-board">${cwGrid(r, r.grid)}</div>
      <p class="muted cw-legend">Grille validée à ${need} mots sur ${total}. Les mêmes grilles pour tous : celui qui en valide le plus gagne.</p>
      ${cwClues(r.grid, { found, current: cur })}
      </div>
      ${roster(r)}
      ${isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">Terminer la partie</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
    </main>`;
}
