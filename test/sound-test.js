// Test du mode « Quel jeu fait ce bruit ? » : contenu réel de data/sounds, réponses acceptées sans collision,
// propositions (jamais deux jeux d'une même série), un jeu une seule fois par partie, intégration au Mix,
// puis une partie avec 2 joueurs simulés : même son pour tous, URL qui ne trahit pas le jeu,
// correction (explication, source), réponse tapée stricte, retrait d'un son par l'hôte.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { SoundLibrary } from '../server/images/sounds.js';
import { MODES, gameKey, soundAnswers } from '../server/games/index.js';
import { matches, normalize } from '../server/games/fuzzy.js';
import { seriesOf } from '../server/data/series.js';

// ------------------------------------------------------------------ contenu réel (data/sounds)
const lib = new SoundLibrary({ dir: path.join('data', 'sounds'), blacklistFile: path.join(os.tmpdir(), 'qp-no-blacklist.json') });
lib.load();
assert.deepEqual(lib.problems, [], `data/sounds/sounds.json : ${lib.problems.join(' · ')}`);
assert.ok(lib.items.length >= 100, `au moins 100 sons (${lib.items.length})`);
{
  const raw = JSON.parse(fs.readFileSync('data/sounds/sounds.json', 'utf8')).sounds;
  const ids = new Set(), files = new Set();
  for (const s of raw) {
    assert.ok(!ids.has(s.id), `${s.id} : identifiant en double`);
    assert.ok(!files.has(s.file), `${s.id} : fichier en double`);
    ids.add(s.id);
    files.add(s.file);
    assert.ok(s.what && s.what.length > 5, `${s.id} : explication manquante`);
    // Source : une page web, ou un son ajouté à la main (nom du fichier d'origine)
    assert.ok(s.source?.url?.startsWith('https://') || s.source?.name, `${s.id} : source manquante`);
    assert.ok(s.credit, `${s.id} : mention manquante`);
    const words = normalize(s.title ?? s.slug ?? '').split(' ').filter((w) => w.length > 3);
    assert.ok(!words.some((w) => s.file.toLowerCase().includes(w)), `${s.id} : le nom de fichier trahit le jeu`);
    const buf = fs.readFileSync(path.join('data', 'sounds', s.file));
    assert.ok(buf.length > 2000 && buf.length < 150_000, `${s.id} : taille inattendue (${buf.length} o)`);
    // Aucune métadonnée qui trahirait le jeu (titre, nom du son d'origine) dans le fichier
    const text = buf.toString('latin1').toLowerCase();
    for (const leak of [s.id, s.title, s.source?.name].filter((x) => x && x.length >= 4)) {
      assert.ok(!text.includes(leak.toLowerCase()), `${s.id} : le fichier contient « ${leak} »`);
    }
  }
  // Pas plus de 3 sons pour une même série (ou un même jeu hors série) : la banque doit rester variée
  const perGame = new Map();
  const perSeries = new Map();
  for (const s of lib.items) {
    perGame.set(gameKey(s.game), (perGame.get(gameKey(s.game)) ?? 0) + 1);
    const f = seriesOf(s.game.title)?.names[0] ?? gameKey(s.game);
    perSeries.set(f, (perSeries.get(f) ?? 0) + 1);
  }
  for (const [k, c] of perSeries) assert.ok(c <= 3, `${k} : ${c} sons (3 au plus par série)`);
  console.log(`✓ data/sounds : ${lib.items.length} sons, ${perGame.size} jeux`);
}

// Réponses : le bon titre passe, et aucune réponse acceptée pour un son ne désigne le jeu d'un autre son
// (sauf même série : le nom de série peut alors valoir pour les deux)
for (const s of lib.items) {
  const acc = soundAnswers(s);
  assert.ok(matches(s.game.title, acc), `${s.id} : titre refusé`);
  for (const o of lib.items) {
    if (gameKey(o.game) === gameKey(s.game)) continue;
    const se = seriesOf(s.game.title);
    if (se && seriesOf(o.game.title) === se) continue;
    assert.ok(!matches(o.game.title, acc), `${s.id} : « ${o.game.title} » serait accepté`);
  }
}
const coin = lib.items.find((s) => s.id === 'mario-coin');
assert.ok(matches('Super Mario', soundAnswers(coin)), 'son repris dans toute la série : nom de série accepté');
const navi = lib.items.find((s) => s.id === 'zelda-heylisten');
assert.ok(!matches('Zelda', soundAnswers(navi)), 'son propre à un épisode : « Zelda » seul refusé');
assert.ok(matches('Zelda Ocarina of Time', soundAnswers(navi)), 'raccourci usuel accepté');
console.log('✓ réponses tapées : titre accepté, séries seulement pour les sons de toute la série, aucune collision');

