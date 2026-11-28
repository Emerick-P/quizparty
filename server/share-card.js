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

// Couleurs de l'habillage (public/plateau.css, thème Obscur) et des cases du résultat (public/salon.css)
const C = {
  bg: '#141517', card: '#1f2124', deep: '#17181b', line: '#33363c', text: '#f1f1ee', muted: '#9a9da4', off: '#4a4e56',
  lime: '#d6f45b', ink: '#14160b', fast: '#4cc38a', slow: '#ffbe2e', miss: '#ff6a47',
  keys: ['#ff6a47', '#4f8cff', '#ffbe2e', '#a46bff'],
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
function text(str, x, y, size, { style = 'bold', fill = C.text, anchor = 'start', max } = {}) {
  const list = glyphs(str, style);
  let s = size;
  const w = measure(list, style, s);
  if (max && w > max) s *= max / w;
  const width = measure(list, style, s);
  let at = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  let d = '';
  for (const g of list) {
    if (g) d += g.glyph.getPath(at, y, s).toPathData(1);
    at += advance(g, style, s);
  }
  return `<path d="${d}" fill="${fill}"/>`;
}
function logo(x, y, size, anchor = 'start') {
  const w = LOGO.map((part) => measure(glyphs(part, 'bold'), 'bold', size));
  const from = anchor === 'middle' ? x - (w[0] + w[1]) / 2 : x;
  return text(LOGO[0], from, y, size) + (LOGO[1] ? text(LOGO[1], from + w[0], y, size, { fill: C.lime }) : '');
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
const left = (title, lines) => logo(72, 105, 52)
  + title.map((t, i) => text(t, 68, 265 + i * 98, 90, { max: 520 })).join('')
  + lines.map((t, i) => text(t, 72, 480 + i * 54, 36, { style: 'semi', fill: C.muted, max: 520 })).join('');
const RIGHT = { x: 640, y: 70, w: 490, h: 490 };

/** Invitation : cartouche citron avec un code (salon, défi entre potes) ou un numéro (Défi du jour). */
export function inviteCard({ title, lines, label, value, code = true }) {
  const { x, y, w, h } = RIGHT;
  return svg(1200, 630, left(title, lines) + cartridge(x, y, w, h, { lime: true })
    + text(label, x + w / 2, y + 230, 44, { style: 'semi', fill: C.ink, anchor: 'middle', max: w - 80 })
    + text(value, x + w / 2, y + 370, 130, { style: code ? 'mono' : 'bold', fill: C.ink, anchor: 'middle', max: w - 80 }));
}
/** Accueil : les quatre touches de réponse dans la cartouche. */
export function homeCard({ title, lines }) {
  const { x, y, w, h } = RIGHT;
  const s = 150;
  const keys = C.keys.map((color, i) => {
    const kx = x + w / 2 - s - 12 + (i % 2) * (s + 24), ky = y + 135 + Math.floor(i / 2) * (s + 24);
    return `<rect x="${kx}" y="${ky}" width="${s}" height="${s}" rx="26" fill="${color}"/>` + text('ABCD'[i], kx + s / 2, ky + s / 2 + 30, 84, { style: 'mono', fill: C.ink, anchor: 'middle' });
  }).join('');
  return svg(1200, 630, left(title, lines) + cartridge(x, y, w, h) + keys);
}
/** Résultat partagé : score et cases dans la cartouche. */
export function scoreCard({ title, lines, score, cells, modes }) {
  const { x, y, w, h } = RIGHT;
  return svg(1200, 630, left(title, lines) + cartridge(x, y, w, h)
    + text(fmt(score), x + w / 2, y + 230, 130, { style: 'mono', fill: C.lime, anchor: 'middle', max: w - 70 })
    + text(score > 1 ? 'points' : 'point', x + w / 2, y + 288, 36, { style: 'semi', fill: C.muted, anchor: 'middle' })
    + cellGrid(cells, modes, x + w / 2, y + 312, w - 90, 150));
}

// ---------------------------------------------------------------- image de score en story (1080 × 1920)
// Les 250 px du haut et du bas restent sans information utile : les applis y posent leurs boutons.
export function storyCard({ heading, score, correct, rounds, cells, modes, site }) {
  return svg(1080, 1920, logo(540, 285, 96, 'middle')
    + cartridge(70, 370, 940, 1120, { cut: 140, r: 40 })
    + text(heading, 150, 600, 58, { style: 'semi', fill: C.muted, max: 780 })
    + text(fmt(score), 140, 830, 220, { style: 'mono', fill: C.lime, max: 800 })
    + text(`${score > 1 ? 'points' : 'point'}, ${correct} trouvée${correct > 1 ? 's' : ''} sur ${rounds}`, 150, 930, 56, { style: 'semi', fill: C.muted, max: 780 })
    + cellGrid(cells, modes, 540, 990, 790, 440)
    + `<rect x="100" y="1535" width="880" height="170" rx="36" fill="${C.lime}"/>`
    + text('Fais mieux que moi', 540, 1643, 68, { fill: C.ink, anchor: 'middle' })
    + text(site, 540, 1790, 40, { style: 'mono', fill: C.muted, anchor: 'middle', max: 880 }));
}

let sharp = null;
export async function toPng(source) {
  sharp ??= (await import('sharp')).default;
  return sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toBuffer();
}
