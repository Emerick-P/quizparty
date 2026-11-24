/**
 * Fournisseur d'images IGDB (base de données de jeux de Twitch).
 *
 * Authentification : identifiants d'une application Twitch (dev.twitch.tv/console),
 * dans les variables d'environnement TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET.
 * Conditions d'utilisation : https://api-docs.igdb.com/#account-creation
 * (usage non commercial gratuit, mention d'IGDB obligatoire).
 */

// Surchargeables pour les tests (faux serveur IGDB)
const TOKEN_URL = process.env.TWITCH_TOKEN_URL || 'https://id.twitch.tv/oauth2/token';
const API_URL = process.env.IGDB_API_URL || 'https://api.igdb.com/v4';
const IMAGE_URL = process.env.IGDB_IMAGE_URL || 'https://images.igdb.com/igdb/image/upload';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_GAP_MS = 300; // IGDB limite à 4 requêtes par seconde
const SLUG_YEAR_TOLERANCE = 3;   // un slug exact mais 10 ans d'écart = un homonyme (Doom 2016 au lieu de 1993)
const SEARCH_YEAR_TOLERANCE = 1;

const FIELDS = 'fields name,slug,url,first_release_date,cover.image_id,involved_companies.publisher,involved_companies.company.name;';

const quote = (s) => `"${String(s).replace(/["\\]/g, '')}"`;
const simplify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const yearOf = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);

export function igdbConfig(env = process.env) {
  const clientId = env.TWITCH_CLIENT_ID || env.IGDB_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET || env.IGDB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function createIgdbProvider({ clientId, clientSecret }) {
  let token = null;
  let tokenExpiresAt = 0;
  let lastCall = 0;

  async function getToken(force = false) {
    if (!force && token && Date.now() < tokenExpiresAt - 60_000) return token;
    const url = `${TOKEN_URL}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`Twitch a refusé les identifiants (HTTP ${res.status})`);
    const body = await res.json();
    token = body.access_token;
    tokenExpiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
    return token;
  }

  async function query(endpoint, body, retry = 2) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(`${API_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' },
      body,
    });
    if (res.status === 401 && retry > 0) {
      await getToken(true);
      return query(endpoint, body, retry - 1);
    }
    if (res.status === 429 && retry > 0) {
      await sleep(1000);
      return query(endpoint, body, retry - 1);
    }
    if (!res.ok) throw new Error(`IGDB ${endpoint} : HTTP ${res.status}`);
    return res.json();
  }

  const toResult = (g) => {
    const publisher = (g.involved_companies || []).find((c) => c.publisher)?.company?.name ?? null;
    return {
      ref: String(g.id),
      name: g.name,
      year: yearOf(g),
      imageId: g.cover?.image_id ?? null,
      pageUrl: g.url || `https://www.igdb.com/games/${g.slug}`,
      publisher,
    };
  };

  const yearOk = (g, year, tol) => !year || !yearOf(g) || Math.abs(yearOf(g) - year) <= tol;

  return {
    id: 'igdb',
    name: 'IGDB',
    homepage: 'https://www.igdb.com',

    /**
     * Trouve la jaquette de chaque jeu. Renvoie Map(slug → résultat | { error }).
     * 1) une requête groupée par slug, 2) pour les manquants, une recherche par titre exact + année.
     */
    async resolve(games) {
      const out = new Map();
      for (let i = 0; i < games.length; i += 100) {
        const chunk = games.slice(i, i + 100);
        const rows = await query('games', `${FIELDS} where slug = (${chunk.map((g) => quote(g.slug)).join(',')}); limit 500;`);
        for (const g of chunk) {
          const row = rows.find((r) => r.slug === g.slug);
          if (row && row.cover?.image_id && yearOk(row, g.igdbYear ?? g.year, SLUG_YEAR_TOLERANCE)) out.set(g.slug, toResult(row));
        }
      }
      for (const g of games) {
        if (out.has(g.slug)) continue;
        const name = g.igdbName || g.title;
        try {
          const rows = await query('games', `search ${quote(name)}; ${FIELDS} limit 25;`);
          const hit = rows.find((r) => r.cover?.image_id && simplify(r.name) === simplify(name) && yearOk(r, g.igdbYear ?? g.year, SEARCH_YEAR_TOLERANCE));
          out.set(g.slug, hit ? toResult(hit) : { error: 'introuvable (vérifier le slug ou l\'année)' });
        } catch (err) {
          out.set(g.slug, { error: err.message });
        }
      }
      return out;
    },

    imageUrl: (imageId) => `${IMAGE_URL}/t_cover_big_2x/${imageId}.jpg`,
  };
}
