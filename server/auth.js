import crypto from 'node:crypto';
import { store } from './store.js';

/**
 * Comptes joueurs (facultatifs) : connexion Discord / Google via Supabase Auth.
 *
 * - Le navigateur part vers Supabase (/auth/v1/authorize), qui le renvoie sur le site avec un jeton
 *   d'accès (1 h) et un jeton de renouvellement. Le navigateur ne parle à Supabase que pour cette redirection.
 * - Le serveur vérifie le jeton en demandant à Supabase à qui il appartient (/auth/v1/user), avec sa clé
 *   secrète : aucune clé n'est donnée au navigateur, et ça marche quelle que soit la méthode de signature.
 * - Rôles : colonne « role » de la table profiles (player par défaut, admin), modifiable seulement dans
 *   Supabase. Un admin seul peut accepter une réponse, supprimer une question ou retirer un jeu/une image/un son.
 *   ADMIN_USER_IDS (identifiants séparés par des virgules) reste possible en secours.
 * - Sans SUPABASE_URL / SUPABASE_SECRET_KEY (PC, tests) : pas de comptes, l'hôte garde ces droits.
 */
const PROVIDERS = ['discord', 'google'];
const CACHE_MS = 5 * 60 * 1000; // un même jeton n'est revérifié auprès de Supabase qu'après 5 min

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');

/** Nom et avatar lisibles depuis les métadonnées de Discord ou Google. */
export function profileOf(user) {
  const m = user?.user_metadata ?? {};
  const name = clip(m.custom_claims?.global_name || m.full_name || m.name || m.user_name || m.preferred_username || (user?.email ?? '').split('@')[0], 40);
  const https = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
  const provider = user?.app_metadata?.provider ?? null;
  // Un compte peut être relié à Discord ET à Google (même e-mail) : user_metadata ne garde que la photo du
  // dernier service utilisé, alors on lit chaque identité pour garder les deux photos.
  const photos = {};
  for (const id of user?.identities ?? []) {
    const url = https(id?.identity_data?.avatar_url) || https(id?.identity_data?.picture);
    if (PROVIDERS.includes(id?.provider) && url) photos[id.provider] = url;
  }
  const avatar = https(m.avatar_url) || https(m.picture);
  if (avatar && provider && PROVIDERS.includes(provider) && !photos[provider]) photos[provider] = avatar;
  return { name: name || 'Joueur', avatar: photos[provider] ?? avatar, photos, provider };
}

