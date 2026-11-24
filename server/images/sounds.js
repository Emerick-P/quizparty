/**
 * Sons du mode « Quel jeu fait ce bruit ? ».
 *
 * Les fichiers vivent dans data/sounds/ (MP3 courts, 7 s au plus, volume harmonisé, sans métadonnées),
 * décrits par data/sounds/sounds.json :
 *
 *   { "sounds": [ {
 *       "id": "mario-coin",                identifiant stable (clé de la liste noire)
 *       "slug": "super-mario-bros",        jeu de server/data/cover-games.js (titre, alias, année)…
 *       "title": "…", "year": 1991, "aliases": [],   …ou décrit ici s'il n'est pas dans la liste
 *       "series": true,                    la réponse est la série elle-même (affichée « Série … »)
 *       "seriesWide": true,                son repris dans toute la série : le nom de la série est accepté
 *       "also": ["…"],                     autres titres acceptés (ex. le Korok de BOTW, aussi dans TOTK)
 *       "what": "La pièce…",               explication affichée à la correction
 *       "file": "….mp3",                   nom aléatoire : l'URL ne trahit pas le jeu
 *       "source": { "site", "name", "url", "original" },   d'où vient le son (pour le retirer ou le vérifier)
 *       "credit": "…",                     mention affichée à la correction
 *       "platform": "console"              optionnel : son d'une console, d'une boutique (« store ») ou d'une marque (« brand ») et non
 *                                          d'un jeu ; les fausses propositions sont alors d'autres plateformes
 *   } ] }
 *
 * Servis sous /sfx/<fichier>. Liste noire : data/blacklist.json, clé "sounds" (identifiants) ou "games" (slugs).
 * Le fichier est relu s'il change : on peut ajouter ou retirer des sons sans relancer le serveur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_GAMES } from '../data/cover-games.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE_RE = /^[A-Za-z0-9_-]{6,64}\.mp3$/;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export class SoundLibrary {
  constructor({ dir, blacklistFile, games = COVER_GAMES } = {}) {
    this.dir = dir;
    this.blacklistFile = blacklistFile;
    this.bySlug = new Map(games.map((g) => [g.slug, g]));
    this.items = [];
    this.byFile = new Map();
    this.mtime = -1;
    this.problems = [];
  }

  load() {
    const file = path.join(this.dir, 'sounds.json');
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      /* pas encore de sons */
    }
    if (mtime === this.mtime) return;
    this.mtime = mtime;
    this.problems = [];
    this.items = [];
    this.byFile.clear();
    for (const s of readJson(file, { sounds: [] }).sounds ?? []) {
      const known = s.slug ? this.bySlug.get(s.slug) : null;
      const game = known
        ? { ...known }
        : s.title
          ? { slug: s.slug ?? `x:${s.title}`, title: s.title, year: s.year ?? null, aliases: s.aliases ?? [], base: s.base ?? null }
          : null;
      if (!game || !FILE_RE.test(s.file ?? '') || !fs.existsSync(path.join(this.dir, s.file))) {
        this.problems.push(`${s.id ?? '?'} : jeu ou fichier manquant`);
        continue;
      }
      const item = {
        id: s.id,
        game,
        series: !!s.series,
        seriesWide: !!s.seriesWide,
        also: s.also ?? [],
        what: s.what ?? '',
        file: s.file,
        credit: s.credit || 'Son extrait du jeu (© éditeur)',
        source: s.source ?? null,
        platform: s.platform ?? null,
      };
      this.items.push(item);
      this.byFile.set(s.file, item);
    }
    if (this.problems.length) console.warn(`[sons] ${this.problems.join(' · ')}`);
  }

  blacklist() {
    return { games: [], sounds: [], ...readJson(this.blacklistFile, {}) };
  }

  allowed(s, bl = this.blacklist()) {
    return !bl.sounds.includes(s.id) && !bl.games.includes(s.game.slug);
  }

  /** Sons jouables (hors liste noire). */
  ready() {
    this.load();
    const bl = this.blacklist();
    return this.items.filter((s) => this.allowed(s, bl));
  }

  /** Tous les jeux des sons (pour les fausses propositions), sans les consoles et boutiques. */
  games() {
    this.load();
    return this.items.filter((s) => !s.platform).map((s) => s.game);
  }

  publicSound(s) {
    return { url: `/sfx/${s.file}` };
  }

  /** Chemin du fichier à servir pour /sfx/:file, ou null (inconnu ou retiré). */
  file(name) {
    this.load();
    const s = FILE_RE.test(name) ? this.byFile.get(name) : null;
    return s && this.allowed(s) ? path.join(this.dir, name) : null;
  }

  /** Retire un son (pas le jeu : il reste jouable dans les autres modes). */
  ban(id) {
    const bl = this.blacklist();
    if (!bl.sounds.includes(id)) bl.sounds.push(id);
    fs.mkdirSync(path.dirname(this.blacklistFile), { recursive: true });
    const tmp = `${this.blacklistFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bl, null, 2) + '\n');
    fs.renameSync(tmp, this.blacklistFile);
  }
}

export const sounds = new SoundLibrary({
  dir: process.env.SOUNDS_DIR || path.join(ROOT, 'data', 'sounds'),
  blacklistFile: process.env.BLACKLIST_FILE || path.join(ROOT, 'data', 'blacklist.json'),
});
