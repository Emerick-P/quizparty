// Test du mode « Jaquette » : faux serveur IGDB, vrai serveur QuizParty, 2 joueurs simulés.
// Vérifie : résolution des jeux (slug, homonymes, recherche), cache, URL opaques, pas de fuite
// de la réponse, validation stricte des titres, essais multiples, liste noire.
// Usage : npm test
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { matches, normalize, baseTitles, answersFor } from '../server/games/fuzzy.js';
import { COVER_GAMES } from '../server/data/cover-games.js';

// ------------------------------------------------------------------ validation des titres tapés
const ok = (guess, ...acc) => assert.ok(matches(guess, acc), `« ${guess} » devrait être accepté pour ${acc[0]}`);
const ko = (guess, ...acc) => assert.ok(!matches(guess, acc), `« ${guess} » devrait être refusé pour ${acc[0]}`);
// Ignorés : casse, accents, cédilles, apostrophes, ponctuation, espaces, article en tête, écriture des numéros
ok('the witcher 3 wild hunt', 'The Witcher 3: Wild Hunt');
ok('witcher 3 wild hunt', 'The Witcher 3: Wild Hunt');
ok('WITCHER3WILDHUNT', 'The Witcher 3: Wild Hunt');
ok('gta 5', 'Grand Theft Auto V', 'GTA V');
ok('grand theft auto 5', 'Grand Theft Auto V');
ok('assassins creed', "Assassin's Creed");
ok('pacman', 'Pac-Man');
ok('okami', 'Ōkami');
ok('legend of zelda ocarina of time', 'The Legend of Zelda: Ocarina of Time');
ok('the sims', 'Les Sims');
ok('ratchet et clank', 'Ratchet & Clank');
ok('ratchet and clank', 'Ratchet & Clank');
ok('monster hunter world', 'Monster Hunter: World');
ok('Pokémon façon cédille', 'pokemon facon cedille');
// Refusés : fautes de frappe, réponses partielles, mauvais numéro, sigle non listé
ko('monster hunter wilds', 'Monster Hunter: World');
ko('monster hunter wild', 'Monster Hunter: World');
ko('monster hunter', 'Monster Hunter: World');
ko('Wicther 3 wild hunt', 'The Witcher 3: Wild Hunt');
ko('witcher 3', 'The Witcher 3: Wild Hunt');
ko('assasin creed', "Assassin's Creed");
ko('ocarina of time', 'The Legend of Zelda: Ocarina of Time');
ko('dark souls 2', 'Dark Souls III');
ko('dark souls', 'Dark Souls III');
ko('final fantasy 8', 'Final Fantasy VII');
ko('portal', 'Portal 2');
ko('mario kart', 'Mario Kart 8');
ko('tlou', 'The Last of Us');
ko('', 'Doom');
ko('the', 'The Sims');
assert.equal(normalize('The Legend of Zelda: Breath of the Wild'), 'legend of zelda breath of wild');
// « The » facultatif partout ; raccourcis usuels des séries iconiques (answersFor = ce qu'utilisent tous les modes)
const full = (...t) => answersFor(t);
ok('legend of zelda breath of wild', 'The Legend of Zelda: Breath of the Wild');
ok('the elder scrolls v the skyrim', 'The Elder Scrolls V: Skyrim');
ok('zelda breath of the wild', ...full('The Legend of Zelda: Breath of the Wild'));
ok('zelda ocarina of time', ...full('The Legend of Zelda: Ocarina of Time'));
ko('zelda', ...full('The Legend of Zelda: Ocarina of Time'));
ko('zelda', ...full('The Legend of Zelda'));
ok('isaac', ...full('The Binding of Isaac: Rebirth', 'The Binding of Isaac'));
ok('isaac rebirth', ...full('The Binding of Isaac: Rebirth', 'The Binding of Isaac'));
ok('skyrim', ...full('The Elder Scrolls V: Skyrim'));
ok('witcher 3', ...full('The Witcher 3: Wild Hunt'));
ok('uncharted 2', ...full('Uncharted 2: Among Thieves'));
ok('gta san andreas', ...full('Grand Theft Auto: San Andreas'));
ok('ff7 remake', ...full('Final Fantasy VII Remake'));
ok('smash ultimate', ...full('Super Smash Bros. Ultimate'));
ok('rdr2', ...full('Red Dead Redemption 2'));
ok('mgs', ...full('Metal Gear Solid'));
ok('spider-man', ...full("Marvel's Spider-Man"));
ok('sekiro', ...full('Sekiro: Shadows Die Twice'));
ok('jak and daxter', ...full('Jak and Daxter: The Precursor Legacy'));
ko('monster hunter', ...full('Monster Hunter: World'));
ko('witcher', ...full('The Witcher 3: Wild Hunt'));
ok('ff7', ...full('Final Fantasy VII Remake'));
ok('the witcher 3 wild hunt game of the year edition', ...full('The Witcher 3: Wild Hunt – Game of the Year Edition')); // facultatif mais accepté
ok('the legend of zelda breath of the wild', ...full('The Legend of Zelda: Breath of the Wild'));
ok('the binding of isaac rebirth', ...full('The Binding of Isaac: Rebirth', 'The Binding of Isaac'));
ko('gta', ...full('Grand Theft Auto V'));
ko('rdr', ...full('Red Dead Redemption 2'));

