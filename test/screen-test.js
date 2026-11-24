// Test des modes « HUD » et « Écran de chargement » avec 2 joueurs simulés.
// Vérifie : modes grisés sans image, mêmes images pour tous, pas de fuite du jeu (URL comprise),
// un jeu une seule fois par partie, capture d'origine à la correction,
// validation stricte des titres tapés, retrait d'une image par l'hôte, et le vrai contenu de data/screens.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { COVER_GAMES } from '../server/data/cover-games.js';
import { ScreenLibrary } from '../server/images/screens.js';

// ------------------------------------------------------------------ contenu réel (data/screens)
{
  const lib = new ScreenLibrary({ dir: path.join('data', 'screens'), blacklistFile: path.join('data', 'blacklist.json') });
  lib.load();
  assert.deepEqual(lib.problems, [], `data/screens/screens.json : ${lib.problems.join(' · ')}`);
  const raw = fs.existsSync('data/screens/screens.json') ? JSON.parse(fs.readFileSync('data/screens/screens.json', 'utf8')).screens : [];
  const slugs = new Set(COVER_GAMES.map((g) => g.slug));
  for (const s of raw) {
    assert.ok(!s.slug || slugs.has(s.slug) || s.title, `${s.id} : slug inconnu sans titre`);
    assert.ok(s.files.full, `${s.id} : capture d'origine manquante`);
    for (const f of Object.values(s.files)) assert.ok(!f.includes(s.slug ?? '¤'), `${s.id} : le nom de fichier trahit le jeu`);
  }
  // Une extension ou une édition indique le titre du jeu de base (accepté en réponse tapée)
  const isaac = lib.items.find((x) => /Binding of Isaac: Rebirth/.test(x.game.title));
  if (isaac) assert.equal(isaac.game.base, 'The Binding of Isaac', 'Isaac : titre de base renseigné');
  console.log(`✓ data/screens : ${lib.items.filter((s) => s.type === 'hud').length} HUD, ${lib.items.filter((s) => s.type === 'loading').length} chargements`);
}

// ------------------------------------------------------------------ jeu d'essai
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-screens-'));
const dir = path.join(tmp, 'screens');
fs.mkdirSync(dir);
let n = 0;
const file = (tag) => {
  const name = `f${String(++n).padStart(3, '0')}x${tag}abc.webp`;
  fs.writeFileSync(path.join(dir, name), `RIFF-${name}`);
  return name;
};
const g = (slug) => COVER_GAMES.find((x) => x.slug === slug);
const shot = (id, type, game) => ({ id, type, ...game, from: `base${type}/${id}.png`, files: { easy: file('e'), full: file('f') } });
const MANIFEST = {
  screens: [
    shot('hud-a', 'hud', { slug: 'hollow-knight' }),
    shot('hud-a2', 'hud', { slug: 'hollow-knight' }), // même jeu : jamais deux fois dans une partie
    shot('hud-b', 'hud', { slug: 'elden-ring' }),
    shot('hud-c', 'hud', { slug: 'minecraft-java-edition' }),
    shot('hud-d', 'hud', { title: 'Jeu Imaginaire 3000', year: 2004, aliases: ['JI3K'] }), // hors liste des jaquettes
    shot('hud-ban', 'hud', { slug: 'celeste' }),
    shot('load-a', 'loading', { slug: 'hollow-knight' }),
    shot('load-b', 'loading', { slug: 'elden-ring' }),
  ],
};
for (const s of MANIFEST.screens) if (s.slug) assert.ok(g(s.slug), `jeu d'essai : ${s.slug} absent de cover-games.js`);
const BLACKLIST = path.join(tmp, 'blacklist.json');
fs.writeFileSync(BLACKLIST, JSON.stringify({ games: [], images: [], screens: ['hud-ban'] }));
const titleOf = (id) => {
  const s = MANIFEST.screens.find((x) => x.id === id);
  return s.title ?? g(s.slug).title;
};
const byFile = new Map(MANIFEST.screens.flatMap((s) => Object.entries(s.files).map(([k, f]) => [f, { s, k }])));

