/**
 * Comparaison d'un titre tapé par un joueur avec les réponses acceptées.
 *
 * Volontairement stricte : le titre doit être complet et sans faute. On ignore seulement
 * - la casse, les accents et cédilles (« okami » = « Ōkami ») ;
 * - les apostrophes, la ponctuation et les espaces (« assassins creed » = « Assassin's Creed »,
 *   « pacman » = « Pac-Man ») ;
 * - « The », partout dans le titre (« Legend of Zelda Breath of Wild » = « The Legend of Zelda: Breath of the Wild »),
 *   et l'article français en tête (« Sims » = « Les Sims ») ;
 * - l'écriture des numéros et du « & » (« GTA 5 » = « GTA V », « Ratchet et Clank » = « Ratchet & Clank »).
 * Les éditions d'un même jeu acceptent aussi le titre de base (voir baseTitles), et les jeux de séries
 * iconiques leurs raccourcis usuels (« Zelda Breath of the Wild », « Isaac », « Skyrim » : voir shortTitles).
 * Pas de faute de frappe, pas de réponse partielle : « Monster Hunter » ou « Monster Hunter Wilds »
 * ne passent pas pour « Monster Hunter: World ». Les sigles (GTA, WoW…) sont acceptés seulement s'ils
 * sont listés comme alias du jeu dans server/data/cover-games.js.
 */

const LEADING_ARTICLES = new Set(['the', 'le', 'la', 'les', 'l']);
const AND = new Set(['and', 'et']);
// Chiffres romains = chiffres arabes, partout dans le titre (« Final Fantasy 7 Remake » = « Final Fantasy VII Remake »)
const ROMAN = Object.fromEntries(
  ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']
    .map((r, i) => [r, String(i + 1)])
    .filter(([r]) => r !== 'i'), // « I » seul reste une lettre (pronom anglais : « I Am Bread »)
);

function tokensOf(s, roman = true) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[œ]/g, 'oe')
    .replace(/['’`]/g, '') // assassin's → assassins
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => (AND.has(t) ? 'and' : roman ? ROMAN[t] ?? t : t));
}

export function normalize(s) {
  const tokens = tokensOf(s);
  if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) tokens.shift();
  const withoutThe = tokens.filter((t) => t !== 'the'); // « The » facultatif partout
  return (withoutThe.length ? withoutThe : tokens).join(' ');
}

/**
 * Clés de comparaison : sans espaces, avec et sans les articles. Les deux sont gardées pour qu'un
 * titre tapé tout attaché (« thewitcher3wildhunt ») passe aussi.
 */
const keys = (s) => {
  const all = tokensOf(s).join('');
  const short = normalize(s).replace(/ /g, '');
  // Titre tapé tout attaché avec un numéro romain (« darksoulsiii ») : le numéro n'est pas reconnu
  // seul, on garde donc aussi la forme sans conversion des chiffres romains
  const raw = tokensOf(s, false).join('');
  // Titre tapé tout attaché sans le « & » (« ratchetclankriftapart ») : forme sans le « and »
  const noAmp = tokensOf(String(s ?? '').replace(/&/g, ' ')).join('');
  return [...new Set([short, all, raw, noAmp])];
};

/** Vrai si `guess` est exactement l'une des réponses `accepted`, aux détails d'écriture près. */
export function matches(guess, accepted) {
  const g = keys(guess);
  if (!g[0]) return false;
  return accepted.some((a) => keys(a).some((k) => g.includes(k)));
}

/**
 * Mentions d'édition : retirées du titre, elles donnent le titre du jeu de base, accepté aussi
 * (« Mario Kart 8 Deluxe » → « Mario Kart 8 », « The Witcher 3: Wild Hunt – Game of the Year Edition »
 * → « The Witcher 3: Wild Hunt », « Final Fantasy VII Remake » → « Final Fantasy VII » : un remake n'a
 * pas besoin d'être précisé). Le titre complet reste accepté. « Reload », « Rebirth »… n'en font pas
 * partie, car ce sont parfois des jeux à part entière (Final Fantasy VII Rebirth est une suite). Pour une extension ou une édition au nom particulier
 * (The Binding of Isaac: Rebirth), indiquer le titre de base dans le champ `base` du jeu.
 */
