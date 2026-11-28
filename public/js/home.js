// QuizParty — Accueil et salon : pages, panneaux, profil, avatar.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  accueil et salon : pages et panneaux
// Sur téléphone, le salon garde l'essentiel à l'écran ; le choix du jeu s'ouvre en page, le reste en panneau du bas.
// Sur ordinateur (1000 px et plus), salon sur trois colonnes, et le choix du jeu s'ouvre en fenêtre.
const WIDE_MQ = matchMedia('(min-width: 1000px)');
const wide = () => WIDE_MQ.matches;
WIDE_MQ.addEventListener?.('change', () => render());
const ui = { sheet: null, phase: null, trail: [] }; // trail : pages d'où l'on vient (bouton Retour)

function modeGroups() {
  const { modes } = state.options;
  const listed = new Set(MODE_GROUPS.flatMap((g) => g.ids));
  return [...MODE_GROUPS, { name: 'Autres', ids: modes.map((m) => m.id).filter((id) => !listed.has(id)) }]
    .map((g) => ({ name: g.name, modes: g.ids.map((id) => modes.find((m) => m.id === id)).filter(Boolean) }))
    .filter((g) => g.modes.length);
}

/** Carte vedette « Ta bande » en tête du choix du jeu : le mode propre à QuizParty (questions sur vos jeux Steam). */
function bandeFeature() {
  const m = state.options.modes.find((x) => x.id === 'bande');
  if (!m) return '';
  const linked = state.players.filter((p) => p.steam?.status === 'ok').length;
  const mine = state.players.find((p) => p.id === state.you)?.steam?.status === 'ok';
  const hint = m.unavailable || (linked ? `${linked} joueur${linked > 1 ? 's' : ''} lié${linked > 1 ? 's' : ''} sur ${state.players.length}` : 'Personne n’a encore lié Steam');
  return `<div class="pick-feat">
    <button class="pick feat ${state.settings.mode === 'bande' ? 'sel' : ''}" style="--mc:${modeArt('bande')[1]}" data-action="pick" data-value="bande" ${isHost() && !m.unavailable ? '' : 'disabled'}>
      <span class="pick-ico" aria-hidden="true">${modeArt('bande')[0]}</span>
      <span class="feat-txt"><b>${esc(m.name)}</b><small>Des questions sur vos vrais jeux Steam : qui y a passé le plus d’heures, qui n’a jamais lancé ce jeu…</small><small class="feat-n">${esc(hint)}</small></span></button>
    ${mine ? '' : `<button class="btn small ghost" data-action="sheet" data-value="steam">${ico('gamepad')} Lier mon Steam</button>`}
  </div>`;
}

// =====================================================================  accueil : deux onglets
// Jouer = les salons entre potes. Compétition = tout ce qui compte pour la cote (défaut pour un compte connecté).
// Le profil, les stats et le thème restent dans le menu de l'avatar. Un invité (ou un lien ?code=…) arrive sur Jouer.
const HOME_TABS = [['comp', 'Compétition', 'trophy'], ['play', 'Jouer', 'gamepad']];
const homeUi = { tab: null, rating: null, at: 0 };
const homeTab = () => (urlCode() ? 'play' : homeUi.tab || (account.user ? 'comp' : 'play'));
actions.tab = (btn) => { homeUi.tab = btn.dataset.value; ui.sheet = null; ui.base = null; render(); };

/** Onglets de l'accueil : barre du bas sur téléphone en portrait, dans le bandeau du haut sur ordinateur et en paysage. */
function tabButtons(cur) {
  return HOME_TABS.map(([id, label, icon]) =>
    `<button class="tab ${id === cur ? 'on' : ''}" role="tab" aria-selected="${id === cur}" data-action="tab" data-value="${id}"><span class="tab-ico" aria-hidden="true">${ico(icon)}</span><span>${label}</span></button>`).join('');
}
const tabBar = (cur) => `<nav class="tabbar" role="tablist" aria-label="Accueil">${tabButtons(cur)}</nav>`;
const barTabs = () => `<nav class="ab-tabs" role="tablist" aria-label="Accueil">${tabButtons(ui.sheet ? null : homeTab())}</nav>`;

