/**
 * Dessin des images de partage « cartouche » : aperçu de lien (1200 × 630) et image de score en story
 * (1080 × 1920). Le SVG est construit ici puis converti en PNG par sharp.
 * Le texte est transformé en tracés (polices fournies par npm) : le rendu est le même sur le PC et sur Render,
 * qui n'a pas nos polices. Aucune image de jeu ni de tiers.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import { LOGO } from './brand.js';

const require = createRequire(import.meta.url);

// Couleurs de l'habillage (public/plateau.css, thème Obscur), du logo et des cases du résultat (public/salon.css)
const C = {
  bg: '#141517', card: '#1b1d20', deep: '#121315', line: '#33363c', text: '#f2f1ea', muted: '#9a9da4', off: '#4a4e56',
  lime: '#d6f45b', ink: '#14160b', outline: '#1b1030', fast: '#4cc38a', slow: '#ffbe2e', miss: '#ff6a47',
};

// Icônes au trait des modes : mêmes dessins que ICONS (public/js/core.js)
const MODE_ICONS = {
  quiz: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  vraifaux: '<path d="m16 16 3-8 3 8a4.5 4.5 0 0 1-6 0zM2 16l3-8 3 8a4.5 4.5 0 0 1-6 0zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  estimation: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  covers: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  pitch: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  emoji: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  sounds: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  bande: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  crossword: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
};

// ---------------------------------------------------------------- texte
const load = (file) => {
  const b = fs.readFileSync(require.resolve(`@fontsource/${file}`));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
let fonts = null;
/** Chaque style : la police latine, puis son complément (lettres d'Europe centrale dans les pseudos). */
function fontsOf() {
  fonts ??= {
    bold: ['latin', 'latin-ext'].map((s) => load(`space-grotesk/files/space-grotesk-${s}-700-normal.woff`)),
    semi: ['latin', 'latin-ext'].map((s) => load(`space-grotesk/files/space-grotesk-${s}-600-normal.woff`)),
    mono: ['latin', 'latin-ext'].map((s) => load(`jetbrains-mono/files/jetbrains-mono-${s}-700-normal.woff`)),
  };
  return fonts;
}
const SPACES = /[\s   ]/;
/** Découpe le texte en lettres dessinables ; un caractère sans dessin (emoji, autre alphabet) est retiré. */
function glyphs(text, style) {
  const list = fontsOf()[style];
  const out = [];
  for (const ch of String(text)) {
    if (SPACES.test(ch)) { out.push(null); continue; }
    const font = list.find((f) => f.charToGlyph(ch).index > 0);
    if (font) out.push({ font, glyph: font.charToGlyph(ch) });
  }
  return out;
}
export const drawable = (text) => glyphs(text, 'bold').some(Boolean);
// Espace plus étroit dans les nombres en chasse fixe (« 4 320 »)
const advance = (g, style, size) => (g ? (g.glyph.advanceWidth / g.font.unitsPerEm) * size : size * (style === 'mono' ? 0.3 : 0.26));
const measure = (list, style, size) => list.reduce((w, g) => w + advance(g, style, size), 0);
/** Texte en tracés. max : largeur à ne pas dépasser (la taille est réduite pour tenir). */
function text(str, x, y, size, { style = 'bold', fill = C.text, anchor = 'start', max, track = 0 } = {}) {
  const list = glyphs(str, style);
  let s = size;
  const widthAt = (at) => measure(list, style, at) + track * at * Math.max(0, list.length - 1);
  if (max && widthAt(s) > max) s *= max / widthAt(s);
  const width = widthAt(s);
  let at = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  let d = '';
  for (const g of list) {
    if (g) d += g.glyph.getPath(at, y, s).toPathData(1);
    at += advance(g, style, s) + track * s;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}
const TRACK = -0.02; // interlettrage du nom dans le logo
/** Le nom : premier morceau clair, second citron. */
function logo(x, y, size) {
  const first = glyphs(LOGO[0], 'bold');
  const w = measure(first, 'bold', size) + TRACK * size * first.length;
  return text(LOGO[0], x, y, size, { track: TRACK }) + text(LOGO[1], x + w, y, size, { fill: C.lime, track: TRACK });
}

// ---------------------------------------------------------------- mascotte
let mascotParts = null;
/** Le dessin livré (assets/mascotte.svg, 256 × 256), et le tracé de son corps pour le contour. */
function mascotSource() {
  if (!mascotParts) {
    const file = fs.readFileSync(new URL('./assets/mascotte.svg', import.meta.url), 'utf8');
    const inner = file.slice(file.indexOf('>') + 1, file.lastIndexOf('</svg>')).replace(/<(metadata|style)[\s\S]*?<\/\1>/g, '');
    const shape = /<clipPath[^>]*><path ([^>]*?)\/>/.exec(inner)?.[1];
    mascotParts = { inner, shape };
  }
  return mascotParts;
}
/**
 * La mascotte : corps entre x + 12 % et x + 88 % de size, bas à 87 %. Elle regarde vers la gauche : on la place
 * à droite de ce qu'elle lit. outline : fin contour sombre, quand elle chevauche un fond clair.
 */
function mascot(x, y, size, { outline = false } = {}) {
  const { inner, shape } = mascotSource();
  const edge = outline && shape ? `<path ${shape} fill="none" stroke="${C.outline}" stroke-width="7" stroke-linejoin="round"/>` : '';
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 256 256" overflow="visible">${edge}${inner}</svg>`;
}

// ---------------------------------------------------------------- pièces
/** La cartouche : coin haut droit coupé, crans de préhension en haut. */
function cartridge(x, y, w, h, { lime = false, cut = 70, r = 30 } = {}) {
  const d = `M${x + r} ${y}H${x + w - cut}L${x + w} ${y + cut}V${y + h - r}q0 ${r} ${-r} ${r}H${x + r}q${-r} 0 ${-r} ${-r}V${y + r}q0 ${-r} ${r} ${-r}z`;
  const pad = Math.round(w * 0.085);
  const bar = Math.round(w * 0.025);
  const ridges = Array.from({ length: Math.floor((w * 0.68) / (bar * 2)) }, (_, i) =>
    `<rect x="${x + pad + i * bar * 2}" y="${y + pad * 0.75}" width="${bar}" height="${Math.round(pad * 0.75)}"/>`).join('');
  return `<path d="${d}" fill="${lime ? C.lime : C.card}"${lime ? '' : ` stroke="${C.line}" stroke-width="3"`}/><g fill="${lime ? C.ink : C.line}">${ridges}</g>`;
}
const icon = (mode, x, y, size, color) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MODE_ICONS[mode] || MODE_ICONS.quiz}</svg>`;
/**
 * Une case « épreuve » : l'icône dit le type de question, la forme dit le résultat (lisible sans les couleurs) :
 * pleine = trouvé vite, contour = trouvé, barrée = raté.
 */
function cell(result, mode, x, y, s) {
  const r = Math.round(s * 0.17);
  const b = Math.max(4, Math.round(s * 0.06));
  const box = result === 'fast' ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}" fill="${C.fast}"/>`
    : result === 'slow' ? `<rect x="${x + b / 2}" y="${y + b / 2}" width="${s - b}" height="${s - b}" rx="${r - 2}" fill="none" stroke="${C.slow}" stroke-width="${b}"/>`
    : `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}" fill="${C.deep}"/>`;
  const color = result === 'fast' ? C.ink : result === 'slow' ? C.slow : C.off;
  const cross = result === 'miss' ? `<path d="M${x + s * 0.18} ${y + s * 0.82}L${x + s * 0.82} ${y + s * 0.18}" stroke="${C.miss}" stroke-width="${s * 0.08}" stroke-linecap="round"/>` : '';
  return box + icon(mode, x + s * 0.23, y + s * 0.23, s * 0.54, color) + cross;
}
/** Grille de cases centrée sur cx, à partir de y, dans une hauteur et une largeur données. */
function cellGrid(cells, modes, cx, y, width, height) {
  const n = cells.length;
  const cols = n <= 6 ? n : n <= 15 ? 5 : 7;
  const rows = Math.ceil(n / cols);
  const gapOf = (s) => Math.round(s * 0.15);
  const s = Math.floor(Math.min(width / (cols + (cols - 1) * 0.15), height / (rows + (rows - 1) * 0.15)));
  const gap = gapOf(s);
  const left = cx - (cols * s + (cols - 1) * gap) / 2;
  const top = y + (height - (rows * s + (rows - 1) * gap)) / 2;
  return cells.map((c, i) => cell(c, modes[i], Math.round(left + (i % cols) * (s + gap)), Math.round(top + Math.floor(i / cols) * (s + gap)), s)).join('');
}
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${C.bg}"/>${body}</svg>`;
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);