// Anti-collision : aucune écriture acceptée ne doit désigner deux jeux différents de la banque
{
  const screensFile = 'data/screens/screens.json';
  const extra = fs.existsSync(screensFile) ? JSON.parse(fs.readFileSync(screensFile, 'utf8')).screens.filter((s) => !s.slug && s.title) : [];
  const games = [...COVER_GAMES, ...extra];
  const identity = (g) => normalize(g.base ?? baseTitles(g.title).at(-1) ?? g.title); // une édition ou un remake = le même jeu
  const owner = new Map();
  for (const g of games) {
    for (const a of answersFor([g.title, ...(g.aliases ?? []), g.base])) {
      const key = normalize(a).replace(/ /g, '');
      const prev = owner.get(key);
      assert.ok(!prev || prev.id === identity(g), `« ${a} » désigne à la fois « ${prev?.title} » et « ${g.title} »`);
      owner.set(key, { id: identity(g), title: g.title });
    }
  }
}
// Éditions : le titre du jeu de base est aussi accepté, mais pas pour un remake devenu un jeu à part ni une suite
const withBase = (t) => [t, ...baseTitles(t)];
ok('mario kart 8', ...withBase('Mario Kart 8 Deluxe'));
ok('ghost of tsushima', ...withBase("Ghost of Tsushima Director's Cut"));
ok('the witcher 3 wild hunt', ...withBase('The Witcher 3: Wild Hunt – Game of the Year Edition'));
ok('dark souls', ...withBase('Dark Souls: Remastered'));
ok('persona 5', ...withBase('Persona 5 Royal'));
ok('cyberpunk 2077', ...withBase('Cyberpunk 2077 (Ultimate Edition)'));
ok('final fantasy 7', ...withBase('Final Fantasy VII Remake')); // « Remake » facultatif
ok('final fantasy vii remake', ...withBase('Final Fantasy VII Remake')); // mais accepté s'il est tapé
ok('resident evil 4', ...withBase('Resident Evil 4 Remake'));
ko('final fantasy 7', ...withBase('Final Fantasy VII Rebirth'));
ko('mario kart', ...withBase('Mario Kart 8 Deluxe'));
ko('gta 4', ...withBase('Grand Theft Auto V'));
ko('botw', ...withBase('The Legend of Zelda: Tears of the Kingdom'), 'TOTK');
ok('the binding of isaac', 'The Binding of Isaac: Rebirth', 'The Binding of Isaac'); // champ base
// Chiffres arabes ou romains, y compris devant un sous-titre et dans les sigles écrits en deux mots
for (const guess of ['Final Fantasy 7 Remake', 'final fantasy VII remake', 'FINAL FANTASY 7: REMAKE', 'FF7 Remake', 'ff vii remake', 'FFVII Remake'])
  ok(guess, 'Final Fantasy VII Remake', 'FF7 Remake', 'FFVII Remake');
