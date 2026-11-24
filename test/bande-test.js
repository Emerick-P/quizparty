// Test « Ta bande » : faux serveur Steam, 3 joueurs (2 profils publics, 1 privé), partie complète, Mix.
// Usage : node test/bande-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';
import { parseProfile } from '../server/steam.js';
import { buildBande, shameCandidates } from '../server/games/bande.js';

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
let lastT = 1_700_000_000;
const G = (appid, name, minutes, recent = 0) => ({ appid, name, playtime_forever: minutes, playtime_2weeks: recent, rtime_last_played: minutes ? (lastT += 86400) : 0 });
const PROFILES = {
  '76561190000000001': { name: 'AliceSteam', public: true, games: [
    G(10, 'Portal 2', 1200, 120), G(20, 'Hades', 3000), G(30, 'Celeste', 600), G(40, 'Hollow Knight', 240), G(50, 'Stardew Valley', 0), G(60, 'Terraria', 0), G(70, 'Dota 2', 90)] },
  '76561190000000002': { name: 'BobSteam', public: true, games: [
    G(10, 'Portal 2', 300), G(20, 'Hades', 4000, 600), G(80, 'Factorio', 9000), G(90, 'Rocket League', 500), G(100, 'Outer Wilds', 0), G(30, 'Celeste', 130)] },
  '76561190000000003': { name: 'CarlSteam', public: false, games: [] },
};
// Succès : nombre débloqué sur 10 par jeu ; le succès n°i est détenu par (50 - 5i) % des joueurs
const ACH = { '76561190000000001': { 30: 10, 20: 9, 10: 8, 40: 5 }, '76561190000000002': { 10: 9, 20: 2, 80: 4, 90: 1 } };
const EXTRA = { '76561190000000001': { created: 1262304000, level: 42 }, '76561190000000002': { created: 1420070400, level: 7 } };
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
    return json({ response: { players: p ? [{ steamid: id, personaname: p.name, timecreated: EXTRA[id]?.created, communityvisibilitystate: p.public ? 3 : 1, avatarmedium: 'https://example.invalid/a.jpg', profileurl: `https://steamcommunity.com/profiles/${id}/` }] : [] } });
  }
  if (u.pathname.startsWith('/IPlayerService/GetOwnedGames')) {
    const p = PROFILES[u.searchParams.get('steamid')];
    return json({ response: p?.public ? { game_count: p.games.length, games: p.games } : {} });
  }
  const sid = u.searchParams.get('steamid');
  if (u.pathname.startsWith('/IPlayerService/GetSteamLevel')) return json({ response: EXTRA[sid] ? { player_level: EXTRA[sid].level } : {} });
  if (u.pathname.startsWith('/ISteamUser/GetFriendList')) {
    if (sid !== '76561190000000001') { res.statusCode = 401; return res.end(); } // liste d'amis de Bob privée
    return json({ friendslist: { friends: [{ steamid: '76561190000000002', relationship: 'friend', friend_since: 1431475200 }] } });
  }
  if (u.pathname.startsWith('/ISteamUserStats/GetPlayerAchievements')) {
    const done = ACH[sid]?.[u.searchParams.get('appid')];
    if (done === undefined) return json({ playerstats: { success: false, error: 'Requested app has no stats' } });
    return json({ playerstats: { success: true, achievements: Array.from({ length: 10 }, (_, i) => ({ apiname: `a${i}`, achieved: i < done ? 1 : 0, name: `Succès ${i}`, description: `Fais le truc ${i}` })) } });
  }
  if (u.pathname.startsWith('/ISteamUserStats/GetGlobalAchievementPercentagesForApp')) {
    return json({ achievementpercentages: { achievements: Array.from({ length: 10 }, (_, i) => ({ name: `a${i}`, percent: String(50 - 5 * i) })) } });
  }
  if (u.pathname.startsWith('/ISteamUserStats/GetSchemaForGame')) {
    return json({ game: { availableGameStats: { achievements: Array.from({ length: 10 }, (_, i) => ({ name: `a${i}`, icon: `https://example.invalid/${i}.jpg` })) } } });
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
  const per = rounds.reduce((m, r) => m.set(r.about ?? 'groupe', (m.get(r.about ?? 'groupe') ?? 0) + 1), new Map());
  assert.deepEqual([...per.keys()].sort(), ['a', 'b', 'groupe'], 'joueurs liés et questions de groupe');
  assert.deepEqual([...per.values()].sort(), [3, 3, 4], 'autant de questions sur chacun');
  for (const r of rounds) {
    if (r.kind === 'qcm') {
      assert.equal(new Set(r.choices).size, r.choices.length, 'pas de proposition en double');
      assert.ok(r.correctIndex >= 0 && r.correctIndex < r.choices.length);
    }
    if (r.bande === 'shame') assert.ok(['Stardew Valley', 'Terraria', 'Outer Wilds'].includes(r.choices[r.correctIndex]), 'pile de la honte : un jeu jamais lancé');
    if (r.bande === 'top') assert.ok(['Hades', 'Factorio'].includes(r.choices[r.correctIndex]), 'jeu le plus joué');
    if (['most', 'recent', 'top', 'shame', 'hours'].includes(r.bande)) assert.equal(r.about == null, ['most', 'recent'].includes(r.bande), 'questions de groupe sans joueur concerné');
    if (r.bande === 'most') assert.ok(['Alice', 'Bob'].includes(r.choices[r.correctIndex]));
    if (r.bande === 'recent') assert.equal(r.choices[r.correctIndex], 'Bob', 'Bob a le plus joué ces 2 semaines');
  }
}
assert.throws(() => buildBande(5, new Set(), { players: ctx.players.slice(0, 1) }), /2 joueurs/);

