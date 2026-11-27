// QuizParty — Bandeau du haut, menu du profil, ouverture/fermeture des panneaux.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

/**
 * Bandeau du haut, commun à toute l'app (accueil, salon, podium et pages perso) : logo = écran principal
 * (l'accueil, ou le salon quand on y est), avatar = menu du profil. Pendant le décompte, les questions et
 * la correction, il laisse la place au jeu (son propre haut d'écran : question 3/10, chrono).
 */
const BAR_PHASES = ['home', 'lobby', 'end'];
const hasBar = (phase) => !SCREEN && BAR_PHASES.includes(phase);
function appBar(phase) {
  if (!hasBar(phase)) return '';
  const u = account.user;
  const name = (state?.players?.find((p) => p.id === state.you)?.name) || store.get(NAME_KEY) || '';
  const solo = !!state?.daily; // défi du jour : pas un vrai salon (ni code, ni Quitter), le logo ramène à l'accueil
  const inRoom = !!state && !solo;
  const away = inRoom && onPage(); // profil, stats… ouverts depuis le salon : le chemin du retour bien en vue
  const compact = inRoom && !wide(); // téléphone dans un salon : avatar seul, la place va à Quitter et ⋯
  const face = name || u ? myAvatar(name || u?.name) : '';
  const chip = `<button class="me-chip ${compact || !name ? 'mini' : ''} ${ui.sheet === 'menu' ? 'on' : ''}" data-action="sheet" data-value="menu" aria-label="Ton menu" aria-haspopup="menu">${face || '<span>Ton pseudo ✎</span>'}${!compact && name ? `<span>${esc(name)}</span>` : ''}</button>`;
  return `
  <header class="appbar" data-key="appbar"><div class="ab-in">
    <button class="ab-logo" data-action="${solo ? (state.daily.live ? 'livehome' : state.daily.challenge ? 'defihome' : 'dailyhome') : 'navhome'}" aria-label="${inRoom ? 'Retour au salon' : 'Accueil'}">Quiz<b>Party</b></button>
    ${phase === 'home' && !state && !tv.sheet ? barTabs() : ''}
    ${away ? `<button class="ab-btn ab-back" data-action="toroom">${ico('back')} Retour au salon</button>`
    : inRoom ? `<span class="ab-room">Salon <b>${esc(state.code)}</b></span>` : ''}
    <span class="ab-end">
      ${inRoom && !away ? '<button class="ab-btn" data-action="leave">Quitter le salon</button>' : ''}
      ${inRoom && phase === 'lobby' && !wide() ? '<button class="ib ab-more" data-action="sheet" data-value="more" aria-label="Plus d’options">⋯</button>' : ''}
      ${phase === 'home' && !state && homeTab() !== 'play' ? `<button class="ab-join" data-action="sheet" data-value="join" aria-label="Rejoindre un salon">${ico('users')}<span>Rejoindre</span></button>` : ''}
      ${phase === 'home' && !state ? `<button class="ab-prop" data-action="propose" aria-label="Proposer une question" title="Proposer une question">${ico('bulb')}</button>` : ''}
      ${solo ? '' : installTop(compact)}
      ${chip}${solo ? '' : loginTop(inRoom ? 'account' : 'name')}
    </span>
  </div></header>`;
}
actions.navhome = () => {
  // Hors salon, le logo ramène à l'accueil normal, même si l'adresse garde un code d'invitation (?code=…)
  if (!state && urlCode()) { setUrlCode(''); ui.sheet = null; ui.base = null; render(); return; }
  if (ui.sheet || tv.sheet) { tv.sheet = false; ui.sheet = null; ui.base = null; render(); } else scrollTo({ top: 0, behavior: 'smooth' }); };

/**
 * Menu du profil (touche l'avatar ou le pseudo, en haut à droite) : pages personnelles (profil, stats,
 * bientôt amis et personnalisation), déconnexion en dernier. Feuille par le bas sur téléphone,
 * menu déroulant sous l'avatar sur ordinateur. Le bandeau du haut garde ce qui touche au jeu.
 */