const PORT = 3995;
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    COUNTDOWN_MS: '300',
    REVEAL_MS: '500',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: path.join(tmp, 'cache'),
    SCREENS_DIR: path.join(tmp, 'empty'), // d'abord sans aucune image
    BLACKLIST_FILE: BLACKLIST,
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
const get = async (u) => {
  const res = await fetch(URL + u);
  return { status: res.status, body: res.ok ? await res.text() : null };
};

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const created = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code: created.code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);

  // ---------------- sans image : modes grisés
  let modes = A.state.options.modes;
  assert.match(modes.find((m) => m.id === 'hud').unavailable, /basehud/);
  assert.match(modes.find((m) => m.id === 'loading').unavailable, /baseloading/);
  assert.ok((await A.emit('room:settings', { mode: 'hud' })).error, 'mode grisé refusé');
  console.log('✓ sans image : HUD et Écran de chargement grisés');
  server.kill();
  await new Promise((r) => server.once('exit', r));
} catch (e) {
  failed = true;
  console.error('✗', e);
}
A.socket.close();
B.socket.close();
if (failed) process.exit(1);

// ---------------- avec les images d'essai (nouveau serveur)
fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(MANIFEST));
const server2 = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    COUNTDOWN_MS: '300',
    REVEAL_MS: '500',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: path.join(tmp, 'cache'),
    SCREENS_DIR: dir,
    BLACKLIST_FILE: BLACKLIST,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server2.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));
