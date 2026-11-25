import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Stockage des soumissions des amis et des signalements ⚑ de l'hôte.
 *
 * - En ligne : Supabase (base Postgres + Storage), via son API REST, sans dépendance npm.
 *   SUPABASE_URL et SUPABASE_SECRET_KEY dans les variables d'environnement (jamais dans le code).
 *   La clé secrète reste sur le serveur : le navigateur des joueurs ne parle jamais à Supabase.
 * - Sans ces variables (PC, tests) : fichiers locaux dans data/submissions/ (non suivis par git).
 *
 * Tables et bucket : voir supabase/schema.sql.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'submissions';

function supabaseBackend(url, key) {
  // Tolère une URL copiée avec /rest/v1 à la fin (« Data API » de Supabase)
  const base = url.trim().replace(/\/+$/, '').replace(/\/(rest|storage)\/v1$/, '');
  // Nouvelles clés (sb_secret_…) : en-tête apikey seul. Anciennes clés JWT (service_role) : apikey + Bearer.
  const auth = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
  async function call(method, p, { body, headers = {}, raw = false } = {}) {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { ...auth, ...(raw ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body == null ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${p.split('?')[0]} : ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    name: 'supabase',
    async insert(table, row) {
      const out = await call('POST', `/rest/v1/${table}`, { body: row, headers: { Prefer: 'return=representation' } });
      return out?.[0] ?? row;
    },
    async list(table, { status, limit = 200 } = {}) {
      const q = new URLSearchParams({ select: '*', order: 'created_at.desc', limit: String(limit) });
      if (status) q.set('status', `eq.${status}`);
      return call('GET', `/rest/v1/${table}?${q}`);
    },
    /** Insère plusieurs lignes d'un coup (sans les relire). */
    async insertMany(table, rows) {
      if (rows.length) await call('POST', `/rest/v1/${table}`, { body: rows });
    },
    /** Appelle une fonction SQL (ex. player_stats). */
    async rpc(fn, args) {
      return call('POST', `/rest/v1/rpc/${fn}`, { body: args });
    },
    /** Insère ou met à jour (clé primaire id). */
    async upsert(table, row) {
      await call('POST', `/rest/v1/${table}`, { body: row, headers: { Prefer: 'resolution=merge-duplicates' } });
    },
    async get(table, id) {
      const out = await call('GET', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`);
      return out?.[0] ?? null;
    },
    async remove(table, id) {
      await call('DELETE', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`);
    },
    async update(table, id, patch) {
      const out = await call('PATCH', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { body: patch, headers: { Prefer: 'return=representation' } });
      return out?.[0] ?? null;
    },
    async upload(name, buffer, type) {
      await call('POST', `/storage/v1/object/${BUCKET}/${name}`, { body: buffer, raw: true, headers: { 'Content-Type': type, 'x-upsert': 'false' } });
      return name;
    },
    async download(name) {
      const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${name}`, { headers: auth });
      if (!res.ok) throw new Error(`Supabase fichier ${name} : ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** Remplace tout le contenu d'une table (copie en lecture du contenu du jeu). */
    async replaceAll(table, rows) {
      await call('DELETE', `/rest/v1/${table}?id=not.is.null`);
      for (let i = 0; i < rows.length; i += 500) await call('POST', `/rest/v1/${table}`, { body: rows.slice(i, i + 500) });
    },
    async getMeta(key) {
      const out = await call('GET', `/rest/v1/meta?key=eq.${encodeURIComponent(key)}&select=value`);
      return out?.[0]?.value ?? null;
    },
    async setMeta(key, value) {
      await call('POST', '/rest/v1/meta', { body: { key, value, updated_at: new Date().toISOString() }, headers: { Prefer: 'resolution=merge-duplicates' } });
    },
    /** Garde le projet éveillé (un projet gratuit se met en pause après 7 jours sans activité). */
    async ping() {
      await call('GET', `/rest/v1/submissions?select=id&limit=1`);
    },
  };
}

function localBackend(dir) {
  const file = (table) => path.join(dir, `${table}.jsonl`);
  const read = (table) => {
    let text = '';
    try { text = fs.readFileSync(file(table), 'utf8'); } catch { return []; }
    return text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  };
  const write = (table, rows) => fs.writeFileSync(file(table), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  return {
    name: 'local',
    dir,
    async insert(table, row) {
      fs.mkdirSync(dir, { recursive: true });
      const full = { id: row.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
      fs.appendFileSync(file(table), JSON.stringify(full) + '\n');
      return full;
    },
    async insertMany(table, rows) {
      for (const row of rows) await this.insert(table, row);
    },
    /** Lignes d'une table qui vérifient un filtre (équivalent local des fonctions SQL). */
    async where(table, fn) {
      return read(table).filter(fn);
    },
    async list(table, { status, limit = 200 } = {}) {
      return read(table).filter((r) => !status || r.status === status).reverse().slice(0, limit);
    },
    async update(table, id, patch) {
      const rows = read(table);
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      write(table, rows);
      return row;
    },
    async upsert(table, row) {
      const rows = read(table).filter((r) => r.id !== row.id);
      fs.mkdirSync(dir, { recursive: true });
      write(table, [...rows, row]);
    },
    async get(table, id) {
      return read(table).find((r) => r.id === id) ?? null;
    },
    async remove(table, id) {
      write(table, read(table).filter((r) => r.id !== id));
    },
    async upload(name, buffer) {
      const p = path.join(dir, 'files', name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buffer, { flag: 'wx' });
      return name;
    },
    async download(name) {
      return fs.readFileSync(path.join(dir, 'files', name));
    },
    async replaceAll() {},
    async getMeta() { return null; },
    async setMeta() {},
    async ping() {},
  };
}

export function createStore(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) return supabaseBackend(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  return localBackend(env.SUBMISSIONS_DIR || path.join(ROOT, 'data', 'submissions'));
}

export const store = createStore();
