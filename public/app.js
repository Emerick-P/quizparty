/* global io */
'use strict';

// =====================================================================  utilitaires
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const SHAPES = ['▲', '◆', '●', '■'];
const KIND_LABEL = { qcm: 'Question', estimation: 'Estimation', cover: 'Jaquette', pitch: 'Pitch mal expliqué', emoji: 'Le jeu en emojis', sound: 'Quel jeu fait ce bruit ?', typed: 'Question', crossword: 'Mots croisés' };
const SCREEN_LABEL = { hud: 'HUD', loading: 'Écran de chargement' };
const kindLabel = (r) => (r.kind === 'screen' ? SCREEN_LABEL[r.screen] : r.kind === 'qcm' && r.choices?.length === 2 ? 'Vrai ou faux' : KIND_LABEL[r.kind]) || '';
const LEVEL_LABEL = { easy: 'Facile', hard: 'Difficile' };
const INPUT_LABEL = { choice: '4 choix', text: 'Réponse tapée' };
const MIX_INPUT_LABEL = { mixed: 'Au hasard', choice: '4 choix', text: 'Réponse tapée' };
const GUESS_KINDS = ['cover', 'pitch', 'emoji', 'screen', 'sound']; // manches « Quel est ce jeu ? » (4 choix ou saisie du titre)
const TYPED_KINDS = ['cover', 'pitch', 'emoji', 'typed', 'screen', 'sound']; // manches où l'on peut taper sa réponse, avec plusieurs essais

/** Salon : jeux regroupés par genre, avec une vignette (emoji + couleur). Un mode absent d'ici va dans « Autres ». */
const MODE_GROUPS = [
  { name: 'Culture jeu vidéo', ids: ['quiz', 'vraifaux', 'estimation'] },
  { name: 'Devine le jeu', ids: ['covers', 'pitch', 'emoji', 'hud', 'loading', 'sounds'] },
  { name: 'Lettres et mélange', ids: ['crossword', 'mix'] },
  { name: 'Entre amis', ids: ['bande'] },
];
const MODE_ART = {
  quiz: ['🧠', '#7c5cff'], vraifaux: ['⚖️', '#3d8bff'], estimation: ['🎯', '#ff8a3d'],
  covers: ['🖼️', '#ff5d73'], pitch: ['💬', '#2fc47a'], emoji: ['😜', '#ffb020'], hud: ['🎮', '#00b8d9'],
  loading: ['⏳', '#a35cff'], sounds: ['🔊', '#ff4fa3'], crossword: ['✏️', '#5fcf3f'], mix: ['🎲', '#ffcf3f'],
  bande: ['👥', '#3fb6ff'],
};
const modeArt = (id) => MODE_ART[id] || ['🕹️', '#8a7fd0'];

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
const SESSION_KEY = 'quizparty:session';
const NAME_KEY = 'quizparty:name';
const THEME_KEY = 'quizparty:theme';
const STEAM_KEY = 'quizparty:steam'; // adresse du profil Steam, retenue sur l'appareil

/** Thème clair / sombre (sombre par défaut), mémorisé sur l'appareil. Appliqué dès le <head> par index.html. */
const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set(THEME_KEY, theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eceef3' : '#22262e');
}
const themeToggle = () => {
  const light = currentTheme() === 'light';
  return `<div class="theme-toggle" role="group" aria-label="Thème">${[['light', 'Clair'], ['dark', 'Obscur']].map(([t, label]) =>
    `<button type="button" data-action="theme" data-value="${t}" aria-pressed="${(t === 'light') === light}">${label}</button>`).join('')}</div>`;
};

/** Énigme du jeu en emojis : chaque groupe (séparé par une espace) reste d'un seul tenant. */
function emojiLine(emojis, small = false) {
  if (!emojis) return '<blockquote class="pitch"><span class="muted">Le serveur n’est pas à jour : relance-le pour voir les emojis.</span></blockquote>';
  return `<div class="emojis${small ? ' small' : ''}" role="img" aria-label="Énigme en emojis">${String(emojis).trim().split(/\s+/).map((g) => `<span>${esc(g)}</span>`).join('')}</div>`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function urlCode() {
  const c = new URLSearchParams(location.search).get('code');
  return c ? c.toUpperCase().slice(0, 4) : '';
}
function setUrlCode(code) {
  const url = code ? `${location.pathname}?code=${code}` : location.pathname;
  history.replaceState(null, '', url);
}

// =====================================================================  socket & horloge
// =====================================================================  mode télé
// La même page sert d'écran télé sur /tv : elle s'appaire au salon de l'hôte (code à 4 chiffres ou Cast)
// et affiche la partie pour tout le monde. Les téléphones passent alors en « manette » (state.tv).
const SCREEN = /^\/tv(\.html)?$/.test(location.pathname);
const TV_KEY = 'quizparty:tv';
const tv = { pin: null, sheet: false };
const controller = () => !SCREEN && !!state?.tv;
if (SCREEN) {
  document.documentElement.classList.add('tv');
  // Interface dessinée pour 1280 px de large, agrandie à la taille de l'écran (télé 1080p ou 4K)
  // Toujours entier à l'écran, même avec la barre du navigateur de la télé (on garde le 16:9)
  const fit = () => { document.body.style.zoom = String(Math.min(innerWidth / 1280, innerHeight / 720)); };
  fit();
  addEventListener('resize', fit);
  // Plein écran : interdit sans geste, donc au premier appui sur OK de la télécommande (ou clic)
  const full = () => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen().catch(() => {});
  };
  addEventListener('keydown', (e) => { if (['Enter', ' ', 'Select'].includes(e.key) || e.keyCode === 13) full(); });
  addEventListener('click', full);
  document.addEventListener('fullscreenchange', () => render());
}
/** Rappel discret sur la télé tant qu'elle n'est pas en plein écran. */
const fullHint = () => (SCREEN && document.documentElement.requestFullscreen && !document.fullscreenElement
  ? '<p class="tv-full">Appuie sur <b>OK</b> de la télécommande pour passer en plein écran</p>' : '');

// =====================================================================  app installée (PWA)
// Installable sans store : écran d'accueil, plein écran, écran qui reste allumé pendant la partie.
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pwa = { prompt: null, installed: false, wake: null };
if ('serviceWorker' in navigator && !SCREEN) navigator.serviceWorker.register('/sw.js').catch(() => {});
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.prompt = e; render(); });
const INSTALLED_KEY = 'quizparty:installed';
const INSTALLED_MSG = '✓ QuizParty est installée : ouvre-la depuis l’icône QP de ton écran d’accueil';
addEventListener('appinstalled', () => {
  pwa.prompt = null;
  try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
  toast(INSTALLED_MSG);
  render();
});
/** L'app est-elle déjà installée ? Installée depuis ce navigateur (mémorisé), ou détectée par Chrome Android. */
function appInstalled() {
  if (pwa.installed) return true;
  try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch { return false; }
}
navigator.getInstalledRelatedApps?.().then((apps) => { if (apps?.length) { pwa.installed = true; render(); } }).catch(() => {});

/**
 * Accueil : faire savoir qu'il existe une app pour le téléphone.
 * Ordinateur : un bouton ouvre un QR code (le téléphone arrive sur la fenêtre d'installation).
 * Téléphone : Android installe en un geste ; iPhone, aide en 2 gestes ; déjà installée, on le dit.
 */
function installCard() {
  if (STANDALONE || SCREEN) return '';
  if (!TOUCH) return '<button class="btn install-btn ghost" data-action="sheet" data-value="getapp">📱 L’app QuizParty sur ton téléphone</button>';
  if (appInstalled() && !pwa.prompt) return '<p class="install-help">✓ App installée : ouvre QuizParty depuis l’icône QP de ton écran d’accueil, en plein écran.</p>';
  if (pwa.prompt) return '<button class="btn install-btn" data-action="install">📲 Installer l’app</button>';
  return '<button class="btn install-btn ghost" data-action="sheet" data-value="getapp">📲 Installer l’app</button>';
}
/** Fenêtre « L'app sur ton téléphone » (ordinateur : QR code ; téléphone : la marche à suivre). */
function getAppBody() {
  const host = esc(location.host);
  if (!TOUCH) return `
    <div class="getapp-qr"><img src="/qr/app.svg" alt="QR code vers QuizParty" width="200" height="200"></div>
    <p class="sh-note big">Scanne ce code avec l’appareil photo de ton téléphone : QuizParty s’ouvre, il ne reste qu’à toucher <b>Installer l’app</b>.</p>
    <p class="sh-note">Sinon, ouvre <span class="tv-url">${host}</span> dans le navigateur de ton téléphone. L’app est gratuite, sans store, et se met à jour toute seule.</p>`;
  if (appInstalled() && !pwa.prompt) return '<p class="sh-note big">✓ L’app est déjà installée sur ce téléphone : ouvre-la depuis l’icône <b>QP</b> de ton écran d’accueil.</p>';
  if (pwa.prompt) return `<p class="sh-note big">QuizParty en plein écran, avec son icône sur ton écran d’accueil. Gratuit, sans store.</p>
    <button class="btn primary big" data-action="install">📲 Installer l’app</button>`;
  if (IOS) return `<ol class="sh-steps"><li>Dans <b>Safari</b>, touche <b>Partager</b> <span aria-hidden="true">⬆︎</span> (en bas de l’écran).</li><li>Choisis <b>« Sur l’écran d’accueil »</b>.</li></ol>
    <p class="sh-note">QuizParty s’ouvrira ensuite en plein écran, comme une app. Depuis Chrome ou un autre navigateur sur iPhone, ouvre d’abord la page dans Safari.</p>`;
  return `<ol class="sh-steps"><li>Ouvre le menu <b>⋮</b> de ton navigateur (en haut à droite).</li><li>Touche <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.</li></ol>
    <p class="sh-note">Avec Chrome, Edge ou Samsung Internet, un bouton « Installer » peut aussi apparaître ici après quelques secondes.</p>`;
}
/** Écran allumé tant qu'on est dans un salon (le téléphone ne se met pas en veille entre deux questions). */
async function keepAwake() {
  const want = !!state && document.visibilityState === 'visible';
  try {
    if (want && !pwa.wake && 'wakeLock' in navigator) {
      pwa.wake = await navigator.wakeLock.request('screen');
      pwa.wake.addEventListener('release', () => { pwa.wake = null; });
    } else if (!want && pwa.wake) {
      await pwa.wake.release();
      pwa.wake = null;
    }
  } catch { pwa.wake = null; }
}
document.addEventListener('visibilitychange', keepAwake);
/** Petites vibrations (Android) : nouvelle question, bonne ou mauvaise réponse. */
const buzz = (pattern) => { if (!SCREEN && navigator.vibrate) try { navigator.vibrate(pattern); } catch {} };
let buzzedFor = null;
function buzzOnPhase(phase) {
  const r = state?.round;
  if (!r) return;
  const key = `${phase}:${r.id}`;
  if (buzzedFor === key) return;
  buzzedFor = key;
  if (phase === 'question') buzz(40);
  else if (phase === 'reveal') {
    const me = state.reveal?.results?.find((x) => x.playerId === state.you);
    buzz(me?.correct || me?.points > 0 ? [30, 60, 30] : 120);
  }
}
// Retour (bouton ou geste Android) : pendant une partie, il ferme d'abord un panneau ouvert, puis il ne quitte pas le salon
function guardBack() {
  if (!SCREEN && state && !history.state?.qp) history.pushState({ qp: 1 }, '');
}
addEventListener('popstate', () => {
  if (SCREEN || !state) return;
  history.pushState({ qp: 1 }, '');
  if (tv.sheet) { tv.sheet = false; render(); }
  else if (ui.sheet) closeSheet();
  else if (typeof proposeOpen === 'function' && proposeOpen()) closePropose();
  else toast('Pour quitter le salon, utilise « ← Quitter »');
});

const socket = io({ transports: ['websocket', 'polling'], ...(SCREEN ? { auth: { screen: true } } : {}) });

/**
 * Synchronisation d'horloge (principe de NTP) :
 * on envoie un ping, le serveur répond avec son heure. En supposant le trajet symétrique,
 * l'heure serveur correspond au milieu de l'aller-retour. On garde l'échantillon au plus
 * petit aller-retour, c'est le plus fiable.
 */
const clock = { offset: 0, samples: [] };
const now = () => Date.now() + clock.offset;
// Heure d'affichage : figée à l'heure serveur de la pause quand l'hôte a mis la partie en pause,
// donc tous les chronos, barres et jaquettes s'arrêtent au même temps restant chez tout le monde.
const shownNow = () => (state?.paused ? state.paused.at : now());

function sampleClock() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const wall0 = Date.now();
    socket.timeout(4000).emit('time:ping', null, (err, serverTime) => {
      if (!err && typeof serverTime === 'number') {
        const rtt = performance.now() - t0;
        clock.samples.push({ rtt, offset: serverTime - (wall0 + rtt / 2) });
        if (clock.samples.length > 12) clock.samples.shift();
        clock.offset = clock.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
      }
      resolve();
    });
  });
}
async function syncClock(n) {
  for (let i = 0; i < n; i++) {
    await sampleClock();
    await new Promise((r) => setTimeout(r, 80));
  }
}
setInterval(() => { if (socket.connected) sampleClock(); }, 15000);

function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, payload, (err, res) => resolve(err ? { error: 'Pas de réponse du serveur' } : res || {}));
  });
}

// =====================================================================  état
let state = null;          // dernier état reçu du serveur
let pending = null;        // réponse envoyée mais pas encore confirmée {roundId, answer}
let renderedPhase = null;  // phase actuellement affichée
let resuming = !SCREEN && !!store.get(SESSION_KEY);

socket.on('connect', async () => {
  $('#conn').hidden = true;
  await syncClock(state ? 3 : 5);
  if (SCREEN) await tvConnect();
  else await resume();
});

