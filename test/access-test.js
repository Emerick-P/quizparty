// Code d'accès « entre amis » (ACCESS_CODE) : page d'entrée, cookie, pages et temps réel protégés.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const PORT = 3997;
const URL = `http://localhost:${PORT}`;
const CODE = 'Mario64';

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT),
    SUPABASE_URL: '', /* jamais la vraie base pendant les tests */ ACCESS_CODE: CODE, TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve());
  server.on('exit', () => reject(new Error('serveur arrêté')));
});

const get = (path, headers = {}) => fetch(URL + path, { redirect: 'manual', headers });
const post = (code, next = '/?code=ABCD') =>
  fetch(URL + '/entree', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, next }),
  });
const connect = (cookie) =>
  new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: cookie ? { cookie } : {} });
    s.on('connect', () => { s.close(); resolve('ok'); });
    s.on('connect_error', (e) => { s.close(); resolve(e.data?.access ? 'refusé' : `erreur ${e.message}`); });
  });

try {
  // Sans cookie : la page renvoie vers /entree en gardant le lien du salon
  let r = await get('/?code=ABCD', { accept: 'text/html' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/entree?next=%2F%3Fcode%3DABCD');
  assert.equal((await get('/proposer.js')).status, 401);
  assert.equal((await get('/sfx/x.mp3')).status, 401);
  assert.equal((await get('/health')).status, 200, '/health reste ouvert (surveillance)');
  // Pages légales ouvertes : Google les lit avant d'autoriser la connexion « avec Google »
  for (const p of ['/confidentialite', '/conditions']) {
    r = await get(p);
    assert.equal(r.status, 200, `${p} ouverte sans code`);
    assert.match(await r.text(), /QuizParty/);
  }
  assert.equal((await get('/api/auth/config')).status, 302, 'le reste reste protégé');
  r = await get('/entree');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Code d’accès/);
  assert.equal(await connect(), 'refusé', 'temps réel refusé sans cookie');

  // Mauvais code
  r = await post('Zelda');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);

  // Bon code (casse ignorée) : cookie + retour au salon
  r = await post('mario64');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/?code=ABCD');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal((await get('/', { cookie })).status, 200);
  assert.equal((await get('/app.js', { cookie })).status, 200);
  assert.equal(await connect(cookie), 'ok', 'temps réel accepté avec le cookie');
  assert.equal(await connect('qp_access=faux'), 'refusé');

  // Redirection vers un autre site impossible
  r = await post(CODE, '//exemple.com');
  assert.equal(r.headers.get('location'), '/');

  // Trop d'essais ratés : blocage temporaire
  for (let i = 0; i < 10; i++) await post('faux');
  r = await post(CODE);
  assert.equal(r.status, 429);

  console.log('✓ access-test : code d’accès OK');
} finally {
  server.kill();
}
