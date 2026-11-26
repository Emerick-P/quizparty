// Test des stats de joueur, avec un faux Supabase :
// - à la fin d'une partie finie, une ligne game_results par joueur connecté et une ligne answers par manche ;
// - rien pour les invités, rien pour une partie arrêtée ; un joueur arrivé en route ne compte que la suite ;
// - stats:me (page Profil) et stats:player (joueur connecté du même salon) ; invité refusé ;
// - calcul des stats (computeStats, même logique que la fonction SQL player_stats).
// Usage : node test/stats-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { computeStats } from '../server/stats.js';

// ---- Calcul des stats (sans serveur)
{
  const at = (i) => `2026-11-25T20:00:${String(i).padStart(2, '0')}Z`;
  const rows = [
    [true, 'covers', 'Zelda', 900], [true, 'covers', 'Zelda', 1500], [false, 'covers', 'Halo', 3000], [true, 'quiz', null, 700],
    [true, 'emoji', 'Halo', 2000], [false, 'emoji', 'Doom', 4000], [false, 'emoji', 'Doom', 5000], [null, 'bande', null, 1000],
  ].map(([correct, mode, game, ms], i) => ({ id: i, created_at: at(i), user_id: 'u', source: 'party', session_id: 'S1', mode, game, correct, time_ms: ms }));
  rows.push({ id: 99, created_at: at(30), user_id: 'u', source: 'daily', session_id: '2026-11-25', mode: 'quiz', game: null, correct: true, time_ms: 400 });
  const s = computeStats([{ source: 'party', score: 3200, rank: 1, players: 3, won: true }, { source: 'party', score: 1200, rank: 3, players: 3, won: false }, { source: 'party', score: 800, rank: 2, players: 1, won: false }], rows);
  assert.equal(s.games, 3);
  assert.equal(s.wins, 1);
  assert.equal(s.podiums, 2, 'podium seulement à 2 joueurs ou plus');
  assert.equal(s.bestScore, 3200);
  assert.equal(s.daily, 1, 'un défi du jour');
  assert.equal(s.answers, 8, 'la question sur soi-même (Ta bande) ne compte pas');
  assert.equal(s.correct, 5);
  assert.equal(s.streak, 2, 'deux bonnes réponses d’affilée au mieux');
  assert.deepEqual(s.fastest, { ms: 400, game: null, mode: 'quiz' });
  assert.deepEqual(s.best.map((x) => x.game), ['Zelda', 'Halo']);
  assert.deepEqual(s.worst.map((x) => x.game), ['Doom'], 'Halo (1 sur 2) n’est pas à la fois des deux côtés');
  assert.equal(s.modes[0].mode, 'covers');
  assert.equal(s.modes[0].name, 'Jaquette pixelisée', 'nom du mode joint');
  assert.deepEqual(computeStats([], []).best, []);
  console.log('✓ calcul des stats');
}

const PORT = 3991;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-stats-'));