/** Écran télé : reprend son salon (après un rechargement), sinon affiche un code d'appairage. */
async function tvConnect() {
  const saved = store.get(TV_KEY);
  if (saved) {
    const r = await send('screen:resume', saved);
    if (!r.error) return;
    store.del(TV_KEY);
  }
  state = null;
  const r = await send('screen:hello');
  tv.pin = r.pin || null;
  render();
}
socket.on('screen:paired', ({ code, token, grant }) => {
  store.set(TV_KEY, { code, token });
  // Site à code d'accès : le laissez-passer pose le cookie, puis la page revient sur /tv et reprend le salon
  if (grant) location.href = `/tv/entree?g=${encodeURIComponent(grant)}`;
});
socket.on('screen:closed', () => {
  store.del(TV_KEY);
  state = null;
  tvConnect();
});
socket.on('disconnect', () => { $('#conn').hidden = false; });
// Site protégé par un code d'accès (cookie absent ou périmé) : retour à la page d'entrée
socket.on('connect_error', (err) => {
  if (err?.data?.access) location.href = `/entree?next=${encodeURIComponent(location.pathname + location.search)}`;
});
socket.on('state', (s) => {
  state = s;
  // Les images sont chargées pendant le « 3, 2, 1 » (et dès la correction précédente) pour être prêtes à l'heure
  if (s.round?.image) loadImage(s.round.image.url);
  if (s.round?.sound) loadSound(s.round.sound.url);
  if (s.preload) (s.preload.startsWith('/sfx/') ? loadSound : loadImage)(s.preload);
  if (s.round?.picture) loadImage(s.round.picture.url);
  if (pending && (!s.round || s.round.id !== pending.roundId || s.round.yourAnswer !== null)) pending = null;
  autoLinkSteam();
  render();
});

/** Profil Steam retenu sur l'appareil : relié tout seul en entrant dans un salon (une fois par salon). */
let steamAutoFor = null;
function autoLinkSteam() {
  const me = state?.players?.find((p) => p.id === state.you);
  const saved = store.get(STEAM_KEY);
  const key = `${state?.code}:${state?.you}`;
  if (!me || me.steam || !saved || steamAutoFor === key) return;
  steamAutoFor = key;
  send('steam:link', { profile: saved });
}
socket.on('srv:ping', (_t, ack) => { if (typeof ack === 'function') ack(); });
socket.on('kicked', () => leaveLocal("L'hôte t'a retiré du salon"));
socket.on('session:replaced', () => {
  state = null;
  render();
  toast('Ta session a été ouverte ailleurs');
});

async function resume() {
  const s = store.get(SESSION_KEY);
  if (!s) { resuming = false; render(); return; }
  const res = await send('room:resume', s);
  resuming = false;
  if (res.error) {
    store.del(SESSION_KEY);
    state = null;
    if (urlCode() === s.code) setUrlCode('');
    toast(res.error);
    render();
  }
}

function enterRoom(res) {
  store.set(SESSION_KEY, { code: res.code, token: res.token });
  setUrlCode(res.code);
}

function leaveLocal(message) {
  store.del(SESSION_KEY);
  state = null;
  pending = null;
  setUrlCode('');
  render();
  if (message) toast(message);
}

// La phase "question" commence à r.startsAt selon l'horloge serveur : on bascule localement
// à l'instant exact, sans attendre le message du serveur (qui arrive avec la latence).
function displayPhase() {
  if (SCREEN) {
    if (!state) return 'tvpair';
    if (state.phase === 'lobby') return 'tvlobby';
  } else if (!state) return resuming ? 'loading' : 'home';
  if (state.phase === 'countdown' && state.round && shownNow() >= state.round.startsAt) return 'question';
  return state.phase;
}

// =====================================================================  actions
function getName() {
  const field = $('#name');
  const name = (field ? field.value : store.get(NAME_KEY) || '').trim();
  if (!name) { toast('Choisis un pseudo'); field ? field.focus() : openSheet('create'); return null; }
  store.set(NAME_KEY, name);
  return name;
}

async function answer(value) {
  const r = state?.round;
  if (!r || pending || r.yourAnswer !== null || displayPhase() !== 'question') return;
  pending = { roundId: r.id, answer: value };
  if (navigator.vibrate) navigator.vibrate(15);
  render();
  const res = await send('game:answer', { roundId: r.id, answer: value });
  if (res.wrong) {
    // Mauvais titre mais il reste des essais
    if (pending && pending.roundId === r.id) pending = null;
    if (state?.round?.id === r.id) state.round.yourMisses = r.tries - res.triesLeft;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    render();
    const input = $('#guess-input');
    if (input) { input.value = ''; input.focus(); } // garde le clavier ouvert pour retenter
    toast(`Non ! Encore ${res.triesLeft} essai${res.triesLeft > 1 ? 's' : ''}`);
    $('.guess')?.classList.add('shake');
    return;
  }
  if (res.correct !== undefined && state?.round?.id === r.id) state.round.yourCorrect = res.correct;
  if (res.error) {
    toast(res.error);
    if (pending && pending.roundId === r.id) pending = null;
    render();
  }
}

/**
 * Un clic copie le lien du salon ; le bouton affiche « Lien copié ! » un instant.
 * navigator.clipboard n'existe qu'en https ou sur localhost : en http sur le réseau local (192.168…),
 * on passe par l'ancienne méthode (champ caché + copier).
 */
let copiedUntil = 0;
const COPIED_MS = 1200;
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* refusé */ }
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error('copie refusée'));
}
async function share() {
  const url = `${location.origin}/?code=${state.code}`;
  try { await copyText(url); } catch { return toast(url); } // à défaut, on affiche le lien pour le copier à la main
  copiedUntil = Date.now() + COPIED_MS;
  render();
  setTimeout(render, COPIED_MS + 20);
}

const actions = {
  theme(btn) { setTheme(btn.dataset.value === 'light' ? 'light' : 'dark'); render(); },
  async create() {
    const name = getName(); if (!name) return;
    const res = await send('room:create', { name });
    if (res.error) return toast(res.error);
    enterRoom(res);
  },
  async join() {
    const name = getName(); if (!name) return;
    const code = ($('#code')?.value || '').trim().toUpperCase();
    if (code.length !== 4) return toast('Le code fait 4 lettres');
    const res = await send('room:join', { code, name });
    if (res.error) return toast(res.error);
    enterRoom(res);
  },
  async leave() { await send('room:leave'); leaveLocal(); },
  async install() {
    if (!pwa.prompt) return;
    pwa.prompt.prompt();
    const choice = await pwa.prompt.userChoice.catch(() => null);
    pwa.prompt = null;
    if (choice?.outcome === 'accepted') {
      if (ui.sheet === 'getapp') ui.sheet = null;
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
      toast(INSTALLED_MSG);
    }
    render();
  },
  tvsheet() { tv.sheet = true; render(); setTimeout(() => $('#tv-pin')?.focus(), 50); },
  tvclose() { tv.sheet = false; render(); },
  async tvoff() { const r = await send('room:screen-off'); if (r.error) toast(r.error); },
  share,
  async start() { const r = await send('game:start'); if (r.error) toast(r.error); },
  async skip() { const r = await send('game:skip'); if (r.error) toast(r.error); },
  async stop(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer ?';
      setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = 'Arrêter'; } }, 3000);
      return;
    }
    const r = await send('game:stop'); if (r.error) toast(r.error);
  },
  async lobby() { const r = await send('game:stop'); if (r.error) toast(r.error); },
  async resetTotals(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer la remise à zéro ?';
      setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = 'Remettre à zéro'; } }, 3000);
      return;
    }
    const r = await send('room:reset-totals');
    if (r.error) return toast(r.error);
    toast('Score global remis à zéro');
  },
  async steamLink() {
    const profile = ($('#steam-input')?.value || '').trim();
    if (!profile) return toast('Colle l\'adresse de ton profil Steam');
    store.set(STEAM_KEY, profile);
    const r = await send('steam:link', { profile });
    if (r.error) toast(r.error);
  },
  steamHelp() { steamHelpOpen = true; render(); },
  steamHelpClose() { steamHelpOpen = false; render(); },
  noop() {},
  async steamUnlink() {
    store.del(STEAM_KEY);
    const r = await send('steam:unlink');
    if (r.error) toast(r.error);
  },
  async kick(btn) { const r = await send('room:kick', { playerId: btn.dataset.id }); if (r.error) toast(r.error); },
  async set(btn) {
    const r = await send('room:settings', { [btn.dataset.key]: btn.dataset.value });
    if (r.error) toast(r.error);
  },
  async mixpart(btn) {
    const r = await send('room:settings', { mixPart: btn.dataset.value });
    if (r.error) toast(r.error);
  },
  answer(btn) { answer(Number(btn.dataset.index)); },
  zoom(el) { zoomShot(el.getAttribute('src')); },
  async ban(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer le retrait ?';
      return;
    }
    const kind = state.round?.kind;
    const r = await send('game:ban-cover');
    if (r.error) return toast(r.error);
    toast(kind === 'screen' ? 'Image retirée des prochaines parties' : kind === 'sound' ? 'Son retiré des prochaines parties' : 'Jeu retiré des prochaines parties');
  },
  replay() { replaySound(); },
  async pause() { const r = await send('game:pause'); if (r.error) toast(r.error); },
  async resume() { const r = await send('game:resume'); if (r.error) toast(r.error); },
  reportType(btn) { report.type = btn.dataset.value; render(); },
  reportPick(btn) {
    const input = $('#report-accept');
    if (input) input.value = btn.dataset.value;
  },
  async reportSend(btn) {
    if (!report.type) return toast('Choisis le type de retour');
    const accept = $('#report-accept')?.value.trim() || '';
    const comment = $('#report-comment')?.value.trim() || '';
    if (report.type === 'accept' && !accept) return toast('Écris la réponse à accepter');
    if (report.type === 'other' && !comment) return toast('Décris le souci en quelques mots');
    btn.disabled = true;
    const r = await send('game:report', { type: report.type, accept, comment, resume: btn.dataset.resume === 'yes' });
    btn.disabled = false;
    if (r.error) return toast(r.error);
    report.type = null;
    for (const el of ['#report-accept', '#report-comment']) if ($(el)) $(el).value = '';
    toast('Retour enregistré, merci !');
    render();
  },
};

// =====================================================================  proposer
// Le formulaire /proposer s'ouvre dans un panneau par-dessus le jeu (iframe de la même origine) :
// la page du jeu et sa connexion restent en place, le brouillon est gardé quand on ferme.
// Bouton seulement dans le salon (choix du client : ne pas casser le rythme d'une partie).
const PROPOSE_PHASES = ['lobby', 'end'];
const proposeButton = (label = 'Une idée de question, de pitch, de son ? Proposer') =>
  `<button class="btn small ghost propose-btn" data-action="propose">💡 ${esc(label)}</button>`;
const proposePanel = () => $('#propose');
const proposeOpen = () => !proposePanel().hidden;
function openPropose() {
  const panel = proposePanel();
  if (!panel.querySelector('iframe')) {
    const frame = document.createElement('iframe');
    frame.src = '/proposer?embed=1';
    frame.title = 'Proposer du contenu';
    panel.querySelector('.propose-sheet').append(frame);
  }
  panel.hidden = false;
  document.body.classList.add('propose-on');
  updatePropose();
}
function closePropose() {
  proposePanel().hidden = true;
  document.body.classList.remove('propose-on');
}
/** Si une manche commence pendant que le panneau est ouvert, on le signale sans le fermer. */
function updatePropose() {
  if (!proposeOpen()) return;
  const phase = displayPhase();
  const live = !PROPOSE_PHASES.includes(phase) && !['home', 'loading'].includes(phase);
  const head = $('#propose-live');
  head.hidden = !live;
  if (live && state.round) head.textContent = state.round.kind === 'crossword' ? '⏱ La grille commence · revenir au jeu' : `⏱ Question ${state.round.index + 1} · revenir au jeu`;
}
actions.propose = openPropose;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && proposeOpen()) closePropose(); });
window.addEventListener('message', (e) => {
  if (e.origin === location.origin && e.data?.type === 'quizparty:propose-close') closePropose();
});
$('#propose-close').addEventListener('click', closePropose);
$('#propose-live').addEventListener('click', closePropose);
$('#propose').addEventListener('click', (e) => { if (e.target.id === 'propose') closePropose(); });

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  actions[btn.dataset.action]?.(btn);
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.matches('[data-form="est"]')) {
    const raw = $('#est-input').value.replace(/\s/g, '').replace(',', '.');
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return toast('Entre un nombre');
    answer(n);
  } else if (e.target.matches('[data-form="guess"]')) {
    const guess = $('#guess-input').value.trim();
    if (!guess) return toast(state?.round?.kind === 'typed' ? 'Tape ta réponse' : 'Tape le nom du jeu');
    rememberGuess(guess);
    answer(guess);
  } else if (e.target.matches('[data-form="name"]')) {
    if (getName()) closeSheet();
  } else if (e.target.matches('[data-form="create"]')) {
    actions.create();
  } else if (e.target.matches('[data-form="join"]')) {
    actions.join();
  } else if (e.target.matches('[data-form="steam"]')) {
    actions.steamLink();
  } else if (e.target.matches('[data-form="tvpin"]')) {
    const pin = $('#tv-pin').value.replace(/\D/g, '');
    if (pin.length !== 4) return toast('Le code de la télé fait 4 chiffres');
    send('room:screen', { pin }).then((r) => {
      if (r.error) return toast(r.error);
      tv.sheet = false;
      $('#tv-pin').value = '';
      toast('📺 Télé connectée : la partie s’affiche dessus');
      render();
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'tv-pin') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  if (e.target.id === 'code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (e.target.id === 'guess-input') recall.pos = null; // on retape : la flèche repart de la dernière saisie
});

/**
 * Saisies précédentes, comme dans un terminal : ↑ remet la saisie d'avant (pour corriger une faute après un
 * essai raté), ↑ encore remonte plus loin, ↓ redescend. Gardées pour toute la session, toutes manches confondues.
 */
const recall = { list: [], pos: null, draft: '' };
function rememberGuess(g) {
  if (recall.list[recall.list.length - 1] !== g) recall.list.push(g);
  if (recall.list.length > 30) recall.list.shift();
  recall.pos = null;
}
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'guess-input' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey) return;
  const input = e.target;
  const { list } = recall;
  if (!list.length) return;
  e.preventDefault();
  if (recall.pos === null) {
    if (e.key === 'ArrowDown') return;
    recall.draft = input.value;
    recall.pos = list.length;
  }
  recall.pos += e.key === 'ArrowUp' ? -1 : 1;
  if (recall.pos < 0) recall.pos = 0;
  let v;
  if (recall.pos >= list.length) { v = recall.draft; recall.pos = null; } else v = list[recall.pos];
  input.value = v;
  input.setSelectionRange(v.length, v.length);
});

