/**
 * Profils Steam des joueurs (API Steam Web, gratuite, profils publics seulement).
 *
 * Un joueur colle l'adresse de son profil (steamcommunity.com/id/… ou /profiles/7656…), son identifiant
 * personnalisé ou son SteamID64. On récupère son nom, son avatar et ses jeux avec le temps de jeu.
 * Les données restent en mémoire (cache de 30 min par profil) et ne sont jamais enregistrées.
 *
 * Variables d'environnement : STEAM_API_KEY (obligatoire pour lier un profil),
 * STEAM_API_URL (adresse de l'API, remplacée par un faux serveur dans les tests).
 */
const API = () => (process.env.STEAM_API_URL || 'https://api.steampowered.com').replace(/\/$/, '');
const KEY = () => process.env.STEAM_API_KEY || '';
const CACHE_MS = 30 * 60_000;
const TIMEOUT_MS = 8000;

export const PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';
const cache = new Map(); // steamid → { at, data }

export const steamEnabled = () => !!KEY();

/** Image d'un jeu sur le CDN de Steam (bannière horizontale de la boutique). */
export const gameImage = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

/**
 * Lit ce que le joueur a collé (adresse du profil, identifiant personnalisé, SteamID64 ou code ami). Renvoie { id } (SteamID64), { vanity } (identifiant personnalisé) ou null.
 */
export function parseProfile(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 200) return null;
  const url = s.match(/steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)/i);
  if (url) return url[1].toLowerCase() === 'profiles' ? (/^7656\d{13}$/.test(url[2]) ? { id: url[2] } : null) : { vanity: url[2] };
  if (/^7656\d{13}$/.test(s)) return { id: s };
  // Code ami (Steam → Amis → Ajouter un ami) : SteamID64 = 76561197960265728 + code
  if (/^\d{3,10}$/.test(s)) return { id: String(76561197960265728n + BigInt(s)) };
  if (/^[\w-]{2,64}$/.test(s)) return { vanity: s };
  return null;
}

