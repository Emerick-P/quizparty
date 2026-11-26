// Test du défi du jour, avec un faux Supabase (tables en mémoire) :
// - le même défi (mêmes manches, même ordre) pour tous, et après un redémarrage du serveur ;
// - une seule tentative par compte ; quitter en cours compte comme terminé avec les points faits ;
// - classement du jour, série de jours d'affilée, résultat partagé (🟩🟨🟥) ;
// - invité : il joue, sans ligne au classement ; le code du défi ne permet pas de rejoindre la partie ;
// - pas de pause ni de « Passer » sur une question ; estimation notée selon l'écart (on joue seul).
// Usage : node test/daily-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { dayKey, previousDay, nextDayAt, cellOf, gridText } from '../server/daily.js';

const PORT = 3991;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-daily-'));

// ---- Faux Supabase : Auth (jetons → comptes) + REST générique en mémoire (eq, gte, order, limit)
const USERS = {
  'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa': { id: 'aaaaaaaa-0000-4000-8000-000000000001', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'Alice' } },
  'tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb': { id: 'bbbbbbbb-0000-4000-8000-000000000002', app_metadata: { provider: 'google' }, user_metadata: { name: 'Bruno' } },
  'tok-carla-cccccccccccccccccccccccc': { id: 'cccccccc-0000-4000-8000-000000000003', app_metadata: { provider: 'google' }, user_metadata: { name: 'Carla' } },
};
const tables = {};
const T = (name) => (tables[name] ??= []);
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    res.setHeader('Content-Type', 'application/json');
    const u = new globalThis.URL(req.url, 'http://x');
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/settings') return res.end(JSON.stringify({ external: { discord: true, google: true } }));
    if (u.pathname === '/auth/v1/user') {
      const user = USERS[bearer];
      res.statusCode = user ? 200 : 401;
      return res.end(JSON.stringify(user ?? {}));
    }
    const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) return res.end('[]');
    const rows = T(m[1]);
    if (req.method === 'GET') {
      let out = rows.filter((r) => [...u.searchParams].every(([k, v]) => {
        if (['select', 'limit', 'order'].includes(k)) return true;
        const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
        return op === 'eq' ? String(r[k]) === val : op === 'gte' ? String(r[k]) >= val : true;
      }));
      const order = u.searchParams.get('order');
      if (order) {
        const keys = order.split(',').map((o) => o.split('.'));
        out = [...out].sort((a, b) => {
          for (const [col, dir] of keys) {
            const c = a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0;
            if (c) return dir === 'desc' ? -c : c;
          }
          return 0;
        });
      }
      return res.end(JSON.stringify(out.slice(0, Number(u.searchParams.get('limit') || 1000))));
    }
    if (req.method === 'POST') {
      const list = [].concat(JSON.parse(body || '[]'));
      const merge = /merge-duplicates/.test(req.headers.prefer || '');
      for (const row of list) {
        const i = rows.findIndex((r) => row.id != null && r.id === row.id);
        if (i >= 0 && !merge) { res.statusCode = 409; return res.end('{"code":"23505"}'); }
        if (i >= 0) rows[i] = { ...rows[i], ...row };
        else rows.push({ created_at: new Date().toISOString(), ...row });
      }
      return res.end(JSON.stringify(list));
    }
    res.end('[]');
  });
});
await new Promise((r) => fake.listen(0, r));
const base = `http://localhost:${fake.address().port}`;