function menuBody() {
  const u = account.user;
  const name = (state?.players?.find((p) => p.id === state.you)?.name) || store.get(NAME_KEY) || '';
  const profile = state ? 'account' : 'name';
  const item = (ico, label, attrs, note = '') => `<button class="mn-item" ${attrs}><span class="mn-ico" aria-hidden="true">${ico}</span><span class="mn-l">${label}</span>${note ? `<small>${note}</small>` : ''}</button>`;
  return `
  <div class="mn-head">${myAvatar(name)}
    <div><b>${esc(name || 'Sans pseudo')}</b><small>${u ? `Compte ${esc(PROVIDER_LABEL[u.provider] || '')}` : 'Invité'}</small></div></div>
  <nav class="mn" role="menu">
    ${item(ico('user'), 'Profil', `data-action="sheet" data-value="${profile}" role="menuitem"`)}
    ${u ? item(ico('chart'), 'Mes stats', 'data-action="mystats" role="menuitem"') : item(ico('chart'), 'Mes stats', `data-action="sheet" data-value="${profile}" role="menuitem"`, 'Connecte-toi')}
    ${item(ico('trophy'), 'Classement', 'data-action="ranking" role="menuitem"')}
    ${item(ico('bulb'), 'Proposer une question', 'data-action="propose" role="menuitem"')}
    ${STANDALONE ? '' : item(ico(appInstalled() ? 'check' : 'download'), appInstalled() ? 'App installée' : (TOUCH ? 'Installer l’app' : 'L’app sur ton téléphone'), 'data-action="getapp" role="menuitem"')}
    ${item(ico('users'), 'Amis', 'disabled role="menuitem"', 'Bientôt')}
    ${item(ico('palette'), 'Personnalisation', 'disabled role="menuitem"', 'Bientôt')}
  </nav>
  <div class="mn-row"><span>Thème</span>${themeToggle()}</div>
  ${u ? `<div class="mn-sep"></div>${item('⎋', 'Se déconnecter', 'data-action="logout" role="menuitem"').replace('mn-item', 'mn-item mn-out')}` : ''}`;
}

function sheetView() {
  if (!ui.sheet || SCREEN) return '';
  const phase = displayPhase();
  const ok = (name) => { const d = SHEETS[name]; return d && [].concat(d.phase).includes(phase) && !(phase !== 'home' && !state); };
  if (!ok(ui.sheet)) { ui.sheet = null; ui.base = null; return ''; }
  // Menu ouvert depuis une page (stats, profil…) : la page reste dessous
  // Toujours dans le même ordre (fond, page, menu) : à la fermeture du menu, la page reste la même
  // dans le DOM (rien n'est recréé, donc pas de clignotement de l'accueil ou du salon)
  const base = OVER.includes(ui.sheet) && ui.base && ok(ui.base) ? sheetHtml(ui.base, true) : '';
  return `<div class="sh-bg" data-action="sheetclose"></div>` + base + sheetHtml(ui.sheet, false);
}
function sheetHtml(name, under) {
  const def = SHEETS[name];
  const { title, body } = def.render();
  const page = def.page;
  return `
  <section class="sh ${page ? 'sh-page' : ''} ${under ? 'sh-under' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-key="sh:${name}"${name === 'menu' && ui.anchor ? ` style="--ax:${ui.anchor.right}px;--ay:${ui.anchor.bottom}px"` : ''}>
    <div class="sh-head">${page ? `<button class="sh-back" data-action="sheetclose" aria-label="Retour">${ico('back')}</button>` : ''}<h2>${esc(title)}</h2>${page ? '' : '<button class="btn small ghost" data-action="sheetclose" aria-label="Fermer">✕</button>'}</div>
    <div class="sh-body">${body}</div>
  </section>`;
}
const OVER = ['menu', 'look']; // fenêtres ouvertes par-dessus une page : à la fermeture, on revient à la page
function openSheet(name) {
  // Une page en remplace une autre : on garde la précédente, le bouton Retour y ramène
  const from = OVER.includes(ui.sheet) ? ui.base : ui.sheet;
  if (!OVER.includes(name) && from && from !== name && SHEETS[from]?.page) ui.trail.push(from);
  const seen = ui.trail.indexOf(name);
  if (seen >= 0) ui.trail.length = seen; // déjà visitée : on revient en arrière plutôt que d'empiler
  ui.base = OVER.includes(name) && ui.sheet && SHEETS[ui.sheet]?.page ? ui.sheet : null;
  ui.sheet = name;
  if (name === 'daily') loadDaily(); // résultat et classement à jour
  render();
  if (name === 'create') setTimeout(() => $('#name')?.focus(), 60);
  if (name === 'join') setTimeout(() => (urlCode() ? $('#name') : $('#code'))?.focus(), 60);
}
function dropSheet() {
  ui.sheet = OVER.includes(ui.sheet) && ui.base ? ui.base : ui.trail.pop() ?? null;
  ui.base = null;
}
const closeSheet = () => { dropSheet(); render(); };
const onPage = () => !!ui.sheet && !!(SHEETS[ui.sheet]?.page || SHEETS[ui.base]?.page);
actions.sheet = (btn) => {
  // Menu du profil : sur ordinateur il se déroule sous l'avatar (position du bouton)
  if (btn.dataset.value === 'menu') {
    if (ui.sheet === 'menu') return closeSheet(); // retour à la page d'où on l'a ouvert
    const r = btn.getBoundingClientRect();
    ui.anchor = { right: Math.round(innerWidth - r.right), bottom: Math.round(r.bottom + 8) };
  }
  openSheet(btn.dataset.value);
};
actions.sheetclose = closeSheet;
actions.soon = (btn) => toast(btn.dataset.value);
actions.propose = () => { if (ui.sheet) closeSheet(); openPropose(); };
// « Créer un salon » : directement si le pseudo est connu, sinon on le demande d'abord
actions.go = () => (store.get(NAME_KEY) ? actions.create() : openSheet('create'));
actions.pick = async (btn) => {
  ui.sheet = null;
  render();
  const r = await send('room:settings', { mode: btn.dataset.value });
  if (r.error) toast(r.error);
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });

