/**
 * Captures d'écran des modes « HUD » et « Écran de chargement ».
 *
 * Les images retouchées vivent dans data/screens/ (WebP), décrites par data/screens/screens.json :
 *
 *   { "screens": [ {
 *       "id": "hud-hollow-knight-1",       identifiant stable (clé de la liste noire)
 *       "type": "hud" | "loading",
 *       "slug": "hollow-knight",           jeu de server/data/cover-games.js (titre, alias, année)…
 *       "title": "…", "year": 2017, "aliases": [], "base": "…",   …ou décrit ici s'il n'est pas dans la liste
 *                                          (base : titre du jeu de base si c'est une édition ou une extension)
 *       "from": "basehud/Hollow Knight.png",          capture d'origine (pour mémoire)
 *       "credit": "Capture personnelle",
 *       "files": { "easy": "….webp", "full": "….webp" },
 *       "edits": { … }                     retouches appliquées (zones du HUD gardées, zones masquées)
 *   } ] }
 *
 * - easy : l'image posée en question. HUD : seule l'interface reste, le décor est masqué, ainsi que
 *          les noms et portraits des personnages. Chargement : titre et logo masqués.
 * - full : la capture d'origine (données perso masquées), montrée à la correction.
 * Les noms de fichiers sont aléatoires et servis sous /shot/<fichier> : l'URL ne trahit pas le jeu.
 * Liste noire : data/blacklist.json, clé "screens" (identifiants) ou "games" (slugs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_GAMES } from '../data/cover-games.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE_RE = /^[A-Za-z0-9_-]{6,64}\.webp$/;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const SCREEN_TYPES = {
  hud: { name: 'HUD', dir: 'basehud' },
  loading: { name: 'Écran de chargement', dir: 'baseloading' },
};

export class ScreenLibrary {
  constructor({ dir, blacklistFile, games = COVER_GAMES } = {}) {
    this.dir = dir;
    this.blacklistFile = blacklistFile;
    this.bySlug = new Map(games.map((g) => [g.slug, g]));
    this.items = [];
    this.files = new Set();
    this.mtime = -1;
    this.problems = [];
  }

  /** Relit screens.json s'il a changé : on peut ajouter des images sans relancer le serveur. */
  load() {
    const file = path.join(this.dir, 'screens.json');
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      /* pas encore d'images */
    }
    if (mtime === this.mtime) return;
    this.mtime = mtime;
    this.problems = [];
    const raw = readJson(file, { screens: [] }).screens ?? [];
    this.items = [];
    this.files.clear();
    for (const s of raw) {
      const known = s.slug ? this.bySlug.get(s.slug) : null;
      const game = known ?? (s.title ? { slug: s.slug ?? `x:${s.title}`, title: s.title, year: s.year ?? null, aliases: s.aliases ?? [], base: s.base ?? null } : null);
      if (!game || !SCREEN_TYPES[s.type] || !s.files?.easy) {
        this.problems.push(`${s.id ?? '?'} : jeu, type ou image manquant`);
        continue;
      }
      const files = Object.fromEntries(Object.entries(s.files).filter(([, f]) => FILE_RE.test(f) && fs.existsSync(path.join(this.dir, f))));
      if (!files.easy) {
        this.problems.push(`${s.id} : fichier ${s.files.easy} introuvable`);
        continue;
      }
      // Alias propres à la capture (ex. titre officiel français) en plus de ceux de la liste
      const aliases = [...new Set([...(game.aliases ?? []), ...(known ? s.aliases ?? [] : [])])];
      this.items.push({ id: s.id, type: s.type, game: { ...game, aliases }, credit: s.credit || 'Capture personnelle', files });
      for (const f of Object.values(files)) this.files.add(f);
    }
    if (this.problems.length) console.warn(`[captures] ${this.problems.join(' · ')}`);
  }

  blacklist() {
    return { games: [], screens: [], ...readJson(this.blacklistFile, {}) };
  }

  /** Captures jouables d'un type. */
  ready(type) {
    this.load();
    const bl = this.blacklist();
    return this.items.filter(
      (s) => s.type === type && !bl.screens.includes(s.id) && !bl.games.includes(s.game.slug),
    );
  }

  /** Tous les jeux connus des captures (pour les fausses propositions). */
  games() {
    this.load();
    return this.items.map((s) => s.game);
  }

  publicImage(s, variant) {
    return { url: `/shot/${s.files[variant] ?? s.files.easy}`, source: s.credit };
  }

  /** Chemin du fichier à servir pour /shot/:file, ou null (inconnu ou retiré). */
  file(name) {
    this.load();
    if (!FILE_RE.test(name) || !this.files.has(name)) return null;
    const bl = this.blacklist();
    const s = this.items.find((x) => Object.values(x.files).includes(name));
    if (!s || bl.screens.includes(s.id) || bl.games.includes(s.game.slug)) return null;
    return path.join(this.dir, name);
  }

  /** Retire une capture (pas le jeu : il reste jouable en Jaquette et Pitch). */
  ban(id) {
    const bl = this.blacklist();
    if (!bl.screens.includes(id)) bl.screens.push(id);
    fs.mkdirSync(path.dirname(this.blacklistFile), { recursive: true });
    const tmp = `${this.blacklistFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bl, null, 2) + '\n');
    fs.renameSync(tmp, this.blacklistFile);
  }
}

export const screens = new ScreenLibrary({
  dir: process.env.SCREENS_DIR || path.join(ROOT, 'data', 'screens'),
  blacklistFile: process.env.BLACKLIST_FILE || path.join(ROOT, 'data', 'blacklist.json'),
});
