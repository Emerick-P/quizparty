// Test « Ta bande » : faux serveur Steam, 3 joueurs (2 profils publics, 1 privé), partie complète, Mix.
// Usage : node test/bande-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';
import { parseProfile } from '../server/steam.js';
import { buildBande } from '../server/games/bande.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Lecture de l'adresse collée
assert.deepEqual(parseProfile('https://steamcommunity.com/id/gaben/'), { vanity: 'gaben' });
assert.deepEqual(parseProfile('steamcommunity.com/profiles/76561197960287930/games'), { id: '76561197960287930' });
assert.deepEqual(parseProfile('76561197960287930'), { id: '76561197960287930' });
assert.deepEqual(parseProfile('  gaben '), { vanity: 'gaben' });
assert.equal(parseProfile('https://steamcommunity.com/profiles/123'), null);
assert.equal(parseProfile('pas une adresse !'), null);
assert.equal(parseProfile(''), null);
assert.deepEqual(parseProfile('22202'), { id: '76561197960287930' }, 'code ami');

// ---- Faux profils Steam
const G = (appid, name, minutes, recent = 0) => ({ appid, name, playtime_forever: minutes, playtime_2weeks: recent });
const PROFILES = {
  '76561190000000001': { name: 'AliceSteam', public: true, games: [
    G(10, 'Portal 2', 1200, 120), G(20, 'Hades', 3000), G(30, 'Celeste', 600), G(40, 'Hollow Knight', 240), G(50, 'Stardew Valley', 0), G(60, 'Terraria', 0), G(70, 'Dota 2', 90)] },
  '76561190000000002': { name: 'BobSteam', public: true, games: [
    G(10, 'Portal 2', 300), G(20, 'Hades', 4000, 600), G(80, 'Factorio', 9000), G(90, 'Rocket League', 500), G(100, 'Outer Wilds', 0), G(30, 'Celeste', 130)] },
  '76561190000000003': { name: 'CarlSteam', public: false, games: [] },
};
const VANITY = { alice: '76561190000000001', bob: '76561190000000002', carl: '76561190000000003' };
let calls = 0;
const fake = http.createServer((req, res) => {
  calls++;
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u.searchParams.get('key') !== 'cle-test') { res.statusCode = 403; return res.end(); }
  if (u.pathname.startsWith('/ISteamUser/ResolveVanityURL')) {
    const id = VANITY[u.searchParams.get('vanityurl')];
    return json({ response: id ? { success: 1, steamid: id } : { success: 42 } });
  }
  if (u.pathname.startsWith('/ISteamUser/GetPlayerSummaries')) {
    const id = u.searchParams.get('steamids');
    const p = PROFILES[id];
    return json({ response: { players: p ? [{ steamid: id, personaname: p.name, communityvisibilitystate: p.public ? 3 : 1, avatarmedium: 'https://example.invalid/a.jpg', profileurl: `https://steamcommunity.com/profiles/${id}/` }] : [] } });
  }
  if (u.pathname.startsWith('/IPlayerService/GetOwnedGames')) {
    const p = PROFILES[u.searchParams.get('steamid')];
    return json({ response: p?.public ? { game_count: p.games.length, games: p.games } : {} });
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => fake.listen(0, r));
const STEAM_URL = `http://127.0.0.1:${fake.address().port}`;

// ---- Tirage seul : rotation égale entre les joueurs
const steamOf = (id) => ({ status: 'ok', id, games: PROFILES[id].games.map((g) => ({ appid: g.appid, name: g.name, minutes: g.playtime_forever, recent: g.playtime_2weeks })) });
const ctx = { players: [{ id: 'a', name: 'Alice', steam: steamOf('76561190000000001') }, { id: 'b', name: 'Bob', steam: steamOf('76561190000000002') }, { id: 'c', name: 'Carl', steam: null }] };
for (let t = 0; t < 30; t++) {
  const rounds = buildBande(10, new Set(), ctx);
  assert.equal(rounds.length, 10);
  const per = rounds.reduce((m, r) => m.set(r.about, (m.get(r.about) ?? 0) + 1), new Map());
  assert.deepEqual([...per.keys()].sort(), ['a', 'b'], 'seuls les joueurs liés sont concernés');
  assert.equal(per.get('a'), 5, 'autant de questions sur chacun');
  for (const r of rounds) {
    if (r.kind === 'qcm') {
      assert.equal(new Set(r.choices).size, r.choices.length, 'pas de proposition en double');
      assert.ok(r.correctIndex >= 0 && r.correctIndex < r.choices.length);
    }
    if (r.bande === 'shame') assert.ok(['Stardew Valley', 'Terraria', 'Outer Wilds'].includes(r.choices[r.correctIndex]), 'pile de la honte : un jeu jamais lancé');
    if (r.bande === 'top') assert.ok(['Hades', 'Factorio'].includes(r.choices[r.correctIndex]), 'jeu le plus joué');
    if (r.bande === 'most') assert.equal(r.choices[r.correctIndex], r.about === 'a' ? 'Alice' : 'Bob');
    if (r.bande === 'recent') assert.equal(r.about, 'b', 'Bob a le plus joué ces 2 semaines');
  }
}
assert.throws(() => buildBande(5, new Set(), { players: ctx.players.slice(0, 1) }), /2 joueurs/);

// ---- Partie réelle
const PORT = 3994;
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), SUPABASE_URL: '', COUNTDOWN_MS: '300', REVEAL_MS: '300', STEAM_API_KEY: 'cle-test', STEAM_API_URL: STEAM_URL },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));