// ---------------------------------------------------------------- aperçus de liens (1200 × 630)
/** Colonne de gauche : logo, titre sur deux lignes, précisions. */
const left = (title, lines) => logo(72, 105, 54)
  + title.map((t, i) => text(t, 68, 265 + i * 98, 90, { max: 520 })).join('')
  + lines.map((t, i) => text(t, 72, 480 + i * 54, 36, { style: 'semi', fill: C.muted, max: 520 })).join('');
const RIGHT = { x: 640, y: 170, w: 490, h: 410 };
/** La mascotte perchée sur la cartouche, tournée vers le titre. */
const perched = (options) => mascot(RIGHT.x + 210, RIGHT.y - 167, 220, options);

/** Invitation : cartouche citron avec un code (salon, défi entre potes) ou un numéro (Défi du jour). */
export function inviteCard({ title, lines, label, value, code = true }) {
  const { x, y, w, h } = RIGHT;
  return svg(1200, 630, left(title, lines) + cartridge(x, y, w, h, { lime: true })
    + text(label, x + w / 2, y + 185, 44, { style: 'semi', fill: C.ink, anchor: 'middle', max: w - 80 })
    + text(value, x + w / 2, y + 325, 130, { style: code ? 'mono' : 'bold', fill: C.ink, anchor: 'middle', max: w - 80 })
    + perched({ outline: true }));
}
/** Accueil : le nom en grand et la mascotte qui le lit (la bannière du logo). */
export function homeCard({ lines }) {
  return svg(1200, 630, logo(72, 300, 128)
    + lines.map((t, i) => text(t, 76, 400 + i * 62, 46, { style: 'semi', fill: C.muted, max: 640 })).join('')
    + mascot(700, 60, 500));
}
/** Résultat partagé : score et cases dans la cartouche. */
export function scoreCard({ title, lines, score, cells, modes }) {
  const { x, y, w, h } = RIGHT;
  return svg(1200, 630, left(title, lines) + cartridge(x, y, w, h)
    + text(fmt(score), x + w / 2, y + 195, 124, { style: 'mono', fill: C.lime, anchor: 'middle', max: w - 70 })
    + text(score > 1 ? 'points' : 'point', x + w / 2, y + 245, 34, { style: 'semi', fill: C.muted, anchor: 'middle' })
    + cellGrid(cells, modes, x + w / 2, y + 262, w - 90, 130)
    + perched());
}

