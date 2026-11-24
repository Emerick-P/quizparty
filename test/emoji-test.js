// Test du mode « Le jeu en emojis » : contenu valide, 2 joueurs simulés, 4 choix puis saisie libre.
// Vérifie : énigmes faites seulement d'emojis (Unicode 12 au plus), pas de fuite de la réponse,
// mêmes emojis pour tous, score selon la rapidité, validation stricte des titres tapés, 3 essais.
// Aucun accès à IGDB n'est nécessaire.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { EMOJI_PUZZLES } from '../server/data/emojis.js';
import { COVER_GAMES } from '../server/data/cover-games.js';
import { normalize, answersFor } from '../server/games/fuzzy.js';
import { seriesOf } from '../server/data/series.js';

// ------------------------------------------------------------------ contenu
// Emojis apparus après Unicode 12 (2019) : pas encore affichés par tous les téléphones et PC
const TOO_RECENT = /[\u{1FA74}-\u{1FA77}\u{1FA7B}-\u{1FA7F}\u{1FA83}-\u{1FA8F}\u{1FA96}-\u{1FAFF}\u{1F6D6}-\u{1F6DF}\u{1F6FB}-\u{1F6FF}\u{1F7F0}-\u{1F7FF}\u{1F90C}\u{1F972}\u{1F977}-\u{1F979}\u{1F9A3}\u{1F9A4}\u{1F9AB}-\u{1F9AD}\u{1F9CB}\u{1F9CC}]/u;
// Séquences récentes faites d'emojis anciens (Unicode 12.1 et plus) : la personne neutre avec métier, chat noir…
const RECENT_SEQ = /\u{1F9D1}‍|\u{1F408}‍⬛|\u{1F43B}‍❄|❤️?‍\u{1F525}|\u{1F62E}‍\u{1F4A8}|\u{1F635}‍\u{1F4AB}|\u{1F636}‍\u{1F32B}/u;
const bySlug = new Map(COVER_GAMES.map((g) => [g.slug, g]));
const gameOf = (p) => (p.slug ? bySlug.get(p.slug) : { title: p.title, year: p.year, aliases: p.aliases });
const label = (p) => p.slug ?? p.title;
const seenGames = new Set();
for (const p of EMOJI_PUZZLES) {
  assert.ok(!!p.slug !== !!p.title, `énigme « ${label(p)} » : slug (jeu de la liste) ou title (hors liste), pas les deux`);
  if (p.slug) assert.ok(bySlug.has(p.slug), `emojis « ${p.slug} » : jeu absent de cover-games.js`);
  else {
    assert.ok(Number.isInteger(p.year) && p.year >= 1970 && p.year <= 2026, `emojis « ${p.title} » : année manquante`);
    assert.ok(!COVER_GAMES.some((g) => normalize(g.title) === normalize(p.title)), `emojis « ${p.title} » : déjà dans cover-games.js, utiliser son slug`);
    if (p.aliases) assert.ok(Array.isArray(p.aliases) && p.aliases.every((a) => typeof a === 'string' && a), `emojis « ${p.title} » : alias invalides`);
  }
  const key = normalize(gameOf(p).title);
  assert.ok(!seenGames.has(key), `emojis « ${label(p)} » en double`);
  seenGames.add(key);
  assert.ok(['easy', 'hard'].includes(p.level), `emojis « ${label(p)} » : niveau easy ou hard`);
  assert.equal(typeof p.emojis, 'string');
  // Rien que des emojis (et des espaces entre les groupes) : ni lettre ni chiffre écrits en clair
  const stripped = p.emojis.replace(/\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|[‍️⃣\s]/gu, '');
  assert.equal(stripped, '', `emojis « ${label(p)} » : uniquement des emojis (reste « ${stripped} »)`);
  assert.ok(!/[a-z]/i.test(p.emojis), `emojis « ${label(p)} » : pas de lettre`);
  assert.ok(!TOO_RECENT.test(p.emojis) && !RECENT_SEQ.test(p.emojis), `emojis « ${label(p)} » : emoji trop récent pour certains appareils`);
  const n = [...p.emojis.matchAll(/\p{Extended_Pictographic}/gu)].length;
  assert.ok(n >= 3 && n <= 12, `emojis « ${label(p)} » : entre 3 et 12 emojis`);
  assert.ok(typeof p.why === 'string' && p.why.length >= 20 && p.why.length <= 200, `emojis « ${label(p)} » : explication manquante ou trop longue`);
  // L'explication est montrée à la correction : elle peut citer le jeu, mais l'énigme non (vérifié ci-dessus : pas de lettres)
}
assert.equal(new Set(EMOJI_PUZZLES.map((p) => p.emojis)).size, EMOJI_PUZZLES.length, 'deux énigmes identiques');
const nEasy = EMOJI_PUZZLES.filter((p) => p.level === 'easy').length;
assert.ok(nEasy >= 40 && EMOJI_PUZZLES.length - nEasy >= 40, 'au moins 40 énigmes par niveau');