ok('final fantasy 14', 'Final Fantasy XIV');
ok('assassins creed 4 black flag', "Assassin's Creed IV: Black Flag");
ok('age of empires 2 the age of kings', 'Age of Empires II: The Age of Kings');
// Les alias de la liste : seulement des sigles très connus ou des titres officiels, jamais un titre raccourci
for (const g of COVER_GAMES) {
  for (const a of (g.aliases ?? []).filter((x) => !(g.short ?? []).includes(x))) {
    const al = normalize(a).replace(/ /g, ''), ti = normalize(g.title).replace(/ /g, '');
    assert.ok(al === ti || !ti.includes(al), `alias « ${a} » (${g.title}) : un titre raccourci n'est pas un alias`);
  }
}
console.log('✓ validation stricte des titres');

// ------------------------------------------------------------------ faux IGDB
// Un PNG uni avec des bandes de couleur, différent pour chaque jeu
function png(seed, w = 264, h = 352) {
  const rnd = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const band = Math.floor((y / h) * 4 + (x / w) * 2);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.floor(rnd(band) * 255);
      raw[o + 1] = Math.floor(rnd(band + 7) * 255);
      raw[o + 2] = Math.floor(rnd(band + 13) * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ts = (year) => Date.UTC(year, 5, 1) / 1000;
const fakeGame = (g, i, over = {}) => ({
  id: 1000 + i,
  name: g.title.replace('Les Sims', 'The Sims'),
  slug: g.slug,
  url: `https://www.igdb.com/games/${g.slug}`,
  first_release_date: ts(g.igdbYear ?? g.year),
  cover: { id: 5000 + i, image_id: `co${i}` },
  involved_companies: [{ publisher: false, company: { name: 'Studio' } }, { publisher: true, company: { name: `Éditeur ${i}` } }],
  ...over,
});
const stats = { token: 0, games: 0, search: 0 };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.startsWith('/token')) {
      stats.token++;
      return res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600, token_type: 'bearer' }));
    }
    if (req.url === '/v4/games') {
      if (req.headers.authorization !== 'Bearer tok' || req.headers['client-id'] !== 'test-id') return res.writeHead(401).end('[]');
      const search = body.match(/search "([^"]+)"/);
      if (search) {
        stats.search++;
        const i = COVER_GAMES.findIndex((g) => g.title === search[1]);
        const rows = [];
        if (search[1] === 'Doom') rows.push(fakeGame(COVER_GAMES[i], i, { slug: 'doom--2', id: 1 }));
        if (search[1] === 'Minecraft') rows.push(fakeGame(COVER_GAMES[i], i, { slug: 'minecraft-java-edition' }));
        // « Hades » : seulement un homonyme de 1999 → doit rester introuvable
        return res.end(JSON.stringify(rows));
      }
      stats.games++;
      const slugs = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const rows = slugs.flatMap((slug) => {
        const i = COVER_GAMES.findIndex((g) => g.slug === slug);
        if (i < 0 || slug === 'minecraft-java-edition') return []; // slug inconnu → recherche par titre
        if (slug === 'doom') return [fakeGame(COVER_GAMES[i], i, { first_release_date: ts(2016), cover: { image_id: 'wrong' } })]; // homonyme
        if (slug === 'hades') return [fakeGame(COVER_GAMES[i], i, { first_release_date: ts(1999) })];
        return [fakeGame(COVER_GAMES[i], i)];
      });
      return res.end(JSON.stringify(rows));
    }
    const img = req.url.match(/^\/img\/t_cover_big_2x\/(co\d+)\.jpg$/);
    if (img) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png(Number(img[1].slice(2)) + 1));
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => mock.listen(0, r));
const MOCK = `http://localhost:${mock.address().port}`;

// ------------------------------------------------------------------ serveur QuizParty
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-covers-'));
const cacheDir = path.join(tmp, 'cache');
const blacklistFile = path.join(tmp, 'blacklist.json');
const PORT = 3998;
const URL = `http://localhost:${PORT}`;
const startServer = (extraEnv = {}) => {
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      COUNTDOWN_MS: '300',
      REVEAL_MS: '600',
      TWITCH_CLIENT_ID: 'test-id',
      TWITCH_CLIENT_SECRET: 'test-secret',
      TWITCH_TOKEN_URL: `${MOCK}/token`,
      IGDB_API_URL: `${MOCK}/v4`,
      IGDB_IMAGE_URL: `${MOCK}/img`,
      IMAGE_CACHE_DIR: cacheDir,
      BLACKLIST_FILE: blacklistFile,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  proc.log = '';
  proc.stdout.on('data', (d) => (proc.log += d));
  return proc;
};
const health = async () => (await fetch(`${URL}/health`)).json();
const until = async (fn, ms = 15000) => {
  const t = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* pas encore prêt */ }
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
};

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