const EDITION = new RegExp(
  '(?:\\s*[:\\-–—(]\\s*|\\s+)' +
    '(?:(?:the\\s+)?(?:definitive|complete|enhanced|ultimate|deluxe|special|anniversary|legendary|gold|goty|game of the year|director\'?s cut|digital deluxe|collector\'?s|royal edition)\\s+edition' +
    '|game of the year|goty|director\'?s cut|remastered|remaster|remake|hd remaster|hd|deluxe|royal|golden)\\s*\\)?\\s*$',
  'i',
);

export function baseTitles(title) {
  const out = [];
  let t = String(title ?? '');
  for (let i = 0; i < 3; i++) {
    const stripped = t.replace(EDITION, '').trim();
    if (!stripped || stripped === t) break;
    out.push(stripped);
    t = stripped;
  }
  return out;
}

/**
 * Raccourcis usuels des séries iconiques. Chaque règle remplace le début du titre ; `rest` exige qu'il
 * reste un sous-titre derrière (« Zelda » seul serait ambigu entre tous les Zelda).
 * Plus « Titre N : sous-titre » → « Titre N » (« The Witcher 3 », « Uncharted 2 »), sans ambiguïté
 * puisque le numéro distingue les épisodes. Le test anti-collision (test/cover-test.js) vérifie
 * qu'aucun raccourci ne désigne deux jeux différents de la banque.
 */
const SHORTCUTS = [
  { re: /^the legend of zelda\s*[:\-–]?\s*/i, to: 'Zelda ', rest: true },
  { re: /^the binding of isaac\b\s*/i, to: 'Isaac ' },
  { re: /^grand theft auto\s*[:\-–]?\s*/i, to: 'GTA ', rest: true },
  { re: /^final fantasy\s+/i, to: 'FF ', rest: true },
  { re: /^the elder scrolls\s+[ivx\d]+\s*:\s*/i, to: '', rest: true },
  { re: /^super smash bros\.?\s*/i, to: 'Smash ', rest: true },
  { re: /^super smash bros\.?\s*/i, to: 'Smash Bros ', rest: true },
  { re: /^metal gear solid\b\s*/i, to: 'MGS ' },
  { re: /^red dead redemption\b\s*/i, to: 'RDR ', rest: true },
  { re: /^marvel'?s\s+/i, to: '', rest: true }, // « Spider-Man »
  // Jeux connus par la première partie de leur titre seulement
  { re: /^(sekiro|jak (?:and|&) daxter)\s*:.*$/i, to: '$1' },
];
const NUMBERED_SUBTITLE = /^(.*?\S\s+(?:\d+|[ivx]+))\s*:\s*\S.*$/i;

export function shortTitles(title) {
  const t = String(title ?? '').trim();
  const out = [];
  for (const { re, to, rest } of SHORTCUTS) {
    if (!re.test(t)) continue;
    if (to.includes('$1')) {
      out.push(t.replace(re, to).trim());
      continue;
    }
    const tail = t.replace(re, '').trim();
    if (rest && !tail) continue;
    out.push(`${to}${tail}`.trim());
  }
  const m = t.match(NUMBERED_SUBTITLE);
  if (m) out.push(m[1]);
  // Les raccourcis se combinent (« The Witcher 3: Wild Hunt » → « Witcher 3 », « GTA IV: … » → « GTA IV »)
  return [...new Set([...out, ...out.flatMap((x) => (x.match(NUMBERED_SUBTITLE) ? [x.match(NUMBERED_SUBTITLE)[1]] : []))])];
}

/** Toutes les écritures acceptées pour un jeu, à partir de ses titres (titre, alias, base, nom IGDB). */
export function answersFor(titles) {
  const list = titles.filter(Boolean);
  const all = [...list, ...list.flatMap(baseTitles)];
  return [...new Set([...all, ...all.flatMap(shortTitles)])];
}
