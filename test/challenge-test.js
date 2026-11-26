// Test des défis entre potes, avec un faux Supabase (tables en mémoire) :
// - création réservée aux comptes, réglages validés, modes réservés selon le rôle du créateur ;
// - mêmes manches pour tous (et après un redémarrage), une tentative par compte et par appareil d'invité ;
// - classement commun (invités compris, marqués), « Mes défis », défi clos après sa date de fin.
// Usage : node test/challenge-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { playerKey, cleanCode } from '../server/challenges.js';

const PORT = 3992;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-chal-'));

// ---- Faux Supabase : Auth (jetons → comptes) + REST générique en mémoire (eq, gte, order, limit)
const USERS = {
  'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa': { id: 'aaaaaaaa-0000-4000-8000-000000000001', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'Alice' } },
  'tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb': { id: 'bbbbbbbb-0000-4000-8000-000000000002', app_metadata: { provider: 'google' }, user_metadata: { name: 'Bruno' } },
  'tok-carla-cccccccccccccccccccccccc': { id: 'cccccccc-0000-4000-8000-000000000003', app_metadata: { provider: 'google' }, user_metadata: { name: 'Carla' } },
};
const tables = { profiles: [{ id: 'cccccccc-0000-4000-8000-000000000003', role: 'friend' }] };
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

const DEV_G = 'device-guest-0123456789abcdef';
const DEV_H = 'device-other-0123456789abcdef';
const roundsOf = (code) => T('challenges').find((c) => c.id === code)?.rounds;