function client(label) {
  const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true });
  const c = { label, socket, state: null, waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 6000) =>
    c.state && pred(c.state) ? Promise.resolve(c.state) : new Promise((resolve, reject) => {
      c.waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
    });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}

let failed = false;
try {
  const A = client('A'), B = client('B'), C = client('C');
  await Promise.all([A.connected, B.connected, C.connected]);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  await C.emit('room:join', { code, name: 'Carl' });
  let s = await A.waitFor((st) => st.players.length === 3);
  const bande = () => A.state.options.modes.find((m) => m.id === 'bande');
  assert.match(bande().unavailable, /0\/2/, 'grisé, avec la raison');
  assert.match((await A.emit('room:settings', { mode: 'bande' })).error, /2 joueurs/);

  // Liaisons : vanity, adresse complète, profil privé, adresse inconnue
  assert.equal((await A.emit('steam:link', { profile: 'https://steamcommunity.com/id/alice/' })).status, 'ok');
  assert.match((await B.emit('steam:link', { profile: 'inconnu' })).message, /introuvable/);
  const rc = await C.emit('steam:link', { profile: 'carl' });
  assert.equal(rc.status, 'private', 'profil privé repéré');
  s = await C.waitFor((st) => st.players.find((p) => p.name === 'Carl').steam?.status === 'private');
  assert.ok(s.players.find((p) => p.name === 'Carl').steam.privacyUrl, 'lien vers les réglages Steam');
  assert.equal(s.players.find((p) => p.name === 'Alice').steam.input, undefined, 'les autres ne voient pas l\'adresse collée');
  assert.equal(s.players.find((p) => p.name === 'Alice').steam.games, 7);
  assert.match(bande().unavailable ?? '', /1\/2/);
  assert.equal((await B.emit('steam:link', { profile: 'steamcommunity.com/profiles/76561190000000002' })).status, 'ok');
  await A.waitFor(() => bande().unavailable === null);
  const before = calls;
  assert.equal((await B.emit('steam:link', { profile: '76561190000000002' })).status, 'ok');
  assert.equal(calls, before, 'profil en cache : pas de nouvel appel à Steam');
  assert.equal(A.state.players.find((p) => p.name === 'Bob').steam.games, 6);

  // Partie « Ta bande » : 6 questions, 3 sur Alice, 3 sur Bob ; Carl joue sans être concerné
  assert.equal((await A.emit('room:settings', { mode: 'bande', rounds: 5 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const about = new Map();
  let selfSeen = 0;
  for (let i = 0; i < 5; i++) {
    const q = await A.waitFor((st) => st.phase === 'question' && st.round.index === i);
    assert.ok(q.round.about, 'chaque question porte sur un joueur');
    assert.equal(q.round.correctIndex, undefined, 'la réponse ne fuit pas');
    about.set(q.round.about.name, (about.get(q.round.about.name) ?? 0) + 1);
    const ans = q.round.kind === 'estimation' ? 50 : 0;
    for (const c of [A, B, C]) assert.equal((await c.emit('game:answer', { roundId: q.round.id, answer: ans })).ok, true);
    const rev = await A.waitFor((st) => st.phase === 'reveal' && st.round.index === i);
    const subject = rev.reveal.results.find((x) => x.name === q.round.about.name);
    assert.equal(subject.points, 0, 'le joueur concerné ne marque pas');
    assert.equal(subject.self, true);
    selfSeen++;
    if (q.round.kind === 'estimation') {
      const ranked = rev.reveal.results.filter((x) => !x.self).map((x) => x.rank).sort();
      assert.deepEqual(ranked, [1, 2], 'classement de la manche sans le joueur concerné');
    } else {
      // Même réponse pour tous : le joueur concerné a juste ou faux comme les autres, mais 0 point
      const other = rev.reveal.results.find((x) => !x.self);
      assert.equal(subject.correct, other.correct);
    }
  }
  assert.equal(selfSeen, 5);
  assert.deepEqual([...about.values()].sort(), [2, 3], 'questions réparties entre Alice et Bob');
  assert.ok(!about.has('Carl'));
  await A.waitFor((st) => st.phase === 'end', 8000);

  // Mix avec « Ta bande » seul coché (et Quiz, qu'on ne peut pas tout décocher d'un coup)
  await A.emit('game:stop');
  await A.emit('room:settings', { mode: 'mix', rounds: 10, mixInput: 'choice' });
  for (const id of A.state.settings.mixParts.filter((x) => !['quiz', 'bande'].includes(x))) await A.emit('room:settings', { mixPart: id });
  assert.deepEqual(A.state.settings.mixParts, ['quiz', 'bande']);
  assert.equal((await A.emit('game:start')).ok, true);
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const q = await A.waitFor((st) => st.phase === 'question' && st.round.index === i);
    parts.push(q.round.about ? 'bande' : 'quiz');
    await A.emit('game:skip');
  }
  assert.equal(parts.filter((x) => x === 'bande').length, 5, 'moitié de manches « Ta bande » dans le Mix');

  // Un joueur lié s'en va : « Ta bande » redevient grisé
  await A.emit('game:stop');
  await B.emit('steam:unlink');
  await A.waitFor(() => /1\/2/.test(bande().unavailable ?? ''));
  for (const c of [A, B, C]) c.socket.close();
  console.log('✔ Ta bande : liaison Steam, profils privés, rotation, pas de points sur sa question, Mix');
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  server.kill();
  fake.close();
  await sleep(100);
  process.exit(failed ? 1 : 0);
}
