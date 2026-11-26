// QuizParty — Panneau « Proposer » et saisie des réponses (rappel des essais avec ↑).
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  proposer
// Le formulaire /proposer s'ouvre dans un panneau par-dessus le jeu (iframe de la même origine) :
// la page du jeu et sa connexion restent en place, le brouillon est gardé quand on ferme.
// Bouton seulement dans le salon (choix du client : ne pas casser le rythme d'une partie).
const PROPOSE_PHASES = ['lobby', 'end'];
const proposeButton = (label = 'Une idée de question, de pitch, de son ? Proposer') =>
  `<button class="btn small ghost propose-btn" data-action="propose">${ico('bulb')} ${esc(label)}</button>`;
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
  if (live && state.round) head.textContent = state.round.kind === 'crossword' ? 'La grille commence · revenir au jeu' : `Question ${state.round.index + 1} · revenir au jeu`;
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
    actions.saveName();
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
      toast('Télé connectée : la partie s’affiche dessus');
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
