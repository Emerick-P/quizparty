// QuizParty — Stats de joueur (Mes stats, stats d’un joueur du salon).
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// ---------------------------------------------------------------- stats de joueur
// Mes stats (page Profil) ou celles d'un joueur connecté du salon (en touchant son nom).
// Trois onglets qu'on fait glisser au doigt, pour tenir sur un écran de téléphone sans défiler.
const statsUi = { title: 'Stats', who: null, data: null, rating: null, error: null, loading: false, tab: 0, req: 0 };

// ---------------------------------------------------------------- cote
// Avant le placement : progression (« 12/30 réponses »). Ensuite : le nombre, et le gain en fin de partie.
const fmtRating = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
function ratingText(r) {
  if (!r) return '';
  if (!r.placed) return `Cote : placement ${r.progress}/${r.need} réponses`;
  return `Cote <b>${fmtRating(r.rating)}</b>`;
}
/** Ligne de fin de partie (state.myRating, envoyé par le serveur une fois la partie enregistrée). */
function ratingEnd() {
  const r = state?.myRating;
  if (!r) return '';
  const d = r.delta;
  const gain = r.justPlaced ? '<span class="rt-new">débloquée</span>'
    : Number.isFinite(d) ? `<span class="rt-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</span>` : '';
  return `<p class="rt-chip">${ico('chart')}<span>${ratingText(r)}</span>${gain}</p>`;
}
const STATS_TABS = ['Résumé', 'Modes', 'Jeux'];
const pct = (good, n) => (n ? Math.round((100 * good) / n) : 0);
const secs = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace('.', ',')} s`;
async function openStats(who, title) {
  const req = ++statsUi.req;
  const myName = (state?.players?.find((p) => p.id === state.you)?.name) || store.get(NAME_KEY) || account.user?.name || '';
  const other = who !== 'me' ? state?.players.find((p) => p.id === who) : null;
  Object.assign(statsUi, { who, title, data: null, rating: null, error: null, loading: true, tab: 0,
    person: who === 'me' ? { name: myName, avatar: account.user?.avatar ?? null } : { name: other?.name ?? '', avatar: null } });
  openSheet('stats');
  const r = who === 'me' ? await send('stats:me') : await send('stats:player', { playerId: who });
  if (req !== statsUi.req) return;
  statsUi.loading = false;
  if (r.error) statsUi.error = r.error;
  else {
    statsUi.data = r.stats ?? {};
    statsUi.rating = r.rating ?? null;
    if (r.avatar) statsUi.person.avatar = r.avatar;
  }
  if (ui.sheet === 'stats') render();
}
actions.mystats = () => openStats('me', 'Mes stats');
actions.pstats = (btn) => {
  const p = state?.players.find((x) => x.id === btn.dataset.id);
  if (!p) return;
  openStats(p.id === state.you ? 'me' : p.id, p.id === state.you ? 'Mes stats' : `Stats de ${p.name}`);
};
actions.stab = (btn) => { statsUi.tab = Number(btn.dataset.value) || 0; showStatsTab(true); };
function showStatsTab(smooth) {
  const track = $('.st-track');
  if (!track) return;
  track.scrollTo({ left: statsUi.tab * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  document.querySelectorAll('.st-tabs button').forEach((b, i) => b.classList.toggle('on', i === statsUi.tab));
}
// Glissé au doigt : l'onglet suit la page affichée
document.addEventListener('scroll', (e) => {
  if (!e.target.classList?.contains('st-track')) return;
  const t = e.target;
  const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
  if (i !== statsUi.tab) { statsUi.tab = i; document.querySelectorAll('.st-tabs button').forEach((b, j) => b.classList.toggle('on', j === i)); }
}, true);
function statsBody() {
  if (statsUi.loading) return '<p class="sh-note st-wait">Chargement des stats…</p>';
  if (statsUi.error) return `<p class="sh-note">${esc(statsUi.error)}</p>`;
  const s = statsUi.data || {};
  const me = statsUi.who === 'me';
  if (!s.answers && !s.games) {
    return `<div class="st-empty">${ico('chart')}<p>${me ? 'Pas encore de stats : elles commencent à ta première partie finie, connecté à ton compte.' : 'Pas encore de partie finie avec son compte.'}</p></div>`;
  }
  const who = statsUi.person || {};
  const face = statsUi.who === 'me' ? myAvatar(who.name) : avatar(who.name || '?');
  const tile = (v, label, sub = '') => `<div class="st-tile"><b>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  // Grille façon défi du jour : un carré par question posée sur ce jeu (vert trouvé, rouge raté)
  const pips = (g) => {
    const max = 12, n = Math.min(g.n, max), good = Math.round((g.good / g.n) * n);
    return `<span class="st-pips" aria-label="${g.good} trouvés sur ${g.n}">${'<i class="ok"></i>'.repeat(good)}${'<i></i>'.repeat(n - good)}</span>`;
  };
  const summary = `
    <div class="st-who">${face}<div><b>${esc(who.name || '')}</b><small>${s.daily ? `${s.games ?? 0} partie${s.games > 1 ? 's' : ''} entre potes et ${s.daily} défi${s.daily > 1 ? 's' : ''} du jour` : `${s.games ?? 0} partie${s.games > 1 ? 's' : ''} entre potes`}</small>${statsUi.rating ? `<span class="rt-line">${ratingText(statsUi.rating)}</span>` : ''}</div></div>
    <div class="st-big"><div class="st-big-in"><b>${pct(s.correct, s.answers)}<span> %</span></b><div><strong>de bonnes réponses</strong><small>${s.correct ?? 0} sur ${s.answers ?? 0} questions</small></div></div></div>
    <div class="st-tiles">
      ${tile(s.games ?? 0, s.games > 1 ? 'parties' : 'partie', s.daily ? `et ${s.daily} défi${s.daily > 1 ? 's' : ''} du jour` : 'entre potes')}
      ${tile(s.wins ?? 0, s.wins > 1 ? 'victoires' : 'victoire', s.games ? `${pct(s.wins, s.games)} % des parties` : '')}
      ${tile(s.podiums ?? 0, s.podiums > 1 ? 'podiums' : 'podium', 'dans le top 3')}
      ${tile(s.bestScore ?? '–', 'meilleur score', 'en une partie')}
    </div>
    <div class="st-col st-recs-col"><h3 class="st-h">Records</h3>
    <ul class="st-recs">
      <li>${ico('flame')}<div><b>${s.streak ?? 0}</b><small>bonnes réponses d’affilée</small></div></li>
      <li>${ico('zap')}<div><b>${s.fastest ? secs(s.fastest.ms) : '–'}</b><small>${s.fastest?.game ? `réponse juste la plus rapide, sur ${esc(s.fastest.game)}` : 'réponse juste la plus rapide'}</small></div></li>
    </ul></div>`;
  const modes = (s.modes || []).length ? `<div class="st-col st-modes-col"><h3 class="st-h">Réussite par jeu</h3><ul class="st-modes">${s.modes.map((m) => `
      <li style="--mc:${modeArt(m.mode)[1]}"><span class="st-mi" aria-hidden="true">${modeArt(m.mode)[0]}</span>
        <div class="st-mb"><div class="st-ml"><b>${esc(m.name || m.mode)}</b><span>${pct(m.good, m.n)} %</span></div>
        <div class="st-bar"><i style="width:${pct(m.good, m.n)}%"></i></div><small>${m.good} sur ${m.n} question${m.n > 1 ? 's' : ''}</small></div></li>`).join('')}</ul></div>`
    : '<p class="sh-note">Aucun mode joué pour l’instant.</p>';
  const gameRow = (g) => `<li><b>${esc(g.game)}</b>${pips(g)}<span>${g.good}/${g.n}</span></li>`;
  const games = `
    <div class="st-col st-best"><h3 class="st-h">${me ? 'Les jeux que tu reconnais le mieux' : 'Ses jeux les mieux reconnus'}</h3>
    ${(s.best || []).length ? `<ol class="st-games">${s.best.map(gameRow).join('')}</ol>` : '<p class="sh-note">Pas encore de jeu trouvé.</p>'}</div>
    <div class="st-col st-worst-col"><h3 class="st-h">${me ? 'Ceux qui te résistent' : 'Ceux qui lui résistent'}</h3>
    ${(s.worst || []).length ? `<ol class="st-games st-worst">${s.worst.map(gameRow).join('')}</ol>` : '<p class="sh-note">Aucun pour l’instant.</p>'}
    <p class="sh-note small">Jaquettes, pitchs, emojis et sons. Un carré par fois où le jeu est tombé.</p></div>`;
  setTimeout(() => showStatsTab(false), 0);
  return `
    <div class="st-tabs" role="tablist">${STATS_TABS.map((t, i) => `<button role="tab" class="${i === statsUi.tab ? 'on' : ''}" data-action="stab" data-value="${i}">${t}</button>`).join('')}</div>
    <div class="st-track"><section class="st-page st-p1">${summary}</section><section class="st-page st-p2">${modes}</section><section class="st-page st-p3">${games}</section></div>`;
}
