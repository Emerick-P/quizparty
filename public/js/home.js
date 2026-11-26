// QuizParty — Accueil et salon : pages, panneaux, profil, avatar.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  accueil et salon : pages et panneaux
// Sur téléphone, le salon garde l'essentiel à l'écran ; le choix du jeu s'ouvre en page, le reste en panneau du bas.
// Sur ordinateur (1000 px et plus), salon sur trois colonnes, et le choix du jeu s'ouvre en fenêtre.
const SHARE_NOTE = '<b>Entre potes seulement.</b> Partage le lien et le code d’accès à tes amis, mais pas sur un forum ni sur les réseaux : QuizParty est un petit projet perso, hébergé gratuitement, avec des sons et des images qu’on n’a pas le droit de diffuser au grand public. C’est pour ça qu’il y a un code.';
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
  daily: { phase: 'home', page: true, render: () => ({ title: 'Défi du jour', body: dailyBody() }) },
  defis: { phase: 'home', page: true, render: () => ({ title: 'Défis entre potes', body: potesBody() }) },
  defi: { phase: 'home', page: true, render: () => ({ title: 'Défi entre potes', body: poteBody() }) },
  getapp: { phase: 'home', render: () => ({ title: TOUCH ? 'Installer l’app' : 'L’app sur ton téléphone', body: getAppBody() }) },
  tvinfo: { phase: 'home', render: () => ({ title: 'Jouer sur la télé', body: `
    <ol class="sh-steps">
      <li><b>Crée un salon</b> sur ton téléphone.</li>
      <li>Sur la télé (son navigateur, un PC branché en HDMI, une console…), ouvre <span class="tv-url">${esc(location.host)}/tv</span> : un code à 4 chiffres s’affiche.</li>
      <li>Dans le salon, touche <b>Sur la télé</b> et tape ce code.</li>
    </ol>
    <p class="sh-note">La télé affiche les questions, les images et les scores ; chacun répond sur son téléphone, l’hôte aussi. Sans télé, tout se joue sur les téléphones.</p>
    <button class="btn primary" data-action="sheetclose">Compris</button>` }) },
  games: { phase: 'lobby', render: () => ({ title: 'Choisis le jeu', body: modeGroups().map((g) => `
    <div class="pick-group"><h3>${esc(g.name)}</h3><div class="pick-grid">
    ${g.modes.map((m) => `<button class="pick ${state.settings.mode === m.id ? 'sel' : ''} ${m.unavailable ? 'off' : ''}" style="--mc:${modeArt(m.id)[1]}" data-action="pick" data-value="${m.id}" ${isHost() && !m.unavailable ? '' : 'disabled'}>
      <span class="pick-ico" aria-hidden="true">${modeArt(m.id)[0]}</span><b>${esc(m.name)}</b><small>${esc(m.unavailable || m.description)}</small></button>`).join('')}
    </div></div>`).join('') }) },
  settings: { phase: 'lobby', render: () => ({ title: 'Réglages', body: `<div class="lb-settings sh-settings">${settingsBody(isHost())}</div>
    <button class="btn primary" data-action="sheetclose">C’est bon</button>` }) },
  players: { phase: 'lobby', render: () => ({ title: `Joueurs · ${state.players.length}`, body: playersList(isHost()) }) },
  steam: { phase: 'lobby', render: () => ({ title: 'Ton Steam', body: steamCard() }) },
  scores: { phase: 'lobby', render: () => ({ title: 'Score global', body: globalBoard() }) },
  note: { phase: 'lobby', render: () => ({ title: 'Entre potes seulement', body: `<p class="sh-note big">${SHARE_NOTE.replace(/^<b>[^<]*<\/b> /, '')}</p>
    <button class="btn primary" data-action="sheetclose">Compris</button>` }) },
  account: { phase: ['lobby', 'end'], page: true, render: () => ({ title: 'Profil', body: profileBody() }) },
  // Fenêtre au-dessus du Profil (pas une page) : « Valider » ou ✕ ramène au Profil
  look: { phase: ['home', 'lobby', 'end'], render: () => ({ title: 'Image de profil', body: lookBody() }) },
  menu: { phase: ['home', 'lobby', 'end'], render: () => ({ title: 'Menu', body: menuBody() }) },
  stats: { phase: ['home', 'lobby', 'end'], page: true, render: () => ({ title: statsUi.title, body: statsBody() }) },
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
const loginTop = (sheet) => (!account.user && account.cfg?.enabled ? `<button class="login-top" data-action="sheet" data-value="${sheet}">${ico('user')} Se connecter</button>` : '');

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
  ${u ? `<div class="acc">
    <h3>Compte</h3>
    <button class="btn danger-btn" data-action="deleteAccount">Supprimer mon compte</button>
    <p class="sh-note small">La suppression efface ton compte et ton profil, définitivement. Tu pourras toujours jouer en invité.</p>
  </div>` : `${accountBlock()}${state ? '<p class="sh-note small">Tu reviens dans ce salon juste après la connexion.</p>' : ''}`}
  <div class="sh-row"><span>Thème</span>${themeToggle()}</div>
  <p class="sh-note small pf-links"><a href="/confidentialite" target="_blank" rel="noopener">Confidentialité</a> · <a href="/conditions" target="_blank" rel="noopener">Conditions</a></p>`;
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