// =====================================================================  jaquettes pixelisées
const images = new Map(); // url → { img, ok }
function loadImage(url) {
  if (!url) return null;
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    e = { img, ok: false };
    img.onload = () => { e.ok = true; updateTimers(); };
    img.onerror = () => { images.delete(url); };
    img.src = url;
    images.set(url, e);
  }
  return e;
}

/**
 * Niveau de détail en fonction du temps écoulé, mesuré sur l'horloge serveur : tous les joueurs
 * voient exactement le même niveau au même moment. L'image reste un peu pixelisée jusqu'au bout
 * de la question ; elle n'est nette qu'à la correction.
 */
const PIX_COLS = [4, 6, 8, 11, 15, 20, 27, 36, 48, 64];
// Vitesse de découverte : le niveau « devinable par la plupart » (27 colonnes, 7e palier) arrive
// quand il reste environ 30 % du chrono (4 choix) et 33 % en saisie, pour laisser le temps de taper.
// Au-delà de 1, les derniers paliers ne sont jamais atteints : l'image reste un peu pixelisée jusqu'au bout.
const PIX_LAST_AT = { choice: 1.05, text: 1.0 };
function pixColumns(t, from, until, input) {
  const p = (t - from) / Math.max(1, until - from);
  const step = Math.floor((p / (PIX_LAST_AT[input] ?? 0.6)) * (PIX_COLS.length - 1));
  return PIX_COLS[Math.max(0, Math.min(PIX_COLS.length - 1, step))];
}

function drawCover(canvas, t) {
  const e = loadImage(canvas.dataset.src);
  if (!e?.ok) return;
  const img = e.img;
  const cols = canvas.dataset.clear ? 0 : pixColumns(t, Number(canvas.dataset.from), Number(canvas.dataset.until), canvas.dataset.input);
  const key = `${cols}`;
  if (canvas.dataset.key === key) return;
  canvas.dataset.key = key;
  const W = img.naturalWidth, H = img.naturalHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  canvas.parentElement.classList.add('loaded');
  const ctx = canvas.getContext('2d');
  if (!cols) { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0); return; }
  // Réduction par moitiés successives : chaque gros pixel est la moyenne de sa zone (couleurs fidèles)
  let src = img, w = W, h = H;
  while (w / 2 >= cols * 2) {
    const half = document.createElement('canvas');
    half.width = w = Math.floor(w / 2);
    half.height = h = Math.floor(h / 2);
    half.getContext('2d').drawImage(src, 0, 0, w, h);
    src = half;
  }
  const rows = Math.max(1, Math.round((cols * H) / W));
  const small = document.createElement('canvas');
  small.width = cols;
  small.height = rows;
  small.getContext('2d').drawImage(src, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(small, 0, 0, cols, rows, 0, 0, W, H);
}

function coverFigure(image, { from, until, clear, input } = {}) {
  return `<figure class="cover-wrap">
    <canvas class="cover" data-src="${esc(image.url)}" ${clear ? 'data-clear="1"' : `data-from="${from}" data-until="${until}" data-input="${input}"`}></canvas>
    <span class="cover-loading">Chargement…</span>
    ${clear ? '' : `<figcaption>Image : ${esc(image.source)}</figcaption>`}
  </figure>`;
}

/** Capture d'écran (HUD, chargement) : affichée telle quelle, touche pour l'agrandir. */
function shotFigure(image) {
  return `<figure class="shot-wrap">
    <img class="shot" src="${esc(image.url)}" alt="" data-action="zoom" draggable="false">
    <span class="shot-zoom" aria-hidden="true">⤢</span>
  </figure>`;
}
function zoomShot(url) {
  let el = $('#zoom');
  if (!el) {
    el = document.createElement('div');
    el.id = 'zoom';
    el.addEventListener('click', () => { el.hidden = true; });
    document.body.appendChild(el);
  }
  el.innerHTML = `<img src="${esc(url)}" alt="">`;
  el.hidden = false;
}
const closeZoom = () => { const el = $('#zoom'); if (el) el.hidden = true; };

// =====================================================================  sons (Quel jeu fait ce bruit ?)
/**
 * Le son est téléchargé pendant le « 3, 2, 1 », puis lancé à r.startsAt (horloge serveur) : tout le monde
 * l'entend au même instant. Chacun peut ensuite le réécouter.
 * Lecture par un seul élément <audio> réutilisé : contrairement à Web Audio, il joue même quand l'iPhone est
 * en mode silencieux. Les navigateurs exigent un premier geste : le moindre toucher ou clic sur la page
 * (pseudo, Rejoindre…) « déverrouille » l'élément en jouant un silence. Sinon, le bouton affiche
 * « Touche l'écran pour activer le son ».
 */
const SILENT_MP3 = 'data:audio/mpeg;base64,//NAxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEWwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsSjAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
const sfx = { el: null, files: new Map(), timer: null, roundId: null, unlocked: false, blocked: false, playing: false };
const SFX_LATE_MS = 300; // au-delà, on ne démarre pas le son en route : il faut toucher Réécouter
/**
 * Volume propre à chaque joueur (0 à 100), mémorisé dans le navigateur. Courbe au carré : le curseur suit
 * mieux l'oreille. Sur iPhone/iPad, Safari ignore le volume d'un élément audio : le curseur y est masqué
 * (on règle avec les boutons du téléphone).
 */
const VOLUME_KEY = 'quizparty:volume';
function sfxVolume() {
  const v = store.get(VOLUME_KEY);
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 100;
}
const volumeGain = (v = sfxVolume()) => (v / 100) ** 2;
const volumeSettable = (() => {
  let ok = null;
  return () => {
    if (ok === null) { try { const a = new Audio(); a.volume = 0.5; ok = Math.abs(a.volume - 0.5) < 0.01; } catch { ok = false; } }
    return ok;
  };
})();
function setVolume(v) {
  store.set(VOLUME_KEY, v);
  if (sfx.el && sfx.el.src !== SILENT_MP3) sfx.el.volume = volumeGain(v);
  const icon = $('[data-vol-icon]');
  if (icon) icon.textContent = volumeIcon(v);
}
const volumeIcon = (v) => (v === 0 ? '🔇' : v < 40 ? '🔈' : v < 75 ? '🔉' : '🔊');

function audioEl() {
  if (!sfx.el) {
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.addEventListener('playing', () => { sfx.playing = a.src !== SILENT_MP3; updateTimers(); });
    for (const ev of ['pause', 'ended', 'error']) a.addEventListener(ev, () => { sfx.playing = false; updateTimers(); });
    sfx.el = a;
  }
  return sfx.el;
}
const audioBlocked = () => sfx.blocked;

/** Premier geste sur la page : on joue un silence pour avoir le droit de jouer les sons ensuite. */
function unlockAudio() {
  if (sfx.unlocked) return;
  const a = audioEl();
  if (sfx.playing) return;
  a.src = SILENT_MP3;
  const p = a.play();
  if (p) p.then(() => { sfx.unlocked = true; sfx.blocked = false; updateTimers(); }).catch(() => {});
}
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlockAudio, { capture: true, passive: true });

/** Télécharge un son une seule fois (adresse locale blob:, prête à jouer instantanément). */
function loadSound(url) {
  if (!url) return null;
  let p = sfx.files.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(res.status))))
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => { sfx.files.delete(url); return url; }); // à défaut, l'élément le chargera lui-même
    sfx.files.set(url, p);
  }
  return p;
}

function stopSound() {
  clearTimeout(sfx.timer);
  sfx.timer = null;
  if (sfx.el && !sfx.el.paused) sfx.el.pause();
  sfx.playing = false;
}

/** Joue le son ; `at` = heure serveur de départ (null : tout de suite). */
async function playSound(url, at = null) {
  if (!url) return;
  const src = await loadSound(url);
  const a = audioEl();
  stopSound();
  a.src = src;
  a.load();
  const go = () => {
    sfx.timer = null;
    if (a.src !== src) a.src = src; // un toucher pendant le 3-2-1 a pu y mettre le silence de déverrouillage
    a.volume = volumeGain();
    try { a.currentTime = 0; } catch { /* pas encore chargé */ }
    const p = a.play();
    if (p) p.then(() => { sfx.unlocked = true; sfx.blocked = false; }).catch((err) => {
      if (err?.name === 'NotAllowedError') sfx.blocked = true;
      else toast('Son illisible');
      updateTimers();
    });
  };
  const wait = at === null ? 0 : at - now();
  if (wait > 0) sfx.timer = setTimeout(go, wait);
  else go();
}

/** Programme le départ automatique du son de la manche en cours (une fois par manche). */
function syncSound() {
  const r = state?.round;
  const phase = displayPhase();
  if (!r || r.kind !== 'sound' || !['countdown', 'question', 'reveal'].includes(phase) || controller()) {
    if (sfx.roundId && (!r || r.id !== sfx.roundId)) { stopSound(); sfx.roundId = null; }
    return;
  }
  if (state.paused) {
    // Pause : on coupe le son (il sera relancé à la reprise s'il n'avait pas encore démarré)
    if (sfx.roundId === r.id && (sfx.timer || sfx.playing)) { stopSound(); sfx.roundId = null; }
    return;
  }
  if (sfx.roundId === r.id) return;
  if (phase === 'reveal' || now() > r.startsAt + SFX_LATE_MS) return; // trop tard : bouton Réécouter
  sfx.roundId = r.id;
  playSound(r.sound.url, r.startsAt);
}

function replaySound() {
  const r = state?.round;
  if (r?.sound) {
    sfx.roundId = r.id;
    playSound(r.sound.url);
  }
}

/** Bouton du son : ondes animées pendant la lecture, « Réécouter » ensuite. */
function soundFigure(r) {
  return `<div class="sound-wrap">
    <button class="sound-btn" data-action="replay" aria-label="Écouter le son">
      <span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
    </button>
    <span class="sound-hint muted" data-sound-hint></span>
    ${volumeSettable() ? `<label class="sound-vol"><span data-vol-icon aria-hidden="true">${volumeIcon(sfxVolume())}</span>
      <input type="range" id="sfx-vol" min="0" max="100" step="5" value="${sfxVolume()}" aria-label="Volume du son"></label>` : ''}
  </div>`;
}
document.addEventListener('input', (e) => { if (e.target.id === 'sfx-vol') setVolume(Number(e.target.value)); });
function updateSoundUi() {
  const hint = $('[data-sound-hint]');
  if (!hint) return;
  const playing = sfx.playing;
  $('.sound-btn')?.classList.toggle('on', playing);
  const text = audioBlocked() ? 'Touche l’écran pour activer le son'
    : displayPhase() === 'countdown' ? 'Monte le son, ça va partir…'
    : playing ? 'Écoute…' : 'Touche pour réécouter';
  if (hint.textContent !== text) hint.textContent = text;
}

// =====================================================================  mots croisés
/**
 * Partie au chrono : chacun enchaîne les mêmes grilles à son rythme. On choisit une définition (ou une case),
 * on tape le mot entier dans la case de saisie : la grille montre la saisie en direct. Le mot part au serveur
 * dès qu'il a toutes ses lettres. Juste : il se verrouille en vert. Faux (ou saisie arrêtée 2 s avant la fin
 * du mot) : il clignote en rouge et la saisie s'efface ; les lettres déjà trouvées restent.
 */
const CW_IDLE_MS = 2000;
const cw = { key: null, sel: null, typed: '', bad: null, idle: null, sending: false };
const cwCells = (w) => Array.from({ length: w.length }, (_, i) => [w.row + (w.dir === 'down' ? i : 0), w.col + (w.dir === 'across' ? i : 0)]);
const cwLetters = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const cwPlaying = () => {
  const r = state?.round;
  return r?.kind === 'crossword' && displayPhase() === 'question' && r.grid ? r : null;
};
/** Lettres verrouillées de la grille en cours : celles des mots trouvés (venues du serveur). */
function cwLocked(r) {
  const out = {};
  for (const [id, word] of Object.entries(r.yourWords || {})) {
    const w = r.grid.words[id];
    if (w) cwCells(w).forEach(([y, x], i) => { out[`${y},${x}`] = word[i]; });
  }
  return out;
}
const cwFound = (r, w) => !!(r.yourWords || {})[w.id];
/** Repère d'un mot : lettre pour les horizontaux (A, B, C…), numéro pour les verticaux (1, 2, 3…), dans l'ordre de lecture. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function cwLabels(grid) {
  const out = new Map();
  for (const dir of ['across', 'down']) {
    grid.words.filter((w) => w.dir === dir).sort((a, b) => a.row - b.row || a.col - b.col)
      .forEach((w, i) => out.set(w.id, dir === 'across' ? LETTERS[i] ?? String(i + 1) : String(i + 1)));
  }
  return out;
}
const cwWord = (r) => (cw.sel === null ? null : r.grid.words[cw.sel] ?? null);

/** Nouvelle grille (début de partie, grille validée, reconnexion) : on repart sur le premier mot à trouver. */
function cwSync(r) {
  const key = `${r.id}:${r.gridIndex}`;
  if (cw.key === key && !(cwWord(r) && cwFound(r, cwWord(r)))) return;
  if (cw.key !== key) { cw.typed = ''; cw.bad = null; }
  cw.key = key;
  cw.sel = (r.grid.words.find((w) => !cwFound(r, w)) ?? r.grid.words[0]).id;
}
function cwSetTyped(v) {
  cw.typed = v;
  const input = $('#cw-word');
  if (input && input.value !== v) input.value = v;
}
/** Passe au mot suivant (ou précédent) pas encore trouvé. */
function cwNext(r, step = 1) {
  const words = r.grid.words;
  const start = cw.sel ?? -1;
  for (let k = 1; k <= words.length; k++) {
    const w = words[(start + k * step + words.length * 2) % words.length];
    if (!cwFound(r, w)) { cw.sel = w.id; break; }
  }
  cwSetTyped('');
  cw.bad = null;
}
function cwChoose(id) {
  const r = cwPlaying();
  const w = r?.grid.words[id];
  if (!w || cwFound(r, w)) return;
  if (cw.sel !== w.id) { cw.sel = w.id; cwSetTyped(''); cw.bad = null; }
  render();
  cwFocus();
}
function cwFocus() {
  const input = $('#cw-word');
  if (input && document.activeElement !== input) input.focus({ preventScroll: true });
}