async function call(path, params) {
  const q = new URLSearchParams({ key: KEY(), format: 'json', ...params });
  let res;
  try {
    res = await fetch(`${API()}${path}?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error('Steam ne répond pas, réessaie dans un instant');
  }
  if (res.status === 429) throw new Error('Steam limite les demandes, réessaie dans une minute');
  if (res.status === 401 || res.status === 403) throw new Error('Clé Steam refusée (STEAM_API_KEY)');
  if (!res.ok) throw new Error('Steam ne répond pas, réessaie dans un instant');
  return res.json();
}

/**
 * Profil complet d'un joueur :
 * { id, name, avatar, profileUrl, status: 'ok' | 'private', games: [{ appid, name, minutes, recent }] }
 * status 'private' : profil ou « Détails des jeux » non publics (aucun jeu visible).
 */
export async function loadProfile(raw) {
  if (!steamEnabled()) throw new Error('Steam n\'est pas encore configuré sur ce serveur (clé manquante)');
  const parsed = parseProfile(raw);
  if (!parsed) throw new Error('Colle ton code ami Steam ou l\'adresse de ton profil');
  let id = parsed.id;
  if (!id) {
    const r = await call('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: parsed.vanity });
    if (r?.response?.success !== 1) throw new Error('Profil Steam introuvable : vérifie l\'adresse');
    id = r.response.steamid;
  }
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  // Niveau et amis : facultatifs (liste d'amis privée = erreur 401, sans gravité)
  const optional = (p) => p.catch(() => null);
  const [sum, owned, level, friends] = await Promise.all([
    call('/ISteamUser/GetPlayerSummaries/v2/', { steamids: id }),
    call('/IPlayerService/GetOwnedGames/v1/', { steamid: id, include_appinfo: 1, include_played_free_games: 1 }),
    optional(call('/IPlayerService/GetSteamLevel/v1/', { steamid: id })),
    optional(call('/ISteamUser/GetFriendList/v1/', { steamid: id, relationship: 'friend' })),
  ]);
  const p = sum?.response?.players?.[0];
  if (!p) throw new Error('Profil Steam introuvable : vérifie l\'adresse');
  const games = (owned?.response?.games ?? [])
    .filter((g) => g && g.appid && g.name)
    .map((g) => ({ appid: g.appid, name: String(g.name).slice(0, 80), minutes: g.playtime_forever | 0, recent: g.playtime_2weeks | 0, lastPlayed: g.rtime_last_played | 0 }));
  const friendSince = {};
  for (const f of friends?.friendslist?.friends ?? []) if (f?.steamid && f.friend_since) friendSince[f.steamid] = f.friend_since;
  const data = {
    id,
    name: String(p.personaname ?? '').slice(0, 32),
    avatar: typeof p.avatarmedium === 'string' ? p.avatarmedium : null,
    profileUrl: typeof p.profileurl === 'string' ? p.profileurl : `https://steamcommunity.com/profiles/${id}`,
    // communityvisibilitystate 3 = public ; même public, la liste des jeux peut être cachée
    // Temps de jeu masqué (« Toujours garder mon temps de jeu total privé ») : tout est à 0, inutilisable
    status: p.communityvisibilitystate === 3 && games.length && games.some((g) => g.minutes > 0) ? 'ok' : 'private',
    hiddenTime: games.length > 0 && games.every((g) => g.minutes === 0),
    games,
    created: Number.isFinite(p.timecreated) && p.timecreated > 0 ? p.timecreated : null, // date de création du compte (s)
    level: Number.isFinite(level?.response?.player_level) ? level.response.player_level : null,
    friendSince, // SteamID64 → date (s) ; vide si la liste d'amis est privée
    achievements: null, // chargés ensuite par loadAchievements
  };
  // Profil privé : pas de cache, le joueur réessaie juste après avoir changé ses réglages Steam
  if (data.status === 'ok') cache.set(id, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

// ---- Succès (chargés après la liaison, en arrière-plan)

const ACH_GAMES = 20; // jeux les plus joués examinés par joueur
const appCache = new Map(); // appid → { at, percent: Map(apiname → %), icon: Map(apiname → url) } (données communes à tous)

async function appAchievements(appid) {
  const hit = appCache.get(appid);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit;
  const optional = (p) => p.catch(() => null);
  const [glob, schema] = await Promise.all([
    optional(call('/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', { gameid: appid })),
    optional(call('/ISteamUserStats/GetSchemaForGame/v2/', { appid, l: 'french' })),
  ]);
  const percent = new Map((glob?.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)]));
  const icon = new Map((schema?.game?.availableGameStats?.achievements ?? []).map((a) => [a.name, typeof a.icon === 'string' ? a.icon : null]));
  const data = { at: Date.now(), percent, icon };
  appCache.set(appid, data);
  if (appCache.size > 2000) appCache.delete(appCache.keys().next().value);
  return data;
}

/** Exécute les tâches avec au plus n appels simultanés. */
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]).catch(() => null);
    }
  }));
  return out;
}

/**
 * Succès des jeux les plus joués d'un profil : [{ appid, game, total, done, pct, rarest }]
 * rarest = succès débloqué le plus rare du jeu : { name, description, percent, icon }.
 * Un jeu sans succès est ignoré. Le résultat est gardé avec le profil (même cache de 30 min).
 */
const inFlight = new WeakMap(); // profil → chargement en cours (deux liaisons rapprochées = un seul chargement)
export function loadAchievements(profile) {
  if (profile.achievements) return Promise.resolve(profile.achievements);
  if (!inFlight.has(profile)) inFlight.set(profile, fetchAchievements(profile).finally(() => inFlight.delete(profile)));
  return inFlight.get(profile);
}
async function fetchAchievements(profile) {
  const games = profile.games.filter((g) => g.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, ACH_GAMES);
  const rows = await pool(games, 5, async (g) => {
    const r = await call('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: profile.id, appid: g.appid, l: 'french' });
    const list = r?.playerstats?.success ? r.playerstats.achievements ?? [] : [];
    if (list.length < 3) return null;
    const app = await appAchievements(g.appid);
    const got = list.filter((a) => a.achieved === 1);
    let rarest = null;
    for (const a of got) {
      const percent = app.percent.get(a.apiname);
      if (!Number.isFinite(percent)) continue;
      if (!rarest || percent < rarest.percent) {
        rarest = { name: String(a.name ?? a.apiname).slice(0, 80), description: String(a.description ?? '').slice(0, 160), percent, icon: app.icon.get(a.apiname) ?? null };
      }
    }
    return { appid: g.appid, game: g.name, total: list.length, done: got.length, pct: got.length / list.length, rarest };
  });
  profile.achievements = rows.filter(Boolean);
  return profile.achievements;
}