const C = client('A'), D = client('B');
try {
  await Promise.all([C.connected, D.connected]);
  const created = await C.emit('room:create', { name: 'Alice' });
  await D.emit('room:join', { code: created.code, name: 'Bob' });
  await C.waitFor((s) => s.players.length === 2);
  const modes = C.state.options.modes;
  const hud = modes.find((m) => m.id === 'hud');
  assert.equal(hud.unavailable, null);
  assert.ok(hud.inputs && !hud.levels, 'HUD : format de réponse, pas de niveau');
  const loading = modes.find((m) => m.id === 'loading');
  assert.ok(loading.inputs && !loading.levels, 'Chargement : format de réponse, pas de niveau');

  // Fichiers : servis seulement s'ils sont connus et pas retirés
  const first = MANIFEST.screens[0].files.easy;
  assert.equal((await get(`/shot/${first}`)).body, `RIFF-${first}`);
  assert.equal((await get(`/shot/${MANIFEST.screens.find((s) => s.id === 'hud-ban').files.easy}`)).status, 404, 'image retirée non servie');
  assert.equal((await get('/shot/..%2F..%2Fpackage.json')).status, 404);
  assert.equal((await get('/shot/inconnu123.webp')).status, 404);

  // ---------------- HUD facile, 4 choix : 4 jeux distincts jouables (Hollow Knight compte une fois, Celeste retiré)
  assert.equal((await C.emit('room:settings', { mode: 'hud', input: 'choice', rounds: 5, duration: 10 })).ok, true);
  assert.equal((await C.emit('game:start')).ok, true);
  const seenGames = new Set();
  for (let i = 0; ; i++) {
    const s = await C.waitFor((x) => (x.round?.index === i && x.phase === 'question') || x.phase === 'end');
    if (s.phase === 'end') break;
    const r = s.round;
    const rB = (await D.waitFor((x) => x.round?.id === r.id)).round;
    assert.equal(r.total, 4, 'un seul exemplaire par jeu dans la partie');
    assert.equal(r.kind, 'screen');
    assert.equal(r.screen, 'hud');
    assert.deepEqual(rB.image, r.image, 'même image pour tous');
    assert.equal(rB.startsAt, r.startsAt, 'même départ du chrono');
    for (const k of ['title', 'slug', 'screenId', 'full', 'correctIndex', 'accepted']) assert.equal(r[k], undefined, `${k} ne fuit pas`);
    const f = byFile.get(r.image.url.replace('/shot/', ''));
    assert.ok(f && f.k === 'easy', 'version question (pas l\'originale)');
    assert.notEqual(f.s.id, 'hud-ban', 'image retirée jamais proposée');
    const title = titleOf(f.s.id);
    assert.ok(!seenGames.has(title), 'pas deux fois le même jeu');
    seenGames.add(title);
    assert.equal(new Set(r.choices).size, 4);
    const right = r.choices.indexOf(title);
    assert.ok(right >= 0, 'bon titre parmi les propositions');
    await C.emit('game:answer', { roundId: r.id, answer: right });
    await D.emit('game:answer', { roundId: r.id, answer: (right + 1) % 4 });
    const rv = (await C.waitFor((x) => x.phase === 'reveal' && x.round.index === i)).reveal;
    assert.equal(rv.correctText, title);
    assert.equal(rv.correctIndex, right);
    assert.equal(byFile.get(rv.image.url.replace('/shot/', '')).k, 'full', 'capture d\'origine à la correction');
    assert.equal(rv.image.source, 'Capture personnelle');
    assert.ok(rv.results.find((x) => x.name === 'Alice').points > 900);
    assert.equal(rv.results.find((x) => x.name === 'Bob').points, 0);
  }
  assert.equal(seenGames.size, 4);
  console.log(`✓ HUD 4 choix : ${[...seenGames].join(', ')}`);

  // ---------------- Écran de chargement, réponse tapée : validation stricte, puis retrait de l'image
  assert.equal((await C.emit('room:settings', { mode: 'loading', input: 'text', rounds: 5 })).ok, true);
  assert.equal((await C.emit('game:start')).ok, true);
  const s = await C.waitFor((x) => x.phase === 'question' && x.round?.index === 0);
  const r = s.round;
  assert.equal(r.screen, 'loading');
  assert.equal(r.tries, 3);
  assert.equal(r.choices, undefined);
  const f = byFile.get(r.image.url.replace('/shot/', ''));
  const title = titleOf(f.s.id);
  assert.deepEqual(await D.emit('game:answer', { roundId: r.id, answer: title.split(' ')[0] }), { wrong: true, triesLeft: 2 }, 'réponse partielle refusée');
  assert.equal((await C.emit('game:answer', { roundId: r.id, answer: title.toLowerCase() })).correct, true);
  await D.emit('game:answer', { roundId: r.id, answer: 'Encore faux' });
  await D.emit('game:answer', { roundId: r.id, answer: 'Toujours faux' }); // 3 essais ratés : la manche se termine
  await C.waitFor((x) => x.phase === 'reveal');
  assert.equal((await C.emit('game:ban-cover')).ok, true);
  assert.ok((await D.emit('game:ban-cover')).error, 'seul l\'hôte retire une image');
  const bl = JSON.parse(fs.readFileSync(BLACKLIST, 'utf8'));
  assert.ok(bl.screens.includes(f.s.id), 'image ajoutée à la liste noire');
  assert.deepEqual(bl.games, [], 'le jeu lui-même n\'est pas retiré');
  assert.equal((await get(r.image.url)).status, 404, 'image retirée plus servie');
  console.log(`✓ chargement saisie : « ${title.split(' ')[0]} » refusé, « ${title.toLowerCase()} » accepté, image retirée`);

  // ---------------- hors liste des jaquettes : titre et alias du manifeste
  await C.emit('game:stop');
  const lib = new ScreenLibrary({ dir, blacklistFile: BLACKLIST });
  const custom = lib.ready('hud').find((x) => x.id === 'hud-d');
  assert.deepEqual([custom.game.title, custom.game.aliases], ['Jeu Imaginaire 3000', ['JI3K']]);
  console.log('✓ jeu hors liste : titre et alias pris dans screens.json');
} catch (e) {
  failed = true;
  console.error('✗', e);
} finally {
  C.socket.close();
  D.socket.close();
  server2.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