let server;
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SUPABASE_URL: base,
      SUPABASE_SECRET_KEY: 'sb_secret_test',
      ADMIN_USER_IDS: '',

      COUNTDOWN_MS: '150',
      REVEAL_MS: '60000', // on passe la correction à la main (« Suivant »)
      TWITCH_CLIENT_ID: '',
      TWITCH_CLIENT_SECRET: '',
      IMAGE_CACHE_DIR: tmp,
      BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
      FEEDBACK_FILE: path.join(tmp, 'feedback.jsonl'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));
}
const stopServer = () => new Promise((r) => { server.once('exit', r); server.kill(); });

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
          setTimeout(() => reject(new Error(`${c.label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}

/** Réponse à la manche en cours : `good` = la bonne quand on la connaît (côté test, via la correction). */
function answerFor(r) {
  if (r.kind === 'estimation') return r.year ? 1990 : 100;
  if (r.choices) return 0;
  return 'zzz';
}
/** Joue n manches (toutes si n absent) en répondant tout de suite ; renvoie les énoncés vus. */
async function play(c, n = Infinity) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    const s = await c.waitFor((x) => x.phase === 'end' || (x.round && x.round.index === i && ['countdown', 'question'].includes(x.phase)));
    if (s.phase === 'end') break;
    const r = s.round;
    seen.push(`${r.kind}:${r.prompt}:${(r.choices || []).join('|')}:${r.pitch || ''}${JSON.stringify(r.emojis ?? '')}${r.image?.url ?? ''}${r.sound?.url ?? ''}`);
    await new Promise((res) => setTimeout(res, Math.max(0, r.startsAt - Date.now() + 30)));
    // Plusieurs essais (réponse tapée) : on les épuise
    for (let t = 0; t < (r.tries || 1); t++) {
      const a = await c.emit('game:answer', { roundId: r.id, answer: answerFor(r) });
      if (!a.wrong) break;
    }
    await c.waitFor((x) => x.phase === 'reveal' && x.round.index === i);
    if (i + 1 < n) {
      const sk = await c.emit('game:skip');
      assert.ok(!sk.error, sk.error);
    }
  }
  return seen;
}
const rowsOf = (day) => T('daily_results').filter((r) => r.day === day);

let failed = false;
try {
  // ---- Fonctions pures : jour à Paris, case du résultat
  assert.equal(dayKey(Date.parse('2026-11-25T22:59:00Z')), '2026-11-25');
  assert.equal(dayKey(Date.parse('2026-11-25T23:01:00Z')), '2026-11-26', 'minuit à Paris = 23 h UTC en hiver');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(nextDayAt(Date.parse('2026-11-25T12:00:00Z')), Date.parse('2026-11-25T23:00:00Z'));
  assert.equal(nextDayAt(Date.parse('2026-07-01T12:00:00Z')), Date.parse('2026-07-01T22:00:00Z'), 'heure d’été');
  assert.equal(cellOf({ kind: 'qcm', correct: true, points: 900, timeMs: 3000, durationMs: 15000 }), 'fast');
  assert.equal(cellOf({ kind: 'qcm', correct: true, points: 600, timeMs: 12000, durationMs: 15000 }), 'slow');
  assert.equal(cellOf({ kind: 'qcm', correct: false, points: 0 }), 'miss');
  assert.equal(cellOf(null), 'miss');
  assert.equal(cellOf({ kind: 'estimation', correct: true, exact: false, points: 300 }), 'slow');
  assert.equal(gridText(['fast', 'slow', 'miss']), '🟩🟨🟥');

  await startServer();
  const day = dayKey();
  // Bruno a joué hier, avec une série de 4 jours
  T('daily_results').push({ id: `${previousDay(day)}:${USERS['tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb'].id}`, day: previousDay(day), user_id: USERS['tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb'].id, name: 'Bruno', score: 5000, streak: 4, finished: true });

  const A = client('Alice'), B = client('Bruno'), G = client('Invité'), X = client('Intrus');
  await Promise.all([A.connected, B.connected, G.connected, X.connected]);
  assert.ok((await A.emit('auth:set', { token: 'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa' })).ok);
  assert.ok((await B.emit('auth:set', { token: 'tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb' })).ok);

  // ---- Accueil : pas encore joué
  let info = await A.emit('daily:info');
  assert.equal(info.day, day);
  assert.equal(info.rounds, 10);
  assert.equal(info.played, null);
  assert.equal(info.leaderboard, null, 'classement caché avant d’avoir joué');
  assert.equal(info.streak, 0);
  assert.ok(info.nextAt > Date.now());
  assert.equal((await B.emit('daily:info')).streak, 4, 'série d’hier encore en cours');

  // ---- Alice et l'invité jouent : mêmes manches, dans le même ordre
  const sa = await A.emit('daily:start', { name: 'Alice' });
  assert.ok(sa.ok, sa.error);
  assert.equal(rowsOf(day).length, 1, 'la tentative est enregistrée dès le départ');
  const sg = await G.emit('daily:start', { name: 'Invité' });
  assert.ok(sg.ok, sg.error);
  assert.notEqual(sa.code, sg.code, 'chacun sa partie');
  // Le code d'une partie du défi ne permet pas de la rejoindre
  assert.match((await X.emit('room:join', { code: sa.code, name: 'Intrus' })).error, /introuvable/);
  const s0 = await A.waitFor((s) => s.round && s.daily);
  assert.equal(s0.daily.number, info.number);
  assert.equal(s0.daily.account, true);
  assert.equal(s0.players.length, 1, 'on joue seul');
  // Pas de pause ni de « Passer » sur une question
  assert.match((await A.emit('game:pause')).error, /pause/);
  assert.match((await A.emit('game:skip')).error, /Passer/);
  assert.ok((await A.emit('room:settings', { rounds: 5 })).error);

  const [seenA, seenG] = await Promise.all([play(A), play(G)]);
  assert.equal(seenA.length, 10);
  assert.deepEqual(seenA, seenG, 'mêmes manches pour tous, dans le même ordre (choix compris)');
  assert.ok(new Set(seenA.map((x) => x.split(':')[0])).size >= 4, 'des manches de plusieurs modes');

  const endA = await A.waitFor((s) => s.phase === 'end' && s.daily.leaderboard);
  assert.equal(endA.daily.cells.length, 10);
  assert.equal([...endA.daily.grid].length, 10, '10 cases dans le résultat');
  assert.equal(endA.daily.streak, 1);
  assert.equal(endA.daily.leaderboard.length, 1, 'l’invité n’est pas au classement');
  assert.equal(endA.daily.leaderboard[0].name, 'Alice');
  const rowA = rowsOf(day).find((r) => r.name === 'Alice');
  assert.equal(rowA.finished, true);
  assert.equal(rowA.score, endA.players[0].score);
  assert.equal(rowA.grid, endA.daily.grid);
  // Stats : les réponses du défi partent dans la table commune (source 'daily', session = le jour)
  await new Promise((r) => setTimeout(r, 200));
  const ansA = T('answers').filter((x) => x.user_id === USERS['tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa'].id);
  assert.equal(ansA.length, 10);
  assert.ok(ansA.every((x) => x.source === 'daily' && x.session_id === day));
  assert.ok(T('game_results').some((x) => x.source === 'daily' && x.mode === 'daily'));
  assert.ok(!T('game_results').some((x) => x.source === 'party'), 'pas de partie entre amis comptée en plus');

  // ---- Une seule tentative
  const again = await A.emit('daily:start', { name: 'Alice' });
  assert.equal(again.already, true);
  assert.equal(again.played.score, rowA.score);
  info = await A.emit('daily:info');
  assert.equal(info.played.grid, rowA.grid);
  assert.equal(info.streak, 1);
  assert.equal(info.leaderboard.length, 1);
  // Un invité qui a joué peut voir le classement
  assert.equal((await G.emit('daily:board')).leaderboard.length, 1);

  // ---- Bruno : 2 manches puis il quitte → terminé avec ses points, série 5
  assert.ok((await B.emit('daily:start', { name: 'Bruno' })).ok);
  await play(B, 2);
  const scoreB = B.state.players[0].score;
  await B.emit('room:leave');
  await new Promise((r) => setTimeout(r, 200));
  const rowB = rowsOf(day).find((r) => r.name === 'Bruno');
  assert.equal(rowB.finished, true, 'quitter compte comme terminé');
  assert.equal(rowB.score, scoreB);
  assert.equal(rowB.streak, 5);
  assert.equal([...rowB.grid].length, 10, 'manches non jouées comptées comme ratées');
  assert.ok(rowB.grid.endsWith('🟥'.repeat(8)));
  const againB = await B.emit('daily:start', { name: 'Bruno' });
  assert.equal(againB.already, true, JSON.stringify(againB));

  // ---- Redémarrage du serveur : même défi
  const challenges = T('daily_challenges').length;
  await stopServer();
  await startServer();
  assert.equal(T('daily_challenges').length, challenges, 'pas de nouveau tirage');
  const C = client('Carla');
  await C.connected;
  assert.ok((await C.emit('auth:set', { token: 'tok-carla-cccccccccccccccccccccccc' })).ok);
  assert.ok((await C.emit('daily:start', { name: 'Carla' })).ok);
  const seenC = await play(C);
  assert.deepEqual(seenC, seenA, 'même défi après redémarrage');
  const endC = await C.waitFor((s) => s.phase === 'end' && s.daily.leaderboard);
  assert.equal(endC.daily.leaderboard.length, 3);
  const scores = endC.daily.leaderboard.map((x) => x.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'classement par score');

  for (const c of [A, B, G, X, C]) c.socket.close();
  console.log('✓ défi du jour : même défi pour tous (et après redémarrage), une tentative, classement, série, partage');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  server?.kill();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