/**
 * Ma cote et ma place. Affichées tout de suite depuis le dernier relevé (gardé sur l'appareil), puis rafraîchies
 * (au plus une fois par minute). La requête ne part qu'une fois le compte confirmé par le serveur (account.ready) :
 * partie plus tôt, elle était refusée (« Connecte-toi ») et la carte restait vide.
 */
const COTE_KEY = 'quizparty:cote';
const coteCache = () => { const c = store.get(COTE_KEY); return c && c.uid === (account.user?.id ?? account.user?.name) ? c : null; };
const rankIndex = () => { const d = rankUi.data; return d?.list && d.me ? d.list.findIndex((x) => x.userId === d.me) : null; };
function saveCote() {
  if (!account.user || !homeUi.rating) return;
  const old = coteCache();
  store.set(COTE_KEY, { uid: account.user.id ?? account.user.name, rating: homeUi.rating, idx: rankUi.data ? rankIndex() : old?.idx ?? null, season: rankUi.data?.season ?? old?.season ?? null });
}
function loadHomeRating() {
  if (!account.user || !account.ready || SCREEN || Date.now() - homeUi.at < 60000) return;
  homeUi.at = Date.now();
  send('stats:me').then((r) => {
    if (r.error) { homeUi.at = Date.now() - 50000; setTimeout(() => { if (!state) render(); }, 10000); return; } // on réessaie dans 10 s
    homeUi.rating = r.rating ?? null;
    saveCote();
    if (!state) render();
  });
  loadRanking();
}
const ordinal = (n) => (n === 1 ? '1er' : `${n}e`);
/**
 * Aperçu du classement dans la carte (large seulement) : ma place avec 2 joueurs au-dessus et 1 en dessous
 * (l'objectif est de monter) ; sans place (placement compris), le top 3 ; moins de 3 classés, une phrase.
 */
