// QuizParty — Classement général par cote (saison du mois en cours).
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

const rankUi = { data: null, error: null, loading: false, req: 0 };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const seasonLabel = (s) => { const [y, m] = String(s || '').split('-'); return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : ''; };

/** Image d'un joueur du classement (pas dans le salon : on part de la chaîne enregistrée sur son profil). */
function rankAvatar(x) {
  let look = null;
  const m = /^e:(\d+):(\d+)$/.exec(x.look || '');
  if (/^photo(:|$)/.test(x.look || '') || (!x.look && x.avatar)) look = x.avatar ? { photo: x.avatar } : null;
  else if (m && looks.emojis[m[1]]) look = { emoji: looks.emojis[m[1]], hue: looks.hues[m[2]] };
  return avatar(x.name || '?', look);
}

/** Simulation d'un classement de 8 joueurs (toi 4e) : seulement sur localhost avec ?mock=rank (ou ?mock=all), rien en base. */
const MOCK_RANK = !SCREEN && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && ['rank', 'all'].includes(new URLSearchParams(location.search).get('mock'));
function mockRanking(r) {
  if (!MOCK_RANK) return r;
  const me = account.user?.id ?? 'mock-me';
  const mine = homeUi.rating?.rating ?? coteCache()?.rating?.rating ?? 1546;
  const others = ['Maxime', 'Julie', 'Théo', 'Camille', 'Léa', 'Hugo', 'Inès'];
  const gap = [90, 60, 25, -30, -70, -110, -160]; // les 3 premiers au-dessus de toi, les 4 autres en dessous
  const list = [...others.slice(0, 3).map((name, i) => ({ userId: `mock-${i}`, name, rating: mine + gap[i], games: 12 - i })), { userId: me, name: account.user?.name || 'Toi', rating: mine, games: 9 },
    ...others.slice(3).map((name, i) => ({ userId: `mock-${i + 3}`, name, rating: mine + gap[i + 3], games: 8 - i }))];
  return { ...r, ok: true, error: undefined, season: r.season || new Date().toISOString().slice(0, 7), list, me };
}
async function loadRanking() {
  const req = ++rankUi.req;
  rankUi.loading = true;
  rankUi.error = null;
  const r = mockRanking(await send('rating:board'));
  if (req !== rankUi.req) return;
  rankUi.loading = false;
  if (r.error) rankUi.error = r.error; else { rankUi.data = r; saveCote?.(); }
  if (ui.sheet === 'ranking' || !state) render();
}

function rankingBody() {
  if (!rankUi.data && !rankUi.error) { if (!rankUi.loading) loadRanking(); return '<p class="sh-note st-wait">Chargement du classement…</p>'; }
  if (rankUi.error) return `<p class="sh-note">${esc(rankUi.error)}</p>`;
  const { season, list, me } = rankUi.data;
  const head = `<p class="rk-sub">Saison de ${esc(seasonLabel(season))}<small>La cote se tasse un peu à chaque début de mois.</small></p>`;
  if (!list.length) return `${head}<p class="sh-note">Personne n’est encore classé ce mois-ci. Une fois ta cote débloquée (${RATING_PLACEMENT} réponses), tu apparais ici.</p>`;
  const rows = list.map((x, i) => `
    <li class="${me && x.userId === me ? 'me' : ''}"><span class="pos">${i + 1}</span>${rankAvatar(x)}
      <span class="grow">${esc(x.name)}<small class="rk-games">${x.games} partie${x.games > 1 ? 's' : ''} ce mois-ci</small></span>
      <span class="pts">${fmtRating(x.rating)}</span></li>`).join('');
  return `${head}<ol class="list rk-board">${rows}</ol>
    ${account.user ? '' : `<p class="sh-note rk-note">Connecte-toi pour avoir une cote et apparaître ici. Les invités ne sont pas classés.</p>`}`;
}
const RATING_PLACEMENT = 30;
actions.ranking = () => { rankUi.data = null; openSheet('ranking'); };
