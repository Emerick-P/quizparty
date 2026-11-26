// QuizParty — Utilitaires partagés : $, esc, stockage local, thème, toast, code dans l’URL.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
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
  history.replaceState(null, '', url);
}