function rankPreview() {
  const d = rankUi.data;
  if (!d?.list) return ''; // pas encore chargé
  const n = d.list.length;
  const mine = d.me ? d.list.findIndex((x) => x.userId === d.me) : -1;
  if (n < 3) {
    const few = !n ? 'Personne n’est encore classé ce mois-ci.' : n > 1 ? `Seulement ${n} joueurs classés ce mois-ci.`
      : mine === 0 ? 'Personne d’autre n’est classé ce mois-ci pour l’instant.' : 'Un seul joueur est classé ce mois-ci.';
    return `<div class="cote-board cote-alone"><p>${few} Invite tes potes à jouer !</p></div>`;
  }
  const from = mine < 0 ? 0 : Math.max(0, mine - 2), to = mine < 0 ? 3 : Math.min(d.list.length, mine + 2);
  const rows = d.list.slice(from, to).map((x, k) => [x, from + k]);
  return `<ol class="cote-board">${rows.map(([x, i]) => `<li class="${i === mine ? 'me' : ''}"><span class="pos">${i + 1}</span>${rankAvatar(x)}<span class="grow">${esc(x.name)}</span><span class="pts">${fmtRating(x.rating)}</span></li>`).join('')}</ol>`;
}
/** Carte « Ma cote » : ma cote, ma place, la saison, et le classement juste dessous (c'est lié). */
function coteCard() {
  const rk = `<button class="cote-rk" data-action="ranking">${ico('trophy')} Voir le classement <span aria-hidden="true">›</span></button>`;
  if (!account.user) {
    return `<section class="cote cote-guest"><div class="cote-left"><div class="cote-main"><span class="cote-l">Ma cote</span><b class="cote-n">Pas de cote</b>
      <small>${account.cfg?.enabled ? 'Connecte-toi pour en avoir une et apparaître au classement.' : 'Les invités ne sont pas classés.'}</small></div>
      ${account.cfg?.enabled ? '<button class="btn primary" data-action="sheet" data-value="name">Se connecter</button>' : ''}${rk}</div>${rankPreview()}</section>`;
  }
  loadHomeRating();
  const c = coteCache();
  const r = homeUi.rating ?? c?.rating;
  const idx = rankUi.data ? rankIndex() : c?.idx ?? -1;
  const known = !!rankUi.data || c?.idx != null;
  const seasonId = rankUi.data?.season ?? c?.season;
  const season = seasonId ? `Saison de ${seasonLabel(seasonId)}` : '';
  if (r && !r.placed) {
    return `<section class="cote"><div class="cote-left"><button class="cote-main" data-action="mystats"><span class="cote-l">Ma cote</span><b class="cote-n">Placement</b>
      <span class="cote-bar"><i style="width:${Math.round(100 * r.progress / r.need)}%"></i></span><small>${r.progress}/${r.need} réponses avant que ta cote s’affiche</small></button>${rk}</div>${rankPreview()}</section>`;
  }
  return `<section class="cote"><div class="cote-left"><button class="cote-main" data-action="mystats"><span class="cote-l">Ma cote${season ? ` · ${esc(season)}` : ''}</span>
    <b class="cote-n">${r ? fmtRating(r.rating) : '…'}</b>
    <small>${idx >= 0 ? `${ordinal(idx + 1)} au classement` : r && known ? 'Pas encore classé ce mois-ci' : ' '}</small></button>${rk}</div>${rankPreview()}</section>`;
}
function homeComp() {
  return `<div class="comp">
    ${coteCard()}
    ${dailyCard()}
    ${liveStrip()}
  </div>`;
}
function homePlay() {
  const invited = urlCode();
  return `<section class="h-play">
      <h1>${invited ? `Salon ${esc(invited)}` : 'Jouer entre potes'}</h1>
      <p>${invited ? 'Tes potes t’attendent : choisis ton pseudo et rejoins-les.' : 'Un salon, un code, et c’est parti. Sur la télé ou juste sur vos téléphones.'}</p>
      <div class="h-btns">${invited
        ? '<button class="btn primary big cut" data-action="sheet" data-value="join">Rejoindre le salon</button>'
        : '<button class="btn primary cut" data-action="go" data-value="create">Créer un salon</button><button class="btn h-ghost" data-action="sheet" data-value="join">Rejoindre</button>'}</div>
      ${invited ? `<button class="link" onclick="history.replaceState(null,'','/');location.reload()">Créer mon propre salon plutôt</button>` : ''}
    </section>
    <div class="play-tiles">${potesTile()}</div>
    <div class="h-extras">
      ${TOUCH ? `<button class="chip-btn" data-action="sheet" data-value="tvinfo">${ico('tv')} Jouer sur la télé</button>` : ''}
    </div>`;
}
/** Résumé des réglages en étiquettes : « 4 choix · 10 questions · 15 s ». */
function settingsTags() {
  const { settings: st } = state;
  const cur = state.options.modes.find((m) => m.id === st.mode);
  const tags = [];
  if (cur?.mix) tags.push(MIX_INPUT_LABEL[st.mixInput], `${st.mixParts.length} jeux`);
  else if (cur?.inputs) tags.push(INPUT_LABEL[st.input]);
  if (cur?.levels) tags.push(LEVEL_LABEL[st.level]);
  if (cur?.grids) tags.push(`${st.rounds} min`);
  else tags.push(`${st.rounds} questions`, `${st.duration} s`);
  return tags.filter(Boolean);
}