// Manches : 4 propositions distinctes, jamais deux jeux de la même série, un jeu une fois par partie
for (let t = 0; t < 30; t++) {
  const rounds = MODES.sounds.build(20, new Set(), { input: 'choice' });
  assert.equal(rounds.length, 20);
  assert.equal(new Set(rounds.map((r) => gameKey(r))).size, 20, 'un jeu une seule fois par partie');
  for (const r of rounds) {
    assert.equal(new Set(r.choices).size, 4);
    assert.equal(r.choices[r.correctIndex], r.title);
    const series = r.choices.map((c) => seriesOf(c)).filter(Boolean);
    assert.equal(new Set(series).size, series.length, `deux jeux d'une même série : ${r.choices.join(' / ')}`);
    assert.match(r.sound.url, /^\/sfx\/[A-Za-z0-9]{16}\.mp3$/);
  }
}
// Tout entendre avant de réentendre : 110 sons, 11 parties de 10 sans répétition
{
  const used = new Set();
  const heard = new Set();
  for (let t = 0; t < Math.floor(lib.items.length / 10); t++) for (const r of MODES.sounds.build(10, used, { input: 'text' })) {
    assert.ok(!heard.has(r.soundId), `${r.soundId} réentendu avant la fin de la banque`);
    heard.add(r.soundId);
    assert.ok(r.accepted.length);
  }
}
// Sons de consoles et de boutiques : leur propre question, d'autres plateformes en fausses propositions
{
  const platforms = new Map(lib.items.filter((s) => s.platform).map((s) => [s.id, s]));
  const games = new Set(lib.games().map((g) => normalize(g.title)));
  for (const s of platforms.values()) assert.ok(!games.has(normalize(s.game.title)), `${s.id} : une console parmi les jeux`);
  let seen = 0;
  for (let t = 0; t < 40; t++) for (const r of MODES.sounds.build(20, new Set(), { input: 'choice' })) {
    const p = platforms.get(r.soundId);
    if (!p) {
      assert.equal(r.prompt, 'Quel jeu fait ce bruit ?');
      for (const c of r.choices) assert.ok(![...platforms.values()].some((x) => x.game.title === c), `console proposée pour un jeu : ${c}`);
      continue;
    }
    seen++;
    assert.equal(r.prompt, { store: 'Quelle plateforme fait ce bruit ?', brand: 'Quelle marque fait ce bruit ?' }[p.platform] ?? 'Quelle console fait ce bruit ?');
    assert.ok(r.choices.every((c) => !games.has(normalize(c)) || c === r.title), `jeu proposé pour une console : ${r.choices.join(' / ')}`);
  }
  if (platforms.size) assert.ok(seen > 0, 'les sons de consoles sortent');
}
const mix = MODES.mix.build(27, new Set(), { input: 'choice', level: 'easy' });
assert.ok(mix.some((r) => r.kind === 'sound' && r.mixPart === 'sounds'), 'le Mix contient des sons');
console.log('✓ manches : propositions sans doublon de série, pas de répétition, consoles à part, présent dans le Mix');

