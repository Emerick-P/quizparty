// QuizParty — Quiz en direct.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  quiz en direct
// À heure fixe, les mêmes questions pour tout le monde au même instant, chacun seul sur son écran.
// La salle d'attente ouvre quelques minutes avant ; une fois parti, on ne peut plus entrer.
// Jamais de nombre de participants à l'écran. La partie elle-même passe par state.daily (state.daily.live).
const live = { info: null, loading: false, timer: null, mine: null, focus: null };
const liveTime = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const liveDay = (s) => s.when || ''; // « aujourd’hui », « demain », « samedi » : calculé par le serveur (heure de Paris)
const LIVE_KEY = 'quizparty:live'; // mes directs joués sur cet appareil (invités compris) : { id du créneau : { score, correct, rounds } }
/** Mon résultat à un direct : celui du serveur (compte) sinon celui de cet appareil. */
const liveResult = (id) => live.mine?.[id] ?? store.get(LIVE_KEY)?.[id] ?? null;
async function loadLive() {
  if (SCREEN || live.loading) return;
  live.loading = true;
  const [r, m] = await Promise.all([send('live:info'), account.user ? send('live:mine') : null]);
  live.loading = false;
  if (r.error) return;
  live.info = r;
  live.mine = m && !m.error ? m.results : null;
  // Rechargé à chaque changement : ouverture de la salle d'attente, départ, fin du direct
  clearTimeout(live.timer);
  const t = now();
  const edges = [...(r.today || []), ...(r.next ? [r.next] : [])].flatMap((s) => [s.opensAt, s.startsAt, s.endsAt]).filter((x) => x > t);
  if (edges.length) live.timer = setTimeout(() => { live.info = null; render(); }, Math.max(1000, Math.min(...edges) - t + 500));
  render();
}
/** Rangée de petites tuiles : un direct par créneau de la journée, dans l'ordre. Le prochain ressort, les finis sont grisés. */
function liveStrip() {
  if (!live.info) loadLive();
  const i = live.info;
  let list = i?.today ?? [];
  // Tous passés pour aujourd'hui : on montre déjà le prochain (demain)
  if (i && list.every((s) => s.status === 'done' || s.status === 'running')) {
    const t = i.upcoming.find((s) => !list.some((x) => x.id === s.id));
    if (t) list = [...list, t];
  }
  const dailyTodo = !daily.info || !dailyMine(); // une seule action principale (coin coupé) : le Défi du jour s'il reste à jouer, sinon le direct imminent
  const feat = list.find((s) => s.status === 'upcoming' || s.status === 'open')?.id;
  const tile = (s) => {
    const r = s.status === 'done' ? liveResult(s.id) : null;
    const sub = s.status === 'open' ? `<span class="d-go" data-until="${s.startsAt}" data-mode="clock"></span>`
      : s.status === 'running' ? 'En cours'
      : s.status === 'done' ? (r ? `${fmtPts(r.score)} pts` : 'Terminé')
      : s.when !== 'aujourd’hui' ? esc(s.when) : `<span data-until="${s.startsAt}" data-mode="eta"></span>`;
    return `<button class="l-tile ${s.status} ${s.id === feat ? 'feat' : ''} ${s.status === 'open' && !dailyTodo ? 'cut' : ''} ${s.event ? 'evt' : ''} ${s.status === 'done' ? (r ? 'played' : 'missed') : ''}" data-key="lt:${s.id}" data-action="liveslot" data-value="${s.id}">
      <b>${liveTime(s.startsAt)}${s.event ? '<i class="l-evt">événement</i>' : ''}</b><span class="l-name">${esc(s.name)}</span><span class="l-tag">${esc(s.tagline)}</span><small>${sub}</small></button>`;
  };
  return `<section class="l-strip" aria-label="Quiz en direct">
    <h3 class="l-h">${ico('zap')} Quiz en direct</h3>
    <div class="l-row">${i ? list.map(tile).join('') : '<span class="muted l-load">Chargement…</span>'}</div>
  </section>`;
}
actions.liveslot = (btn) => { live.focus = btn.dataset.value; openSheet('live'); };
function liveBody() {
  const i = live.info;
  if (!i) { loadLive(); return '<p class="muted">Chargement…</p>'; }
  const n = [...(i.today || []), ...i.upcoming].find((s) => s.id === live.focus) ?? i.next;
  if (!n) return '<p class="muted">Pas de direct prévu pour le moment.</p>';
  if (n.status === 'done' || n.status === 'running') return liveResultBody(n);
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
      <li><span class="grow">${esc(s.name)}<span class="sub">${esc(s.tagline)}</span></span><span class="pts">${s.when === 'aujourd’hui' ? '' : `${esc(s.when)} `}${liveTime(s.startsAt)}</span></li>`).join('')}</ul></div>` : ''}
  </div>`;
}
/** Un direct déjà parti : mon résultat s'il est fini, sinon « en cours ». */
function liveResultBody(n) {
  const r = n.status === 'done' ? liveResult(n.id) : null;
  return `<div class="d-sheet l-sheet">
    <div class="d-intro"><span class="d-num">${esc(n.name)} · ${liveDay(n)} à ${liveTime(n.startsAt)}</span><p class="muted">${esc(n.tagline)}</p></div>
    ${n.status === 'running' ? '<p class="muted">Ce direct est en cours : on ne peut plus y entrer. Rendez-vous au prochain !</p>'
      : r ? `<div class="d-result"><small>${r.correct}/${r.rounds} trouvées</small><b>${fmtPts(r.score)} <span>pts</span></b></div>`
      : `<p class="muted">Tu n’as pas joué ce direct.</p>${account.user ? '' : '<p class="sh-note">Avec un compte, tes directs sont gardés sur tous tes appareils.</p>'}`}
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
  if (me && l.id) { // garde mon résultat sur cet appareil (l'accueil le grise et le montre)
    const all = { ...(store.get(LIVE_KEY) || {}), [l.id]: { score: me.score ?? 0, correct: d.correct, rounds: d.rounds } };
    const keep = Object.keys(all).sort().slice(-30);
    store.set(LIVE_KEY, Object.fromEntries(keep.map((k) => [k, all[k]])));
    live.mine = null;
  }
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