/** Grande carte « Ce soir on joue à » : le jeu choisi, ses règles, ses réglages. */
function heroCard(host) {
  const id = state.settings.mode;
  const cur = state.options.modes.find((m) => m.id === id);
  const [ico, color] = modeArt(id);
  return `<section class="hero" style="--mc:${color}">
    ${host ? '<button class="hero-chg" data-action="sheet" data-value="games">Changer ›</button>' : ''}
    <span class="hero-ico" aria-hidden="true">${ico}</span>
    <h2>${esc(cur?.name || '')}</h2>
    <p>${esc(cur?.description || '')}</p>
    <button class="hero-tags" data-action="sheet" data-value="settings" aria-label="${host ? 'Changer les réglages' : 'Voir les réglages'}">${settingsTags().map((t) => `<span>${esc(t)}</span>`).join('')}<span class="edit">${host ? '✎ Réglages' : 'Réglages ›'}</span></button>
  </section>`;
}

function settingsBody(host) {
  const { settings, options } = state;
  const seg = (key, values, suffix = '', labels = {}) => `<div class="seg">${values.map((v) =>
    `<button class="${settings[key] === v ? 'sel' : ''}" data-action="set" data-key="${key}" data-value="${v}" ${host ? '' : 'disabled'}>${labels[v] ?? v}${suffix}</button>`).join('')}</div>`;
  const current = options.modes.find((m) => m.id === settings.mode);
  return `
        <div class="cur-mode"><span class="mode-ico" aria-hidden="true">${modeArt(settings.mode)[0]}</span><b>${esc(current?.name || '')}</b></div>
        ${current?.mix ? `<div class="opt"><span>Réponse</span>${seg('mixInput', options.mixInput, '', MIX_INPUT_LABEL)}</div>
          <p class="opt-hint">${settings.mixInput === 'mixed' ? 'Chaque manche tire au hasard : 4 choix (un seul essai) ou réponse tapée (3 essais, accents et majuscules ignorés).'
            : settings.mixInput === 'text' ? 'Tu tapes le titre du jeu ou la réponse exacte (accents et majuscules ignorés), 3 essais.'
            : 'Une proposition à choisir parmi 4, un seul essai.'} Vrai ou faux et Estimation ne changent pas.</p>
          <div class="opt mix-opt"><span>Jeux</span><div class="mix-parts">${options.mixParts.map((id) => {
            const m = options.modes.find((x) => x.id === id);
            const on = settings.mixParts.includes(id);
            return `<button class="mix-part ${on ? 'sel' : ''} ${m?.unavailable ? 'off' : ''}" data-action="mixpart" data-value="${id}" aria-pressed="${on}" ${host ? '' : 'disabled'} title="${esc(m?.unavailable || '')}"><span aria-hidden="true">${modeArt(id)[0]}</span> ${esc(m?.name || id)}</button>`;
          }).join('')}</div></div>
          <p class="opt-hint">Coche les jeux à mélanger${host ? '' : ' (l\'hôte choisit)'}. Un jeu grisé est sauté.</p>`
        : current?.inputs ? `<div class="opt"><span>Réponse</span>${seg('input', options.input, '', INPUT_LABEL)}</div>
          <p class="opt-hint">${settings.input === 'text'
            ? (settings.mode === 'quiz' ? 'Tu tapes la réponse exacte (accents et majuscules ignorés), 3 essais. Seulement les questions à réponse précise : un nom, un nombre…'
              : settings.mode === 'mix' ? 'Tu tapes le titre du jeu ou la réponse exacte (accents et majuscules ignorés), 3 essais. Vrai ou faux et Estimation ne changent pas.'
              : 'Tu tapes le titre complet du jeu (accents et majuscules ignorés), 3 essais.')
            : settings.mode === 'mix' ? 'Une proposition à choisir parmi 4, un seul essai. Vrai ou faux et Estimation ne changent pas.' : 'Une proposition à choisir parmi 4, un seul essai.'}</p>` : ''}
        ${current?.levels ? `<div class="opt"><span>Niveau</span>${seg('level', options.level, '', LEVEL_LABEL)}</div>
          ${settings.mode === 'mix' ? '<p class="opt-hint">Pour les manches Pitch mal expliqué et Le jeu en emojis.</p>' : ''}` : ''}
        ${current?.grids ? `<div class="opt"><span>Durée</span>${seg('rounds', options.rounds, ' min')}</div>
        <p class="opt-hint">Grilles de 10 mots, validées dès 8 mots trouvés. Les mêmes grilles pour tout le monde : celui qui en valide le plus en ${settings.rounds} min gagne. À égalité : le plus de mots dans la grille en cours, puis le premier à avoir trouvé son dernier mot.</p>`
        : `<div class="opt"><span>Questions</span>${seg('rounds', options.rounds)}</div>
        <div class="opt"><span>Temps</span>${seg('duration', options.duration, 's')}</div>`}`;
}

