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
  const compact = inRoom && !wide(); // téléphone dans un salon : avatar seul, la place va à Quitter et ⋯
  const face = name || u ? myAvatar(name || u?.name) : '';
  const chip = `<button class="me-chip ${compact || !name ? 'mini' : ''} ${ui.sheet === 'menu' ? 'on' : ''}" data-action="sheet" data-value="menu" aria-label="Ton menu" aria-haspopup="menu">${face || '<span>Ton pseudo ✎</span>'}${!compact && name ? `<span>${esc(name)}</span>` : ''}</button>`;
  return `
  <header class="appbar" data-key="appbar"><div class="ab-in">
    <button class="ab-logo" data-action="${solo ? 'dailyhome' : 'navhome'}" aria-label="${inRoom ? 'Retour au salon' : 'Accueil'}">Quiz<b>Party</b></button>
    ${inRoom ? `<span class="ab-room">Salon <b>${esc(state.code)}</b></span>` : ''}
    <span class="ab-end">
      ${inRoom ? '<button class="ab-btn" data-action="leave">Quitter</button>' : ''}
      ${inRoom && phase === 'lobby' && !wide() ? '<button class="ib ab-more" data-action="sheet" data-value="more" aria-label="Plus d’options">⋯</button>' : ''}
      ${solo ? '' : loginTop(inRoom ? 'account' : 'name')}${chip}
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
  ui.base = OVER.includes(name) && ui.sheet && SHEETS[ui.sheet]?.page ? ui.sheet : null;
  ui.sheet = name;
  if (name === 'daily') loadDaily(); // résultat et classement à jour
  render();
  if (name === 'create') setTimeout(() => $('#name')?.focus(), 60);
  if (name === 'join') setTimeout(() => (urlCode() ? $('#name') : $('#code'))?.focus(), 60);
}
const closeSheet = () => { ui.sheet = OVER.includes(ui.sheet) ? ui.base ?? null : null; ui.base = null; render(); };
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