// ------------------------------------------------------------------ partie avec 2 joueurs
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-sounds-'));
const BLACKLIST = path.join(tmp, 'blacklist.json');
fs.writeFileSync(BLACKLIST, JSON.stringify({ games: [], images: [], sounds: ['sonic-ring'] }));
const PORT = 3994;
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT),
    SUPABASE_URL: '', /* jamais la vraie base pendant les tests */ COUNTDOWN_MS: '300', REVEAL_MS: '500', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', IMAGE_CACHE_DIR: path.join(tmp, 'cache'), BLACKLIST_FILE: BLACKLIST },
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
const byFile = new Map(lib.items.map((s) => [s.file, s]));
const soundOf = (r) => byFile.get(r.sound.url.split('/').pop());

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const created = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code: created.code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);
  const mode = A.state.options.modes.find((m) => m.id === 'sounds');
  assert.ok(mode && !mode.unavailable && mode.inputs, 'mode proposé, avec 4 choix / réponse tapée');

  // Fichier servi, retiré = 404, inconnu = 404
  const one = lib.items.find((s) => s.id === 'mario-coin');
  const res = await fetch(`${URL}/sfx/${one.file}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await fetch(`${URL}/sfx/${lib.items.find((s) => s.id === 'sonic-ring').file}`)).status, 404, 'son retiré non servi');
  assert.equal((await fetch(`${URL}/sfx/..%2Fsounds.json`)).status, 404);

  // 4 choix
  assert.equal((await A.emit('room:settings', { mode: 'sounds', input: 'choice', rounds: 5, duration: 10 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  for (let i = 0; i < 5; i++) {
    const s = await A.waitFor((x) => x.phase === 'question' && x.round?.index === i);
    const sb = await B.waitFor((x) => x.phase === 'question' && x.round?.index === i);
    const r = s.round;
    assert.equal(r.kind, 'sound');
    assert.deepEqual(sb.round.sound, r.sound, 'même son pour tous');
    assert.equal(sb.round.startsAt, r.startsAt, 'même heure de départ');
    const json = JSON.stringify(r);
    const snd = soundOf(r);
    assert.ok(snd, 'son connu');
    assert.ok(snd.id !== 'sonic-ring', 'son retiré jamais proposé');
    for (const leak of [snd.id, snd.what, snd.source.url ?? snd.source.name]) assert.ok(!json.includes(leak), `fuite avant la correction : ${leak}`);
    const right = r.choices.indexOf(snd.game.title);
    assert.ok(right >= 0);
    await A.emit('game:answer', { roundId: r.id, answer: right });
    await B.emit('game:answer', { roundId: r.id, answer: (right + 1) % 4 });
    const rv = (await A.waitFor((x) => x.phase === 'reveal' && x.round.index === i)).reveal;
    assert.equal(rv.correctIndex, right);
    assert.equal(rv.what, snd.what);
    assert.equal(rv.sourceUrl, snd.source.url ?? null);
    assert.ok(rv.correctText.includes(snd.game.title));
    assert.equal(rv.results.find((x) => x.name === 'Alice').correct, true);
    assert.equal(rv.results.find((x) => x.name === 'Bob').correct, false);
  }
  await A.waitFor((x) => x.phase === 'end', 10000);
  console.log('✓ 4 choix : même son à la même heure pour tous, rien ne fuit avant la correction');

  // Réponse tapée + retrait par l'hôte
  assert.equal((await A.emit('room:settings', { mode: 'sounds', input: 'text', rounds: 5 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const s = await A.waitFor((x) => x.phase === 'question' && x.round?.index === 0);
  const r = s.round;
  const snd = soundOf(r);
  assert.deepEqual(await B.emit('game:answer', { roundId: r.id, answer: 'Tetris' }), { wrong: true, triesLeft: 2 });
  assert.equal((await A.emit('game:answer', { roundId: r.id, answer: snd.game.title.toUpperCase() })).correct, true);
  await B.emit('game:answer', { roundId: r.id, answer: 'Encore faux' });
  await B.emit('game:answer', { roundId: r.id, answer: 'Toujours faux' });
  await A.waitFor((x) => x.phase === 'reveal');
  assert.ok((await B.emit('game:ban-cover')).error, 'seul l\'hôte retire un son');
  assert.equal((await A.emit('game:ban-cover')).ok, true);
  await A.waitFor((x) => x.round?.banned === true);
  const bl = JSON.parse(fs.readFileSync(BLACKLIST, 'utf8'));
  assert.ok(bl.sounds.includes(snd.id), 'son ajouté à la liste noire');
  assert.deepEqual(bl.games, [], 'le jeu reste jouable ailleurs');
  assert.equal((await fetch(`${URL}${r.sound.url}`)).status, 404, 'son retiré plus servi');
  await A.emit('game:stop');
  console.log('✓ réponse tapée stricte, retrait d\'un son par l\'hôte (liste noire)');
} catch (e) {
  failed = true;
  console.error('✗', e);
}
A.socket.close();
B.socket.close();
server.kill();
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('Tous les tests du mode sons sont passés.');