function playersList(host) {
  return `<ul class="players">
          ${state.players.map((p) => `
            <li data-key="${p.id}" class="${p.connected ? '' : 'off'}">
              ${avatar(p.name)}
              ${p.account ? `<button class="pname pstats" data-action="pstats" data-id="${p.id}" aria-label="Stats de ${esc(p.name)}">${esc(p.name)}${p.id === state.you ? ' <em>(toi)</em>' : ''} <span class="pstats-ico">${ico('chart')}</span></button>`
                : `<span class="pname">${esc(p.name)}${p.id === state.you ? ' <em>(toi)</em>' : ''}</span>`}
              ${p.steam?.status === 'ok' ? '<span class="steam-dot" title="Profil Steam lié" aria-label="Profil Steam lié">S</span>' : ''}
              ${p.id === state.hostId ? '<span class="tag">hôte</span>' : ''}
              ${host && p.id !== state.you ? `<button class="x" data-action="kick" data-id="${p.id}" aria-label="Retirer">${ico('x')}</button>` : ''}
            </li>`).join('')}
        </ul>`;
}

/** Pages (« page: true », plein écran sur téléphone) et panneaux du bas, par écran. */
const SHEETS = {
  name: { phase: 'home', page: true, render: () => ({ title: 'Profil', body: profileBody() }) },
  create: { phase: 'home', render: () => ({ title: 'Créer un salon', body: `
    <form class="sh-form" data-form="create">
      <label class="field"><span>Ton pseudo</span><input id="name" maxlength="16" autocomplete="nickname" placeholder="Ex : Camille" value="${esc(store.get(NAME_KEY) || '')}" enterkeyhint="go"></label>
      <button class="btn primary big" type="submit">Créer le salon</button>
    </form>` }) },
  join: { phase: 'home', render: () => ({ title: 'Rejoindre un salon', body: `
    <form class="sh-form" data-form="join">
      <label class="field"><span>Code du salon</span><input id="code" class="code-input" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" value="${esc(urlCode())}"></label>
      <label class="field"><span>Ton pseudo</span><input id="name" maxlength="16" autocomplete="nickname" placeholder="Ex : Camille" value="${esc(store.get(NAME_KEY) || '')}" enterkeyhint="go"></label>
      <button class="btn primary big" type="submit">Rejoindre</button>
    </form>` }) },
  live: { phase: 'home', page: true, render: () => ({ title: 'Quiz en direct', body: liveBody() }) },
  daily: { phase: 'home', page: true, render: () => ({ title: 'Défi du jour', body: dailyBody() }) },
  defis: { phase: 'home', page: true, render: () => ({ title: 'Défis entre potes', body: potesBody() }) },
  defi: { phase: 'home', page: true, render: () => ({ title: 'Défi entre potes', body: poteBody() }) },
  getapp: { phase: ['home', 'lobby', 'end'], render: () => ({ title: TOUCH ? 'Installer l’app' : 'L’app sur ton téléphone', body: getAppBody() }) },
  tvinfo: { phase: 'home', render: () => ({ title: 'Jouer sur la télé', body: `
    <ol class="sh-steps">
      <li><b>Crée un salon</b> sur ton téléphone.</li>
      <li>Sur la télé (son navigateur, un PC branché en HDMI, une console…), ouvre <span class="tv-url">${esc(location.host)}/tv</span> : un code à 4 chiffres s’affiche.</li>
      <li>Dans le salon, touche <b>Sur la télé</b> et tape ce code.</li>
    </ol>
    <p class="sh-note">La télé affiche les questions, les images et les scores ; chacun répond sur son téléphone, l’hôte aussi. Sans télé, tout se joue sur les téléphones.</p>
    <button class="btn primary" data-action="sheetclose">Compris</button>` }) },
  games: { phase: 'lobby', render: () => ({ title: 'Choisis le jeu', body: bandeFeature() + modeGroups().map((g) => ({ ...g, modes: g.modes.filter((m) => m.id !== 'bande') })).filter((g) => g.modes.length).map((g) => `
    <div class="pick-group"><h3>${esc(g.name)}</h3><div class="pick-grid">
    ${g.modes.map((m) => `<button class="pick ${state.settings.mode === m.id ? 'sel' : ''} ${m.unavailable ? 'off' : ''}" style="--mc:${modeArt(m.id)[1]}" data-action="pick" data-value="${m.id}" ${isHost() && !m.unavailable ? '' : 'disabled'}>
      <span class="pick-ico" aria-hidden="true">${modeArt(m.id)[0]}</span><b>${esc(m.name)}</b><small>${esc(m.unavailable || m.description)}</small></button>`).join('')}
    </div></div>`).join('') }) },
  settings: { phase: 'lobby', render: () => ({ title: 'Réglages', body: `<div class="lb-settings sh-settings">${settingsBody(isHost())}</div>
    <button class="btn primary" data-action="sheetclose">C’est bon</button>` }) },
  players: { phase: 'lobby', render: () => ({ title: `Joueurs · ${state.players.length}`, body: playersList(isHost()) }) },
  steam: { phase: 'lobby', render: () => ({ title: 'Ton Steam', body: steamCard() }) },
  scores: { phase: 'lobby', render: () => ({ title: 'Score global', body: globalBoard() }) },
  account: { phase: ['lobby', 'end'], page: true, render: () => ({ title: 'Profil', body: profileBody() }) },
  // Fenêtre au-dessus du Profil (pas une page) : « Valider » ou ✕ ramène au Profil
  look: { phase: ['home', 'lobby', 'end'], render: () => ({ title: 'Image de profil', body: lookBody() }) },
  menu: { phase: ['home', 'lobby', 'end'], render: () => ({ title: 'Menu', body: menuBody() }) },
  stats: { phase: ['home', 'lobby', 'end'], page: true, render: () => ({ title: statsUi.title, body: statsBody() }) },
  ranking: { phase: ['home', 'lobby', 'end'], page: true, render: () => ({ title: 'Classement', body: rankingBody() }) },
  more: { phase: 'lobby', render: () => ({ title: 'Options', body: `
    <div class="sh-row"><span>Thème</span>${themeToggle()}</div>
    <button class="btn" data-action="sheet" data-value="account">${ico('user')} Profil</button>
    <button class="btn" data-action="sheet" data-value="players">${ico('users')} Joueurs (${state.players.length})</button>
    ${state.gamesPlayed ? `<button class="btn" data-action="sheet" data-value="scores">${ico('trophy')} Score global</button>` : ''}
    <button class="btn" data-action="sheet" data-value="steam">${ico('gamepad')} Lier mon Steam</button>
    <button class="btn" data-action="propose">${ico('bulb')} Proposer une question</button>` }) },
};