// ---------------------------------------------------------------- image de score en story (1080 × 1920)
// Les 250 px du haut et du bas restent sans information utile : les applis y posent leurs boutons.
export function storyCard({ heading, score, correct, rounds, cells, modes, site }) {
  return svg(1080, 1920, logo(80, 400, 116)
    + cartridge(70, 460, 940, 1035, { cut: 140, r: 40 })
    + mascot(690, 224, 320)
    + text(heading, 150, 685, 58, { style: 'semi', fill: C.muted, max: 780 })
    + text(fmt(score), 140, 910, 220, { style: 'mono', fill: C.lime, max: 800 })
    + text(`${score > 1 ? 'points' : 'point'}, ${correct} trouvée${correct > 1 ? 's' : ''} sur ${rounds}`, 150, 1008, 56, { style: 'semi', fill: C.muted, max: 780 })
    + cellGrid(cells, modes, 540, 1050, 790, 400)
    + `<rect x="100" y="1535" width="880" height="170" rx="36" fill="${C.lime}"/>`
    + text('Fais mieux que moi', 540, 1643, 68, { fill: C.ink, anchor: 'middle' })
    + text(site, 540, 1790, 40, { style: 'mono', fill: C.muted, anchor: 'middle', max: 880 }));
}

let sharp = null;
export async function toPng(source) {
  sharp ??= (await import('sharp')).default;
  return sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toBuffer();
}
