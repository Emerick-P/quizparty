// QuizParty — Appareil : écran télé (/tv), app installée (PWA), vibrations, bouton Retour.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

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
const INSTALLED_MSG = '📲 Installation lancée : QuizParty apparaîtra sur ton écran d’accueil dans quelques secondes';
addEventListener('appinstalled', () => {
  pwa.prompt = null;
  let already = false;
  try { already = localStorage.getItem(INSTALLED_KEY) === '1'; localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
  if (!already) toast(INSTALLED_MSG); // le message part déjà au clic sur « Installer »
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
  if (!TOUCH) return '<button class="chip-btn" data-action="sheet" data-value="getapp">📱 L’app sur ton téléphone</button>';
  if (appInstalled() && !pwa.prompt) return '<button class="chip-btn" data-action="sheet" data-value="getapp">✓ App installée</button>';
  if (pwa.prompt) return '<button class="chip-btn" data-action="install">📲 Installer l’app</button>';
  return '<button class="chip-btn" data-action="sheet" data-value="getapp">📲 Installer l’app</button>';
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
