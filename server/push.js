import crypto from 'node:crypto';
import { generateRequestDetails, getVapidHeaders } from 'web-push';
import { store as defaultStore } from './store.js';

/**
 * Notifications du navigateur (Web Push) pour les quiz en direct.
 *
 * - Choix : tous les directs, certains créneaux (format : midi, soir, nuit, finale) ou des directs
 *   précis (id du créneau).
 * - Compte connecté : les choix sont ceux du compte (table push_accounts), les mêmes sur tous ses appareils.
 *   La permission se donne appareil par appareil : chaque appareil activé = une ligne rattachée au compte.
 * - Invité : chaque appareil (abonnement donné par son navigateur) porte ses propres choix.
 * - Une seule notification par direct et par appareil, à l'ouverture de la salle d'attente (Live.plan).
 *   Rien d'autre n'est jamais envoyé.
 * - Sans VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (voir .env.example) : désactivé, aucune cloche à l'écran.
 * - Tables Supabase push_subscriptions et push_accounts (voir supabase/schema.sql) ; sans Supabase, fichiers locaux.
 */
const TABLE = 'push_subscriptions'; // un appareil
const ACCOUNTS = 'push_accounts'; // les choix d'un compte
const SENT_KEY = 'push_sent'; // table meta : derniers directs déjà annoncés (pas de doublon après un redémarrage)
const MAX_ROWS = 1000;
const BATCH = 20;
const RETRY_MS = 20_000;
const MAX_SLOTS = 30;
// Services de notification des navigateurs. Le serveur n'écrit à aucune autre adresse : sans ce filtre,
// n'importe qui pourrait lui faire appeler un site de son choix.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|google\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/;
const SLOT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(-evt)?$/;

const parisFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Maintenant à Paris, au format des id de créneaux : « 2026-11-28T14:05 ». */
const parisNow = (t = Date.now()) => parisFmt.format(new Date(t)).replace(' ', 'T');
const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex');
const bytes = (s) => (typeof s === 'string' && /^[\w-]+={0,2}$/.test(s) ? Buffer.from(s, 'base64url').length : 0);
const NONE = { every: false, formats: [], slots: [] };
const wants = (row, slot) => !!row && (row.every_live || row.formats?.includes(slot.format) || row.slots?.includes(slot.id));
const prefsOf = (row) => ({ every: !!row.every_live, formats: row.formats ?? [], slots: row.slots ?? [] });
const columnsOf = (p) => ({ every_live: p.every, formats: p.formats, slots: p.slots, updated_at: new Date().toISOString() });
const isEmpty = (p) => !p.every && !p.formats.length && !p.slots.length;