// ---- Faux Supabase : auth + tables game_results / answers + fonction player_stats
const USERS = {
  'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa': { id: '11111111-1111-4111-8111-111111111111', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'Alice' } },
  'tok-chloe-ccccccccccccccccccccccccc': { id: '33333333-3333-4333-8333-333333333333', app_metadata: { provider: 'google' }, user_metadata: { name: 'Chloé' } },
};
const db = { game_results: [], answers: [] };
let n = 0;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null;
    res.setHeader('Content-Type', 'application/json');
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (req.url === '/auth/v1/settings') return res.end(JSON.stringify({ external: { discord: true, google: true } }));
    if (req.url === '/auth/v1/user') {
      const u = USERS[bearer];
      res.statusCode = u ? 200 : 401;
      return res.end(JSON.stringify(u ?? { msg: 'invalid JWT' }));
    }
    const now = () => new Date(Date.now() + n++).toISOString();
    if (req.method === 'POST' && req.url === '/rest/v1/game_results') {
      const row = { id: `g${db.game_results.length + 1}`, created_at: now(), ...body };
      db.game_results.push(row);
      return res.end(JSON.stringify([row]));
    }
    if (req.method === 'POST' && req.url === '/rest/v1/answers') {
      for (const r of [].concat(body)) db.answers.push({ id: db.answers.length + 1, created_at: now(), ...r });
      return res.end('');
    }
    if (req.method === 'POST' && req.url === '/rest/v1/rpc/player_stats') {
      const s = computeStats(db.game_results.filter((g) => g.user_id === body.uid), db.answers.filter((a) => a.user_id === body.uid));
      for (const m of s.modes) delete m.name; // la fonction SQL ne connaît pas les noms : le serveur les ajoute
      return res.end(JSON.stringify(s));
    }
    res.end('[]');
  });
});
await new Promise((r) => fake.listen(0, r));
const base = `http://localhost:${fake.address().port}`;

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: base,
    SUPABASE_SECRET_KEY: 'sb_secret_test',

    COUNTDOWN_MS: '100',
    REVEAL_MS: '250',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
    FEEDBACK_FILE: path.join(tmp, 'feedback.jsonl'),
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
  c.waitFor = (pred, ms = 10000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const A = client('Alice (compte)'), B = client('Bob (invité)'), C = client('Chloé (compte, arrive en route)');
try {
  await Promise.all([A.connected, B.connected, C.connected]);
  assert.equal((await A.emit('auth:set', { token: 'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa' })).ok, true);
  assert.equal((await C.emit('auth:set', { token: 'tok-chloe-ccccccccccccccccccccccccc' })).ok, true);
  assert.match((await B.emit('stats:me')).error, /Connecte-toi/);
  const empty = await A.emit('stats:me');
  assert.equal(empty.stats.answers, 0, 'pas encore de stats');

  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);
  await A.emit('room:settings', { mode: 'vraifaux', rounds: 5, duration: 10 });

  // Partie arrêtée en route : rien n'est enregistré
  await A.emit('game:start');
  await A.waitFor((s) => s.phase === 'question');
  await A.emit('game:stop');
  await A.waitFor((s) => s.phase === 'lobby');
  await wait(150);
  assert.equal(db.game_results.length, 0, 'partie arrêtée : pas de stats');

  // Partie complète ; Chloé arrive pendant la 3e question
  await A.emit('game:start');
  const players = () => [A, B, ...(C.state ? [C] : [])];
  for (let i = 0; i < 5; i++) {
    const s = await A.waitFor((st) => st.phase === 'question' && st.round.index === i);
    if (i === 2) {
      await C.emit('room:join', { code, name: 'Chloé' });
      await C.waitFor((st) => st.phase === 'question' && st.round.index === 2);
    }
    for (const c of players()) await c.emit('game:answer', { roundId: s.round.id, answer: c === B ? 1 : 0 });
    await A.waitFor((st) => st.phase === 'reveal' && st.round.index === i);
  }
  const end = await A.waitFor((s) => s.phase === 'end');
  await wait(300);

  const alice = USERS['tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa'].id, chloe = USERS['tok-chloe-ccccccccccccccccccccccccc'].id;
  assert.equal(db.game_results.length, 2, 'une ligne par joueur connecté, aucune pour l’invité');
  const ga = db.game_results.find((g) => g.user_id === alice), gc = db.game_results.find((g) => g.user_id === chloe);
  const score = Object.fromEntries(end.players.map((p) => [p.name, p.score]));
  assert.equal(ga.source, 'party');
  assert.equal(ga.mode, 'vraifaux');
  assert.equal(ga.score, score.Alice);
  assert.equal(ga.players, 3);
  assert.equal(ga.rounds, 5);
  assert.equal(gc.rounds, 3, 'arrivée à la 3e question : 3 manches comptées');
  assert.equal(ga.session_id, gc.session_id);
  assert.match(ga.session_id, new RegExp(`^${code}-`));
  const best = Math.max(...Object.values(score));
  assert.equal(ga.won, score.Alice === best && best > 0);
  assert.equal(ga.rank, 1 + Object.entries(score).filter(([k, v]) => k !== 'Alice' && v > score.Alice).length);
  const aa = db.answers.filter((a) => a.user_id === alice);
  assert.equal(aa.length, 5);
  assert.ok(aa.every((a) => a.game_id === ga.id && a.kind === 'qcm' && a.mode === 'vraifaux' && a.input === 'choice' && a.answered === true));
  assert.ok(aa.every((a) => /^vraifaux:\d+$/.test(a.content_id)), 'id du contenu retrouvé');
  assert.equal(aa.filter((a) => a.correct).length, ga.correct);
  assert.ok(aa.every((a) => a.correct ? a.points > 0 && a.time_ms >= 0 : a.points === 0));
  assert.deepEqual(db.answers.filter((a) => a.user_id === chloe).map((a) => a.round_index), [2, 3, 4]);
  console.log('✓ partie finie enregistrée (comptes seulement, arrivée en route, partie arrêtée ignorée)');

  // Lecture
  const me = await A.emit('stats:me');
  assert.equal(me.stats.games, 1);
  assert.equal(me.stats.answers, 5);
  assert.equal(me.stats.correct, ga.correct);
  assert.equal(me.stats.modes[0].name, 'Vrai ou faux');
  const other = await B.emit('stats:player', { playerId: end.players.find((p) => p.name === 'Chloé').id });
  assert.equal(other.ok, true, 'un invité peut voir les stats d’un joueur connecté du salon');
  assert.equal(other.name, 'Chloé');
  assert.equal(other.stats.answers, 3);
  assert.match((await A.emit('stats:player', { playerId: end.players.find((p) => p.name === 'Bob').id })).error, /invité/);
  assert.ok((await A.emit('stats:player', { playerId: 'inconnu' })).error);
  console.log('✓ stats:me et stats:player');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [A, B, C]) c.socket.close();
  server.kill();
  fake.close();
}
console.log(failed ? 'ÉCHEC' : 'stats : OK');
process.exit(failed ? 1 : 0);
