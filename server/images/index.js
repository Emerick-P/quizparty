/**
 * Bibliothèque de jaquettes : fait le lien entre la liste de jeux, un fournisseur d'images
 * interchangeable (IGDB aujourd'hui) et un cache disque.
 *
 * - Les images sont téléchargées une fois, gardées dans .cache/images/ et servies par notre
 *   serveur sous un identifiant opaque (/img/<id>) : rapide, et l'URL ne trahit pas le jeu.
 * - Chaque image garde sa source et sa mention (fournisseur, page du jeu, éditeur).
 * - Liste noire (data/blacklist.json) : un jeu ou une image retiré n'est plus jamais proposé
 *   ni servi.
 * - Sans identifiants, les jaquettes déjà en cache restent utilisables.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_GAMES } from '../data/cover-games.js';
import { createIgdbProvider, igdbConfig } from './igdb.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const RETRY_MISSING_AFTER_MS = 24 * 3600 * 1000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export class CoverLibrary {
  constructor({ games = COVER_GAMES, provider = null, cacheDir, blacklistFile } = {}) {
    this.games = games;
    this.provider = provider;
    this.cacheDir = cacheDir;
    this.indexFile = path.join(cacheDir, 'covers.json');
    this.blacklistFile = blacklistFile;
    this.index = {}; // `${provider}:${slug}` → { status, ref, name, year, imageId, file, id, pageUrl, publisher, error, checkedAt }
    this.byId = new Map(); // id opaque → entrée
    this.blacklist = { games: [], images: [] };
    this.state = 'idle'; // idle | loading | ready | error
    this.error = null;
    this.providerId = provider?.id ?? 'igdb';
  }

  key(slug) {
    return `${this.providerId}:${slug}`;
  }

  load() {
    this.index = readJson(this.indexFile, {});
    this.blacklist = { games: [], images: [], ...readJson(this.blacklistFile, {}) };
    this.reindex();
  }

  reindex() {
    this.byId.clear();
    for (const e of Object.values(this.index)) if (e.status === 'ready') this.byId.set(e.id, e);
  }

  isBanned(slug, e) {
    return this.blacklist.games.includes(slug) || (e?.imageId && this.blacklist.images.includes(`${this.providerId}:${e.imageId}`));
  }

  /** Charge le cache puis complète les jaquettes manquantes (sans bloquer le démarrage). */
  async init() {
    this.load();
    if (!this.provider) {
      this.state = this.ready().length ? 'ready' : 'error';
      this.error = 'Identifiants IGDB absents : ajoute TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET (voir .env.example)';
      return;
    }
    this.state = 'loading';
    try {
      const now = Date.now();
      const todo = this.games.filter((g) => {
        const e = this.index[this.key(g.slug)];
        if (!e) return true;
        if (e.status === 'ready') return !fs.existsSync(path.join(this.cacheDir, e.file));
        return now - (e.checkedAt ?? 0) > RETRY_MISSING_AFTER_MS;
      });
      if (todo.length) {
        const found = await this.provider.resolve(todo);
        for (const g of todo) {
          const r = found.get(g.slug) ?? { error: 'introuvable' };
          const k = this.key(g.slug);
          if (r.error || !r.imageId) {
            this.index[k] = { status: 'missing', error: r.error || 'pas de jaquette', checkedAt: now };
            continue;
          }
          this.index[k] = { status: 'pending', slug: g.slug, ...r, checkedAt: now };
        }
        await this.downloadPending();
        writeJson(this.indexFile, this.index);
      }
      this.reindex();
      this.state = 'ready';
      this.error = null;
    } catch (err) {
      this.reindex();
      this.state = this.ready().length ? 'ready' : 'error';
      this.error = `IGDB : ${err.message}`;
    }
    const missing = this.games.filter((g) => this.index[this.key(g.slug)]?.status !== 'ready');
    console.log(`[jaquettes] ${this.ready().length}/${this.games.length} prêtes${missing.length ? ` · manquantes : ${missing.map((g) => g.slug).join(', ')}` : ''}${this.error ? ` · ${this.error}` : ''}`);
  }

  async downloadPending() {
    const pending = Object.values(this.index).filter((e) => e.status === 'pending');
    const dir = path.join(this.cacheDir, this.providerId);
    fs.mkdirSync(dir, { recursive: true });
    const worker = async () => {
      for (let e = pending.shift(); e; e = pending.shift()) {
        try {
          const res = await fetch(this.provider.imageUrl(e.imageId));
          const type = (res.headers.get('content-type') || '').split(';')[0];
          if (!res.ok || !EXT[type]) throw new Error(`image HTTP ${res.status} ${type}`);
          const file = path.join(this.providerId, `${e.imageId}${EXT[type]}`);
          fs.writeFileSync(path.join(this.cacheDir, file), Buffer.from(await res.arrayBuffer()));
          Object.assign(e, { status: 'ready', file, id: e.id || crypto.randomBytes(9).toString('base64url') });
        } catch (err) {
          Object.assign(e, { status: 'missing', error: err.message });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  /** Jeux jouables : jaquette en cache et pas sur liste noire. */
  ready() {
    return this.games
      .map((g) => ({ game: g, entry: this.index[this.key(g.slug)] }))
      .filter(({ game, entry }) => entry?.status === 'ready' && !this.isBanned(game.slug, entry));
  }

  /** Ce que le client a besoin de savoir sur une image : URL opaque + mentions. */
  publicImage(entry) {
    return {
      url: `/img/${entry.id}`,
      source: this.provider?.name ?? 'IGDB',
      sourceUrl: this.provider?.homepage ?? 'https://www.igdb.com',
      pageUrl: entry.pageUrl,
      publisher: entry.publisher ?? null,
    };
  }

  /** Fichier à servir pour /img/:id, ou null (inconnu ou retiré). */
  file(id) {
    const e = this.byId.get(id);
    if (!e) return null;
    if (this.isBanned(e.slug, e)) return null;
    return { path: path.join(this.cacheDir, e.file), type: MIME[path.extname(e.file)] || 'application/octet-stream' };
  }

  /** Retire un jeu de la rotation (et ne sert plus son image). Écrit dans data/blacklist.json. */
  ban(slug) {
    this.blacklist = { games: [], images: [], ...readJson(this.blacklistFile, {}) };
    if (!this.blacklist.games.includes(slug)) this.blacklist.games.push(slug);
    writeJson(this.blacklistFile, this.blacklist);
  }

  status() {
    return { state: this.state, ready: this.ready().length, total: this.games.length, error: this.error };
  }
}

/** Bibliothèque partagée par le serveur. */
export const covers = new CoverLibrary({
  provider: igdbConfig() ? createIgdbProvider(igdbConfig()) : null,
  cacheDir: process.env.IMAGE_CACHE_DIR || path.join(ROOT, '.cache', 'images'),
  blacklistFile: process.env.BLACKLIST_FILE || path.join(ROOT, 'data', 'blacklist.json'),
});
