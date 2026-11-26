import crypto from 'node:crypto';
import qcm from './qcm.js';
import estimation from './estimation.js';
import cover from './cover.js';
import pitch from './pitch.js';
import typed from './typed.js';
import emoji from './emoji.js';
import sound from './sound.js';
import crossword, { makeGrid } from './crossword.js';
import { normalize, answersFor, baseTitles } from './fuzzy.js';
import { buildBande, bandeUnavailable } from './bande.js';
import { QCM, TRUE_FALSE, ESTIMATION } from '../data/questions.js';
import { PITCHES } from '../data/pitches.js';
import { EMOJI_PUZZLES } from '../data/emojis.js';
import { seriesOf } from '../data/series.js';
import { COVER_GAMES } from '../data/cover-games.js';
import { covers } from '../images/index.js';
import { sounds } from '../images/sounds.js';

/** Types de manche : la logique de validation / score / correction. */
export const KINDS = { qcm, estimation, cover, pitch, typed, emoji, sound, crossword };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Tire n questions d'une banque en évitant celles déjà posées dans le salon.
 * skip(q) : questions à écarter pour cette partie (le Mix s'en sert pour ne pas poser deux fois le même jeu).
 */
function pick(bank, prefix, n, used, keyOf = (_q, i) => i, skip = null) {
  const all = bank.map((q, i) => ({ q, key: `${prefix}${keyOf(q, i)}` })).filter((x) => !skip?.(x.q));
  let pool = all.filter((x) => !used.has(x.key));
  if (pool.length < n) {
    // Banque épuisée : on recommence à zéro pour cette catégorie
    for (const x of all) used.delete(x.key);
    pool = all;
  }
  const chosen = shuffle(pool).slice(0, n);
  chosen.forEach((x) => used.add(x.key));
  return chosen.map((x) => x.q);
}

// Fabrique des manches à partir des entrées de la banque
const makeQcm = (q) => {
  // Dans la banque, la bonne réponse est toujours en premier : on mélange
  const order = shuffle(q.choices.map((_, i) => i));
  return {
    kind: 'qcm',
    prompt: q.q,
    choices: order.map((i) => q.choices[i]),
    correctIndex: order.indexOf(0),
    info: q.info,
  };
};
const makeTf = (q) => ({
  kind: 'qcm',
  prompt: q.q,
  choices: ['Vrai', 'Faux'],
  correctIndex: q.a ? 0 : 1,
  info: q.info,
});
/**
 * Version « réponse tapée » d'une question du QCM (seulement celles marquées `typed`).
 * Réponses acceptées : la bonne réponse, la même sans article en tête (« L'Animus » → « Animus »,
 * « Un tanuki » → « tanuki », « En diamant » → « diamant »), et les écritures listées dans `typed`.
 */
const LEADING = /^(l['’]\s*|(le|la|les|un|une|des|du|en)\s+)/i;
const makeTyped = (q) => {
  const answer = q.choices[0];
  const extra = Array.isArray(q.typed) ? q.typed : [];
  const accepted = [...new Set([answer, answer.replace(LEADING, ''), ...extra, ...extra.map((a) => a.replace(LEADING, ''))])];
  return { kind: 'typed', input: 'text', prompt: q.q, answer, accepted, info: q.info };
};
// Questions jouables en réponse tapée, avec leur position dans QCM (même clé « déjà posée » que le 4 choix)
const TYPED = QCM.map((q, i) => ({ q, i })).filter((x) => x.q.typed);

const makeEstimation = (q) => ({ kind: 'estimation', prompt: q.q, unit: q.unit ?? '', year: !!q.year, answer: q.a, info: q.info });

// ---- Jaquettes

/**
 * Réponses acceptées en saisie libre : le titre complet, son nom chez IGDB, les alias listés
 * (sigles très connus, titre officiel en anglais ou en français, titre du jeu de base pour une
 * extension), le titre sans mention d'édition (Deluxe, Remastered, GOTY…) et les raccourcis usuels des
 * séries iconiques (voir fuzzy.js). Pas d'autre réponse partielle.
 */
function acceptedAnswers(game, entry) {
  return answersFor([game.title, ...(game.aliases ?? []), game.base, entry.name]);
}

/**
 * 3 mauvaises propositions, prises parmi les jeux d'époque proche (plus dur que du hasard pur).
 * Jamais un autre épisode de la même série (sinon il faudrait deviner l'épisode), jamais deux fois le même titre.
 */
function distractors(game, pool) {
  const se = seriesOf(game.title);
  const seen = new Set([gameKey(game)]);
  const rivals = [];
  for (const x of shuffle(pool)) {
    const k = gameKey(x.game);
    if (x.game === game || seen.has(k) || (se && seriesOf(x.game.title) === se)) continue;
    seen.add(k);
    rivals.push(x);
  }
  const near = rivals
    .sort((a, b) => Math.abs(a.game.year - game.year) - Math.abs(b.game.year - game.year))
    .slice(0, 10);
  // Pas deux fausses propositions de la même série non plus (Mortal Kombat et Mortal Kombat II)
  const out = [];
  const series = new Set();
  for (const x of [...shuffle(near), ...rivals.slice(10)]) {
    if (out.length === 3) break;
    const xs = seriesOf(x.game.title);
    if (xs && series.has(xs)) continue;
    if (xs) series.add(xs);
    out.push(x.game.title);
  }
  return out;
}

/**
 * Clé d'un jeu, sans mention d'édition : « Final Fantasy VII Remake » et « Final Fantasy VII » comptent pour
 * le même jeu, comme une extension et son jeu de base.
 */
export const gameKey = (g) => normalize(g.base ?? baseTitles(g.title).at(-1) ?? g.title);
/** avoid : jeux (gameKey) déjà pris dans la partie, complété au fil des tirages (Mix). */
const avoidSkip = (avoid, gameOf) => (avoid ? (q) => avoid.has(gameKey(gameOf(q))) : null);
const remember = (avoid, rounds) => { if (avoid) for (const r of rounds) avoid.add(gameKey(r)); return rounds; };

function buildCovers(input, n, used, avoid = null) {
  const pool = covers.ready();
  if (pool.length < 4) throw new Error(coverUnavailable() || 'Pas assez de jaquettes');
  return remember(avoid, pick(pool, 'c:', n, used, (x) => x.game.slug, avoidSkip(avoid, (x) => x.game)).map(({ game, entry }) => {
    const round = {
      kind: 'cover',
      input,
      prompt: 'Quel est ce jeu ?',
      slug: game.slug,
      title: game.title,
      base: game.base, // titre du jeu de base (Isaac : Rebirth → The Binding of Isaac)
      year: game.year, // année de la liste (vérifiée) : celle d'IGDB peut être une réédition
      image: covers.publicImage(entry),
    };
    if (input === 'choice') {
      const choices = shuffle([game.title, ...distractors(game, pool)]);
      round.choices = choices;
      round.correctIndex = choices.indexOf(game.title);
    } else {
      round.accepted = acceptedAnswers(game, entry);
    }
    return round;
  }));
}

function coverUnavailable() {
  const st = covers.status();
  if (st.ready >= 4) return null;
  if (st.state === 'loading' || st.state === 'idle') return 'Jaquettes en cours de chargement…';
  return st.error || 'Aucune jaquette disponible';
}

// ---- Pitchs mal expliqués

const GAME_BY_SLUG = new Map(COVER_GAMES.map((g) => [g.slug, g]));

/**
 * Le titre, l'année et les alias viennent de la liste des jaquettes. Les propositions et les réponses
 * « rivales » sont prises dans toute cette liste : pas besoin d'IGDB pour jouer.
 * La jaquette n'est montrée qu'à la correction, et seulement si elle est déjà en cache.
 */
function buildPitches(input, n, used, level = 'easy', avoid = null) {
  const all = COVER_GAMES.map((game) => ({ game, entry: {} }));
  const items = PITCHES.filter((p) => GAME_BY_SLUG.has(p.slug) && p.level === level);
  // Facile : les fausses propositions sont aussi des jeux très connus. Difficile : toute la liste.
  const easy = new Set(PITCHES.filter((p) => p.level === 'easy').map((p) => p.slug));
  const pool = level === 'easy' ? all.filter((x) => easy.has(x.game.slug)) : all;
  const shown = new Map(covers.ready().map((x) => [x.game.slug, x.entry]));
  return remember(avoid, pick(items, 'p:', n, used, (p) => p.slug, avoidSkip(avoid, (p) => GAME_BY_SLUG.get(p.slug))).map((p) => {
    const game = GAME_BY_SLUG.get(p.slug);
    const entry = shown.get(game.slug);
    const round = {
      kind: 'pitch',
      input,
      prompt: 'Quel est ce jeu ?',
      slug: game.slug,
      title: game.title,
      base: game.base, // titre du jeu de base (Isaac : Rebirth → The Binding of Isaac)
      year: game.year,
      pitch: p.pitch,
      image: entry ? covers.publicImage(entry) : null,
    };
    if (input === 'choice') {
      const choices = shuffle([game.title, ...distractors(game, pool)]);
      round.choices = choices;
      round.correctIndex = choices.indexOf(game.title);
    } else {
      round.accepted = acceptedAnswers(game, {});
    }
    return round;
  }));
}

// ---- Le jeu en emojis

/** Jeu d'une énigme : celui de la liste des jaquettes (slug) ou celui décrit dans l'énigme elle-même. */
const emojiGame = (p) => (p.slug ? GAME_BY_SLUG.get(p.slug) : { slug: null, title: p.title, year: p.year, aliases: p.aliases });
const emojiKey = (p) => p.slug ?? normalize(p.title).replace(/ /g, '-');
const EMOJI_ITEMS = EMOJI_PUZZLES.filter((p) => (p.slug ? GAME_BY_SLUG.has(p.slug) : p.title && p.year));

// Nombre de jeux par série (énigmes et liste des jaquettes) : le nom de la série n'est accepté que si le jeu
// est le seul de sa série, sinon « Baldur's Gate » désignerait aussi bien le 1 que le 3
const EMOJI_SERIES_TITLES = new Map();
for (const g of [...EMOJI_ITEMS.map(emojiGame), ...COVER_GAMES]) {
  const se = seriesOf(g.title);
  if (se) EMOJI_SERIES_TITLES.set(se, (EMOJI_SERIES_TITLES.get(se) ?? new Set()).add(normalize(g.title)));
}
const EMOJI_SERIES_COUNT = new Map([...EMOJI_SERIES_TITLES].map(([se, t]) => [se, t.size]));

/**
 * Réponses acceptées : celles des autres modes (règles strictes de fuzzy.js) et, si le jeu est le seul de sa
 * série dans la banque, le nom de la série (« Mario Kart » pour Mario Kart 8). Quand la banque a plusieurs
 * épisodes d'une série, chaque énigme contient un indice propre à son épisode (numéro, sous-titre).
 */
export function emojiAnswers(game) {
  const se = seriesOf(game.title);
  const series = se && EMOJI_SERIES_COUNT.get(se) === 1 ? se.names : [];
  return answersFor([game.title, ...(game.aliases ?? []), game.base, ...series]);
}

/**
 * Fausses propositions : jeux d'époque proche pris parmi les jeux des énigmes (en facile : des jeux faciles
 * aussi) et, en difficile, toute la liste des jaquettes en plus. Jamais un autre jeu de la même série : sinon
 * il faudrait deviner l'épisode. Jaquette à la correction si elle est en cache.
 */
function buildEmojis(input, n, used, level = 'easy', avoid = null) {
  const items = EMOJI_ITEMS.filter((p) => p.level === level);
  const seen = new Set();
  const pool = [];
  for (const p of EMOJI_ITEMS) {
    if (level === 'easy' && p.level !== 'easy') continue;
    const game = emojiGame(p);
    if (!seen.has(normalize(game.title))) { seen.add(normalize(game.title)); pool.push({ game }); }
  }
  if (level !== 'easy') for (const game of COVER_GAMES) if (!seen.has(normalize(game.title))) { seen.add(normalize(game.title)); pool.push({ game }); }
  const shown = new Map(covers.ready().map((x) => [x.game.slug, x.entry]));
  return remember(avoid, pick(items, 'm:', n, used, emojiKey, avoidSkip(avoid, emojiGame)).map((p) => {
    const game = emojiGame(p);
    const entry = game.slug ? shown.get(game.slug) : null;
    const round = {
      kind: 'emoji',
      input,
      prompt: 'Quel est ce jeu ?',
      slug: game.slug,
      title: game.title,
      base: game.base, // titre du jeu de base (Isaac : Rebirth → The Binding of Isaac)
      year: game.year,
      emojis: p.emojis,
      why: p.why,
      image: entry ? covers.publicImage(entry) : null,
    };
    if (input === 'choice') {
      const se = seriesOf(game.title);
      const rivals = pool.filter((x) => normalize(x.game.title) !== normalize(game.title) && (!se || seriesOf(x.game.title) !== se));
      const choices = shuffle([game.title, ...distractors(game, rivals)]);
      round.choices = choices;
      round.correctIndex = choices.indexOf(game.title);
    } else {
      round.accepted = emojiAnswers(game);
    }
    return round;
  }));
}

/** Clé de titre d'un jeu (anti-doublon dans une partie). */
const titleKey = (g) => normalize(g.title);

// ---- Quel jeu fait ce bruit ?

/**
 * Réponses acceptées pour un son : celles des autres modes (règles strictes de fuzzy.js), plus le nom de la
 * série quand le son est repris dans toute la série (la pièce de Mario, le « Hadouken ! »…) ou quand la
 * bonne réponse est la série elle-même, et les autres titres listés dans `also`.
 */
export function soundAnswers(s) {
  const se = s.series || s.seriesWide ? seriesOf(s.game.title)?.names ?? [] : [];
  return answersFor([s.game.title, ...(s.game.aliases ?? []), s.game.base, ...s.also, ...se]);
}

/**
 * Tire n sons, un seul par jeu dans la partie, en évitant ceux déjà entendus dans le salon.
 * Fausses propositions : la liste des jaquettes et les jeux des sons, jamais un autre jeu de la même série.
 */
/** Fausses propositions des sons de consoles (démarrage, succès…), de boutiques et de marques (« SEGA ! »). */
const PLATFORMS = {
  console: ['NES', 'Super Nintendo', 'Nintendo 64', 'GameCube', 'Wii', 'Wii U', 'Nintendo Switch', 'Game Boy',
    'Game Boy Advance', 'Nintendo DS', 'Mega Drive', 'Dreamcast', 'PlayStation', 'PlayStation 2', 'PlayStation 3',
    'PlayStation 4', 'PlayStation 5', 'PSP', 'Xbox', 'Xbox 360', 'Xbox One', 'Xbox Series X'],
  store: ['Steam', 'Epic Games Store', 'GOG Galaxy', 'Battle.net', 'Ubisoft Connect', 'EA App', 'PlayStation Network', 'Xbox Live'],
  brand: ['Sega', 'Nintendo', 'Sony', 'Microsoft', 'Atari', 'Capcom', 'Konami', 'Namco', 'SNK', 'Ubisoft', 'Square Enix', 'Electronic Arts'],
};
const SOUND_PROMPT = { console: 'Quelle console fait ce bruit ?', store: 'Quelle plateforme fait ce bruit ?', brand: 'Quelle marque fait ce bruit ?' };

function buildSounds(input, n, used, avoid = null) {
  const pool = sounds.ready();
  if (pool.length < 4) throw new Error(soundsUnavailable() || 'Pas assez de sons');
  const prefix = 'a:';
  const allowed = pool.filter((s) => !avoid?.has(gameKey(s.game)));
  let fresh = allowed.filter((s) => !used.has(prefix + s.id));
  if (fresh.length < n) {
    for (const s of pool) used.delete(prefix + s.id);
    fresh = allowed;
  }
  const chosen = [];
  const seen = new Set();
  for (const s of shuffle(fresh)) {
    if (chosen.length >= n) break;
    if (seen.has(gameKey(s.game))) continue;
    seen.add(gameKey(s.game));
    chosen.push(s);
  }
  const others = new Map();
  for (const g of [...COVER_GAMES, ...sounds.games()]) if (g.year && !others.has(titleKey(g))) others.set(titleKey(g), { game: g });
  const decoys = [...others.values()];
  const shown = new Map(covers.ready().map((x) => [x.game.slug, x.entry]));
  const rounds = chosen.map((s) => {
    used.add(prefix + s.id);
    const game = s.game;
    const entry = shown.get(game.slug);
    const round = {
      kind: 'sound',
      soundId: s.id,
      input,
      prompt: SOUND_PROMPT[s.platform] ?? 'Quel jeu fait ce bruit ?',
      slug: game.slug,
      title: game.title,
      base: game.base,
      year: game.year,
      series: s.series,
      what: s.what,
      credit: s.credit,
      sourceName: s.source?.site ?? null,
      sourceUrl: s.source?.url ?? null,
      sound: sounds.publicSound(s),
      image: entry && !s.series ? covers.publicImage(entry) : null, // jaquette à la correction si elle est en cache
    };
    if (input === 'choice' && PLATFORMS[s.platform]) {
      const rivals = PLATFORMS[s.platform].filter((t) => normalize(t) !== normalize(game.title));
      const choices = shuffle([game.title, ...shuffle(rivals).slice(0, 3)]);
      round.choices = choices;
      round.correctIndex = choices.indexOf(game.title);
    } else if (input === 'choice') {
      const rivals = decoys.filter((x) => titleKey(x.game) !== titleKey(game));
      const choices = shuffle([game.title, ...distractors({ ...game, year: game.year ?? 2005 }, rivals)]);
      round.choices = choices;
      round.correctIndex = choices.indexOf(game.title);
    } else {
      round.accepted = soundAnswers(s);
    }
    return round;
  });
  return remember(avoid, rounds);
}

function soundsUnavailable() {
  return sounds.ready().length >= 4 ? null : 'Pas encore de sons : il en faut au moins 4 dans data/sounds/';
}

// ---- Mots croisés

/**
 * Une partie de mots croisés = une seule manche au chrono fixe ; le réglage « Questions » compte des minutes.
 * Les grilles (10 mots) sont fabriquées au fur et à mesure, les mêmes pour tous et dans le même ordre, sans
 * reprendre un mot déjà vu dans le salon tant qu'il en reste.
 */
function buildCrosswords(used, level = 'easy') {
  const nextGrid = () => {
    const grid = makeGrid({ level, avoid: (w) => used.has(`x:${w}`) });
    for (const w of grid.words) used.add(`x:${w.word}`);
    return grid;
  };
  return [{ kind: 'crossword', prompt: 'Mots croisés', grids: [], nextGrid }];
}

// ---- Mix

/**
 * Le Mix pioche dans tous les modes jouables : un mode grisé (pas de jaquettes, pas de sons) est sauté.
 * Les manches sont réparties à parts égales entre les modes (le reste au hasard), puis mélangées en évitant
 * deux manches du même mode d'affilée. Les réglages du salon s'appliquent quand le mode les connaît :
 * Réponse (4 choix / tapée) pour le Quiz et les modes « Quel est ce jeu ? », Niveau pour le Pitch et les emojis.
 * Chaque manche garde son propre fonctionnement (essais, 5 s de plus pour taper, dépixelisation…).
 */
export const MIX_PARTS = ['quiz', 'vraifaux', 'estimation', 'covers', 'pitch', 'emoji', 'sounds', 'bande'];
const QUIZ_PARTS = ['quiz', 'vraifaux', 'estimation'];

/** Manches « Quel est ce jeu ? » : jamais deux fois le même jeu dans la partie (avoid). */
const GUESS_BUILD = {
  covers: (k, used, s, avoid) => buildCovers(s.input, k, used, avoid),
  pitch: (k, used, s, avoid) => buildPitches(s.input, k, used, s.level, avoid),
  emoji: (k, used, s, avoid) => buildEmojis(s.input, k, used, s.level, avoid),
  sounds: (k, used, s, avoid) => buildSounds(s.input, k, used, avoid),
  // Ta bande : toujours à choix ou estimation, quel que soit le réglage Réponse
  bande: (k, used, s) => buildBande(k, used, s.ctx),
};
const FIXED_INPUT = new Set(['bande']);
/** Questions : celles qui citent un jeu à deviner dans la même partie sont écartées (elles le souffleraient). */
const QUIZ_BUILD = {
  quiz: (k, used, s, skip) =>
    s.input === 'text'
      ? pick(TYPED, 'q', k, used, (x) => x.i, (x) => skip(x.q)).map((x) => makeTyped(x.q))
      : pick(QCM, 'q', k, used, undefined, skip).map(makeQcm),
  vraifaux: (k, used, _s, skip) => pick(TRUE_FALSE, 't', k, used, undefined, skip).map(makeTf),
  estimation: (k, used, _s, skip) => pick(ESTIMATION, 'e', k, used, undefined, skip).map(makeEstimation),
};

/** Façons d'écrire un jeu à deviner, pour repérer une question qui le cite (« Breath of the Wild », « GTA V »…). */
function spoilers(title) {
  const names = answersFor([title]);
  const sub = String(title).split(':').slice(1).join(':').trim();
  if (sub.split(/\s+/).length >= 2) names.push(sub);
  return names.map(normalize).filter((x) => x.length >= 5);
}
const mentions = (q, names) => {
  const text = ` ${normalize([q.q, ...(q.choices ?? []), ...(Array.isArray(q.typed) ? q.typed : [])].join(' '))} `;
  return names.some((x) => text.includes(` ${x} `));
};

/** Ordre des manches : mélangé, sans deux manches du même mode d'affilée quand c'est possible. */
function spread(rounds) {
  const adjacent = (list) => list.reduce((c, r, i) => c + (i > 0 && list[i - 1].mixPart === r.mixPart ? 1 : 0), 0);
  let best = shuffle(rounds);
  for (let t = 0; t < 200 && adjacent(best) > 0; t++) {
    const next = shuffle(rounds);
    if (adjacent(next) < adjacent(best)) best = next;
  }
  return best;
}

/**
 * Réglages propres au Mix : mixParts = modes cochés par l'hôte (tous par défaut),
 * mixInput = 'choice', 'text' ou 'mixed' (chaque manche tirée au hasard entre 4 choix et réponse tapée).
 */
export const MIX_INPUTS = ['mixed', 'choice', 'text'];
export const mixPartsOf = (settings = {}) => {
  const wanted = Array.isArray(settings.mixParts) ? MIX_PARTS.filter((id) => settings.mixParts.includes(id)) : MIX_PARTS;
  return wanted.length ? wanted : MIX_PARTS;
};

function buildMix(n, used, settings = {}, ctx = null) {
  const mixInput = MIX_INPUTS.includes(settings.mixInput) ? settings.mixInput : settings.input === 'text' ? 'text' : 'choice';
  const level = settings.level === 'hard' ? 'hard' : 'easy';
  const s = { input: mixInput === 'text' ? 'text' : 'choice', level, ctx };
  const parts = mixPartsOf(settings).filter((id) => allowed(id, ctx) && !MODES[id].unavailable?.(ctx));
  if (!parts.length) throw new Error('Aucun des jeux cochés pour le Mix n\'est disponible');
  // Réponse au hasard : chaque manche à réponse réglable est tirée en 4 choix ou en réponse tapée,
  // avec au moins une de chaque dès qu'il y a deux manches de ce genre (tirage préparé dans draws)
  let draws = [];
  const split = (k) => {
    if (mixInput !== 'mixed') return [[s.input, k]];
    let text = 0;
    for (let i = 0; i < k; i++) if ((draws.length ? draws.pop() : Math.random() < 0.5 ? 'text' : 'choice') === 'text') text++;
    return [['choice', k - text], ['text', text]].filter(([, c]) => c > 0);
  };
  // Parts égales ; le reste va à des modes tirés au hasard
  const counts = new Map(parts.map((id) => [id, 0]));
  shuffle(parts).forEach((id, i) => counts.set(id, Math.floor(n / parts.length) + (i < n % parts.length ? 1 : 0)));

  const flexible = parts.filter((id) => (GUESS_BUILD[id] && !FIXED_INPUT.has(id)) || id === 'quiz').reduce((t, id) => t + counts.get(id), 0);
  if (flexible >= 2) draws = shuffle(['choice', 'text', ...Array.from({ length: flexible - 2 }, () => (Math.random() < 0.5 ? 'text' : 'choice'))]);

  const out = [];
  const tag = (id) => (r) => ({ ...r, mixPart: id });
  const got = new Map(parts.map((id) => [id, 0]));
  const avoid = new Set();
  const guess = (id, k) => {
    const rounds = [];
    for (const [input, c] of FIXED_INPUT.has(id) ? [['choice', k]] : split(k)) {
      try {
        rounds.push(...GUESS_BUILD[id](c, used, { ...s, input }, avoid).map(tag(id)));
      } catch {
        // Mode devenu indisponible entre-temps : ses manches vont aux autres modes
      }
    }
    out.push(...rounds);
    got.set(id, got.get(id) + rounds.length);
    return rounds.length;
  };
  for (const id of parts) if (GUESS_BUILD[id] && counts.get(id)) guess(id, counts.get(id));
  // Banque trop petite (peu de sons, sons déjà tous entendus) : les manches manquantes vont aux
  // modes qui en ont le moins, pour garder l'équilibre
  const exhausted = new Set(parts.filter((id) => GUESS_BUILD[id] && got.get(id) < counts.get(id)));
  const load = (id) => (GUESS_BUILD[id] ? got.get(id) : counts.get(id)); // manches prévues pour ce mode
  let missing = n - out.length - QUIZ_PARTS.reduce((t, id) => t + (counts.get(id) ?? 0), 0);
  while (missing > 0) {
    const id = shuffle(parts.filter((x) => !exhausted.has(x))).sort((a, b) => load(a) - load(b))[0];
    if (!id) break;
    if (GUESS_BUILD[id]) {
      if (!guess(id, 1)) exhausted.add(id);
      else missing--;
    } else {
      counts.set(id, counts.get(id) + 1);
      missing--;
    }
  }
  const names = out.flatMap((r) => (r.title ? [...spoilers(r.title), ...(r.base ? spoilers(r.base) : [])] : []));
  const skip = (q) => mentions(q, names);
  for (const id of QUIZ_PARTS) {
    if (!counts.get(id)) continue;
    if (id !== 'quiz') out.push(...QUIZ_BUILD[id](counts.get(id), used, s, skip).map(tag(id)));
    else for (const [input, c] of split(counts.get(id))) out.push(...QUIZ_BUILD[id](c, used, { ...s, input }, skip).map(tag(id)));
  }
  // Filet de sécurité (banques de questions vides, ou jeux cochés à court de manches) : on complète avec
  // les questions des jeux cochés, puis avec n'importe quelle question
  const chosen = QUIZ_PARTS.filter((id) => parts.includes(id));
  const fill = chosen.length ? chosen : QUIZ_PARTS;
  for (let i = 0; out.length < n && i < n * 3; i++) {
    const id = fill[i % fill.length];
    out.push(...QUIZ_BUILD[id](1, used, { ...s, input: split(1)[0][0] }, skip).map(tag(id)));
  }
  return spread(out.slice(0, n));
}

/**
 * Modes de jeu proposés dans le salon. Ajouter un jeu = ajouter une entrée ici.
 * levels : le salon propose Facile / Difficile (settings.level).
 * inputs : le salon propose « 4 choix » ou « Réponse tapée » (settings.input : 'choice' | 'text').
 */
export const MODES = {
  quiz: {
    name: 'Quiz classique',
    description: '4 choix ou réponse tapée. Plus tu réponds vite, plus tu marques.',
    inputs: true,
    build: (n, used, s) =>
      s?.input === 'text'
        ? pick(TYPED, 'q', n, used, (x) => x.i).map((x) => makeTyped(x.q))
        : pick(QCM, 'q', n, used).map(makeQcm),
  },
  vraifaux: {
    name: 'Vrai ou faux',
    description: 'Anecdotes et légendes du jeu vidéo.',
    build: (n, used) => pick(TRUE_FALSE, 't', n, used).map(makeTf),
  },
  estimation: {
    name: 'Estimation',
    description: 'Chiffres tirés des jeux, scores, records, dates. Le plus proche gagne.',
    build: (n, used) => pick(ESTIMATION, 'e', n, used).map(makeEstimation),
  },
  covers: {
    name: 'Jaquette pixelisée',
    description: 'La jaquette se dévoile peu à peu. Plus tu trouves tôt, plus tu marques.',
    unavailable: coverUnavailable,
    inputs: true,
    build: (n, used, s) => buildCovers(s.input, n, used),
  },
  pitch: {
    name: 'Pitch mal expliqué',
    description: 'Un jeu résumé de travers en une phrase. Plus tu trouves tôt, plus tu marques.',
    levels: true,
    inputs: true,
    build: (n, used, s) => buildPitches(s.input, n, used, s.level),
  },
  emoji: {
    name: 'Le jeu en emojis',
    description: 'Un jeu raconté en quelques emojis, à décoder. Plus tu trouves tôt, plus tu marques.',
    levels: true,
    inputs: true,
    build: (n, used, s) => buildEmojis(s.input, n, used, s.level),
  },
  sounds: {
    name: 'Quel jeu fait ce bruit ?',
    reserved: true, // contenus aux droits problématiques : voir RESERVED_MODES
    description: 'Un son culte (pièce, cri, réplique…), à toi de trouver le jeu. Plus tu trouves tôt, plus tu marques.',
    unavailable: soundsUnavailable,
    inputs: true,
    build: (n, used, s) => buildSounds(s.input, n, used),
  },
  crossword: {
    name: 'Mots croisés',
    description: 'Les mêmes grilles pour tous, au chrono : celui qui en valide le plus gagne (8 mots sur 10 suffisent).',
    levels: true,
    grids: true, // le salon règle une durée de partie (minutes) au lieu d'un nombre de questions
    build: (_n, used, s) => buildCrosswords(used, s?.level),
  },
  mix: {
    name: 'Mix',
    description: (ctx) => `Les jeux de ton choix mélangés : quiz, vrai ou faux, estimation, jaquettes, pitchs, emojis, ${ctx?.reserved ? 'sons, ' : ''}ta bande.`,
    levels: true,
    inputs: true,
    mix: true, // réglages propres : jeux cochés (mixParts) et réponse au hasard (mixInput)
    build: (n, used, s, ctx) => buildMix(n, used, s, ctx),
  },
  bande: {
    name: 'Ta bande',
    description: 'Questions tirées de vos profils Steam : heures de jeu, succès, pile de la honte, vieux comptes… Pas de points sur ta propre question.',
    unavailable: bandeUnavailable,
    build: (n, used, _s, ctx) => buildBande(n, used, ctx),
  },
};

/**
 * Modes réservés (sons extraits des jeux : droits non acquis).
 * Ils n'existent que pour les salons dont l'HÔTE a un compte autorisé (profiles.role 'friend' ou 'admin') :
 * ctx.reserved, calculé par room.js. Ailleurs, ils sont absents de la liste, du Mix et du Défi du jour,
 * et refusés par le serveur. Sans ctx (défi du jour), jamais.
 */
export const RESERVED_MODES = Object.keys(MODES).filter((id) => MODES[id].reserved);
export const allowed = (id, ctx = null) => !!MODES[id] && (!MODES[id].reserved || !!ctx?.reserved);

/** Liste envoyée aux clients. `unavailable` : raison pour laquelle le mode est grisé, sinon null. */
/** ctx : ce qui dépend du salon (joueurs ayant lié leur profil Steam pour « Ta bande », accès aux modes réservés). */
export const modeList = (ctx = null) =>
  Object.entries(MODES)
    .filter(([id]) => allowed(id, ctx))
    .map(([id, m]) => ({ id, name: m.name, description: typeof m.description === 'function' ? m.description(ctx) : m.description, levels: !!m.levels, inputs: !!m.inputs, grids: !!m.grids, mix: !!m.mix, unavailable: m.unavailable?.(ctx) ?? null }));
