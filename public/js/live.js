// QuizParty — Quiz en direct.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  quiz en direct
// À heure fixe, les mêmes questions pour tout le monde au même instant, chacun seul sur son écran.
// La salle d'attente ouvre quelques minutes avant ; une fois parti, on ne peut plus entrer.
// Jamais de nombre de participants à l'écran. La partie elle-même passe par state.daily (state.daily.live).
const live = { info: null, loading: false, timer: null };
const liveTime = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const liveDay = (s) => {
  const today = new Date(now()).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  return s.day === today ? 'aujourd’hui' : 'demain';
};
async function loadLive() {
  if (SCREEN || live.loading) return;
  live.loading = true;
  const r = await send('live:info');
  live.loading = false;
  if (r.error) return;
  live.info = r;
  // Rechargé à l'ouverture de la salle d'attente, puis au départ (le créneau suivant s'affiche)
  clearTimeout(live.timer);
  const n = r.next;
  if (n) live.timer = setTimeout(() => { live.info = null; render(); }, Math.max(1000, (now() < n.opensAt ? n.opensAt : n.startsAt) - now() + 500));
  render();
}
function liveTile() {
  const n = live.info?.next;
  if (!live.info) loadLive();
  const sub = !n ? 'Les mêmes questions pour tout le monde, à heure fixe'
    : n.open ? `${n.name} : la salle d’attente est ouverte`
    : `${n.name} ${liveDay(n)} à ${liveTime(n.startsAt)}`;
  return `<button class="h-tile live ${n?.open ? 'open' : ''}" data-action="sheet" data-value="live"><span class="t-ico">${ico('zap')}</span><b>Quiz en direct</b><small>${esc(sub)}</small>
    ${n?.open ? `<span class="d-go">Départ dans <span data-until="${n.startsAt}" data-mode="clock"></span> ▸</span>` : ''}</button>`;
}
function liveBody() {
  const i = live.info;
  if (!i) { loadLive(); return '<p class="muted">Chargement…</p>'; }
  const n = i.next;
  if (!n) return '<p class="muted">Pas de direct prévu pour le moment.</p>';
  const others = i.upcoming.filter((s) => s.id !== n.id);
  return `<div class="d-sheet l-sheet">
    <div class="d-intro">
      <span class="d-num">${esc(n.name)} · ${liveDay(n)} à ${liveTime(n.startsAt)}</span>
      <p class="muted">${esc(n.tagline)}</p>
      <ul class="d-rules">
        <li><b>${n.rounds}</b> questions, <b>${n.duration} s</b> chacune : les mêmes pour tout le monde, au même instant</li>
        <li><b>Départ à l’heure pile</b> : la salle d’attente ouvre ${Math.round((n.startsAt - n.opensAt) / 60000)} min avant, plus personne n’entre ensuite</li>
        <li>${account.user ? 'Le direct compte pour ta <b>cote</b>' : 'Connecte-toi pour que le direct compte pour ta <b>cote</b>'}</li>
      </ul>
    </div>
    ${n.open
      ? `<button class="btn primary big" data-action="livejoin">Entrer dans la salle d’attente</button>
         <p class="muted l-count">Départ dans <span data-until="${n.startsAt}" data-mode="clock"></span></p>`
      : `<button class="btn primary big" disabled>Ouverture à ${liveTime(n.opensAt)}</button>`}
    ${others.length ? `<div class="d-col"><h3>Les prochains</h3><ul class="list l-next">${others.map((s) => `
      <li><span class="grow">${esc(s.name)}<span class="sub">${esc(s.tagline)}</span></span><span class="pts">${liveDay(s) === 'demain' ? 'demain ' : ''}${liveTime(s.startsAt)}</span></li>`).join('')}</ul></div>` : ''}
  </div>`;
}
/** Salle d'attente : le compte à rebours jusqu'au départ (heure serveur). */
function liveWait() {
  const l = state.daily.live;
  return `
    <main class="screen center l-wait">
      <span class="pill">${esc(l.name)} · ${liveTime(l.startsAt)}</span>
      <h1 class="l-title">Le direct commence dans</h1>
      <div class="big-count l-clock" data-until="${l.startsAt}" data-mode="clock"></div>
      <p class="muted">${l.rounds} questions de ${l.duration} s, les mêmes pour tout le monde au même instant. Reste sur cette page : ça part tout seul.</p>
      ${state.daily.account ? '' : `<p class="sh-note">Tu joues en invité : ce direct ne comptera pas pour une cote.</p>`}
    </main>`;
}
/** Fin du direct : mon score, ma cote, le meilleur score (jamais le nombre de joueurs). */
function liveEnd() {
  const d = state.daily, l = d.live;
  const me = state.players.find((p) => p.id === state.you);
  const top = l.best != null && me && l.best > me.score ? `<p class="l-best">Meilleur score du direct : <b>${fmtPts(l.best)} pts</b></p>`
    : l.best != null && me?.score > 0 ? '<p class="l-best"><b>Meilleur score du direct !</b></p>' : '';
  const text = `QuizParty · Direct ${l.name} ${liveTime(l.startsAt)}\n${d.grid}\n${fmtPts(me?.score)} pts\n${location.origin}`;
  return `
    <main class="screen d-end">
      <div class="d-result">
        <small>${esc(l.name)} · ${d.correct}/${d.rounds} trouvées</small>
        <b>${fmtPts(me?.score)} <span>pts</span></b>
        ${cellsHtml(d.cells.map((c) => CELL_CLASS[c] || 'ko'), 'big')}
      </div>
      ${top}
      ${ratingEnd()}
      <button class="btn primary" data-action="dailyshare" data-value="${esc(text)}">${ico('share')} Partager mon résultat</button>
      <button class="btn" data-action="livehome">Retour à l’accueil</button>
    </main>`;
}
actions.livejoin = async () => {
  const name = store.get(NAME_KEY) || account.user?.nickname || account.user?.name;
  if (!name) { toast('Choisis d’abord ton pseudo'); return openSheet('name'); }
  unlockAudio();
  const res = await send('live:join', { name });
  if (res.error) { live.info = null; render(); return toast(res.error); }
  ui.sheet = null;
  enterRoom(res);
};
actions.livehome = async () => {
  await send('room:leave');
  leaveLocal();
  live.info = null;
  loadLive();
};
