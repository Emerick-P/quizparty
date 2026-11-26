// QuizParty — Défi du jour.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  défi du jour
// Le même quiz pour tout le monde, de minuit à minuit (heure de Paris), joué seul dans une partie à part.
// Le serveur garde le résultat des comptes (une tentative, classement, série) ; un invité garde le sien ici.
const DAILY_KEY = 'quizparty:daily'; // invité : { day, number, score, grid, correct, rounds, streak }
const daily = { info: null, board: null, loading: false };
const CELL_CLASS = { fast: 'ok', slow: 'mid', miss: 'ko', none: '' };
const GRID_CELL = { '🟩': 'ok', '🟨': 'mid', '🟥': 'ko' };
const gridCells = (grid) => [...String(grid || '')].map((c) => GRID_CELL[c] ?? '');
const prevDay = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); };
/** Mon résultat du jour : celui du serveur (compte) ou celui gardé dans le navigateur (invité). */
function dailyMine() {
  const i = daily.info;
  if (!i) return null;
  if (i.played) return i.played;
  const local = store.get(DAILY_KEY);
  return !i.account && local?.day === i.day ? local : null;
}
function dailyStreak() {
  const i = daily.info;
  if (!i) return 0;
  if (i.account) return i.streak || 0;
  const local = store.get(DAILY_KEY);
  return local && (local.day === i.day || local.day === prevDay(i.day)) ? local.streak || 0 : 0;
}
async function loadDaily() {
  if (SCREEN || daily.loading) return;
  daily.loading = true;
  const r = await send('daily:info');
  daily.loading = false;
  if (r.error) return;
  daily.info = r;
  daily.board = r.leaderboard ?? null;
  // Invité qui a déjà joué : il peut voir le classement
  if (!daily.board && dailyMine()) daily.board = (await send('daily:board')).leaderboard ?? [];
  render();
}
const cellsHtml = (classes, cls = '') => `<span class="d-cells ${cls}" aria-hidden="true">${classes.map((c) => `<i class="${c}"></i>`).join('')}</span>`;
const fmtPts = (n) => nf.format(n || 0);
function untilNext(at) {
  const s = Math.max(0, Math.round((at - now()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
function shareTextOf({ number, grid, score, streak }) {
  return `QuizParty · Défi n°${number}\n${grid}\n${fmtPts(score)} pts${streak > 1 ? ` · 🔥 ${streak} jours` : ''}\n${location.origin}/?defi`;
}
async function shareDaily(text) {
  if (navigator.share && TOUCH) {
    try { await navigator.share({ text }); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  try { await copyText(text); toast('Résultat copié : colle-le à tes potes !'); } catch { toast(text); }
}
/** Classement du jour : les premiers, et ma ligne si je suis plus loin. */
function dailyBoard(list, meId, max = 5) {
  if (!list) return '';
  if (!list.length) return '<p class="muted d-empty">Personne au classement pour l’instant.</p>';
  const myIdx = list.findIndex((x) => meId && x.userId === meId);
  const shown = list.slice(0, max).map((x, i) => [x, i]);
  if (myIdx >= max) shown.push([list[myIdx], myIdx]);
  return `<ol class="list d-board">${shown.map(([x, i]) => `
    <li class="${i === myIdx ? 'me' : ''}"><span class="pos">${i + 1}</span>${avatar(x.name || '?')}<span class="grow">${esc(x.name)}${cellsHtml(gridCells(x.grid), 'xs')}</span><span class="pts">${fmtPts(x.score)}</span></li>`).join('')}
  </ol>${list.length > shown.length ? `<p class="muted d-more">${list.length} joueurs aujourd’hui</p>` : ''}`;
}
function dailyTile() {
  const i = daily.info, mine = dailyMine(), streak = dailyStreak();
  const sub = !i ? 'Le même quiz pour tout le monde, résultat à partager'
    : mine ? `Joué : ${fmtPts(mine.score)} pts · prochain dans ${untilNext(i.nextAt)}`
    : `${i.rounds} questions mélangées, une seule tentative`;
  return `<button class="h-tile daily ${mine ? 'done' : ''}" data-action="sheet" data-value="daily">${i ? `<i class="soon">n°${i.number}</i>` : ''}<span class="t-ico">📅</span><b>Défi du jour</b><small>${esc(sub)}</small>
    ${mine ? cellsHtml(gridCells(mine.grid), 'tile') : `<span class="d-go">${streak ? `🔥 ${streak} jour${streak > 1 ? 's' : ''} · ` : ''}À jouer ▸</span>`}</button>`;
}
function dailyBody() {
  const i = daily.info;
  if (!i) { loadDaily(); return '<p class="muted">Chargement…</p>'; }
  const mine = dailyMine(), streak = dailyStreak();
  if (mine) {
    return `<div class="d-sheet">
      <div class="d-result">
        <small>Défi n°${i.number} · ${mine.correct}/${mine.rounds} trouvées</small>
        <b>${fmtPts(mine.score)} <span>pts</span></b>
        ${cellsHtml(gridCells(mine.grid), 'big')}
        ${streak ? `<span class="d-streak">🔥 ${streak} jour${streak > 1 ? 's' : ''} d’affilée</span>` : ''}
      </div>
      <button class="btn primary" data-action="dailyshare">📤 Partager mon résultat</button>
      <div class="d-col"><h3>Classement du jour</h3>
      ${dailyBoard(daily.board, i.me, 8)}</div>
      ${i.account ? '' : `<p class="sh-note">${account.cfg?.enabled ? '<button class="link" data-action="sheet" data-value="name">Connecte-toi</button> pour apparaître au classement et garder ta série sur tous tes appareils.' : ''}</p>`}
      <p class="muted d-next">Prochain défi dans ${untilNext(i.nextAt)}</p>
    </div>`;
  }
  return `<div class="d-sheet">
    <div class="d-intro">
      <span class="d-num">Défi n°${i.number}</span>
      <ul class="d-rules">
        <li><b>${i.rounds}</b> questions mélangées : quiz, jaquettes, emojis, sons…</li>
        <li><b>${i.duration} s</b> par question, plus tu réponds vite, plus tu marques</li>
        <li><b>Une seule tentative</b> : le même défi pour tout le monde aujourd’hui</li>
      </ul>
      ${streak ? `<span class="d-streak">🔥 Série en cours : ${streak} jour${streak > 1 ? 's' : ''}</span>` : ''}
    </div>
    ${i.account ? '' : `<p class="sh-note">${account.cfg?.enabled ? 'En invité, ton score reste sur cet appareil. <button class="link" data-action="sheet" data-value="name">Connecte-toi</button> pour le classement du jour et ta série.' : 'Ton score reste sur cet appareil.'}</p>`}
    <button class="btn primary big" data-action="dailystart">C’est parti !</button>
  </div>`;
}
/** Fin du défi : invité → on garde le résultat dans le navigateur (avec sa série). */
function rememberDaily(s) {
  if (s.daily.account || s.phase !== 'end') return;
  const old = store.get(DAILY_KEY);
  if (old?.day === s.daily.day) return;
  const streak = old && old.day === prevDay(s.daily.day) ? (old.streak || 0) + 1 : 1;
  const me = s.players.find((p) => p.id === s.you);
  store.set(DAILY_KEY, { day: s.daily.day, number: s.daily.number, score: me?.score ?? 0, grid: s.daily.grid, correct: s.daily.correct, rounds: s.daily.rounds, streak });
}
/** Correction et question du défi : la progression (une case par question). */
const dailyProgress = () => (state.daily ? cellsHtml(state.daily.cells.map((c) => CELL_CLASS[c] ?? ''), 'prog') : '');
const dailyBar = (extra = '') => `<div class="host-bar player-bar d-bar">${extra}<button class="btn small ghost report-btn" data-action="flag" title="Signaler une erreur sur cette question">⚑ Signaler</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>`;
function dailyEnd() {
  const d = state.daily;
  const me = state.players.find((p) => p.id === state.you);
  const local = d.account ? null : store.get(DAILY_KEY);
  const streak = d.account ? d.streak : local?.day === d.day ? local.streak : 1;
  const text = shareTextOf({ number: d.number, grid: d.grid, score: me?.score, streak });
  return `
    <main class="screen d-end">
      <div class="d-result">
        <small>Défi n°${d.number} · ${d.correct}/${d.rounds} trouvées</small>
        <b>${fmtPts(me?.score)} <span>pts</span></b>
        ${cellsHtml(d.cells.map((c) => CELL_CLASS[c] || 'ko'), 'big')}
        ${streak ? `<span class="d-streak">🔥 ${streak} jour${streak > 1 ? 's' : ''} d’affilée</span>` : ''}
      </div>
      <button class="btn primary" data-action="dailyshare" data-value="${esc(text)}">📤 Partager mon résultat</button>
      <section class="card d-card">
        <h2>Classement du jour</h2>
        ${d.account ? (d.leaderboard ? dailyBoard(d.leaderboard, d.me) : '<p class="muted">Chargement…</p>') : `<p class="muted">En invité, tu n’es pas au classement.${account.cfg?.enabled ? ' Connecte-toi avant le défi de demain pour y être et garder ta série.' : ''}</p>${d.leaderboard ? dailyBoard(d.leaderboard, null, 3) : ''}`}
      </section>
      <p class="muted d-next">Prochain défi dans ${untilNext(d.nextAt)}</p>
      <button class="btn" data-action="dailyhome">Retour à l’accueil</button>
    </main>`;
}
actions.dailystart = async () => {
  const name = store.get(NAME_KEY) || account.user?.nickname || account.user?.name;
  if (!name) { toast('Choisis d’abord ton pseudo'); return openSheet('name'); }
  unlockAudio();
  const res = await send('daily:start', { name });
  if (res.already) { daily.info = null; loadDaily(); return toast('Tu as déjà joué le défi du jour'); }
  if (res.error) return toast(res.error);
  ui.sheet = null;
  enterRoom(res);
};
actions.dailyshare = (btn) => {
  if (btn.dataset.value) return shareDaily(btn.dataset.value);
  const i = daily.info, mine = dailyMine();
  if (i && mine) shareDaily(shareTextOf({ number: i.number, grid: mine.grid, score: mine.score, streak: dailyStreak() }));
};
actions.dailyhome = async () => {
  await send('room:leave');
  leaveLocal();
  daily.info = null;
  loadDaily();
};
