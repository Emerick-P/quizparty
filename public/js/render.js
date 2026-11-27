// QuizParty — Rendu : morph du DOM, swipe de la correction, chronos à chaque frame.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

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
  if (state) homeUi.at = 0; // après une partie, l'accueil recharge ma cote
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
  next.innerHTML = (views[phase] || views.home)() + appBar(phase) + pauseOverlay() + flagOverlay() + steamHelpOverlay() + tvSheet() + sheetView() + leaveOverlay();
  // Changement d'écran (ou de question) : nouvel écran, avec son animation d'entrée
  if (next.firstElementChild) next.firstElementChild.dataset.key = `${phase}:${state?.round?.id ?? ''}`;
  morphChildren(app, next);
  // Écran de question : plus large sur ordinateur, pour la colonne des joueurs à droite
  app.classList.toggle('wide', phase === 'question');
  app.classList.toggle('wider', phase === 'lobby'); // salon sur trois colonnes
  app.classList.toggle('has-bar', hasBar(phase)); // bandeau du haut commun
  app.classList.toggle('pad-mode', controller() && ['countdown', 'question', 'reveal'].includes(phase)); // téléphone en manette

  const newInput = $('#est-input') || $('#guess-input') || $('#cw-word');
  if (newInput) {
    if (keep) {
      newInput.value = keep.value;
      if (keep.focus) newInput.focus();
    } else if (renderedPhase !== 'question' && !TOUCH) {
      newInput.focus(); // sur téléphone, le clavier ne s'ouvre qu'au toucher du champ (on voit d'abord la question)
    }
  }
  const steamNew = $('#steam-input');
  if (steamNew && steamKeep) {
    steamNew.value = steamKeep.value;
    if (steamKeep.focus && document.activeElement !== steamNew) steamNew.focus();
  }
  if (phase === 'home') {
    if (nameVal && $('#name')) $('#name').value = nameVal;
    if (codeVal && $('#code')) $('#code').value = codeVal;
  }
  renderedPhase = phase;
  buzzOnPhase(phase);
  navSync();
  keepAwake();
  updatePropose();
  updateSwipe();
  updateTimers();
}

/* ---------- Correction au swipe (téléphone) : « Réponse » ⇄ « Classement »
   --p (0 → 1) suit le doigt : les pages se réduisent/estompent et la pastille du repère glisse avec.
   Les premières fois, la page fait un petit aller-retour pour montrer qu'on peut la faire glisser. */
const SWIPE_HINT_KEY = 'quizparty.swipeHint';
const swipeSeen = new WeakSet();
function swipeHints(n) {
  try {
    if (n !== undefined) localStorage.setItem(SWIPE_HINT_KEY, String(n));
    return Number(localStorage.getItem(SWIPE_HINT_KEY)) || 0;
  } catch { return 99; }
}
function updateSwipe() {
  const el = document.querySelector('.rv-swipe.on');
  if (!el) return;
  const screen = el.closest('.reveal-screen');
  const max = el.scrollWidth - el.clientWidth;
  const p = max > 4 ? Math.min(1, Math.max(0, el.scrollLeft / max)) : 0;
  screen.style.setProperty('--p', p.toFixed(3));
  const page = p > 0.5 ? 1 : 0;
  screen.querySelector('.rv-dots')?.classList.toggle('moving', p > 0.02 && p < 0.98); // pendant le glissé : texte lisible sur la pastille comme à côté
  screen.querySelectorAll('.rv-dot').forEach((d, i) => {
    d.classList.toggle('on', i === page);
    d.setAttribute('aria-selected', String(i === page));
  });
  if (max > 4 && !swipeSeen.has(el)) {
    swipeSeen.add(el);
    const shown = swipeHints();
    if (shown < 3) {
      setTimeout(() => {
        if (!el.isConnected || el.scrollLeft > 4) return;
        swipeHints(shown + 1);
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // animation à part du DOM (un nouveau rendu ne la coupe pas)
        for (const pg of el.querySelectorAll('.rv-page')) {
          pg.animate([{ translate: '0' }, { translate: '-64px', offset: 0.35 }, { translate: '-64px', offset: 0.55 }, { translate: '0' }],
            { duration: 1100, easing: 'cubic-bezier(.3, 0, .2, 1)' });
        }
      }, 900);
    }
  }
}
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!el.classList?.contains('rv-swipe')) return;
  updateSwipe();
  if (el.scrollLeft > 40) swipeHints(99); // il a trouvé : plus besoin de montrer
}, true);

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
      if (el.dataset.mode === 'eta') { // « dans 2 h 15 », puis mm:ss pendant la dernière heure
        const min = Math.ceil(sec / 60);
        const s = sec > 3600 ? `dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        if (el.textContent !== s) el.textContent = s;
        continue;
      }
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