/** Bloc « Compte » du profil : connexion facultative (Discord, Google), ou compte connecté. */
const providerIcon = (p) => `<span class="acc-ico acc-${p}" aria-hidden="true">${p === 'discord' ? ico('gamepad') : 'G'}</span>`;
/** Bouton « Se connecter » en haut à droite (accueil, salon), seulement pour un invité. */
const loginTop = (sheet) => (!account.user && account.cfg?.enabled ? `<button class="login-top" data-action="sheet" data-value="${sheet}" aria-label="Se connecter" title="Se connecter">${ico('user')}</button>` : '');

/** Fenêtre « Image de profil » : galerie maison (emoji + couleur), photos des comptes reliés, initiale.
 *  Chaque choix est enregistré tout de suite ; « Valider » referme la fenêtre. */
const lookUi = { hue: null };
function lookBody() {
  const raw = myLookRaw();
  const cur = /^e:(\d+):(\d+)$/.exec(raw);
  const h = lookUi.hue ?? (cur ? Number(cur[2]) : 0);
  const name = (state?.players?.find((p) => p.id === state.you)?.name) || store.get(NAME_KEY) || '';
  const u = account.user;
  const opt = (look, inner, label) => `<button class="lk ${raw === look ? 'on' : ''}" data-action="pickLook" data-value="${look}" aria-label="${label}" aria-pressed="${raw === look}">${inner}</button>`;
  return `
  <div class="lk-now">${myAvatar(name)}<div><b>${esc(name || 'Sans pseudo')}</b><small>C’est ce que voient les autres joueurs.</small></div></div>
  <h3 class="lk-h">Couleur</h3>
  <div class="lk-hues" role="radiogroup">${looks.hues.map((x, j) => `<button class="lk-hue ${j === h ? 'on' : ''}" style="--h:${x}" data-action="pickHue" data-value="${j}" aria-label="Couleur ${j + 1}" aria-checked="${j === h}" role="radio"></button>`).join('')}</div>
  <h3 class="lk-h">Avatar</h3>
  <div class="lk-grid">
    ${opt('', avatar(name || '?', null), 'Initiale de mon pseudo')}
    ${Object.entries(u?.photos ?? {}).map(([p, url]) => opt(`photo:${p}`, `${avatar(name, { photo: url })}<em class="lk-src">${providerIcon(p)}</em>`, 'Ma photo ' + (PROVIDER_LABEL[p] || p))).join('')}
    ${looks.emojis.map((e, i) => opt(`e:${i}:${h}`, `<span class="avatar emo" style="--h:${looks.hues[h]}">${e}</span>`, `Avatar ${e}`)).join('')}
  </div>
  ${u ? '' : '<p class="sh-note small">Retenue sur cet appareil. Connecte-toi pour la garder partout (et utiliser ta photo Discord ou Google).</p>'}
  <button class="btn primary" data-action="sheetclose">Valider</button>`;
}
actions.pickHue = (btn) => {
  lookUi.hue = Number(btn.dataset.value);
  const cur = /^e:(\d+):\d+$/.exec(myLookRaw());
  if (cur) return actions.pickLook({ dataset: { value: `e:${cur[1]}:${lookUi.hue}` } });
  render();
};
actions.pickLook = async (btn) => {
  const look = btn.dataset.value;
  const before = store.get(LOOK_KEY);
  store.set(LOOK_KEY, look);
  render();
  const r = await send('profile:avatar', { look });
  if (r.error) { store.set(LOOK_KEY, before); render(); toast(r.error); }
};