/**
 * Bouton ou geste Retour du navigateur (Android, iPhone, ordinateur), le même partout : chaque couche
 * ouverte au-dessus de l'accueil (salon, page, panneau, fenêtre) a son entrée dans l'historique
 * (history.state.qp = nombre de couches). Retour ferme la couche du dessus. Il ne fait jamais quitter
 * un salon ou un défi sans la popup de confirmation, même pendant une question (la partie continue
 * derrière). L'adresse ne change pas : un rechargement reprend la session par son jeton, comme avant.
 */
let leaveAsk = false; // popup « Quitter le salon ? »
let navSkip = 0; // retours lancés par l'app elle-même : leur popstate ne ferme rien
let navRoom = ''; // dernier salon affiché
if (!SCREEN) history.replaceState({ qp: 0 }, '');
function navLayers() {
  const l = [];
  if (state) l.push('room');
  if (ui.sheet) { for (const _ of ui.trail) l.push('page'); if (OVER.includes(ui.sheet) && ui.base) l.push('page'); l.push('sheet'); }
  if (proposeOpen()) l.push('propose');
  if (tv.sheet && tvSheet()) l.push('tv');
  if (report.open && flagOverlay()) l.push('flag');
  if (steamHelpOpen && steamHelpOverlay()) l.push('steam');
  if (leaveAsk) l.push('ask');
  return l;
}
/** Après chaque rendu : l'historique suit les couches ouvertes ou fermées par les boutons de l'app. */
function navSync() {
  if (SCREEN || navSkip) return;
  if (!state) leaveAsk = false;
  // L'adresse garde le code du salon (?code=), même après un aller-retour dans l'historique
  if (state && !state.daily) { navRoom = state.code; if (urlCode() !== state.code) setUrlCode(state.code); }
  else if (!state && navRoom && urlCode() === navRoom) setUrlCode('');
  if (!ui.sheet) { ui.trail = []; ui.base = null; }
  const want = navLayers().length;
  const have = history.state?.qp ?? 0;
  for (let d = have + 1; d <= want; d++) history.pushState({ qp: d }, '');
  if (want < have) { navSkip++; history.go(want - have); }
}
/** Ferme la couche du dessus. Le salon ne se ferme pas : on demande d'abord (false). */
function navPop() {
  const top = navLayers().at(-1);
  if (top === 'ask') leaveAsk = false;
  else if (top === 'steam') steamHelpOpen = false;
  else if (top === 'flag') report.open = false;
  else if (top === 'tv') tv.sheet = false;
  else if (top === 'propose') closePropose();
  else if (top === 'sheet') dropSheet();
  else { askLeave(true); return false; }
  return true;
}
addEventListener('popstate', (e) => {
  if (SCREEN) return;
  if (navSkip) { navSkip--; navSync(); return; }
  const d = e.state?.qp ?? 0;
  while (navLayers().length > d && navPop());
  render();
});

/** Quitter le salon (ou abandonner un défi) : toujours confirmé, sauf un défi déjà fini. */
function askLeave(fromBack) {
  if (!state) return;
  if (state.daily && state.phase === 'end') return leaveNow();
  leaveAsk = true;
  if (!fromBack) render();
}
async function leaveNow() {
  leaveAsk = false;
  if (state?.daily) return state.daily.live ? actions.livehome() : state.daily.challenge ? actions.defihome() : actions.dailyhome();
  await send('room:leave');
  leaveLocal();
}
actions.leaveok = leaveNow;
actions.leavecancel = () => { leaveAsk = false; render(); };
actions.toroom = () => { ui.sheet = null; ui.base = null; ui.trail = []; render(); };
function leaveOverlay() {
  if (!leaveAsk || !state || SCREEN) return '';
  const d = state.daily;
  const playing = ['countdown', 'question', 'reveal'].includes(state.phase);
  const title = d?.live ? 'Quitter le direct ?' : d ? 'Abandonner le défi ?' : 'Quitter le salon ?';
  const text = d?.live ? (state.phase === 'lobby' ? 'Tu peux revenir tant que le direct n’a pas commencé.' : 'Le direct continue sans toi et tu ne pourras pas y revenir.')
    : d ? 'Ta tentative compte avec les points déjà faits : tu ne pourras pas la rejouer.'
    : playing ? 'La partie continue sans toi.' : '';
  return `<div class="pause-overlay leave-ask" data-action="leavecancel" data-key="leave"><div class="pause-card card" role="alertdialog" aria-modal="true" aria-labelledby="leave-t" data-action="noop">
    <h2 id="leave-t">${title}</h2>
    ${text ? `<p class="muted">${text}</p>` : ''}
    <div class="leave-row">
      <button class="btn ghost" data-action="leaveok">${d && !d.live ? 'Abandonner' : 'Quitter'}</button>
      <button class="btn primary" data-action="leavecancel">${d ? 'Continuer' : 'Rester'}</button>
    </div>
  </div></div>`;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && leaveAsk) actions.leavecancel(); });
