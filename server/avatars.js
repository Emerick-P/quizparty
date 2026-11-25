/**
 * Images de profil : galerie maison (un emoji sur une couleur), la photo du compte Discord/Google, ou l'initiale.
 * Un choix tient dans une courte chaîne, gardée sur le compte (profiles.avatar_look) ou sur l'appareil (invité) :
 *   ''           initiale du pseudo (par défaut)
 *   'photo'      photo du compte Discord/Google (seulement si connecté)
 *   'e:<i>:<j>'  emoji n° i de AVATAR_EMOJIS sur la couleur n° j de AVATAR_HUES
 * La même liste est envoyée au navigateur (GET /api/avatars) : un seul endroit à modifier pour en ajouter.
 * Plus tard, les avatars à débloquer avec les pièces viendront s'ajouter ici.
 */
export const AVATAR_EMOJIS = ['🎮', '👾', '🕹️', '🍄', '⭐', '🐉', '🗡️', '🛡️', '🏆', '👻', '🤖', '🦊', '🐸', '🐱', '🐼', '🦖', '🚀', '💎', '🔥', '⚡', '🎯', '🧙', '🥷', '👑'];
export const AVATAR_HUES = [262, 200, 165, 120, 45, 20, 345, 300];

/** Choix reçu du navigateur → chaîne propre, ou null si invalide. */
export function cleanLook(raw) {
  if (raw === '' || raw == null) return '';
  if (raw === 'photo') return 'photo';
  const m = /^e:(\d{1,2}):(\d)$/.exec(String(raw));
  if (m && Number(m[1]) < AVATAR_EMOJIS.length && Number(m[2]) < AVATAR_HUES.length) return `e:${Number(m[1])}:${Number(m[2])}`;
  return null;
}

/** Ce que voient les autres joueurs : { emoji, hue } ou { photo: url }, null pour l'initiale. */
export function lookView(look, user) {
  if (look === 'photo') return user?.avatar ? { photo: user.avatar } : null;
  const m = /^e:(\d+):(\d+)$/.exec(look || '');
  return m ? { emoji: AVATAR_EMOJIS[m[1]], hue: AVATAR_HUES[m[2]] } : null;
}