/** Page Profil (accueil et salon) : pseudo, compte (connexion, déconnexion, suppression), thème. */
function profileBody() {
  const u = account.user;
  const name = (state?.players?.find((p) => p.id === state.you)?.name) || store.get(NAME_KEY) || '';
  const playing = state && !['lobby', 'end'].includes(state.phase);
  return `
  <div class="pf-head"><button class="pf-av pf-look" data-action="sheet" data-value="look" aria-label="Changer mon image de profil">${myAvatar(name)}<i>Changer</i></button>
    <div><b>${esc(name || 'Sans pseudo')}</b><small>${u ? `Compte ${esc(PROVIDER_LABEL[u.provider] || '')} · ${esc(u.name)}${u.admin ? ' · admin' : ''}` : 'Invité'}</small></div></div>
  <form class="sh-form" data-form="name">
    <label class="field"><span>Ton pseudo</span><input id="name" maxlength="16" autocomplete="nickname" placeholder="Ex : Camille" value="${esc(name)}" enterkeyhint="done"></label>
    <button class="btn primary" type="submit">Enregistrer</button>
  </form>
  <p class="sh-note">${u ? 'Enregistré sur ton compte : tu le retrouves sur tous tes appareils.' : 'Retenu sur cet appareil. Connecte-toi pour le garder sur tous tes appareils.'}${playing ? ' Il changera dans le salon à la fin de la partie.' : ''}</p>
  ${steamProfileBlock(u)}
  ${u ? `<div class="acc">
    <h3>Compte</h3>
    <button class="btn danger-btn" data-action="deleteAccount">Supprimer mon compte</button>
    <p class="sh-note small">La suppression efface ton compte et ton profil, définitivement. Tu pourras toujours jouer en invité.</p>
  </div>` : `${accountBlock()}${state ? '<p class="sh-note small">Tu reviens dans ce salon juste après la connexion.</p>' : ''}`}
  <div class="sh-row"><span>Thème</span>${themeToggle()}</div>
  <p class="sh-note small pf-links"><a href="/confidentialite" target="_blank" rel="noopener">Confidentialité</a> · <a href="/conditions" target="_blank" rel="noopener">Conditions</a></p>`;
}
/** Profil : « Mon Steam » pour le mode « Ta bande ». Retenu sur l'appareil, et sur le compte si connecté. */
function steamProfileBlock(u) {
  const saved = store.get(STEAM_KEY) || '';
  const me = state?.players?.find((p) => p.id === state.you)?.steam;
  const live = me?.status === 'ok' ? `<p class="sh-note small">Lié : ${esc(me.name)}, ${me.games} jeu${me.games > 1 ? 'x' : ''}.</p>` : '';
  return `<form class="sh-form pf-steam" data-form="steam-profile">
    <label class="field"><span>Mon Steam <em class="muted">facultatif</em></span><input id="pf-steam" autocomplete="off" placeholder="Code de contact ou adresse du profil" value="${esc(saved)}" enterkeyhint="done"></label>
    ${live}
    <button class="btn" type="submit">${ico('gamepad')} ${saved ? 'Mettre à jour' : 'Lier mon Steam'}</button>
    ${saved ? '<button class="link" type="button" data-action="steamForget">Retirer mon Steam</button>' : ''}
    <p class="sh-note small">Pour « Ta bande » : tes jeux et tes heures servent aux questions. ${u ? 'Retenu sur ton compte.' : 'Retenu sur cet appareil.'} Dans Steam : ton pseudo → Contacts → Ajouter un contact, copie « Votre code de contact ». Ton profil et tes jeux doivent être publics.</p>
  </form>`;
}
function accountBlock() {
  const cfg = account.cfg;
  const u = account.user;
  if (u) {
    return `<div class="acc acc-in">
      <div class="acc-me">${u.avatar ? `<img class="acc-avatar" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true">` : avatar(u.name)}
        <div><b>${esc(u.name)}</b><small>Connecté avec ${esc(PROVIDER_LABEL[u.provider] || 'ton compte')}${u.admin ? ' · admin' : ''}</small></div></div>
      <button class="link" data-action="logout">Se déconnecter</button>
    </div>`;
  }
  if (!cfg?.enabled) return '';
  return `<div class="acc">
    <h3>Compte <small>facultatif</small></h3>
    <p class="sh-note">Pour retrouver ton profil sur tous tes appareils et garder tes stats de parties. Sans compte, tu joues en invité, comme avant.</p>
    <div class="acc-btns">${cfg.providers.map((p) => `<button class="btn acc-btn acc-${p}" data-action="login" data-value="${p}">${providerIcon(p)}Continuer avec ${PROVIDER_LABEL[p] || p}</button>`).join('')}</div>
  </div>`;
}