let server = startServer();
let failed = false;
const clients = [];
try {
  const h = await until(async () => {
    const x = await health();
    return x.covers.state === 'ready' && x;
  });
  const expected = COVER_GAMES.length - 1; // « Hades » : seul un homonyme existe chez le faux IGDB
  assert.equal(h.covers.ready, expected, 'toutes les jaquettes trouvables sont prêtes');
  const index = JSON.parse(fs.readFileSync(path.join(cacheDir, 'covers.json'), 'utf8'));
  assert.equal(index['igdb:doom'].imageId, `co${COVER_GAMES.findIndex((g) => g.slug === 'doom')}`, 'homonyme écarté, bon Doom retrouvé par recherche');
  assert.equal(index['igdb:hades'].status, 'missing', 'jeu de la mauvaise année refusé');
  assert.equal(index['igdb:minecraft-java-edition'].status, 'ready', 'slug inconnu retrouvé par la recherche');
  assert.equal(index['igdb:the-witcher-3-wild-hunt'].publisher, `Éditeur ${COVER_GAMES.findIndex((g) => g.slug === 'the-witcher-3-wild-hunt')}`, 'éditeur gardé pour la mention');
  console.log(`✓ ${h.covers.ready} jaquettes résolues et en cache (requêtes : ${stats.games} groupée(s), ${stats.search} recherche(s))`);
  const bySlug = (url) => Object.values(index).find((e) => `/img/${e.id}` === url);
  const titleOf = (url) => COVER_GAMES.find((g) => g.slug === bySlug(url).slug).title;

  const A = client('A'), B = client('B');
  clients.push(A, B);
  await Promise.all([A.connected, B.connected]);
  const created = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code: created.code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);
  const modes = A.state.options.modes;
  assert.equal(modes.find((m) => m.id === 'covers').unavailable, null, 'mode jaquette disponible');
  assert.equal(modes.find((m) => m.id === 'covers').inputs, true, 'jaquette : choix du format de réponse');
  assert.ok(!modes.some((m) => m.id === 'coverstext'), 'une seule entrée Jaquette dans le salon');
  assert.equal(A.state.settings.input, 'choice', '4 choix par défaut');
  assert.ok((await A.emit('room:settings', { input: 'voice' })).error, 'format hors liste refusé');

  // ---------------- 4 propositions
  assert.equal((await A.emit('room:settings', { mode: 'covers', input: 'choice', rounds: 5, duration: 10 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const cd = await A.waitFor((s) => s.round?.index === i && ['countdown', 'question'].includes(s.phase));
    const r = cd.round;
    assert.equal(r.kind, 'cover');
    assert.equal(r.choices.length, 4);
    assert.equal(new Set(r.choices).size, 4, 'propositions distinctes');
    assert.ok(r.image.url.startsWith('/img/'), 'image servie par notre serveur');
    assert.equal(r.correctIndex, undefined, 'la bonne réponse ne fuit pas');
    assert.equal(r.image.pageUrl, undefined, 'la page IGDB (qui donne le nom) ne fuit pas pendant la question');
    assert.ok(!/[a-z]/.test(r.image.url.slice(5).replace(/[A-Za-z0-9_-]/g, '')), 'URL opaque');
    seen.add(r.image.url);
    const img = await fetch(URL + r.image.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /immutable/);
    const title = titleOf(r.image.url);
    const right = r.choices.indexOf(title);
    assert.ok(right >= 0, 'le bon titre est parmi les propositions');

    await A.waitFor((s) => s.phase === 'question' && s.round.index === i);
    assert.equal((await A.emit('game:answer', { roundId: r.id, answer: right })).ok, true);
    assert.equal((await B.emit('game:answer', { roundId: r.id, answer: (right + 1) % 4 })).ok, true);
    const rev = await A.waitFor((s) => s.phase === 'reveal' && s.round.index === i);
    assert.equal(rev.reveal.correctText, title);
    assert.equal(rev.reveal.correctIndex, right);
    assert.ok(rev.reveal.image.pageUrl.includes('igdb.com'), 'mention de la source à la correction');
    const ra = rev.reveal.results.find((x) => x.name === 'Alice');
    const rb = rev.reveal.results.find((x) => x.name === 'Bob');
    assert.ok(ra.correct && ra.points >= 200 && ra.points <= 1000, `points Alice ${ra.points}`);
    assert.ok(!rb.correct && rb.points === 0);
    if (i < 4) assert.ok(rev.preload && rev.preload.startsWith('/img/'), 'image suivante annoncée pour préchargement');
  }
  assert.equal(seen.size, 5, 'pas deux fois le même jeu');
  await A.waitFor((s) => s.phase === 'end');
  console.log('✓ mode 4 propositions');

  // ---------------- nom à taper, 3 essais
  await A.emit('game:stop');
  assert.equal((await A.emit('room:settings', { mode: 'covers', input: 'text', rounds: 5 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const q = await A.waitFor((s) => s.phase === 'question' && s.round.index === 0);
  const title = titleOf(q.round.image.url);
  assert.equal(q.round.choices, undefined);
  assert.equal(q.round.durationMs, 15000, '5 s de plus pour taper');
  assert.ok(!JSON.stringify(q).includes(title), 'le titre ne fuit pas dans l\'état');
  const typo = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); // sans accents, espaces ni ponctuation
  const w1 = await A.emit('game:answer', { roundId: q.round.id, answer: 'zzzz' });
  assert.deepEqual(w1, { wrong: true, triesLeft: 2 }, 'mauvais essai : il en reste 2');
  const good = await A.emit('game:answer', { roundId: q.round.id, answer: typo });
  assert.equal(good.correct, true, `« ${typo} » accepté pour ${title}`);
  for (let k = 0; k < 2; k++) assert.equal((await B.emit('game:answer', { roundId: q.round.id, answer: 'nope nope' })).wrong, true);
  const last = await B.emit('game:answer', { roundId: q.round.id, answer: 'toujours pas' });
  assert.equal(last.ok, true);
  assert.equal(last.correct, false, '3e mauvais essai : réponse finale fausse');
  const rev = await A.waitFor((s) => s.phase === 'reveal');
  assert.ok(rev.reveal.results.find((x) => x.name === 'Alice').points > 0);
  assert.equal(rev.reveal.results.find((x) => x.name === 'Bob').points, 0);
  console.log(`✓ mode saisie (« ${typo} » accepté pour « ${title} », 3 essais)`);

  // ---------------- liste noire
  assert.ok((await B.emit('game:ban-cover')).error, 'seul l\'hôte peut retirer un jeu');
  assert.equal((await A.emit('game:ban-cover')).ok, true);
  const banned = bySlug(q.round.image.url).slug;
  assert.deepEqual(JSON.parse(fs.readFileSync(blacklistFile, 'utf8')).games, [banned]);
  assert.equal((await fetch(URL + q.round.image.url)).status, 404, 'image retirée plus servie');
  assert.equal((await health()).covers.ready, expected - 1);
  await A.emit('game:stop');
  console.log(`✓ liste noire (${banned})`);

  // ---------------- redémarrage sans identifiants : le cache suffit
  for (const c of clients) c.socket.close();
  server.kill();
  await new Promise((r) => server.on('exit', r));
  const before = { ...stats };
  server = startServer({ TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' });
  const h2 = await until(async () => (await health()).covers.state !== 'idle' && health());
  assert.equal(h2.covers.ready, expected - 1, 'jaquettes en cache utilisables sans identifiants');
  assert.deepEqual(stats, before, 'aucun appel à IGDB au redémarrage');
  console.log('✓ cache disque réutilisé au redémarrage');

  console.log('✅ Tests jaquettes OK');
} catch (err) {
  failed = true;
  console.error('❌', err);
  console.error(server.log);
} finally {
  for (const c of clients) c.socket.close();
  server.kill();
  mock.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
