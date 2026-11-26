// QuizParty — Jaquettes pixelisées, sons (« Quel jeu fait ce bruit ? »).
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  jaquettes pixelisées
const images = new Map(); // url → { img, ok }
function loadImage(url) {
  if (!url) return null;
  let e = images.get(url);
  if (e?.failedAt && performance.now() - e.failedAt > 500) e = null; // nouvel essai, sans insister à chaque frame
  if (!e) {
    const img = new Image();
    e = { img, ok: false };
    img.onload = () => { e.ok = true; updateTimers(); };
    img.onerror = () => { e.failedAt = performance.now(); };
    img.src = url;
    images.set(url, e);
  }
  return e;
}

/**
 * Jaquette pixelisée. Anti-triche : le navigateur ne reçoit jamais l'image nette pendant la question,
 * seulement des paliers déjà réduits par le serveur (image.levels : { cols, at, url }), chacun servi
 * à son heure. Le palier affiché dépend de l'horloge serveur : tout le monde voit le même au même moment.
 * Le suivant est téléchargé un peu avant son heure (le serveur l'accepte 800 ms avant).
 */
const PIX_PREFETCH_MS = 600;

function drawCover(canvas, t) {
  if (canvas.dataset.clear) return drawClearCover(canvas);
  if (canvas._raw !== canvas.dataset.levels) {
    canvas._raw = canvas.dataset.levels;
    try { canvas._levels = JSON.parse(canvas._raw || '[]').filter((l) => l.url); } catch { canvas._levels = []; }
  }
  const levels = canvas._levels;
  let k = 0;
  while (k + 1 < levels.length && levels[k + 1].at <= t) k++;
  if (levels[k + 1] && levels[k + 1].at - PIX_PREFETCH_MS <= t) loadImage(levels[k + 1].url);
  // Palier à l'heure ; s'il n'est pas encore arrivé, le dernier palier déjà chargé
  let e = null;
  for (let j = k; j >= 0 && !e?.ok; j--) e = loadImage(levels[j].url);
  if (!e?.ok || canvas.dataset.key === e.img.src) return;
  canvas.dataset.key = e.img.src;
  const small = e.img;
  const W = 512, H = Math.round((W * small.naturalHeight) / small.naturalWidth);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  canvas.parentElement.classList.add('loaded');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(small, 0, 0, W, H);
}

/** Correction : la jaquette nette. */
function drawClearCover(canvas) {
  const e = loadImage(canvas.dataset.src);
  if (!e?.ok || canvas.dataset.key === 'clear') return;
  canvas.dataset.key = 'clear';
  const img = e.img;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.parentElement.classList.add('loaded');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0);
}

function coverFigure(image, { clear } = {}) {
  return `<figure class="cover-wrap">
    <canvas class="cover" ${clear ? `data-src="${esc(image.url)}" data-clear="1"` : `data-levels="${esc(JSON.stringify(image.levels ?? []))}"`}></canvas>
    <span class="cover-loading">Chargement…</span>
    ${clear ? '' : `<figcaption>Image : ${esc(image.source)}</figcaption>`}
  </figure>`;
}


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
  if (icon) icon.innerHTML = volumeIcon(v);
}
const volumeIcon = (v) => ico(v === 0 ? 'vol0' : v < 40 ? 'vol1' : v < 75 ? 'vol2' : 'vol3');

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