// Anti-collision : une écriture acceptée ne doit pas désigner deux jeux (énigmes, noms de série compris,
// et liste des jaquettes)
const { MODES, emojiAnswers } = await import('../server/games/index.js');
const owner = new Map();
const claim = (a, title) => {
  const k = normalize(a).replace(/ /g, '');
  const prev = owner.get(k);
  assert.ok(!prev || prev === title, `« ${a} » accepté à la fois pour « ${prev} » et « ${title} »`);
  owner.set(k, title);
};
for (const p of EMOJI_PUZZLES) for (const a of emojiAnswers(gameOf(p))) claim(a, gameOf(p).title);
for (const g of COVER_GAMES) for (const a of answersFor([g.title, ...(g.aliases ?? []), g.base])) claim(a, g.title);
// Le nom de série seul n'est accepté que pour un jeu seul de sa série dans la banque
const bySeries = new Map();
for (const t of new Set([...EMOJI_PUZZLES.map((p) => gameOf(p).title), ...COVER_GAMES.map((g) => g.title)])) {
  const se = seriesOf(t);
  if (se) bySeries.set(se, [...(bySeries.get(se) ?? []), t]);
}
for (const [se, titles] of bySeries) {
  for (const t of titles) {
    const ok = emojiAnswers({ title: t }).some((a) => se.names.some((nm) => normalize(nm) === normalize(a)));
    if (titles.length === 1) assert.ok(ok, `« ${se.names[0]} » doit être accepté pour « ${t} »`);
  }
}
assert.ok(!emojiAnswers(bySlug.get('mario-kart-8')).includes('Mario Kart'), '« Mario Kart » refusé pour Mario Kart 8 (plusieurs Mario Kart dans la liste)');
assert.ok(emojiAnswers(bySlug.get('oddworld-abes-oddysee')).includes('Oddworld'), '« Oddworld » accepté pour le seul Oddworld');
const multi = [...bySeries].filter(([, t]) => t.length > 1).length;
console.log(`✓ ${EMOJI_PUZZLES.length} énigmes en emojis valides (${nEasy} faciles, ${EMOJI_PUZZLES.length - nEasy} difficiles), sans réponse ambiguë, ${multi} séries à plusieurs épisodes`);

// ------------------------------------------------------------------ partie
// ------------------------------------------------------------------ toutes les manches, sans réseau
for (const level of ['easy', 'hard']) {
  const all = EMOJI_PUZZLES.filter((p) => p.level === level).length;
  const asChoice = MODES.emoji.build(all, new Set(), { input: 'choice', level });
  const asText = MODES.emoji.build(all, new Set(), { input: 'text', level });
  assert.equal(asChoice.length, all);
  for (const r of asChoice) {
    assert.equal(new Set(r.choices).size, 4, `« ${r.title} » : 4 propositions distinctes`);
    assert.equal(r.choices[r.correctIndex], r.title);
    assert.ok(r.choices.filter((c) => normalize(c) === normalize(r.title)).length === 1, `« ${r.title} » : pas de doublon de la bonne réponse`);
    const se = seriesOf(r.title);
    if (se) assert.ok(r.choices.every((c) => c === r.title || seriesOf(c) !== se), `« ${r.title} » : un autre épisode de la série parmi les propositions (${r.choices.join(', ')})`);
  }
  for (const r of asText) assert.ok(r.accepted.includes(r.title), `« ${r.title} » : titre accepté`);
}
console.log('✓ toutes les énigmes se construisent en 4 choix et en saisie, dans les deux niveaux');

const PORT = 3994;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-emoji-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: '', // jamais la vraie base pendant les tests (même si .env la définit)
    COUNTDOWN_MS: '300',
    REVEAL_MS: '500',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));