/** Mot faux : il clignote en rouge (avec ce qui a été tapé), puis la saisie s'efface. */
function cwWrong(r, w, typed) {
  clearTimeout(cw.idle);
  cw.bad = { id: w.id, letters: typed, at: Date.now() };
  cwSetTyped('');
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  render();
  setTimeout(() => { if (cw.bad && Date.now() - cw.bad.at >= 850) { cw.bad = null; render(); } }, 900);
}

async function cwSubmit(r, w, letters) {
  clearTimeout(cw.idle);
  cw.sending = true;
  const res = await send('game:word', { roundId: r.id, grid: r.gridIndex, wordId: w.id, letters });
  cw.sending = false;
  const cur = state?.round;
  if (cur?.id !== r.id) return;
  if (res.error) { cwSetTyped(''); render(); if (!res.stale) toast(res.error); return; }
  if (!res.correct) return cwWrong(r, w, letters);
  if (navigator.vibrate) navigator.vibrate(20);
  if (res.validated) {
    toast(`Grille validée ! Grille ${r.gridIndex + 2}`);
    cwSetTyped('');
    return; // la nouvelle grille arrive avec l'état
  }
  cur.yourWords = { ...(cur.yourWords || {}), [w.id]: res.word };
  if (cur.gridIndex === r.gridIndex) cwNext(cur);
  render();
}

/** Saisie : lettres seulement, pas plus que la longueur du mot ; envoi dès que le mot est complet. */
function cwOnInput(input) {
  const r = cwPlaying();
  const w = r && cwWord(r);
  if (!w) return;
  const v = cwLetters(input.value).slice(0, w.length);
  if (input.value !== v) input.value = v;
  cw.typed = v;
  cw.bad = null;
  clearTimeout(cw.idle);
  if (v.length === w.length) {
    cwSubmit(r, w, v);
  } else if (v.length) {
    // Saisie arrêtée en cours de mot : comptée comme une erreur
    const typed = v;
    cw.idle = setTimeout(() => {
      const now2 = cwPlaying();
      if (now2 && cw.typed === typed && cwWord(now2) === w) cwWrong(now2, w, typed);
    }, CW_IDLE_MS);
  }
  render();
}

Object.assign(actions, {
  cwCell(btn) {
    const r = cwPlaying();
    if (!r) return;
    const row = Number(btn.dataset.r), col = Number(btn.dataset.c);
    const at = r.grid.words.filter((w) => !cwFound(r, w) && cwCells(w).some(([y, x]) => y === row && x === col));
    if (!at.length) return;
    // Case au croisement de deux mots : un second toucher change de sens
    const cur = at.findIndex((w) => w.id === cw.sel);
    cwChoose(at[(cur + 1) % at.length].id);
  },
  cwClue(btn) { cwChoose(Number(btn.dataset.id)); },
  cwFocus() { cwFocus(); },
});

document.addEventListener('input', (e) => { if (e.target.id === 'cw-word') cwOnInput(e.target); });
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'cw-word') return;
  const r = cwPlaying();
  if (!r) return;
  if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    cwNext(r, e.shiftKey || e.key === 'ArrowUp' ? -1 : 1);
    render();
  } else if (e.key === 'Enter') {
    // Entrée sur un mot incomplet : c'est une erreur, comme l'arrêt de la saisie
    e.preventDefault();
    const w = cwWord(r);
    if (w && cw.typed && cw.typed.length < w.length) cwWrong(r, w, cw.typed);
  }
});

/** La grille. solution : lettres de tous les mots (correction) ; sinon mots trouvés + saisie en cours. */
function cwGrid(r, grid, { solution = false, mine = null } = {}) {
  const locked = solution ? {} : cwLocked(r);
  const letters = {};
  const okCells = new Set();
  for (const w of grid.words) {
    cwCells(w).forEach(([y, x], i) => {
      const k = `${y},${x}`;
      if (solution) letters[k] = w.word[i];
      if (solution ? mine?.[w.id] : locked[k]) okCells.add(k);
    });
  }
  const cur = !solution && cwWord(r);
  const curCells = cur ? cwCells(cur).map((c) => c.join(',')) : [];
  const typed = {}; // saisie en direct, ou le mot faux qui clignote
  const bad = !solution && cw.bad && grid.words[cw.bad.id];
  if (bad) cwCells(bad).forEach((c, i) => { if (cw.bad.letters[i]) typed[c.join(',')] = cw.bad.letters[i]; });
  else if (cur) curCells.forEach((k, i) => { if (cw.typed[i]) typed[k] = cw.typed[i]; });
  const badCells = new Set(bad ? cwCells(bad).map((c) => c.join(',')) : []);
  const labels = cwLabels(grid);
  const nums = new Map(); // case de départ → repères (horizontal en haut à gauche, vertical en haut à droite)
  for (const w of grid.words) {
    const k = `${w.row},${w.col}`;
    nums.set(k, { ...nums.get(k), [w.dir]: labels.get(w.id) });
  }
  const live = new Set(grid.words.flatMap((w) => cwCells(w).map((c) => c.join(','))));
  const next = curCells.find((k, i) => !cw.typed[i]); // prochaine lettre à taper
  let html = '';
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const k = `${y},${x}`;
      if (!live.has(k)) { html += '<i class="cw-blank"></i>'; continue; }
      const ch = solution ? letters[k] : typed[k] ?? locked[k] ?? '';
      const cls = [
        'cw-cell',
        okCells.has(k) && !typed[k] ? 'ok' : solution ? 'miss' : '',
        curCells.includes(k) ? 'cur' : '',
        typed[k] && !badCells.has(k) ? 'typed' : '',
        k === next && !bad ? 'sel' : '',
        badCells.has(k) ? 'bad' : '',
      ].filter(Boolean).join(' ');
      const tag = solution ? 'div' : 'button';
      html += `<${tag} class="${cls}" ${solution ? '' : `data-action="cwCell" data-r="${y}" data-c="${x}" type="button"`}>${nums.get(k)?.across ? `<small>${nums.get(k).across}</small>` : ''}${nums.get(k)?.down ? `<small class="dn">${nums.get(k).down}</small>` : ''}<span>${esc(ch)}</span></${tag}>`;
    }
  }
  return `<div class="cw-grid" style="--w:${grid.width}">${html}</div>`;
}
function cwClues(grid, { found = {}, current = null, solution = false } = {}) {
  const labels = cwLabels(grid);
  const list = (dir) => grid.words.filter((w) => w.dir === dir).sort((a, b) => a.row - b.row || a.col - b.col).map((w) => `
      <li class="${found[w.id] ? 'ok' : ''} ${current === w ? 'cur' : ''}" ${solution || found[w.id] ? '' : `data-action="cwClue" data-id="${w.id}"`}>
        <b>${labels.get(w.id)}</b><span>${esc(w.clue)} <em>(${w.length})</em>${solution ? `<strong>${esc(w.word)}</strong>` : ''}</span>
      </li>`).join('');
  return `<div class="cw-clues">
      <div><h3>Horizontalement →</h3><ol>${list('across')}</ol></div>
      <div><h3>Verticalement ↓</h3><ol>${list('down')}</ol></div>
    </div>`;
}

function crosswordQuestion(r) {
  cwSync(r);
  const found = r.yourWords || {};
  const nFound = Object.keys(found).length;
  const total = r.grid.words.length;
  const need = r.validateAt ?? 8;
  const cur = cwWord(r);
  return `
    <main class="screen has-side">
      <div class="play cw">
      <div class="qhead">
        <span class="pill">Grille ${r.gridIndex + 1} · ${nFound} / ${need} mots${r.yourGrids ? ` · ${r.yourGrids} validée${r.yourGrids > 1 ? 's' : ''}` : ''}</span>
        <span class="timer" data-until="${r.endsAt}" data-mode="clock" data-urgent="30000"></span>
      </div>
      <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="30000"></div></div>
      <div class="cw-entry">
        <div class="cw-current" data-action="cwFocus">${cur ? `<b>${cwLabels(r.grid).get(cur.id)} ${cur.dir === 'across' ? '→' : '↓'}</b><span>${esc(cur.clue)} <em>(${cur.length})</em></span>` : ''}</div>
        <form class="guess" data-form="cw" onsubmit="return false">
          <input id="cw-word" maxlength="${cur?.length ?? 9}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="${cur ? `Mot de ${cur.length} lettres` : ''}" aria-label="Ta réponse">
        </form>
      </div>
      <div class="cw-board">${cwGrid(r, r.grid)}</div>
      <p class="muted cw-legend">Grille validée à ${need} mots sur ${total}. Les mêmes grilles pour tous : celui qui en valide le plus gagne.</p>
      ${cwClues(r.grid, { found, current: cur })}
      </div>
      ${roster(r)}
      ${isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">Terminer la partie</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
    </main>`;
}

// =====================================================================  vues
const isHost = () => state && state.hostId === state.you;

// =====================================================================  pause et retours de l'hôte
// L'hôte peut figer la partie (⚑ Signaler) pour noter un souci sur la question : réponse à accepter en plus,
// bonne réponse fausse, question à supprimer… Les retours sont enregistrés par le serveur (data/feedback.jsonl).
const report = { type: null, pausedAt: null };
const REPORT_TYPES = [
  ['accept', 'Accepter une autre réponse'],
  ['wrong', 'La bonne réponse est fausse'],
  ['remove', 'Question à supprimer'],
  ['other', 'Autre'],
];

function reportButton() {
  const n = state.round?.reported || 0;
  return `<button class="btn small ghost report-btn" data-action="pause" title="Mettre en pause et signaler un souci sur cette question">⚑ Signaler${n ? ` <span class="count">${n}</span>` : ''}</button>`;
}

/** Manche à réponse tapée : on peut demander d'accepter une autre écriture. */
function typedRound(r) {
  return r.kind === 'typed' || (GUESS_KINDS.includes(r.kind) && r.input === 'text');
}

/** Réponses ratées des joueurs (à la correction), proposées en un clic comme « réponse à accepter ». */
function missedAnswers() {
  const rv = state.phase === 'reveal' ? state.reveal : null;
  if (!rv) return [];
  const seen = new Map();
  const add = (t) => { const k = String(t ?? '').trim(); if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k); };
  for (const x of rv.results || []) if (!x.correct) { add(x.answerText); (x.guesses || []).forEach(add); }
  for (const x of rv.missed || []) (x.guesses || []).forEach(add);
  return [...seen.values()].slice(0, 12);
}