let failed = false;
try {
  assert.equal(cleanCode(' ab-c d2e '), 'ABCD2E');
  assert.equal(playerKey(null, 'court'), null, 'identifiant d’appareil trop court refusé');
  assert.match(playerKey(null, DEV_G), /^g:[0-9a-f]{24}$/);
  assert.equal(playerKey({ id: 'x' }, DEV_G), 'u:x');

  await startServer();
  const A = client('Alice'), B = client('Bruno'), C = client('Carla'), G = client('Invité'), H = client('Invité 2');
  await Promise.all([A, B, C, G, H].map((c) => c.connected));
  assert.ok((await A.emit('auth:set', { token: 'tok-alice-aaaaaaaaaaaaaaaaaaaaaaaa' })).ok);
  assert.ok((await B.emit('auth:set', { token: 'tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb' })).ok);
  assert.ok((await C.emit('auth:set', { token: 'tok-carla-cccccccccccccccccccccccc' })).ok);

  // ---- Réglages proposés : pas de mots croisés ni de Ta bande ; sons seulement pour un compte autorisé
  const oa = await A.emit('challenge:options');
  const ids = oa.modes.map((m) => m.id);
  assert.ok(ids.includes('mix') && ids.includes('quiz'));
  assert.ok(!ids.includes('crossword') && !ids.includes('bande') && !ids.includes('sounds'), ids.join());
  assert.deepEqual(oa.defaults, { mode: 'mix', rounds: 10, duration: 15 });

  // ---- Création
  assert.match((await G.emit('challenge:create', {})).error, /Connecte-toi/);
  assert.match((await A.emit('challenge:create', { mode: 'sounds' })).error, /indisponible/);
  assert.match((await A.emit('challenge:create', { mode: 'crossword' })).error, /indisponible/);
  assert.match((await A.emit('challenge:create', { rounds: 7 })).error, /questions/);
  assert.match((await A.emit('challenge:create', { duration: 99 })).error, /Durée/);
  const made = await A.emit('challenge:create', { mode: 'mix', rounds: 5, duration: 10 });
  assert.ok(made.ok, made.error);
  const code = made.challenge.id;
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(made.challenge.rounds, 5);
  assert.equal(made.challenge.by, 'Alice');
  assert.ok(made.challenge.endsAt - Date.now() > 6.9 * 86400_000, 'ouvert 7 jours');
  // Mix d'un compte non autorisé : aucun son, même en demandant explicitement les modes réservés
  assert.ok(!roundsOf(code).some((r) => r.mixPart === 'sounds' || r.kind === 'sound'));
  for (let i = 0; i < 8; i++) {
    const m = await A.emit('challenge:create', { mode: 'mix', rounds: 15, duration: 10, mixParts: ['sounds'] });
    assert.ok(m.ok, m.error);
    assert.ok(!roundsOf(m.challenge.id).some((r) => r.mixPart === 'sounds' || r.kind === 'sound' || r.sound), 'pas de son dans le Mix d’un joueur');
  }

  // ---- Page du défi avant d'avoir joué : pas de classement
  let info = await B.emit('challenge:info', { code: code.toLowerCase(), device: DEV_H });
  assert.ok(info.ok, info.error);
  assert.equal(info.played, null);
  assert.equal(info.leaderboard, null);
  assert.equal(info.mine, false);
  assert.equal((await A.emit('challenge:info', { code, device: DEV_H })).mine, true);
  assert.match((await B.emit('challenge:info', { code: 'ZZZZZZ' })).error, /introuvable/);

  // ---- Bruno et un invité jouent : mêmes manches, même ordre ; on ne rejoint pas la partie d'un autre
  const sb = await B.emit('challenge:start', { code, name: 'Bruno', device: DEV_H });
  assert.ok(sb.ok, sb.error);
  assert.match((await H.emit('room:join', { code: sb.code, name: 'Intrus' })).error, /introuvable/);
  assert.equal(T('challenge_results').length, 1, 'la tentative compte dès le départ');
  assert.match((await G.emit('challenge:start', { code, name: 'Gus' })).error, /Appareil/);
  const sg = await G.emit('challenge:start', { code, name: 'Gus', device: DEV_G });
  assert.ok(sg.ok, sg.error);
  const s0 = await B.waitFor((s) => s.round && s.daily?.challenge);
  assert.equal(s0.daily.challenge.id, code);
  assert.equal(s0.settings.duration, 10);
  assert.match((await B.emit('game:pause')).error, /pause/);
  const [seenB, seenG] = await Promise.all([play(B), play(G)]);
  assert.equal(seenB.length, 5);
  assert.deepEqual(seenG, seenB, 'mêmes manches pour tous');
  const endB = await B.waitFor((s) => s.phase === 'end' && s.daily.leaderboard);
  assert.equal(endB.daily.me, `u:${USERS['tok-bruno-bbbbbbbbbbbbbbbbbbbbbbbb'].id}`);
  const endG = await G.waitFor((s) => s.phase === 'end' && s.daily.leaderboard?.length === 2);
  assert.ok(endG.daily.leaderboard.some((x) => x.guest && x.name === 'Gus'), 'invité au classement, marqué');

  // ---- Une seule tentative (compte, et appareil d'invité même sur un autre socket)
  await B.emit('room:leave');
  await G.emit('room:leave');
  assert.equal((await B.emit('challenge:start', { code, name: 'Bruno', device: DEV_G })).already, true);
  assert.equal((await H.emit('challenge:start', { code, name: 'Gus bis', device: DEV_G })).already, true);
  info = await H.emit('challenge:info', { code, device: DEV_G });
  assert.ok(info.played && info.leaderboard.length === 2, 'après avoir joué : résultat et classement');
  // Stats : les réponses d'un compte partent avec la source 'challenge'
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(T('game_results').some((g) => g.source === 'challenge' && g.session_id === code), 'stats enregistrées');

  // ---- Mes défis
  const la = await A.emit('challenge:list', { device: DEV_H });
  const mineA = la.list.find((x) => x.id === code);
  assert.equal(la.list.length, 9);
  assert.equal(mineA.mine, true);
  assert.equal(mineA.players, 2);
  const lb = await B.emit('challenge:list', { device: 'peu-importe-0123456789' });
  assert.equal(lb.list[0].id, code);
  assert.ok(lb.list[0].played && lb.list[0].rank >= 1);
  const lg = await H.emit('challenge:list', { device: DEV_G, codes: [] });
  assert.equal(lg.list[0]?.id, code, 'invité : ses défis joués, retrouvés par son appareil');

  // ---- Carla (rôle friend) peut créer un défi de sons ; après redémarrage, mêmes manches
  const oc = await C.emit('challenge:options');
  assert.ok(oc.modes.some((m) => m.id === 'sounds'), 'sons proposés à un compte friend');
  const ms = await C.emit('challenge:create', { mode: 'sounds', rounds: 5 });
  assert.ok(ms.ok, ms.error);
  // Son Mix peut contenir des sons (sur 3 défis de 15 questions, au moins un)
  let withSound = false;
  for (let i = 0; i < 3 && !withSound; i++) {
    const m = await C.emit('challenge:create', { mode: 'mix', rounds: 15 });
    withSound = roundsOf(m.challenge.id).some((r) => r.kind === 'sound');
  }
  assert.ok(withSound, 'le Mix d’un compte friend inclut les sons');
  await stopServer();
  await startServer();
  const D = client('Daphné');
  await D.connected;
  const sd = await D.emit('challenge:start', { code, name: 'Daphné', device: 'device-daphne-0123456789ab' });
  assert.ok(sd.ok, sd.error);
  const seenD = await play(D);
  assert.deepEqual(seenD, seenB, 'même défi après redémarrage');
  await D.emit('room:leave');

  // ---- Défi clos : on ne peut plus le jouer, le classement final reste visible
  T('challenges').find((c) => c.id === code).ends_at = new Date(Date.now() - 1000).toISOString();
  await stopServer();
  await startServer();
  const E2 = client('Émile');
  await E2.connected;
  assert.match((await E2.emit('challenge:start', { code, name: 'Émile', device: 'device-emile-0123456789abc' })).error, /terminé/);
  info = await E2.emit('challenge:info', { code, device: 'device-emile-0123456789abc' });
  assert.equal(info.closed, true);
  assert.equal(info.leaderboard.length, 3, 'classement final visible sans avoir joué');

  for (const c of [A, B, C, G, H, D, E2]) c.socket.close();
  console.log('✓ défis entre potes : création (comptes), mêmes manches pour tous, une tentative, classement commun, Mes défis, défi clos');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  server?.kill();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