// ---- Nouveaux types (données complètes, comme après chargement des succès)
{
  const full = (id, extra) => ({ ...steamOf(id), ...extra, games: PROFILES[id].games.map((g) => ({ appid: g.appid, name: g.name, minutes: g.playtime_forever, recent: g.playtime_2weeks, lastPlayed: g.rtime_last_played })) });
  const ach = (id) => Object.entries(ACH[id]).map(([appid, done]) => ({ appid: Number(appid), game: PROFILES[id].games.find((g) => g.appid === Number(appid)).name, total: 10, done, pct: done / 10,
    rarest: { name: `Succès ${done - 1}`, description: '', percent: 50 - 5 * (done - 1), icon: null } }));
  const A = { id: 'a', name: 'Alice', steam: full('76561190000000001', { created: 1262304000, level: 42, friendSince: { '76561190000000002': 1431475200 }, achievements: ach('76561190000000001') }) };
  const B = { id: 'b', name: 'Bob', steam: full('76561190000000002', { created: 1420070400, level: 7, friendSince: {}, achievements: ach('76561190000000002') }) };
  const seen = new Map();
  for (let t = 0; t < 300; t++) {
    for (const r of buildBande(20, new Set(), { players: [A, B, { id: 'c', name: 'Carl', steam: null }] })) {
      seen.set(r.bande, r);
      const answer = r.kind === 'qcm' ? r.choices[r.correctIndex] : r.answer;
      if (r.bande === 'perfect') assert.equal(answer, r.about === 'a' ? 'Celeste' : 'Portal 2');
      if (r.bande === 'perfect') assert.equal(r.prompt.includes('100 %'), r.about === 'a', '« 100 % » seulement si le jeu est fini');
      if (r.bande === 'rarest') assert.equal(answer, 'Alice', 'Alice a le succès le plus rare (5 %)');
      if (r.bande === 'age') assert.equal(answer, /vieux/.test(r.prompt) ? 'Alice' : 'Bob');
      if (r.bande === 'level') assert.equal(answer, /haut/.test(r.prompt) ? 'Alice' : 'Bob');
      if (r.bande === 'library') assert.equal(answer, 'Alice');
      if (r.bande === 'friends') { assert.equal(answer, 2015); assert.deepEqual(r.about, ['a', 'b']); }
      if (r.bande === 'binge') assert.equal(answer, 'Hades');
      if (r.bande === 'last') assert.equal(answer, r.about === 'a' ? 'Dota 2' : 'Celeste');
      if (r.bande === 'count') assert.equal(answer, r.about === 'a' ? 7 : 6);
    }
  }
  for (const t of ['top', 'shame', 'hours', 'most', 'recent', 'binge', 'last', 'perfect', 'rarest', 'age', 'level', 'library', 'count', 'friends']) assert.ok(seen.has(t), `type ${t} tiré`);
  // À deux dans le salon, pas de question d'amitié (personne ne pourrait marquer)
  for (let t = 0; t < 50; t++) assert.ok(buildBande(20, new Set(), { players: [A, B] }).every((r) => r.bande !== 'friends'));
}

