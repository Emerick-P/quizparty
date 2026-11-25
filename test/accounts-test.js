// Test des comptes joueurs (Discord / Google via Supabase Auth), avec un faux Supabase :
// - le serveur vérifie les jetons auprès de Supabase (/auth/v1/user) et décide seul qui est admin ;
// - ⚑ Signaler ouvert à tous, sans pause ; accepter une réponse / supprimer une question : admin seulement ;
// - rôle admin lu dans la table profiles (colonne role) ;
// - retirer un jeu : admin seulement, même s'il n'est pas l'hôte ; l'hôte non admin ne peut plus ;
// - profil copié dans la table profiles ; renouvellement et suppression du compte ; pages légales.
// Usage : node test/accounts-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const PORT = 3987;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-accounts-'));
const FEEDBACK_FILE = path.join(tmp, 'feedback.jsonl');

// ---- Faux Supabase
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USERS = {
  'tok-admin-aaaaaaaaaaaaaaaaaaaaaaaa': { id: ADMIN_ID, email: 'admin@example.com', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'liargo', custom_claims: { global_name: 'Liargo' }, avatar_url: 'https://cdn.discordapp.com/avatars/1/a.png' } },
  'tok-player-bbbbbbbbbbbbbbbbbbbbbbb': { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com', app_metadata: { provider: 'google' }, user_metadata: { name: 'Bob Martin', picture: 'https://lh3.googleusercontent.com/b' } },
};
const seen = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (req.url === '/auth/v1/settings') return res.end(JSON.stringify({ external: { discord: true, google: false, email: true } }));
    if (req.url === '/auth/v1/user') {
      const u = USERS[bearer];
      res.statusCode = u ? 200 : 401;
      return res.end(JSON.stringify(u ?? { msg: 'invalid JWT' }));
    }
    if (req.url.startsWith('/auth/v1/token?grant_type=refresh_token')) {
      const { refresh_token } = JSON.parse(body || '{}');
      if (refresh_token !== 'refresh-ok') { res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
      return res.end(JSON.stringify({ access_token: 'tok-player-bbbbbbbbbbbbbbbbbbbbbbb', refresh_token: 'refresh-2', expires_in: 3600 }));
    }
    if (req.url.startsWith('/auth/v1/admin/users/') && req.method === 'DELETE') return res.end('{}');
    if (req.method === 'GET' && req.url.startsWith(`/rest/v1/profiles?id=eq.${ADMIN_ID}`)) return res.end(JSON.stringify([{ id: ADMIN_ID, nickname: 'Liar', role: 'admin' }]));
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
    ADMIN_USER_IDS: '',
    ACCESS_CODE: '',
    CONTACT_EMAIL: 'contact@example.com',
    COUNTDOWN_MS: '200',
    REVEAL_MS: '60000',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
    FEEDBACK_FILE,
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
const lines = () => (fs.existsSync(FEEDBACK_FILE) ? fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const post = (p, body) => fetch(URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let failed = false;
const A = client('A (hôte invité)'), B = client('B (admin)'), C = client('C (invité)');
try {
  // ---- Configuration : seuls les fournisseurs activés dans Supabase sont proposés
  let r = await fetch(URL + '/api/auth/config');
  assert.deepEqual(await r.json(), { enabled: true, url: base, providers: ['discord'] });

  // ---- Pages légales
  r = await fetch(URL + '/confidentialite');
  assert.equal(r.status, 200);
  const privacy = await r.text();
  assert.match(privacy, /Règles de confidentialité/);
  assert.match(privacy, /contact@example\.com/, 'adresse de contact tirée de CONTACT_EMAIL');
  assert.match(await (await fetch(URL + '/conditions')).text(), /Conditions d’utilisation/);

  await Promise.all([A.connected, B.connected, C.connected]);
  // Jeton invalide : refusé, pas de compte
  assert.ok((await B.emit('auth:set', { token: 'tok-faux-ccccccccccccccccccccccccc' })).error);
  const login = await B.emit('auth:set', { token: 'tok-admin-aaaaaaaaaaaaaaaaaaaaaaaa' });
  assert.deepEqual(login.user, { name: 'Liargo', avatar: 'https://cdn.discordapp.com/avatars/1/a.png', provider: 'discord', admin: true, nickname: 'Liar' });
  const bob = await C.emit('auth:set', { token: 'tok-player-bbbbbbbbbbbbbbbbbbbbbbb' });
  assert.equal(bob.user.name, 'Bob Martin');
  assert.equal(bob.user.admin, false);
  // Le navigateur ne peut pas se déclarer admin : seul le jeton compte
  assert.ok(seen.some((x) => x.url === '/auth/v1/user' && x.headers.apikey === 'sb_secret_test'), 'vérification avec la clé secrète du serveur');

  // Profil copié dans profiles (pour les futures fonctions)
  await new Promise((res) => setTimeout(res, 100));
  const prof = seen.filter((x) => x.url === '/rest/v1/profiles' && x.method === 'POST').map((x) => JSON.parse(x.body));
  assert.ok(prof.some((p) => p.id === ADMIN_ID && p.name === 'Liargo' && p.provider === 'discord'), 'profil admin copié');
  assert.equal(seen.find((x) => x.url === '/rest/v1/profiles').headers.prefer, 'resolution=merge-duplicates');

  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Liargo' });
  await C.emit('room:join', { code, name: 'Chloé' });
  let [sa, sb, sc] = await Promise.all([A.waitFor((s) => s.players.length === 3), B.waitFor((s) => s.players.length === 3), C.waitFor((s) => s.players.length === 3)]);
  assert.equal(sa.admin, false, "l'hôte invité n'est pas admin");
  assert.equal(sb.admin, true, 'le compte admin l’est, sans être hôte');
  assert.equal(sc.admin, false);
  assert.deepEqual(sa.players.map((p) => p.account), [false, true, true], 'on voit qui a un compte, sans plus');
  assert.ok(!JSON.stringify(sa).includes('example.com'), 'aucun e-mail dans l’état diffusé');

  // ---- Page Profil : pseudo enregistré sur le compte, appliqué dans le salon avant la partie
  let pn = await C.emit('profile:name', { name: 'Bobby' });
  assert.equal(pn.renamed, 'Bobby');
  await A.waitFor((s) => s.players.some((p) => p.name === 'Bobby'));
  const nick = seen.filter((x) => x.url === '/rest/v1/profiles' && x.method === 'POST').map((x) => JSON.parse(x.body)).find((p) => p.nickname);
  assert.deepEqual(nick, { id: '22222222-2222-4222-8222-222222222222', nickname: 'Bobby' }, 'seul le pseudo est mis à jour');
  pn = await A.emit('profile:name', { name: 'bobby' });
  assert.equal(pn.renamed, 'bobby 2', 'pseudo déjà pris dans le salon');
  assert.ok(!seen.some((x) => x.body.includes('bobby 2')), 'un invité : rien en base');
  assert.ok((await A.emit('profile:name', { name: '   ' })).error);
  await A.emit('profile:name', { name: 'Alice' });

  await A.emit('room:settings', { mode: 'quiz' });
  await A.emit('room:settings', { input: 'text' });
  await A.emit('game:start');
  sc = await C.waitFor((s) => s.phase === 'question');
  const rid = sc.round.id;
  pn = await C.emit('profile:name', { name: 'Bob' });
  assert.equal(pn.renamed, null, 'pas de changement de nom en pleine partie');

  // ---- ⚑ pour tous, sans pause
  assert.ok(!(await C.emit('game:report', { type: 'wrong', comment: 'La date est fausse', roundId: rid, resume: true })).error, 'un invité peut signaler une erreur');
  assert.equal((await C.emit('game:pause')).error, "Seul l'hôte peut faire ça");
  sc = await C.waitFor((s) => s.round?.reported === 1);
  assert.equal(sc.paused, null, 'un signalement de joueur ne met pas en pause');
  assert.match((await C.emit('game:report', { type: 'remove', roundId: rid })).error, /admin/, 'supprimer : admin seulement');
  assert.match((await C.emit('game:report', { type: 'accept', accept: 'x', roundId: rid })).error, /admin/, 'accepter : admin seulement');
  assert.match((await A.emit('game:report', { type: 'remove', roundId: rid })).error, /admin/, "l'hôte non admin non plus");
  assert.match((await C.emit('game:report', { type: 'wrong', roundId: 'autre' })).error, /passée/, 'question déjà passée');
  assert.ok(!(await B.emit('game:report', { type: 'remove', comment: 'Doublon', roundId: rid })).error, "l'admin peut tout");
  assert.ok(!(await B.emit('game:report', { type: 'accept', accept: 'Zelda BOTW', roundId: rid })).error);

  // ---- Retirer un jeu : admin seulement (l'hôte invité ne peut plus)
  assert.match((await A.emit('game:ban-cover')).error, /admin/);
  assert.match((await C.emit('game:ban-cover')).error, /admin/);
  assert.match((await B.emit('game:ban-cover')).error, /image/, "l'admin passe le contrôle (pas d'image en mode quiz)");

  const fb = lines();
  assert.equal(fb.length, 3);
  assert.deepEqual(fb.map((e) => [e.type, e.admin, e.host, e.user_id]), [
    ['wrong', false, false, '22222222-2222-4222-8222-222222222222'],
    ['remove', true, false, ADMIN_ID],
    ['accept', true, false, ADMIN_ID],
  ]);
  await new Promise((res) => setTimeout(res, 100));
  const rows = seen.filter((x) => x.url === '/rest/v1/reports' && x.method === 'POST').map((x) => JSON.parse(x.body));
  assert.equal(rows.length, 3);
  assert.equal(rows[1].data.admin, true, 'consigne admin repérable dans Supabase');

  // ---- Déconnexion : plus admin
  await B.emit('auth:clear');
  sb = await B.waitFor((s) => s.admin === false);
  assert.match((await B.emit('game:ban-cover')).error, /admin/);
  // Reconnexion (nouvel appareil, même compte) : de nouveau admin
  await B.emit('auth:set', { token: 'tok-admin-aaaaaaaaaaaaaaaaaaaaaaaa' });
  await B.waitFor((s) => s.admin === true);

  // ---- Renouvellement et suppression du compte
  r = await post('/api/auth/refresh', { refresh_token: 'refresh-ok' });
  const ref = await r.json();
  assert.equal(ref.refresh_token, 'refresh-2');
  assert.ok(ref.expires_at > Date.now() / 1000);
  assert.equal((await post('/api/auth/refresh', { refresh_token: 'mauvais' })).status, 401);
  assert.equal((await post('/api/auth/delete', { access_token: 'tok-faux-ccccccccccccccccccccccccc' })).status, 401);
  r = await post('/api/auth/delete', { access_token: 'tok-player-bbbbbbbbbbbbbbbbbbbbbbb' });
  assert.equal(r.status, 200);
  assert.ok(seen.some((x) => x.method === 'DELETE' && x.url === '/auth/v1/admin/users/22222222-2222-4222-8222-222222222222'));
  assert.ok(seen.some((x) => x.method === 'DELETE' && x.url === '/rest/v1/profiles?id=eq.22222222-2222-4222-8222-222222222222'));

  console.log('✓ Comptes : vérification serveur, ⚑ pour tous sans pause, actions admin réservées, profils, renouvellement, suppression, pages légales');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of [A, B, C]) c.socket.close();
  server.kill();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
