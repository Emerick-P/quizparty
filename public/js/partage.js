// QuizParty — Partage : le même geste partout (Défi du jour, direct, défi entre potes, salon).
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// « Partager » envoie une phrase courte et le lien : c'est l'aperçu du lien (server/share.js) qui porte l'image.
// « Image » donne la seule image du score (pour une story). Les deux ne partent jamais ensemble.

/** « Max a fait 5 957 pts au Défi du jour n°2, à toi ! » puis le lien. */
const scoreText = (name, score, where, url) => `${name ? `${name} a fait` : 'J’ai fait'} ${nf.format(score || 0)} pts ${where}, à toi !\n${url}`;
/** Lien d'un résultat : avec son jeton signé, l'aperçu montre le score. */
const resultLink = (key, token, fallback = '/') => `${location.origin}${token ? `/?${key}=${encodeURIComponent(token)}` : fallback}`;

/** Bouton « Partager » (text : la phrase et le lien), avec « Image » à côté quand le résultat a un jeton. */
function shareRow(text, { token, cls = 'btn primary' } = {}) {
  const button = `<button class="${cls}" data-action="partager" data-value="${esc(text)}">${ico('share')} Partager</button>`;
  if (!token) return button;
  shareImageFile(token);
  return `<div class="d-share">${button}<button class="btn ghost" data-action="shareimage" data-token="${esc(token)}" title="Copier l’image du score">${ico('image')} Image</button></div>`;
}

/** Téléphone : feuille de partage du système ; ailleurs, tout est copié. */
actions.partager = async (btn) => {
  const text = btn.dataset.value;
  if (navigator.share && TOUCH) {
    try { await navigator.share({ text }); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  try { await copyText(text); toast('Copié : colle-le à tes potes !'); } catch { toast(text); }
};

// Image de score (format story) : chargée dès que son bouton s'affiche, pour que la copie parte au toucher
const shareImages = new Map(); // jeton → Promise<File | null>
function shareImageFile(token) {
  if (!shareImages.has(token)) {
    shareImages.set(token, fetch(`/partage/story/${encodeURIComponent(token)}.png`)
      .then(async (r) => (r.ok ? new File([await r.blob()], `${APP_NAME.toLowerCase()}-score.png`, { type: 'image/png' }) : null))
      .catch(() => null));
  }
  return shareImages.get(token);
}
/** L'image seule : dans le presse-papiers, sinon (navigateur qui refuse, http local) téléchargée. */
actions.shareimage = async (btn) => {
  const { token } = btn.dataset;
  const loading = shareImageFile(token);
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      // L'écriture part dans le geste, avec une promesse : Safari l'exige
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': loading.then((f) => f || Promise.reject(new Error('image'))) })]);
      return toast('Image copiée : colle-la où tu veux');
    } catch { /* refusé : on la télécharge */ }
  }
  const file = await loading;
  if (!file) {
    shareImages.delete(token); // nouvel essai au prochain toucher
    return toast('Image indisponible, réessaie dans un instant');
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast('Image téléchargée');
};