export function createPush({ formats = [], store = defaultStore, env = process.env } = {}) {
  const publicKey = (env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY || '').trim();
  // Contact exigé par les services de notification (VAPID) : l'adresse du site suffit
  const subject = (env.VAPID_SUBJECT || env.RENDER_EXTERNAL_URL || '').trim().replace(/^http:\/\/.*/, '') || 'https://lorebound-quiz.onrender.com';
  const testOrigin = env.PUSH_TEST_ORIGIN || null; // tests seulement : faux service de notification local
  let enabled = !!(publicKey && privateKey);
  if (enabled) {
    try {
      getVapidHeaders('https://fcm.googleapis.com', subject, publicKey, privateKey, 'aes128gcm');
    } catch (err) {
      console.error('[notifications] clés VAPID refusées, notifications désactivées :', err.message);
      enabled = false;
    }
  }
  const sent = new Set();

  function cleanSubscription(s) {
    let url = null;
    try { url = new URL(s?.endpoint); } catch {}
    const allowed = url && s.endpoint.length <= 1000
      && ((url.protocol === 'https:' && !url.port && !url.username && PUSH_HOSTS.test(url.hostname)) || (testOrigin && url.origin === testOrigin));
    const { p256dh, auth } = s?.keys ?? {};
    if (!allowed || bytes(p256dh) !== 65 || bytes(auth) !== 16) throw new Error('Abonnement aux notifications non reconnu');
    return { endpoint: s.endpoint, p256dh, auth };
  }

  /** Choix envoyés par le navigateur : valeurs connues seulement, directs précis pas encore partis. */
  function cleanPrefs(p) {
    const list = (v) => (Array.isArray(v) ? [...new Set(v)] : []);
    const nowId = parisNow();
    return {
      every: p?.every === true,
      formats: list(p?.formats).filter((f) => formats.includes(f)),
      slots: list(p?.slots).filter((id) => typeof id === 'string' && SLOT_ID.test(id) && id.slice(0, 16) >= nowId).slice(-MAX_SLOTS),
    };
  }

  /** Une erreur de base de données ne remonte pas telle quelle au joueur. */
  async function db(fn) {
    try {
      return await fn();
    } catch (err) {
      console.error('[notifications]', err.message);
      throw new Error('Notifications indisponibles pour le moment, réessaie plus tard');
    }
  }

  async function deliver(row, payload, ttl) {
    const req = generateRequestDetails(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      payload,
      { TTL: ttl, urgency: 'high', contentEncoding: 'aes128gcm', vapidDetails: { subject, publicKey, privateKey } },
    );
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== 'content-length').map(([k, v]) => [k, String(v)]));
    const res = await fetch(req.endpoint, { method: 'POST', headers, body: req.body, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    await res.arrayBuffer().catch(() => {});
    return res.status;
  }

  return {
    enabled,
    publicKey: enabled ? publicKey : null,

    /**
     * Mes choix et l'état de cet appareil. user : compte connecté, ou null (invité).
     * prefs : les choix (du compte, ou de l'appareil), null si rien d'enregistré ;
     * here : cet appareil est inscrit pour cette personne. subscription facultatif.
     */
    async get(user, subscription) {
      if (!enabled) return { prefs: null, here: false };
      const id = subscription ? idOf(cleanSubscription(subscription).endpoint) : null;
      return db(async () => {
        const row = id ? await store.get(TABLE, id) : null;
        const here = !!row && (row.user_id ?? null) === (user?.id ?? null);
        const saved = user ? await store.get(ACCOUNTS, user.id) : here ? row : null;
        return { prefs: saved ? cleanPrefs(prefsOf(saved)) : null, here };
      });
    },

    /**
     * Enregistre les choix. Avec un compte : sur le compte, et l'appareil donné (facultatif) y est rattaché.
     * En invité : sur l'appareil ; plus rien de coché, sa ligne est effacée.
     */
    async save(user, subscription, prefs, previous) {
      if (!enabled) throw new Error('Notifications indisponibles pour le moment');
      const sub = subscription || !user ? cleanSubscription(subscription) : null;
      const p = cleanPrefs(prefs);
      const id = sub ? idOf(sub.endpoint) : null;
      await db(async () => {
        // L'adresse de l'appareil a changé : l'ancienne ligne ne sert plus
        if (sub && typeof previous === 'string' && previous && previous !== sub.endpoint) await store.remove(TABLE, idOf(previous));
        if (user) {
          await store.upsert(ACCOUNTS, { id: user.id, ...columnsOf(p) });
          // Rattaché au compte : la ligne reste même sans rien de coché, les choix peuvent revenir d'un autre appareil
          if (sub) await store.upsert(TABLE, { id, ...sub, user_id: user.id, ...columnsOf(NONE) });
        } else if (isEmpty(p)) await store.remove(TABLE, id);
        else await store.upsert(TABLE, { id, ...sub, user_id: null, ...columnsOf(p) });
      });
      return { prefs: p, here: !!sub && (!!user || !isEmpty(p)) };
    },

    /** « Désactiver sur cet appareil » : il ne reçoit plus rien. */
    async off(subscription) {
      if (!enabled) return;
      const { endpoint } = cleanSubscription(subscription);
      await db(() => store.remove(TABLE, idOf(endpoint)));
    },

    /**
     * Salle d'attente ouverte : prévient les appareils abonnés à ce direct, une seule fois.
     * Rappelé chaque seconde par Live.plan jusqu'au départ : les répétitions sont ignorées.
     */
    async notify(slot) {
      if (!enabled || sent.has(slot.id) || Date.now() >= slot.startsAt) return;
      sent.add(slot.id);
      try {
        let done = [];
        try { done = JSON.parse(await store.getMeta(SENT_KEY)) || []; } catch (err) { if (!(err instanceof SyntaxError)) throw err; }
        if (done.includes(slot.id)) return;
        const accounts = new Map((await store.query(ACCOUNTS, { limit: MAX_ROWS })).map((a) => [a.id, a]));
        // Appareil d'un compte : les choix du compte ; appareil d'invité : les siens
        const rows = (await store.query(TABLE, { limit: MAX_ROWS })).filter((r) => wants(r.user_id ? accounts.get(r.user_id) : r, slot));
        // Marqué avant l'envoi : mieux vaut une notification perdue qu'une envoyée deux fois
        await store.setMeta(SENT_KEY, JSON.stringify([...done, slot.id].slice(-30)));
        if (!rows.length) return;
        const minutes = Math.max(1, Math.round((slot.startsAt - Date.now()) / 60_000));
        const payload = JSON.stringify({
          title: `${slot.name} : départ à ${slot.time.slice(0, 5).replace(':', ' h ')}`,
          body: `La salle d’attente est ouverte, ça part dans ${minutes} min.`,
          slot: slot.id,
        });
        const ttl = Math.max(30, Math.ceil((slot.startsAt - Date.now()) / 1000)); // après le départ, inutile de la livrer
        let ok = 0, gone = 0;
        const served = new Set(); // comptes prévenus sur au moins un appareil
        for (let i = 0; i < rows.length; i += BATCH) {
          await Promise.all(rows.slice(i, i + BATCH).map(async (row) => {
            try {
              const status = await deliver(row, payload, ttl);
              if (status === 404 || status === 410) { gone++; await store.remove(TABLE, row.id); return; }
              if (status >= 300) return console.error(`[notifications] refus ${status} (${new URL(row.endpoint).hostname})`);
              ok++;
              if (row.user_id) return served.add(row.user_id);
              if (!row.slots?.includes(slot.id)) return;
              // Rappel ponctuel servi : on l'oublie, et la ligne avec s'il ne reste rien
              const slots = row.slots.filter((x) => x !== slot.id);
              if (!row.every_live && !row.formats?.length && !slots.length) await store.remove(TABLE, row.id);
              else await store.update(TABLE, row.id, { slots });
            } catch (err) {
              console.error('[notifications] envoi :', err.message);
            }
          }));
        }
        for (const id of served) { // rappel ponctuel d'un compte : oublié une fois ses appareils prévenus
          const { slots } = accounts.get(id);
          if (slots?.includes(slot.id)) await store.update(ACCOUNTS, id, { slots: slots.filter((x) => x !== slot.id) });
        }
        console.log(`[notifications] ${slot.id} : ${ok}/${rows.length} envoyée(s)${gone ? `, ${gone} abonnement(s) expiré(s)` : ''}`);
      } catch (err) {
        console.error('[notifications]', err.message);
        setTimeout(() => sent.delete(slot.id), RETRY_MS).unref(); // base injoignable : on réessaie avant le départ
      }
    },
  };
}