function pauseOverlay() {
  const p = state?.paused;
  const r = state?.round;
  if (!p || !r || !['countdown', 'question', 'reveal'].includes(state.phase)) return '';
  if (report.pausedAt !== p.at) { report.pausedAt = p.at; report.type = null; }
  if (!isHost()) {
    return `<div class="pause-overlay"><div class="pause-card card">
      <div class="pause-icon">⏸</div>
      <h2>Pause</h2>
      <p class="muted">${esc(p.by || "L'hôte")} signale un souci sur cette question. Le chrono reprendra au même endroit pour tout le monde.</p>
    </div></div>`;
  }
  const types = REPORT_TYPES.filter(([id]) => id !== 'accept' || typedRound(r));
  const picks = report.type === 'accept' ? missedAnswers() : [];
  return `<div class="pause-overlay"><form class="pause-card card report" onsubmit="return false">
    <h2>⏸ Partie en pause</h2>
    <p class="muted small">Le chrono est figé pour tout le monde. Qu'est-ce qui ne va pas avec cette question ?</p>
    <div class="report-types">${types.map(([id, label]) => `<button type="button" class="rchip ${report.type === id ? 'sel' : ''}" data-action="reportType" data-value="${id}">${label}</button>`).join('')}</div>
    <div class="report-fields" ${report.type ? '' : 'hidden'}>
      <label class="field" ${report.type === 'accept' ? '' : 'hidden'}>Réponse à accepter
        <input id="report-accept" maxlength="120" autocomplete="off" placeholder="Ex. : Zelda BOTW">
      </label>
      ${picks.length ? `<div class="report-picks"><span class="muted small">Réponses des joueurs :</span>${picks.map((t) => `<button type="button" class="rchip small" data-action="reportPick" data-value="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <label class="field">${report.type === 'other' ? 'Le souci' : 'Commentaire (facultatif)'}
        <textarea id="report-comment" maxlength="1000" rows="3" placeholder="${report.type === 'wrong' ? 'Ex. : la bonne réponse est…' : 'Précise si besoin'}"></textarea>
      </label>
    </div>
    <div class="report-actions">
      <button type="button" class="btn primary" data-action="reportSend" data-resume="yes" ${report.type ? '' : 'disabled'}>Envoyer et reprendre</button>
      <button type="button" class="btn ghost small" data-action="reportSend" data-resume="no" ${report.type ? '' : 'disabled'}>Envoyer, rester en pause</button>
      <button type="button" class="link" data-action="resume">Reprendre sans signaler</button>
    </div>
  </form></div>`;
}
// ---- Ta bande (profils Steam)

/** Image d'un jeu Steam (bannière de la boutique), cachée si elle ne charge pas. */
const gamePicture = (pic, done = false) => (pic.icon
  ? `<figure class="ach-pic"><img src="${esc(pic.url)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true"><figcaption>${esc(pic.caption || pic.alt || '')}</figcaption></figure>`
  : `<figure class="game-pic ${done ? 'done' : ''}"><img src="${esc(pic.url)}" alt="${esc(pic.alt || '')}" referrerpolicy="no-referrer" onerror="this.parentNode.hidden=true"></figure>`);

/** Bandeau « question sur X » : X répond sans marquer. */
function aboutLine(r) {
  if (!r.about) return '';
  const ids = r.about.ids || [r.about.id];
  return ids.includes(state.you)
    ? '<p class="about-line me">C\'est sur toi ! Réponds quand même, mais tu ne marques pas.</p>'
    : `<p class="about-line">Question sur <b>${esc(r.about.name)}</b> · ${ids.length > 1 ? 'ils ne marquent pas' : `${esc(r.about.name)} ne marque pas`}</p>`;
}

/** Fenêtre d'aide : où trouver son code ami Steam, et quels réglages de confidentialité ouvrir. */
let steamHelpOpen = false;
function steamHelpOverlay() {
  if (!steamHelpOpen || displayPhase() !== 'lobby') return '';
  return `<div class="pause-overlay" data-action="steamHelpClose"><div class="pause-card card steam-help" data-action="noop">
    <h2>Lier ton Steam</h2>
    <h3>1. Ton code de contact</h3>
    <p>Dans Steam sur PC : clique sur <b>ton pseudo</b> (en haut, à droite de Communauté) → <b>Contacts</b> → <b>Ajouter un contact</b>. Copie <b>Votre code de contact</b> et colle-le ici.</p>
    <div class="mock" aria-hidden="true">
      <div class="mock-bar"><span>Magasin</span><span>Bibliothèque</span><span>Communauté</span><span class="hl">Ton pseudo ▾</span></div>
      <div class="mock-menu"><span>Activité</span><span>Profil</span><span class="hl">Contacts</span><span>Groupes</span></div>
      <div class="mock-row"><span>Vos contacts</span><span class="mock-copy hl">Ajouter un contact</span></div>
      <div class="mock-panel"><small>Votre code de contact</small><b class="hl">12345678</b><span class="mock-copy">Copier</span></div>
    </div>
    <p class="small muted">Ça marche aussi avec l'adresse de ton profil : sur ta page de profil, clique sur l'adresse affichée sous le menu (steamcommunity.com/…), elle est copiée directement.</p>
    <h3>2. Profil public</h3>
    <p>Pour qu'on voie tes jeux : ouvre tes <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener">options de confidentialité</a> (ton pseudo → Profil → Modifier le profil → Options de confidentialité) et règle :</p>
    <div class="mock" aria-hidden="true">
      <div class="mock-row"><span>Visibilité de mon profil</span><b class="hl">tout le monde</b></div>
      <div class="mock-row"><span>Visibilité sur mes jeux</span><b class="hl">tout le monde</b></div>
      <div class="mock-row"><span>☐ Garder le temps total de jeu privé…</span><b class="hl">décoché</b></div>
      <div class="mock-row"><span>Liste de contacts <small>(facultatif)</small></span><b>tout le monde</b></div>
    </div>
    <p class="small muted">Seuls tes jeux et tes heures servent aux questions de la soirée. Rien n'est enregistré.</p>
    <button class="btn primary" type="button" data-action="steamHelpClose">Compris</button>
  </div></div>`;
}

/** Salon : lier son profil Steam (facultatif), pour le mode « Ta bande ». */
function steamCard() {
  const me = state.players.find((p) => p.id === state.you);
  const st = me?.steam;
  const linked = state.players.filter((p) => p.steam?.status === 'ok').length;
  let body;
  if (st?.status === 'loading') body = '<p class="muted">Chargement du profil…</p>';
  else if (st?.status === 'ok') {
    body = `<div class="steam-me">${st.avatar ? `<img src="${esc(st.avatar)}" alt="" referrerpolicy="no-referrer">` : ''}<span class="grow"><b>${esc(st.name)}</b><small class="muted">${st.games} jeu${st.games > 1 ? 'x' : ''}, dont ${st.played ?? 0} lancé${st.played > 1 ? 's' : ''}${st.achievements === 'loading' ? ' · succès en chargement…' : st.achievements != null ? ` · succès de ${st.achievements} jeu${st.achievements > 1 ? 'x' : ''}` : ''}</small></span><button class="link" data-action="steamUnlink">Délier</button></div>`;
    if ((st.played ?? 0) < 4) body += '<p class="steam-warn">Peu de jeux lancés sur ton compte : il y aura peu de questions sur toi. Les jeux prêtés par le partage familial Steam ne sont pas visibles.</p>';
  } else {
    const msg = st?.status === 'private' && st.hiddenTime
      ? `<p class="steam-warn">Ton temps de jeu est masqué. Dans tes <a href="${esc(st.privacyUrl)}" target="_blank" rel="noopener">options de confidentialité</a> Steam, décoche « Garder le temps total de jeu privé, même si mes détails de jeux sont publics », puis réessaie. <button type="button" class="link" data-action="steamHelp">Aide</button></p>`
      : st?.status === 'private'
      ? `<p class="steam-warn">Ton profil est privé : on ne voit pas tes jeux. Sur Steam, mets « Visibilité de mon profil » et « Visibilité sur mes jeux » sur <b>tout le monde</b> (<a href="${esc(st.privacyUrl)}" target="_blank" rel="noopener">options de confidentialité</a>), puis réessaie. <button type="button" class="link" data-action="steamHelp">Aide</button></p>`
      : st?.status === 'error' ? `<p class="steam-warn">${esc(st.message)}</p>` : '';
    body = `${msg}<form class="steam-form" data-form="steam">
        <input id="steam-input" autocomplete="off" placeholder="Code de contact ou adresse du profil" value="${esc(st?.input || store.get(STEAM_KEY) || '')}" enterkeyhint="send">
        <button class="btn small" type="submit">${st ? 'Réessayer' : 'Lier'}</button>
        <button class="btn small ghost help-btn" type="button" data-action="steamHelp" aria-label="Où trouver mon code de contact ?">?</button>
      </form>
      ${st?.status === 'private' ? '<button class="link" data-action="steamUnlink">Jouer sans mon profil</button>' : ''}`;
  }
  return `<section class="card steam-card">
    <h2>Ton Steam <span class="muted">facultatif</span></h2>
    ${body}
    <p class="opt-hint">Pour le jeu « Ta bande » : ${linked} joueur${linked > 1 ? 's' : ''} lié${linked > 1 ? 's' : ''}. Tes jeux et tes heures servent aux questions, rien n'est enregistré.</p>
  </section>`;
}

const avatar = (name) => `<span class="avatar" style="--h:${hue(name)}">${esc([...name][0]?.toUpperCase() || '?')}</span>`;
// À score égal, le départage éventuel (mots croisés : premier à avoir trouvé son dernier mot)
const sortedByScore = () => [...state.players].sort((a, b) => b.score - a.score || (a.tiebreak ?? Infinity) - (b.tiebreak ?? Infinity));
const sortedByTotal = () => [...state.players].sort((a, b) => b.total - a.total || b.wins - a.wins);

/** Score global du salon : cumul des parties terminées depuis la dernière remise à zéro. */
function globalBoard() {
  const n = state.gamesPlayed || 0;
  if (!n) return '';
  const ranked = sortedByTotal();
  return `
      <section class="card global">
        <h2>Score global <span class="muted">${n} partie${n > 1 ? 's' : ''}</span></h2>
        <ul class="list">
          ${ranked.map((p, i) => `
            <li class="${p.id === state.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
              <span class="pos">${i > 0 && p.total === ranked[i - 1].total ? '' : i + 1}</span>${avatar(p.name)}
              <span class="grow">${esc(p.name)}</span>
              ${p.wins ? `<span class="wins" title="Parties gagnées">🏆 ${p.wins}</span>` : ''}
              <span class="pts">${p.total}</span>
            </li>`).join('')}
        </ul>
        ${isHost() ? '<div class="card-foot"><button class="link danger" data-action="resetTotals">Remettre à zéro</button></div>' : ''}
      </section>`;
}

// Statut déjà affiché pour chaque joueur : l'animation ne se joue qu'au changement,
// pas à chaque nouvel état reçu (l'écran est entièrement redessiné à chaque fois).
const shownStatus = new Map();
const STATUS_BADGE = {
  answered: '<span class="badge" title="A répondu">✓</span>',
  found: '<span class="badge" title="A trouvé">✓</span>',
  missed: '<span class="badge" title="Plus d\'essais">✗</span>',
};

/** Joueurs pendant la question : qui a répondu, ou qui a trouvé quand on tape le nom. */
/** Saisie libre avec plusieurs essais (titre de jeu ou réponse du quiz). */
function guessBody(r, mine, placeholder) {
  if (mine !== null) {
    const ok = r.yourCorrect;
    const title = ok === false ? 'Plus d\'essais' : ok ? 'Trouvé !' : 'Vérification…';
    return `<div class="sent-box ${ok === false ? 'ko' : ''}">${title}<b>${esc(mine)}</b></div>`;
  }
  const left = r.tries - r.yourMisses;
  return `<form class="guess" data-form="guess">
      <input id="guess-input" maxlength="60" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(placeholder)}" enterkeyhint="send">
      <button class="btn primary" type="submit">OK</button>
    </form>
    <div class="tries" aria-label="${left} essais restants">${Array.from({ length: r.tries }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}<span class="muted">${left} essai${left > 1 ? 's' : ''}</span></div>
    <p class="recall-hint muted"><kbd>↑</kbd> pour reprendre ta saisie précédente</p>`;
}

function roster(r) {
  if (r.kind === 'crossword') return cwRoster(r);
  const multi = r.tries > 1;
  const done = state.players.filter((p) => p.status).length;
  const found = state.players.filter((p) => p.status === 'found').length;
  const count = multi
    ? `${found} / ${r.expected} ${found > 1 ? 'ont' : 'a'} trouvé`
    : `${r.answeredCount} / ${r.expected} ${r.answeredCount > 1 ? 'ont' : 'a'} répondu`;
  const chips = sortedByScore().filter((p) => p.connected || p.status).map((p) => {
    const key = `${r.id}:${p.id}`;
    const status = p.status || '';
    const prev = shownStatus.get(key);
    if (!prev || prev.status !== status) shownStatus.set(key, { status, at: Date.now() });
    const pop = status && Date.now() - shownStatus.get(key).at < 600 ? 'pop' : '';
    const misses = multi && !p.status && p.misses ? `<span class="misses" title="Essais ratés">${'✗'.repeat(p.misses)}</span>` : '';
    const label = !p.connected ? 'hors ligne'
      : status === 'found' ? 'a trouvé'
      : status === 'missed' ? 'plus d\'essais'
      : status === 'answered' ? 'a répondu'
      : p.misses && multi ? `${p.misses} essai${p.misses > 1 ? 's' : ''} raté${p.misses > 1 ? 's' : ''}`
      : 'réfléchit…';
    return `<li data-key="${p.id}" class="chip ${status || 'wait'} ${pop} ${p.id === state.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
        ${avatar(p.name)}<span class="cname">${esc(p.name)}<small class="clabel">${label}</small></span>${misses}${STATUS_BADGE[status] || ''}
      </li>`;
  });
  if (shownStatus.size > 200) shownStatus.clear();
  return `
      <aside class="roster" aria-label="Joueurs">
        <div class="roster-head muted"><span>${count}</span>${done >= r.expected ? '' : '<span class="dots">En attente</span>'}</div>
        <ul>${chips.join('')}</ul>
      </aside>`;
}

/** Joueurs pendant une grille : nombre de mots trouvés par chacun (jamais lesquels). */
function cwRoster(r) {
  const total = r.grid?.words.length ?? 10;
  const chips = sortedByScore().filter((p) => p.connected || p.progress?.found || p.progress?.grids).map((p) => {
    const pr = p.progress ?? { grids: 0, found: 0 };
    const key = `${r.id}:${p.id}`;
    const mark = `${pr.grids}:${pr.found}`;
    const prev = shownStatus.get(key);
    if (!prev || prev.status !== mark) shownStatus.set(key, { status: mark, at: Date.now() });
    const pop = Date.now() - shownStatus.get(key).at < 600 && (pr.grids || pr.found) ? 'pop' : '';
    const label = !p.connected ? 'hors ligne' : `${pr.grids} grille${pr.grids > 1 ? 's' : ''} · ${pr.found} / ${total} mots`;
    return `<li data-key="${p.id}" class="chip ${pr.grids ? 'found' : pr.found ? '' : 'wait'} ${pop} ${p.id === state.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
        ${avatar(p.name)}<span class="cname">${esc(p.name)}<small class="clabel">${label}</small></span><span class="cw-prog">${pr.grids ? `<b>${pr.grids}✓</b> ` : ''}${pr.found}/${total}</span>
      </li>`;
  });
  return `
      <aside class="roster" aria-label="Joueurs">
        <div class="roster-head muted"><span>Grilles validées · mots</span><span class="dots">En cours</span></div>
        <ul>${chips.join('')}</ul>
      </aside>`;
}

// =====================================================================  mode télé : vues
/** Salon, côté téléphone : l'hôte branche (ou éteint) la télé ; les autres savent qu'elle est là. */
const TOUCH = matchMedia('(pointer: coarse)').matches; // téléphone ou tablette : seuls appareils qui servent de manette
function tvCard() {
  if (!isHost()) return state.tv ? '<p class="tv-state">📺 La partie s’affiche sur la télé</p>' : '';
  if (!state.tv && !TOUCH) return ''; // sur ordinateur, pas de bouton « Afficher sur la télé »
  if (state.tv) return `<section class="tv-card on"><span>📺 <b>Télé connectée</b> · chacun joue sur son téléphone</span><button class="btn small ghost" data-action="tvoff">Éteindre</button></section>`;
  return '<button class="btn tv-open" data-action="tvsheet">📺 Afficher sur la télé</button>';
}

/** Feuille « Afficher sur la télé » (hôte, dans le salon). */
function tvSheet() {
  if (!tv.sheet || SCREEN || !state || state.phase !== 'lobby' || !isHost()) return '';
  return `
  <div class="tv-sheet-bg" data-action="tvclose"></div>
  <section class="tv-sheet" role="dialog" aria-modal="true" aria-label="Afficher sur la télé">
    <div class="tv-sheet-head"><h2>Afficher sur la télé</h2><button class="btn small ghost" data-action="tvclose">✕</button></div>
    <div class="tv-opt">
      <b>⌨ Code de l’écran</b>
      <p>Sur la télé, un PC branché en HDMI, une console ou un Fire Stick : ouvre <span class="tv-url">${esc(location.host)}/tv</span>, puis tape ici les 4 chiffres affichés.</p>
      <form class="row" data-form="tvpin">
        <input id="tv-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="0000" aria-label="Code de la télé">
        <button class="btn primary" type="submit">Connecter</button>
      </form>
    </div>
    <p class="tv-note">La télé affiche les questions, les images et les sons ; chacun répond sur son téléphone. Sans télé, tout reste comme avant.</p>
  </section>`;
}

/** Écran télé en attente : son code à 4 chiffres, à taper sur le téléphone de l'hôte. */
function tvPairView() {
  const digits = (tv.pin || '····').split('');
  return `
  <main class="screen tv-pair">
    <div class="logo">Quiz<b>Party</b> <span class="tv-sub">· écran télé</span></div>
    <div class="tv-label">Code de cet écran</div>
    <div class="tv-digits">${digits.map((d) => `<span>${esc(d)}</span>`).join('')}</div>
    <p class="tv-steps">Sur ton téléphone, dans le salon : <b>📺 Afficher sur la télé</b>, puis tape ce code.<br>Rien à saisir avec la télécommande.</p>
    ${fullHint()}
  </main>`;
}

/** Salon sur la télé : code et QR code pour rejoindre, joueurs, jeu choisi. */
function tvLobbyView() {
  const { settings, options } = state;
  const current = options.modes.find((m) => m.id === settings.mode);
  const host = state.players.find((p) => p.id === state.hostId);
  return `
  <main class="screen tv-lobby">
    <div class="tv-top"><div class="logo">Quiz<b>Party</b></div><span class="tv-site">${esc(location.host)}</span></div>
    <div class="tv-lob">
      <section class="tv-code">
        <div class="tv-label">Rejoins la partie</div>
        <div class="code">${esc(state.code)}</div>
        <div class="tv-join"><img class="tv-qr" src="/qr/${esc(state.code)}.svg" alt="QR code du salon"><p>Scanne avec ton téléphone<br>ou tape le code <b>${esc(state.code)}</b> sur la page d’accueil.</p></div>
      </section>
      <section class="tv-players">
        <h2>Joueurs <span>${state.players.length}</span></h2>
        <ul>${state.players.map((p) => `<li data-key="${p.id}" class="${p.connected ? '' : 'off'}">${avatar(p.name)}<span>${esc(p.name)}</span>${p.id === state.hostId ? '<span class="tag">hôte</span>' : ''}</li>`).join('')}
        <li class="empty">+ en attente…</li></ul>
      </section>
    </div>
    <div class="tv-foot"><span class="mode-ico">${modeArt(settings.mode)[0]}</span><b>${esc(current?.name || '')}</b>
      <span class="muted">${current?.grids ? `${settings.rounds} min` : `${settings.rounds} questions · ${settings.duration} s`}</span>
      <span class="tv-wait">${esc(host?.name || 'L’hôte')} lance la partie depuis son téléphone</span></div>
    ${fullHint()}
  </main>`;
}

/**
 * Question sur la télé : les propositions sont sur les téléphones, la télé garde la place pour
 * la question (ou l'image, les emojis, le son) en grand et les joueurs, bien visibles, à côté.
 */
function tvQuestion(r, media) {
  const guess = GUESS_KINDS.includes(r.kind);
  const multi = r.tries > 1;
  const done = state.players.filter((p) => p.status).length;
  const found = state.players.filter((p) => p.status === 'found').length;
  const count = multi ? `${found} / ${r.expected} ${found > 1 ? 'ont' : 'a'} trouvé` : `${r.answeredCount} / ${r.expected} ${r.answeredCount > 1 ? 'ont' : 'a'} répondu`;
  const players = sortedByScore().filter((p) => p.connected || p.status).map((p) => {
    const status = p.status || '';
    const label = !p.connected ? 'hors ligne'
      : status === 'found' ? 'a trouvé ★' : status === 'missed' ? 'plus d’essais' : status === 'answered' ? 'a répondu ✓'
      : p.misses && multi ? `${p.misses} essai${p.misses > 1 ? 's' : ''} raté${p.misses > 1 ? 's' : ''}` : 'réfléchit…';
    return `<li data-key="${p.id}" class="tvp ${status || 'wait'} ${p.connected ? '' : 'off'}">${avatar(p.name)}<span class="tvp-name">${esc(p.name)}</span><span class="tvp-st">${label}</span><b class="tvp-pts">${p.score}</b></li>`;
  }).join('');
  const how = r.kind === 'estimation' ? 'Donne ton estimation sur ton téléphone'
    : r.input === 'text' || r.kind === 'typed' ? `Tape ta réponse sur ton téléphone${multi ? ` · ${r.tries} essais` : ''}`
    : 'Choisis ta réponse sur ton téléphone';
  return `
  <main class="screen tv-q ${guess ? 'tv-q-media' : 'tv-q-text'}">
    <div class="qhead">
      <span class="pill">${r.index + 1} / ${r.total}</span><span class="tv-kind">${esc(kindLabel(r))}</span>
      <span class="timer" data-until="${r.endsAt}" data-mode="count" data-urgent="5000"></span>
    </div>
    <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="5000"></div></div>
    <div class="tv-q-body">
      <section class="tv-q-main">
        ${aboutLine(r)}
        ${guess ? `<h1 class="prompt small">${esc(r.prompt)}</h1>${r.picture ? gamePicture(r.picture) : ''}<div class="tv-media">${media}</div>`
          : `${r.picture ? gamePicture(r.picture) : ''}<h1 class="prompt">${esc(r.prompt)}</h1>${r.kind === 'estimation' && r.unit ? `<p class="tv-unit">Réponse en ${esc(r.unit)}</p>` : ''}`}
        <p class="tv-answer">📱 ${how}</p>
      </section>
      <aside class="tv-q-players">
        <div class="tv-q-count">${count}${done >= r.expected ? '' : '<span class="dots"></span>'}</div>
        <ul>${players}</ul>
      </aside>
    </div>
  </main>`;
}

/** Mots croisés sur la télé : chacun a sa grille sur son téléphone, la télé montre la course. */
function tvCrossword(r) {
  return `
  <main class="screen tv-cw">
    <div class="qhead"><span class="pill">Mots croisés</span><span class="timer" data-until="${r.endsAt}" data-mode="clock" data-urgent="30000"></span></div>
    <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="30000"></div></div>
    <h1 class="prompt">Les mêmes grilles pour tous : chacun remplit la sienne sur son téléphone</h1>
    ${cwRoster(r)}
  </main>`;
}

/** Téléphone en manette : la question est sur la télé, il ne reste que les réponses, en grand. */
function padQuestion(r, body, answered) {
  const me = state.players.find((p) => p.id === state.you);
  const rank = sortedByScore().findIndex((p) => p.id === state.you) + 1;
  const choice = /class="choices/.test(body);
  const watch = r.kind === 'sound' ? 'Écoute le son sur la télé' : GUESS_KINDS.includes(r.kind) ? 'Regarde la télé' : 'La question est sur la télé';
  return `
  <main class="screen pad-screen">
    <div class="qhead">
      <span class="pill">${r.index + 1} / ${r.total}</span><span class="pad-kind">${esc(kindLabel(r))}</span>
      <span class="timer" data-until="${r.endsAt}" data-mode="count" data-urgent="5000"></span>
    </div>
    <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="5000"></div></div>
    <p class="tv-hint">📺 ${watch}</p>
    ${r.kind === 'estimation' && r.unit ? `<p class="pad-unit">Réponse en ${esc(r.unit)}</p>` : ''}
    <div class="pad-body ${choice ? 'pad-choices' : ''}">${body}</div>
    ${answered && choice ? `<p class="pad-sent">✓ Réponse envoyée · ${r.answeredCount} / ${r.expected} ont répondu</p>` : ''}
    ${me ? `<div class="pad-me">${avatar(me.name)}<span>${esc(me.name)} · ${rank}ᵉ</span><b>${me.score}</b></div>` : ''}
    ${isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">Passer</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
  </main>`;
}

// =====================================================================  accueil et salon : pages et panneaux
// Sur téléphone, le salon garde l'essentiel à l'écran ; le choix du jeu s'ouvre en page, le reste en panneau du bas.
// Sur ordinateur (1000 px et plus), salon sur trois colonnes, et le choix du jeu s'ouvre en fenêtre.
const SHARE_NOTE = '🔒 <b>Entre potes seulement.</b> Partage le lien et le code d’accès à tes amis, mais pas sur un forum ni sur les réseaux : QuizParty est un petit projet perso, hébergé gratuitement, avec des sons et des images qu’on n’a pas le droit de diffuser au grand public. C’est pour ça qu’il y a un code.';
const WIDE_MQ = matchMedia('(min-width: 1000px)');
const wide = () => WIDE_MQ.matches;
WIDE_MQ.addEventListener?.('change', () => render());
const ui = { sheet: null, phase: null };

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
              <span class="pname">${esc(p.name)}${p.id === state.you ? ' <em>(toi)</em>' : ''}</span>
              ${p.steam?.status === 'ok' ? '<span class="steam-dot" title="Profil Steam lié" aria-label="Profil Steam lié">S</span>' : ''}
              ${p.id === state.hostId ? '<span class="tag">hôte</span>' : ''}
              ${host && p.id !== state.you ? `<button class="x" data-action="kick" data-id="${p.id}" aria-label="Retirer">✕</button>` : ''}
            </li>`).join('')}
        </ul>`;
}

/** Pages (« page: true », plein écran sur téléphone) et panneaux du bas, par écran. */
const SHEETS = {
  name: { phase: 'home', render: () => ({ title: 'Ton pseudo', body: `
    <form class="sh-form" data-form="name">
      <input id="name" maxlength="16" autocomplete="nickname" placeholder="Ex : Camille" value="${esc(store.get(NAME_KEY) || '')}" enterkeyhint="done">
      <button class="btn primary" type="submit">C’est bon</button>
    </form>
    <p class="sh-note">C’est le nom que verront tes potes. Pas de compte : il reste juste sur cet appareil.</p>` }) },
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
  getapp: { phase: 'home', render: () => ({ title: TOUCH ? 'Installer l’app' : 'L’app sur ton téléphone', body: getAppBody() }) },
  tvinfo: { phase: 'home', render: () => ({ title: 'Jouer sur la télé', body: `
    <ol class="sh-steps">
      <li><b>Crée un salon</b> sur ton téléphone.</li>
      <li>Sur la télé (son navigateur, un PC branché en HDMI, une console…), ouvre <span class="tv-url">${esc(location.host)}/tv</span> : un code à 4 chiffres s’affiche.</li>
      <li>Dans le salon, touche <b>📺 Sur la télé</b> et tape ce code.</li>
    </ol>
    <p class="sh-note">La télé affiche les questions, les images et les scores ; chacun répond sur son téléphone, l’hôte aussi. Sans télé, tout se joue sur les téléphones.</p>
    <button class="btn primary" data-action="sheetclose">Compris</button>` }) },
  games: { phase: 'lobby', page: true, render: () => ({ title: 'Choisis le jeu', body: modeGroups().map((g) => `
    <div class="pick-group"><h3>${esc(g.name)}</h3><div class="pick-grid">
    ${g.modes.map((m) => `<button class="pick ${state.settings.mode === m.id ? 'sel' : ''} ${m.unavailable ? 'off' : ''}" style="--mc:${modeArt(m.id)[1]}" data-action="pick" data-value="${m.id}" ${isHost() && !m.unavailable ? '' : 'disabled'}>
      <span class="pick-ico" aria-hidden="true">${modeArt(m.id)[0]}</span><b>${esc(m.name)}</b><small>${esc(m.unavailable || m.description)}</small></button>`).join('')}
    </div></div>`).join('') }) },
  settings: { phase: 'lobby', render: () => ({ title: 'Réglages', body: `<div class="lb-settings sh-settings">${settingsBody(isHost())}</div>
    <button class="btn primary" data-action="sheetclose">C’est bon</button>` }) },
  players: { phase: 'lobby', render: () => ({ title: `Joueurs · ${state.players.length}`, body: playersList(isHost()) }) },
  steam: { phase: 'lobby', render: () => ({ title: 'Ton Steam', body: steamCard() }) },
  scores: { phase: 'lobby', render: () => ({ title: 'Score global', body: globalBoard() }) },
  note: { phase: 'lobby', render: () => ({ title: 'Entre potes seulement', body: `<p class="sh-note big">${SHARE_NOTE.replace(/^🔒 <b>[^<]*<\/b> /, '')}</p>
    <button class="btn primary" data-action="sheetclose">Compris</button>` }) },
  more: { phase: 'lobby', render: () => ({ title: 'Options', body: `
    <div class="sh-row"><span>Thème</span>${themeToggle()}</div>
    <button class="btn" data-action="sheet" data-value="players">👥 Joueurs (${state.players.length})</button>
    ${state.gamesPlayed ? '<button class="btn" data-action="sheet" data-value="scores">🏆 Score global</button>' : ''}
    <button class="btn" data-action="sheet" data-value="steam">🎮 Lier mon Steam</button>
    <button class="btn" data-action="propose">💡 Proposer une question</button>` }) },
};

function sheetView() {
  if (!ui.sheet || SCREEN) return '';
  const def = SHEETS[ui.sheet];
  const phase = displayPhase();
  if (!def || def.phase !== phase || (phase === 'lobby' && !state)) { ui.sheet = null; return ''; }
  const { title, body } = def.render();
  const page = def.page;
  return `
  <div class="sh-bg" data-action="sheetclose"></div>
  <section class="sh ${page ? 'sh-page' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-key="sh:${ui.sheet}">
    <div class="sh-head">${page ? '<button class="sh-back" data-action="sheetclose" aria-label="Retour">←</button>' : ''}<h2>${esc(title)}</h2>${page ? '' : '<button class="btn small ghost" data-action="sheetclose" aria-label="Fermer">✕</button>'}</div>
    <div class="sh-body">${body}</div>
  </section>`;
}
function openSheet(name) {
  ui.sheet = name;
  render();
  if (['name', 'create'].includes(name)) setTimeout(() => $('#name')?.focus(), 60);
  if (name === 'join') setTimeout(() => (urlCode() ? $('#name') : $('#code'))?.focus(), 60);
}
const closeSheet = () => { ui.sheet = null; render(); };
actions.sheet = (btn) => openSheet(btn.dataset.value);
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

const views = {
  tvpair: tvPairView,
  tvlobby: tvLobbyView,
  loading: () => `<main class="screen center"><p class="muted">Reconnexion…</p></main>`,

  home: () => {
    const name = store.get(NAME_KEY) || '';
    const invited = urlCode();
    return `
    <main class="screen home2">
      <div class="h-top">
        <div class="logo">Quiz<b>Party</b></div>
        <button class="me-chip" data-action="sheet" data-value="name" aria-label="Changer de pseudo">${name ? `${avatar(name)}<span>${esc(name)}</span>` : '<span>Ton pseudo ✎</span>'}</button>
      </div>
      <section class="h-play">
        <h1>${invited ? `Salon ${esc(invited)}` : 'Jouer entre potes'}</h1>
        <p>${invited ? 'Tes potes t’attendent : choisis ton pseudo et rejoins-les.' : 'Un salon, un code, et c’est parti. Sur la télé ou juste sur vos téléphones.'}</p>
        <div class="h-btns">${invited
          ? '<button class="btn primary big" data-action="sheet" data-value="join">Rejoindre le salon</button>'
          : '<button class="btn primary" data-action="go" data-value="create">Créer un salon</button><button class="btn h-ghost" data-action="sheet" data-value="join">Rejoindre</button>'}</div>
        ${invited ? `<button class="link" onclick="history.replaceState(null,'','/');location.reload()">Créer mon propre salon plutôt</button>` : ''}
      </section>
      <div class="h-tiles">
        <button class="h-tile daily" data-action="soon" data-value="Le défi du jour arrive bientôt : le même quiz pour tout le monde, chaque jour, avec un résultat à partager."><i class="soon">Bientôt</i><span class="t-ico">📅</span><b>Défi du jour</b><small>Le même quiz pour tout le monde, résultat à partager</small><span class="streak" aria-hidden="true"><i class="ok"></i><i class="ok"></i><i class="mid"></i><i class="ok"></i><i></i></span></button>
        <button class="h-tile" data-action="soon" data-value="Les défis entre potes arrivent bientôt : le même quiz figé, chacun le joue quand il veut, classement commun."><i class="soon">Bientôt</i><span class="t-ico">⚔️</span><b>Défis entre potes</b><small>Chacun joue quand il veut, classement commun</small></button>
        <button class="h-tile" data-action="sheet" data-value="tvinfo"><span class="t-ico">📺</span><b>Sur la télé</b><small>La partie en grand, les téléphones en manette</small></button>
        <button class="h-tile" data-action="propose"><span class="t-ico">💡</span><b>Proposer</b><small>Tes questions, pitchs, sons, captures</small></button>
      </div>
      ${installCard()}
      <div class="h-foot">${themeToggle()}</div>
      <p class="credits">Données et jaquettes de jeux : <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB.com</a>. Les jaquettes et les sons des jeux appartiennent à leurs éditeurs respectifs.</p>
    </main>`;
  },

  lobby() {
    const host = isHost();
    const copied = Date.now() < copiedUntil;
    const count = `${state.players.length} joueur${state.players.length > 1 ? 's' : ''}`;
    const start = host
      ? '<button class="btn primary big sticky-bottom" data-action="start">Lancer la partie</button>'
      : `<p class="waiting">En attente de ${esc(state.players.find((p) => p.id === state.hostId)?.name || "l'hôte")}</p>`;
    if (!wide()) {
      // Téléphone : l'essentiel sur un écran (code, joueurs, jeu choisi) ; le reste s'ouvre en page ou en panneau
      const linked = state.players.find((p) => p.id === state.you)?.steam?.status === 'ok';
      return `
    <main class="screen lobby lobby-m">
      <div class="top lm-top"><button class="link" data-action="leave">← Quitter</button><button class="ib" data-action="sheet" data-value="more" aria-label="Plus d’options">⋯</button></div>
      <section class="lm-code"><small>Code du salon</small><b class="code">${esc(state.code)}</b></section>
      <div class="lm-chips">
        <button class="chip-btn ${copied ? 'copied' : ''}" data-action="share" aria-live="polite">${copied ? '✓ Lien copié !' : '🔗 Inviter'}</button>
        ${host && !state.tv && TOUCH ? '<button class="chip-btn tv-chip" data-action="tvsheet">📺 Sur la télé</button>' : ''}
        <button class="chip-btn" data-action="sheet" data-value="note">🔒 Entre potes <span aria-hidden="true">ⓘ</span></button>
      </div>
      ${state.tv ? tvCard() : ''}
      <button class="lm-players" data-action="sheet" data-value="players" aria-label="Voir les joueurs (${count})">
        ${state.players.map((p) => `<span class="lm-pl ${p.connected ? '' : 'off'}" data-key="${p.id}">${avatar(p.name)}${p.id === state.hostId ? '<i>hôte</i>' : ''}<small>${esc(p.name)}</small></span>`).join('')}
      </button>
      <div class="lm-main">
        <div class="lm-label">Ce soir on joue à</div>
        ${heroCard(host)}
      </div>
      ${start}
      <nav class="lm-foot">
        ${state.gamesPlayed ? '<button class="link" data-action="sheet" data-value="scores">🏆 Score global</button>' : ''}
        <button class="link" data-action="sheet" data-value="steam">🎮 ${linked ? 'Steam ✓' : 'Mon Steam'}</button>
        <button class="link" data-action="propose">💡 Proposer</button>
      </nav>
    </main>`;
    }
    // Ordinateur : joueurs à gauche, jeu choisi au centre, réglages à droite, « Lancer » en bas.
    return `
    <main class="screen lobby">
      <div class="top lobby-top"><button class="link" data-action="leave">← Quitter</button><div class="lobby-logo" aria-hidden="true">Quiz<b>Party</b></div><span class="lobby-end"><span class="lobby-count muted">${count}</span>${themeToggle()}</span></div>
      <section class="code-card">
        <div class="label">Code du salon</div>
        <div class="code">${esc(state.code)}</div>
        <button class="btn small ghost share-btn ${copied ? 'copied' : ''}" data-action="share" aria-live="polite">${copied ? '✓ Lien copié !' : 'Copier le lien'}</button>
      </section>
      ${tvCard()}
      <p class="share-note">${SHARE_NOTE}</p>
      <div class="lobby-cols">
      <div class="lb-players">
      <section class="card">
        <h2>Joueurs <span class="muted">${state.players.length}</span></h2>
        ${playersList(host)}
      </section>
      ${steamCard()}
      ${globalBoard()}
      ${proposeButton()}
      </div>
      <section class="lb-center">
        <div class="lm-label">Ce soir on joue à</div>
        ${heroCard(host)}
      </section>
      <section class="card lb-settings" style="--mc:${modeArt(state.settings.mode)[1]}">
        <h2>Réglages</h2>
        ${settingsBody(host)}
      </section>
      </div>
      ${start}
    </main>`;
  },

  countdown() {
    const r = state.round;
    return `
    <main class="screen center">
      <span class="pill">${r.kind === 'crossword' ? `${Math.round(r.durationMs / 60000)} min au chrono` : `Question ${r.index + 1} / ${r.total}`}</span>
      <div class="kind-label">${kindLabel(r)}</div>
      <div class="big-count" data-until="${r.startsAt}" data-mode="count">3</div>
      <p class="muted" ${r.kind === 'sound' ? 'data-sound-hint' : ''}>Prépare-toi…</p>
    </main>`;
  },

  question() {
    const r = state.round;
    if (r.kind === 'crossword') return SCREEN ? tvCrossword(r) : crosswordQuestion(r);
    const mine = r.yourAnswer ?? (pending && pending.roundId === r.id ? pending.answer : null);
    const answered = mine !== null;
    let body;
    let media = '';
    if (GUESS_KINDS.includes(r.kind)) {
      media = r.kind === 'cover' ? coverFigure(r.image, { until: r.endsAt, from: r.startsAt, input: r.input })
        : r.kind === 'screen' ? shotFigure(r.image)
        : r.kind === 'sound' ? soundFigure(r)
        : r.kind === 'emoji' ? emojiLine(r.emojis)
        : `<blockquote class="pitch">${r.pitch ? esc(r.pitch) : '<span class="muted">Le serveur n’est pas à jour : relance-le pour voir le pitch.</span>'}</blockquote>`;
      if (r.input === 'choice') {
        body = `<div class="choices compact n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <button class="choice c${i} ${answered ? (mine === i ? 'picked' : 'dim') : ''}" data-action="answer" data-index="${i}" ${answered ? 'disabled' : ''}>
              <span class="shape">${SHAPES[i]}</span><span>${esc(c)}</span>
            </button>`).join('')}
        </div>`;
      } else {
        body = guessBody(r, mine, /console/.test(r.prompt) ? 'Nom de la console' : /plateforme/.test(r.prompt) ? 'Nom de la plateforme' : /marque/.test(r.prompt) ? 'Nom de la marque' : 'Nom du jeu');
      }
    } else if (r.kind === 'typed') {
      body = guessBody(r, mine, 'Ta réponse');
    } else if (r.kind === 'estimation') {
      body = answered
        ? `<div class="sent-box">Ta réponse<b>${r.year ? mine : `${nf.format(mine)} ${esc(r.unit)}`}</b></div>`
        : `<form class="est" data-form="est">
             <div class="inrow"><input id="est-input" inputmode="${r.year ? 'numeric' : 'decimal'}" autocomplete="off" placeholder="${r.year ? 'Année' : '?'}" enterkeyhint="send">
             ${r.unit ? `<span class="unit">${esc(r.unit)}</span>` : ''}</div>
             <button class="btn primary big" type="submit">Valider</button>
           </form>`;
    } else {
      body = `<div class="choices n${r.choices.length}">
        ${r.choices.map((c, i) => `
          <button class="choice c${i} ${answered ? (mine === i ? 'picked' : 'dim') : ''}" data-action="answer" data-index="${i}" ${answered ? 'disabled' : ''}>
            ${r.choices.length > 2 ? `<span class="shape">${SHAPES[i]}</span>` : ''}<span>${esc(c)}</span>
          </button>`).join('')}
      </div>`;
    }
    // Écran télé : on n'y répond pas, les champs de saisie deviennent une consigne
    if (SCREEN && !/class="choices/.test(body)) body = `<p class="tv-answer">📱 Réponds sur ton téléphone${r.tries > 1 ? ` · ${r.tries} essais` : ''}</p>`;
    if (SCREEN) return tvQuestion(r, media);
    if (controller()) return padQuestion(r, body, answered);
    return `
    <main class="screen has-side">
      <div class="play">
      <div class="qhead">
        <span class="pill">${r.index + 1} / ${r.total}</span>
        <span class="timer" data-until="${r.endsAt}" data-mode="count" data-urgent="5000"></span>
      </div>
      <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="5000"></div></div>
      ${['pitch', 'emoji', 'sound'].includes(r.kind) ? `<h1 class="prompt small">${esc(r.prompt)}</h1>` : ''}
      ${aboutLine(r)}
      ${r.picture ? gamePicture(r.picture) : ''}
      ${GUESS_KINDS.includes(r.kind) ? media : `<h1 class="prompt">${esc(r.prompt)}</h1>`}
      <div class="q-answer">${body}</div>
      </div>
      ${roster(r)}
      ${isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">Passer</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
    </main>`;
  },

  reveal() {
    const r = state.round;
    // Réponse tapée : pour ceux qui n'ont pas trouvé, leurs dernières saisies (même sans réponse finale)
    const guessesText = (g) => g.map((t) => `« ${esc(t)} »`).join(' · ');
    const resultList = () => `
        <ul class="list">
          ${[...state.reveal.results, ...(state.reveal.missed || []).map((m) => ({ ...m, correct: false, points: 0 }))].map((x) => `
            <li class="${x.playerId === state.you ? 'me' : ''}">
              <span class="pos">${x.correct ? '✓' : '✗'}</span>
              <span class="grow">${esc(x.name)}<span class="sub ${x.guesses?.length ? 'guesses' : ''}">${x.guesses?.length ? guessesText(x.guesses) : esc(x.answerText)}${x.correct ? ` · ${(x.timeMs / 1000).toFixed(1)} s` : ''}</span></span>
              <span class="delta">+${x.points}</span>
            </li>`).join('')}
        </ul>`;
    const rv = state.reveal;
    const me = rv.results.find((x) => x.playerId === state.you);
    const last = r.index + 1 >= r.total;

    let banner;
    if (r.kind === 'crossword') {
      const g = me?.grids ?? 0, f = me?.found ?? 0;
      banner = !me ? '<div class="result none">Aucun mot trouvé</div>'
        : `<div class="result ${me.rank === 1 ? 'good' : me.points ? '' : 'bad'}">${me.rank === 1 ? '1ᵉʳ !' : `${me.rank}ᵉ`}<small>${g} grille${g > 1 ? 's' : ''} validée${g > 1 ? 's' : ''} · ${f} mot${f > 1 ? 's' : ''} dans la suivante · +${me.points} pts</small></div>`;
    } else if (me?.self) {
      const good = me.correct;
      banner = `<div class="result ${good ? 'good' : 'bad'}">${good ? 'Tu te connais bien !' : 'Même toi, tu ne savais pas !'}<small>Question sur toi : pas de points${r.kind === 'estimation' ? ` · ${esc(me.errorText)}` : ''}</small></div>`;
    } else if (!me) banner = `<div class="result none">${TYPED_KINDS.includes(r.kind) && r.yourMisses ? 'Pas trouvé' : 'Pas de réponse'}</div>`;
    else if (r.kind === 'estimation') {
      const title = me.exact ? 'Pile poil !' : me.rank === 1 ? 'Le plus proche !' : `${me.rank}ᵉ`;
      banner = `<div class="result ${me.points > 0 ? 'good' : 'bad'}">${title}<small>+${me.points} pts · ${esc(me.errorText)}</small></div>`;
    } else {
      banner = me.correct
        ? `<div class="result good">Bonne réponse !<small>+${me.points} pts · ${(me.timeMs / 1000).toFixed(1)} s</small></div>`
        : '<div class="result bad">Raté !<small>+0 pt</small></div>';
    }

    let detail;
    if (r.kind === 'crossword') {
      const mine = r.yourWords || {};
      const sol = rv.grids?.[r.gridIndex];
      detail = `
        <ul class="list">
          ${rv.results.map((x) => `
            <li class="${x.playerId === state.you ? 'me' : ''}">
              <span class="pos">${x.rank}</span>
              <span class="grow">${esc(x.name)}<span class="sub">${esc(x.answerText)}${x.tiebreak != null ? ` · dernier mot à ${Math.floor(x.tiebreak / 60000)}:${String(Math.floor(x.tiebreak / 1000) % 60).padStart(2, '0')}` : ''}</span></span>
              <span class="delta">+${x.points}</span>
            </li>`).join('')}
        </ul>
        ${sol ? `<div class="cw reveal">
          <h2>Solution de ta grille ${r.gridIndex + 1}</h2>
          <div class="cw-board">${cwGrid(r, sol, { solution: true, mine })}</div>
          <p class="muted cw-legend"><span class="sw ok"></span> trouvé par toi <span class="sw miss"></span> pas trouvé</p>
          ${cwClues(sol, { found: mine, solution: true })}
        </div>` : ''}`;
    } else if (r.kind === 'screen') {
      const img = rv.image;
      detail = `
        ${img ? shotFigure(img) : ''}
        <div class="shot-meta">
          <div class="val">${esc(rv.correctText)}</div>
          <div class="muted">${rv.year ?? ''}${img ? `${rv.year ? ' · ' : ''}${esc(img.source)}` : ''}</div>
        </div>
        ${r.input === 'choice' ? `
        <div class="choices reveal n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <div class="choice c${i} ${i === rv.correctIndex ? 'correct' : 'wrong'}">
              <span>${esc(c)}${me && me.answer === i ? '<span class="mine">toi</span>' : ''}</span>
              <span class="count">${rv.counts[i]}</span>
            </div>`).join('')}
        </div>` : resultList()}`;
    } else if (GUESS_KINDS.includes(r.kind)) {
      const img = rv.image;
      detail = `
        <div class="cover-reveal ${img ? '' : 'no-img'}">
          ${img ? coverFigure(img, { clear: true }) : ''}
          <div class="cover-meta">
            <div class="val">${esc(rv.correctText)}</div>
            <div class="muted">${rv.year ?? ''}${img?.publisher ? ` · ${esc(img.publisher)}` : ''}</div>
            ${img ? `<div class="credit">Jaquette${img.publisher ? ` © ${esc(img.publisher)}` : ''} · via <a href="${esc(img.pageUrl || img.sourceUrl)}" target="_blank" rel="noopener">${esc(img.source)}</a></div>` : ''}
          </div>
        </div>
        ${rv.pitch ? `<blockquote class="pitch done">${esc(rv.pitch)}</blockquote>` : ''}
        ${r.kind === 'sound' ? `<div class="sound-why">${soundFigure(r)}<div>${rv.what ? `<p>${esc(rv.what)}</p>` : ''}<div class="credit">${esc(rv.credit || '')}${rv.sourceUrl ? ` · <a href="${esc(rv.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ''}</div></div></div>` : ''}
        ${rv.emojis ? `<div class="emoji-why">${emojiLine(rv.emojis, true)}${rv.why ? `<p>${esc(rv.why)}</p>` : ''}</div>` : ''}
        ${r.input === 'choice' ? `
        <div class="choices reveal n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <div class="choice c${i} ${i === rv.correctIndex ? 'correct' : 'wrong'}">
              <span>${esc(c)}${me && me.answer === i ? '<span class="mine">toi</span>' : ''}</span>
              <span class="count">${rv.counts[i]}</span>
            </div>`).join('')}
        </div>` : resultList()}`;
    } else if (r.kind === 'typed') {
      detail = `
        <div class="truth"><div class="muted">Réponse</div><div class="val">${esc(rv.correctText)}</div></div>
        ${rv.info ? `<p class="info">${esc(rv.info)}</p>` : ''}
        ${resultList()}`;
    } else if (r.kind === 'estimation') {
      detail = `
        <div class="truth"><div class="muted">Réponse</div><div class="val">${esc(rv.correctText)}</div></div>
        ${rv.info ? `<p class="info">${esc(rv.info)}</p>` : ''}
        <ul class="list">
          ${rv.results.map((x) => `
            <li class="${x.playerId === state.you ? 'me' : ''}">
              <span class="pos">${x.rank ?? '–'}</span>
              <span class="grow">${esc(x.name)}${x.self ? ' <em class="muted">(sa question)</em>' : ''}<span class="sub">${esc(x.answerText)} · ${esc(x.errorText)}</span></span>
              <span class="delta">+${x.points}</span>
            </li>`).join('')}
        </ul>`;
    } else {
      detail = `
        <div class="choices reveal n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <div class="choice c${i} ${i === rv.correctIndex ? 'correct' : 'wrong'}">
              <span>${esc(c)}${me && me.answer === i ? '<span class="mine">toi</span>' : ''}</span>
              <span class="count">${rv.counts[i]}</span>
            </div>`).join('')}
        </div>
        ${rv.info ? `<p class="info">${esc(rv.info)}</p>` : ''}`;
    }

    const board = sortedByScore().slice(0, 8);
    return `
    <main class="screen reveal-screen">
      <div class="qhead"><span class="pill">${r.kind === 'crossword' ? 'Fin du chrono' : `${r.index + 1} / ${r.total}`}</span><span class="muted">${last ? 'Résultats' : r.kind === 'crossword' ? 'Grille suivante' : 'Question suivante'} dans <span data-until="${state.phaseEndsAt}" data-mode="count"></span> s</span></div>
      <div class="bar thin"><div class="bar-fill" data-until="${state.phaseEndsAt}" data-total="${state.phaseEndsAt - state.phaseStartedAt}" data-mode="bar"></div></div>
      <div class="rv-main">
      ${SCREEN ? '' : banner}
      ${controller() && r.kind !== 'crossword' ? `<p class="tv-hint">📺 La correction est sur la télé</p>` : `
      ${GUESS_KINDS.includes(r.kind) || r.kind === 'crossword' ? '' : `<p class="prompt small">${esc(r.prompt)}</p>`}
      ${rv.picture ? gamePicture(rv.picture, true) : ''}
      ${detail}`}
      </div>
      <div class="rv-side">
      <section class="card">
        <h2>Classement</h2>
        <ul class="list">
          ${board.map((p, i) => `
            <li class="${p.id === state.you ? 'me' : ''}">
              <span class="pos">${i + 1}</span>${avatar(p.name)}
              <span class="grow">${esc(p.name)}</span>
              ${p.lastPoints ? `<span class="delta">+${p.lastPoints}</span>` : ''}
              <span class="pts">${p.score}</span>
            </li>`).join('')}
        </ul>
      </section>
      ${isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">${last ? 'Voir les résultats' : 'Suivant'}</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
      ${isHost() && ['cover', 'screen', 'sound'].includes(r.kind) ? `<div class="host-bar">${r.banned ? `<span class="muted">${{ screen: 'Image retirée', sound: 'Son retiré' }[r.kind] || 'Jeu retiré'} des prochaines parties</span>` : `<button class="link danger" data-action="ban">Retirer ${{ screen: 'cette image', sound: 'ce son' }[r.kind] || 'ce jeu'} des prochaines parties</button>`}</div>` : ''}
      </div>
    </main>`;
  },

  end() {
    const ranked = sortedByScore();
    const step = (p, place) => (p ? `
      <div class="step p${place}">
        ${avatar(p.name)}
        <span class="pname">${esc(p.name)}</span>
        <span class="score">${p.score} pts</span>
        <div class="block">${place}</div>
      </div>` : '<div></div>');
    const myPos = ranked.findIndex((p) => p.id === state.you) + 1;
    return `
    <main class="screen">
      <div class="title">${myPos === 1 ? 'Victoire ! 🏆' : 'Partie terminée'}</div>
      ${SCREEN ? '<p class="waiting tv-only">L’hôte peut relancer une partie depuis son téléphone</p>' : ''}
      <div class="podium">${step(ranked[1], 2)}${step(ranked[0], 1)}${step(ranked[2], 3)}</div>
      <section class="card">
        <ul class="list">
          ${ranked.map((p, i) => `
            <li class="${p.id === state.you ? 'me' : ''}">
              <span class="pos">${i + 1}</span>${avatar(p.name)}
              <span class="grow">${esc(p.name)}</span>
              <span class="pts">${p.score}</span>
            </li>`).join('')}
        </ul>
      </section>
      ${globalBoard()}
      ${SCREEN ? '' : isHost()
        ? '<button class="btn primary big sticky-bottom" data-action="lobby">Nouvelle partie</button>'
        : '<p class="waiting">En attente de l\'hôte pour une nouvelle partie</p>'}
      ${SCREEN ? '' : '<button class="link" data-action="leave">Quitter le salon</button>'}
    </main>`;
  },
};

// =====================================================================  rendu
// Mise à jour minimale du DOM : on garde les éléments existants et on ne touche qu'aux
// attributs et textes qui ont changé. Un élément n'est remplacé que s'il change de nature
// (balise, data-key, ou image d'un canvas).
function sameNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType !== 1) return true;
  if ((a.dataset.key ?? '') !== (b.dataset.key ?? '')) return false;
  if (a.nodeName === 'CANVAS' && a.dataset.src !== b.dataset.src) return false;
  return true;
}

function morphNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of to.attributes) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  // La valeur tapée dans un champ appartient au joueur : on n'y touche pas.
  // Mais un bouton désactivé/réactivé doit suivre l'état.
  if ('disabled' in from && from.disabled !== to.hasAttribute('disabled')) from.disabled = to.hasAttribute('disabled');
  morphChildren(from, to);
}

function morphChildren(from, to) {
  const wanted = [...to.childNodes];
  wanted.forEach((t, i) => {
    const f = from.childNodes[i];
    if (!f) from.appendChild(t);
    else if (sameNode(f, t)) morphNode(f, t);
    else from.replaceChild(t, f);
  });
  while (from.childNodes.length > wanted.length) from.lastChild.remove();
}

function render() {
  const phase = displayPhase();
  // Conserve la saisie en cours (l'état est re-diffusé à chaque réponse d'un autre joueur)
  const input = $('#est-input') || $('#guess-input') || $('#cw-word');
  const keep = input ? { value: input.value, focus: document.activeElement === input } : null;
  const nameVal = $('#name')?.value;
  const steamIn = $('#steam-input');
  const steamKeep = steamIn ? { value: steamIn.value, focus: document.activeElement === steamIn } : null;
  const codeVal = $('#code')?.value;

  // On ne remplace pas l'écran : on met à jour seulement ce qui a changé (voir morph).
  // Un bouton en train d'être cliqué reste le même élément, donc le clic n'est jamais perdu,
  // et rien ne clignote quand un autre joueur agit.
  const next = document.createElement('div');
  next.innerHTML = (views[phase] || views.home)() + pauseOverlay() + steamHelpOverlay() + tvSheet() + sheetView();
  // Changement d'écran (ou de question) : nouvel écran, avec son animation d'entrée
  if (next.firstElementChild) next.firstElementChild.dataset.key = `${phase}:${state?.round?.id ?? ''}`;
  morphChildren(app, next);
  // Écran de question : plus large sur ordinateur, pour la colonne des joueurs à droite
  app.classList.toggle('wide', phase === 'question');
  app.classList.toggle('wider', phase === 'lobby'); // salon sur trois colonnes
  app.classList.toggle('pad-mode', controller() && ['countdown', 'question', 'reveal'].includes(phase)); // téléphone en manette

  const newInput = $('#est-input') || $('#guess-input') || $('#cw-word');
  if (newInput) {
    if (keep) {
      newInput.value = keep.value;
      if (keep.focus) newInput.focus();
    } else if (renderedPhase !== 'question') {
      newInput.focus();
    }
  }
  const steamNew = $('#steam-input');
  if (steamNew && steamKeep) {
    steamNew.value = steamKeep.value;
    if (steamKeep.focus && document.activeElement !== steamNew) steamNew.focus();
  }
  if (phase === 'home') {
    if (nameVal) $('#name').value = nameVal;
    if (codeVal) $('#code').value = codeVal;
  }
  if (renderedPhase !== phase) closeZoom(); // l'image agrandie ne survit pas au changement d'écran
  renderedPhase = phase;
  buzzOnPhase(phase);
  guardBack();
  keepAwake();
  updatePropose();
  updateTimers();
}

/** Met à jour chronos et barres à chaque frame, à partir de l'horloge serveur estimée. */
function updateTimers() {
  const t = shownNow();
  syncSound();
  updateSoundUi();
  for (const c of document.querySelectorAll('canvas.cover')) drawCover(c, t);
  for (const el of document.querySelectorAll('[data-until]')) {
    const left = Math.max(0, Number(el.dataset.until) - t);
    const urgent = el.dataset.urgent && left <= Number(el.dataset.urgent);
    el.classList.toggle('urgent', !!urgent);
    if (el.dataset.mode === 'bar') {
      const total = Number(el.dataset.total) || 1;
      el.style.transform = `scaleX(${Math.min(1, left / total)})`;
    } else {
      const sec = Math.ceil(left / 1000);
      // « clock » : minutes et secondes, pour les chronos longs (mots croisés)
      const s = el.dataset.mode === 'clock' ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
      if (el.textContent !== s) el.textContent = s;
    }
  }
}

function frame() {
  if (displayPhase() !== renderedPhase) render();
  else updateTimers();
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);
// Arrivée par le QR code « L'app sur ton téléphone » : on ouvre directement la fenêtre d'installation
if (new URLSearchParams(location.search).has('install')) {
  history.replaceState(null, '', location.pathname);
  if (!STANDALONE && !SCREEN && displayPhase() === 'home') openSheet('getapp');
}
