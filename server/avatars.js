/**
 * Images de profil : galerie maison (un emoji sur une couleur), la photo du compte Discord/Google, ou l'initiale.
 * Un choix tient dans une courte chaîne, gardée sur le compte (profiles.avatar_look) ou sur l'appareil (invité) :
 *   ''           initiale du pseudo (par défaut)
 *   'photo:discord' / 'photo:google'  photo de ce compte-là (seulement si connecté) : un compte relié aux deux
 *                garde la photo choisie, quel que soit le service utilisé pour se connecter
 *   'photo'      (ancien format) photo du service de la connexion en cours
 *   'e:<i>:<j>'  emoji n° i de AVATAR_EMOJIS sur la couleur n° j de AVATAR_HUES
 * La même liste est envoyée au navigateur (GET /api/avatars) : un seul endroit à modifier pour en ajouter.
 * Plus tard, les avatars à débloquer avec les pièces viendront s'ajouter ici.
 */
export const AVATAR_EMOJIS = ['🎮', '👾', '🕹️', '🧛', '⭐', '🐉', '🗡️', '🛡️', '🏆', '👻', '🤖', '🦊', '🐸', '🐱', '🐼', '🦖', '🚀', '💎', '🔥', '⚡', '🎯', '🧙', '🥷', '👑'];
export const AVATAR_HUES = [262, 200, 165, 120, 45, 20, 345, 300];

/** Choix reçu du navigateur → chaîne propre, ou null si invalide. */
export function cleanLook(raw) {
  if (raw === '' || raw == null) return '';
  if (raw === 'photo' || raw === 'photo:discord' || raw === 'photo:google') return raw;
  const m = /^e:(\d{1,2}):(\d)$/.exec(String(raw));
  if (m && Number(m[1]) < AVATAR_EMOJIS.length && Number(m[2]) < AVATAR_HUES.length) return `e:${Number(m[1])}:${Number(m[2])}`;
  return null;
}

/** Adresse de la photo choisie (look 'photo:<service>'), ou null. user.photos : { discord, google } (auth.js). */
export function photoOf(look, user) {
  if (!user || !/^photo(:|$)/.test(look || '')) return null;
  const p = look.split(':')[1];
  return p ? user.photos?.[p] ?? null : user.avatar ?? null;
}

/** Choix par défaut d'un compte sans choix enregistré : la photo du service de connexion, s'il y en a une. */
export const defaultLook = (user) => (user?.avatar && user.provider ? `photo:${user.provider}` : '');

/** Ce que voient les autres joueurs : { emoji, hue } ou { photo: url }, null pour l'initiale. */
export function lookView(look, user) {
  if (/^photo(:|$)/.test(look || '')) { const url = photoOf(look, user); return url ? { photo: url } : null; }
  const m = /^e:(\d+):(\d+)$/.exec(look || '');
  return m ? { emoji: AVATAR_EMOJIS[m[1]], hue: AVATAR_HUES[m[2]] } : null;
}