// ---- Pile de la honte : bêtas, éditions doublons et préférence pour les jeux lancés par les autres
{
  const g = (appid, name, minutes) => ({ appid, name, minutes, recent: 0 });
  const me = { id: 'x', steam: { games: [g(1, 'Skyrim Special Edition', 9000), g(2, 'The Elder Scrolls V: Skyrim', 0), g(3, 'Halo Infinite Beta', 0),
    g(4, 'Dead Space (2008)', 0), g(5, 'Tomb Raider', 0), g(6, 'Counter-Strike 2 Dedicated Server', 0), g(7, 'Bioshock', 600), g(8, 'BioShock Remastered', 0), g(9, 'Outer Wilds', 0)] } };
  const names = shameCandidates(me).map((x) => x.name).sort();
  for (const n of ['Dead Space (2008)', 'Tomb Raider', 'Outer Wilds']) assert.ok(names.includes(n), `${n} gardé`);
  assert.ok(!names.includes('Halo Infinite Beta') && !names.includes('BioShock Remastered') && !names.includes('Counter-Strike 2 Dedicated Server'));
  const friend = { id: 'y', steam: { games: [g(9, 'Outer Wilds', 1200)] } };
  assert.deepEqual(shameCandidates(me, [me, friend]).map((x) => x.name), ['Outer Wilds'], 'de préférence un jeu lancé par un autre');
}

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
  assert.match((await B.emit('steam:link', { profile: 'alice' })).message, /déjà lié par Alice/, 'même profil refusé');
  assert.equal((await B.emit('steam:link', { profile: 'steamcommunity.com/profiles/76561190000000002' })).status, 'ok');
  await A.waitFor(() => bande().unavailable === null);
  await A.waitFor((st) => st.players.every((p) => p.steam?.status !== 'ok' || typeof p.steam.achievements === 'number'));
  assert.equal(A.state.players.find((p) => p.name === 'Alice').steam.achievements, 4, 'succès chargés en arrière-plan');
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
    assert.equal(q.round.correctIndex, undefined, 'la réponse ne fuit pas');
    const ids = q.round.about?.ids ?? [];
    const who = ids.length === 1 ? q.round.about.name : 'groupe'; // amitié (2 joueurs) : question de groupe
    about.set(who, (about.get(who) ?? 0) + 1);
    const ans = q.round.kind === 'estimation' ? 50 : 0;
    for (const c of [A, B, C]) assert.equal((await c.emit('game:answer', { roundId: q.round.id, answer: ans })).ok, true);
    const rev = await A.waitFor((st) => st.phase === 'reveal' && st.round.index === i);
    if (!q.round.about) {
      assert.ok(rev.reveal.results.every((x) => !x.self), 'question de groupe : tout le monde marque');
      continue;
    }
    for (const id of ids) {
      const x = rev.reveal.results.find((y) => y.playerId === id);
      assert.equal(x.points, 0, 'le joueur concerné ne marque pas');
      assert.equal(x.self, true);
    }
    const subject = rev.reveal.results.find((x) => x.playerId === ids[0]);
    selfSeen++;
    if (q.round.kind === 'estimation') {
      const ranked = rev.reveal.results.filter((x) => !x.self).map((x) => x.rank).sort();
      assert.deepEqual(ranked, ids.length > 1 ? [1] : [1, 2], 'classement de la manche sans le joueur concerné');
    } else {
      // Même réponse pour tous : le joueur concerné a juste ou faux comme les autres, mais 0 point
      const other = rev.reveal.results.find((x) => !x.self);
      assert.equal(subject.correct, other.correct);
    }
  }
  assert.deepEqual([...about.values()].sort(), [1, 2, 2], 'questions réparties entre Alice, Bob et le groupe');
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
    parts.push(q.round.bande ? 'bande' : 'quiz');
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