export function createAuth(env = process.env, { fetch: f = globalThis.fetch } = {}) {
  const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/(rest|storage|auth)\/v1$/, '');
  const key = (env.SUPABASE_SECRET_KEY || '').trim();
  const admins = new Set(String(env.ADMIN_USER_IDS || '').split(/[\s,;]+/).filter(Boolean));
  const enabled = !!(url && key) && env.AUTH_DISABLED !== '1';
  const headers = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
  const cache = new Map(); // empreinte du jeton → { user, until }
  const saved = new Map(); // id → dernière copie du profil dans la table profiles
  let settings = null; // fournisseurs activés dans Supabase (Discord, Google), relus toutes les 10 min

  async function call(method, p, { body, bearer } = {}) {
    const res = await f(`${url}${p}`, {
      method,
      headers: { ...headers, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, data };
  }

  /** Copie du profil (nom, avatar, dernière visite) pour les futures fonctions : stats, défis, pièces… */
  function saveProfile(user) {
    if (store.name !== 'supabase' || !store.upsert) return;
    const last = saved.get(user.id);
    if (last && Date.now() - last < 3600_000) return;
    saved.set(user.id, Date.now());
    store.upsert('profiles', { id: user.id, name: user.name, avatar_url: user.avatar, provider: user.provider, last_seen: new Date().toISOString() })
      .catch((err) => console.error('[comptes] profil :', err.message));
  }

  return {
    enabled,
    providers: PROVIDERS,
    isAdmin: (id) => !!id && admins.has(id),
    /** Configuration pour le navigateur : seulement les fournisseurs réellement activés dans Supabase. */
    async config() {
      if (!enabled) return { enabled: false, url: null, providers: [] };
      if (!settings || settings.until < Date.now()) {
        const r = await call('GET', '/auth/v1/settings').catch(() => null);
        const ext = r?.ok ? r.data?.external ?? {} : null;
        settings = { providers: ext ? PROVIDERS.filter((p) => ext[p]) : settings?.providers ?? PROVIDERS, until: Date.now() + (ext ? 10 * 60_000 : 30_000) };
      }
      return { enabled: settings.providers.length > 0, url, providers: settings.providers };
    },

    /** Jeton d'accès → { id, name, avatar, provider, admin } ou null s'il est invalide/expiré. */
    async verify(token) {
      if (!enabled || typeof token !== 'string' || token.length < 20 || token.length > 4096) return null;
      const h = crypto.createHash('sha256').update(token).digest('hex');
      const hit = cache.get(h);
      if (hit && hit.until > Date.now()) return hit.user;
      const r = await call('GET', '/auth/v1/user', { bearer: token });
      if (!r.ok || !r.data?.id) { cache.delete(h); return null; }
      const user = { id: r.data.id, ...profileOf(r.data), role: 'player', admin: false, nickname: null };
      // Profil en base : pseudo choisi dans la page Profil, et rôle (colonne profiles.role, modifiable
      // seulement dans Supabase : les joueurs n'y ont aucun accès). Pris en compte en 5 min au plus.
      if (store.name === 'supabase' && store.get) {
        const row = await store.get('profiles', user.id).catch(() => null);
        user.nickname = row?.nickname ?? null;
        user.look = row?.avatar_look ?? null;
        if (row?.role) user.role = row.role;
      }
      user.admin = user.role === 'admin' || admins.has(user.id); // ADMIN_USER_IDS : secours facultatif
      if (cache.size > 2000) cache.clear();
      cache.set(h, { user, until: Date.now() + CACHE_MS });
      saveProfile(user);
      return user;
    },

    /** Image de profil du compte (page Profil), gardée dans profiles.avatar_look. */
    async setLook(user, look) {
      for (const v of cache.values()) if (v.user.id === user.id) v.user.look = look;
      user.look = look;
      if (store.name === 'supabase' && store.upsert) await store.upsert('profiles', { id: user.id, avatar_look: look });
    },

    /** Pseudo du compte (page Profil), gardé dans profiles.nickname. */
    async setNickname(user, nickname) {
      for (const v of cache.values()) if (v.user.id === user.id) v.user.nickname = nickname;
      user.nickname = nickname;
      if (store.name === 'supabase' && store.upsert) await store.upsert('profiles', { id: user.id, nickname });
    },

    /** Renouvelle la session (le jeton d'accès dure 1 h). */
    async refresh(refreshToken) {
      if (!enabled || typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 512) return null;
      const r = await call('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
      if (!r.ok || !r.data?.access_token) return null;
      const { access_token, refresh_token, expires_in, expires_at } = r.data;
      return { access_token, refresh_token, expires_at: expires_at ?? Math.floor(Date.now() / 1000) + (expires_in || 3600) };
    },

    /** Le joueur supprime son compte (et son profil) : demandé sur la page de confidentialité. */
    async remove(token) {
      const user = await this.verify(token);
      if (!user) return false;
      for (const [h, v] of cache) if (v.user.id === user.id) cache.delete(h);
      const r = await call('DELETE', `/auth/v1/admin/users/${encodeURIComponent(user.id)}`);
      if (!r.ok) throw new Error('Suppression impossible pour le moment, réessaie plus tard');
      if (store.name === 'supabase' && store.remove) await store.remove('profiles', user.id).catch(() => {});
      return true;
    },

    /** Routes HTTP : configuration publique, renouvellement, suppression du compte. */
    install(app, express) {
      app.get('/api/auth/config', async (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await this.config());
      });
      app.post('/api/auth/refresh', express.json({ limit: '4kb' }), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
          const s = await this.refresh(req.body?.refresh_token);
          if (!s) return res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
          res.json(s);
        } catch {
          res.status(502).json({ error: 'Connexion impossible pour le moment' });
        }
      });
      app.post('/api/auth/delete', express.json({ limit: '8kb' }), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
          if (!(await this.remove(req.body?.access_token))) return res.status(401).json({ error: 'Reconnecte-toi puis réessaie' });
          res.json({ ok: true });
        } catch (err) {
          res.status(502).json({ error: err.message });
        }
      });
    },
  };
}
