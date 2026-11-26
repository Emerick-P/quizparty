// QuizParty — Utilitaires partagés : $, esc, stockage local, thème, toast, code dans l’URL.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  utilitaires
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const SHAPES = ['A', 'B', 'C', 'D'];
const KIND_LABEL = { qcm: 'Question', estimation: 'Estimation', cover: 'Jaquette', pitch: 'Pitch mal expliqué', emoji: 'Le jeu en emojis', sound: 'Quel jeu fait ce bruit ?', typed: 'Question', crossword: 'Mots croisés' };
const kindLabel = (r) => (r.kind === 'qcm' && r.choices?.length === 2 ? 'Vrai ou faux' : KIND_LABEL[r.kind]) || '';
const LEVEL_LABEL = { easy: 'Facile', hard: 'Difficile' };
const INPUT_LABEL = { choice: '4 choix', text: 'Réponse tapée' };
const MIX_INPUT_LABEL = { mixed: 'Au hasard', choice: '4 choix', text: 'Réponse tapée' };
const GUESS_KINDS = ['cover', 'pitch', 'emoji', 'sound']; // manches « Quel est ce jeu ? » (4 choix ou saisie du titre)
const TYPED_KINDS = ['cover', 'pitch', 'emoji', 'typed', 'sound']; // manches où l'on peut taper sa réponse, avec plusieurs essais

/** Salon : jeux regroupés par genre, avec une vignette (emoji + couleur). Un mode absent d'ici va dans « Autres ». */
const MODE_GROUPS = [
  { name: 'Culture jeu vidéo', ids: ['quiz', 'vraifaux', 'estimation'] },
  { name: 'Devine le jeu', ids: ['covers', 'pitch', 'emoji', 'sounds'] },
  { name: 'Lettres et mélange', ids: ['crossword', 'mix'] },
  { name: 'Entre amis', ids: ['bande'] },
];
/** Icônes au trait (dessin façon lucide, 24×24, trait 1,75) : ico('tv') rend un <svg> qui prend la couleur du texte. */
const ICONS = {
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
  gamepad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="3"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  chart: '<path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  vol0: '<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>',
  vol1: '<path d="M11 5 6 9H2v6h4l5 4z"/>',
  vol2: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7"/>',
  vol3: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  scale: '<path d="m16 16 3-8 3 8a4.5 4.5 0 0 1-6 0zM2 16l3-8 3 8a4.5 4.5 0 0 1-6 0zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  shuffle: '<path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h1.4a4 4 0 0 0 3.3-1.7l6.6-9.6A4 4 0 0 1 16.6 5H22M2 6h1.4a4 4 0 0 1 3.3 1.7l1 1.4M22 18h-5.4a4 4 0 0 1-3.3-1.7l-.9-1.3"/>',
};
const ico = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
/** Vignette de chaque jeu : icône et couleur (sur les tons des touches de réponse). */
const MODE_ART = {
  quiz: ['help', '#a46bff'], vraifaux: ['scale', '#4f8cff'], estimation: ['target', '#ff6a47'],
  covers: ['image', '#ff6a47'], pitch: ['chat', '#4f8cff'], emoji: ['smile', '#ffbe2e'],
  sounds: ['music', '#ffbe2e'], crossword: ['grid', '#d6f45b'], mix: ['shuffle', '#d6f45b'],
  bande: ['users', '#ff6a47'],
};
const modeArt = (id) => { const [name, color] = MODE_ART[id] || ['gamepad', '#a46bff']; return [ico(name), color]; };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
const SESSION_KEY = 'quizparty:session';
const NAME_KEY = 'quizparty:name';
const THEME_KEY = 'quizparty:theme';
const STEAM_KEY = 'quizparty:steam'; // adresse du profil Steam, retenue sur l'appareil
const AUTH_KEY = 'quizparty:auth'; // compte connecté : jetons Supabase + nom/avatar affichés

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
  const url = code && code.length === 4 ? `${location.pathname}?code=${code}` : location.pathname; // pas d'adresse pour le défi du jour
  history.replaceState(history.state, '', url); // garde la position dans l'historique (bouton Retour, nav.js)
}
