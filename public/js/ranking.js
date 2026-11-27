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

async function loadRanking() {
  const req = ++rankUi.req;
  rankUi.loading = true;
  rankUi.error = null;
  const r = await send('rating:board');
  if (req !== rankUi.req) return;
  rankUi.loading = false;
  if (r.error) rankUi.error = r.error; else rankUi.data = r;
  if (ui.sheet === 'ranking') render();
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