function client(label) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { label, socket, state: null, waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 8000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const puzzleOf = (r) => EMOJI_PUZZLES.find((p) => p.emojis === r.emojis);

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const created = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code: created.code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);
  const mode = A.state.options.modes.find((m) => m.id === 'emoji');
  assert.ok(mode, 'mode emoji proposé dans le salon');
  assert.equal(mode.unavailable, null, 'disponible sans IGDB');
  assert.equal(mode.inputs, true, 'choix du format de réponse');
  assert.equal(mode.levels, true, 'niveau Facile / Difficile');

  // ---------------- 4 propositions
  assert.equal((await A.emit('room:settings', { mode: 'emoji', input: 'choice', rounds: 5, duration: 10 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const seen = new Set();
  const easyTitles = new Set(EMOJI_PUZZLES.filter((x) => x.level === 'easy').map((x) => gameOf(x).title));
  for (let i = 0; i < 5; i++) {
    const s = await A.waitFor((x) => x.round?.index === i && ['countdown', 'question'].includes(x.phase));
    const r = s.round;
    const rB = (await B.waitFor((x) => x.round?.id === r.id)).round;
    assert.equal(r.kind, 'emoji');
    assert.equal(r.input, 'choice');
    assert.equal(rB.emojis, r.emojis, 'mêmes emojis pour tous');
    assert.equal(rB.startsAt, r.startsAt, 'même départ du chrono pour tous');
    for (const k of ['correctIndex', 'title', 'slug', 'why', 'accepted']) assert.equal(r[k], undefined, `${k} ne fuit pas`);
    assert.equal(new Set(r.choices).size, 4, 'propositions distinctes');
    const p = puzzleOf(r);
    assert.ok(p, 'énigme reconnue');
    assert.equal(p.level, 'easy', 'niveau facile par défaut');
    assert.ok(r.choices.every((c) => easyTitles.has(c)), 'en facile, les fausses propositions sont aussi des jeux faciles');
    assert.ok(!seen.has(label(p)), 'pas deux fois le même jeu');
    seen.add(label(p));
    const right = r.choices.indexOf(gameOf(p).title);
    assert.ok(right >= 0, 'le bon titre est parmi les propositions');

    await A.waitFor((x) => x.phase === 'question' && x.round.index === i);
    assert.equal((await A.emit('game:answer', { roundId: r.id, answer: right })).ok, true);
    if (i === 0) await sleep(1500); // Bob répond tard : moins de points
    assert.equal((await B.emit('game:answer', { roundId: r.id, answer: i === 0 ? right : (right + 1) % 4 })).ok, true);
    const rv = (await A.waitFor((x) => x.phase === 'reveal' && x.round.index === i)).reveal;
    assert.equal(rv.correctIndex, right);
    assert.equal(rv.correctText, gameOf(p).title);
    assert.equal(rv.emojis, p.emojis);
    assert.equal(rv.why, p.why, 'explication à la correction');
    assert.equal(rv.image, null, 'pas de jaquette sans IGDB');
    if (!p.slug) assert.equal(rv.year, p.year, 'année du jeu hors liste');
    const a = rv.results.find((x) => x.name === 'Alice'), b = rv.results.find((x) => x.name === 'Bob');
    assert.ok(a.correct && a.points > 900, 'réponse rapide bien payée');
    if (i === 0) assert.ok(b.correct && b.points < a.points, 'réponse tardive moins payée');
    else assert.equal(b.points, 0);
  }
  await A.waitFor((s) => s.phase === 'end');
  console.log('✓ emojis 4 choix : 5 manches, mêmes emojis pour tous, scores');

  // ---------------- saisie libre
  assert.equal((await A.emit('room:settings', { mode: 'emoji', input: 'text', rounds: 5, level: 'hard' })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const s = await A.waitFor((x) => x.phase === 'question' && x.round?.index === 0);
  const r = s.round;
  assert.equal(r.input, 'text');
  assert.equal(r.choices, undefined);
  assert.equal(r.tries, 3);
  assert.equal(r.durationMs, 15000, '5 s de plus pour taper');
  assert.equal(puzzleOf(r).level, 'hard', 'niveau difficile respecté');
  const t = gameOf(puzzleOf(r)).title;
  // Validation stricte : une faute de frappe est refusée, le titre exact sans accents ni majuscules passe
  const k = [...t].findIndex((c, j) => /[a-z]/.test(c) && /[a-z]/.test(t[j + 1] ?? '') && c !== t[j + 1]);
  const typo = t.slice(0, k) + t[k + 1] + t[k] + t.slice(k + 2);
  assert.deepEqual(await B.emit('game:answer', { roundId: r.id, answer: 'Nimportequoi' }), { wrong: true, triesLeft: 2 });
  assert.deepEqual(await A.emit('game:answer', { roundId: r.id, answer: typo }), { wrong: true, triesLeft: 2 }, `« ${typo} » refusé pour « ${t} »`);
  const plain = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, '');
  assert.equal((await A.emit('game:answer', { roundId: r.id, answer: plain })).correct, true, `« ${plain} » accepté pour « ${t} »`);
  await B.emit('game:answer', { roundId: r.id, answer: 'Encore faux' });
  assert.equal((await B.emit('game:answer', { roundId: r.id, answer: 'Toujours faux' })).correct, false, '3e essai raté');
  const rv = (await A.waitFor((x) => x.phase === 'reveal')).reveal;
  assert.equal(rv.correctText, t);
  assert.ok(rv.results.find((x) => x.name === 'Alice').points > 0);
  console.log(`✓ emojis saisie libre : « ${typo} » refusé, « ${plain} » accepté pour « ${t} », 3 essais`);
} catch (e) {
  failed = true;
  console.error('✗', e);
} finally {
  A.socket.close();
  B.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
