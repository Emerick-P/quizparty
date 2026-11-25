// Mode télé : appairage d'un écran par code à 4 chiffres, vue « tout le monde » sur la télé,
// téléphones en manette, extinction par l'hôte, et laissez-passer quand le code d'accès est actif.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, env = {}) {
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', ACCESS_CODE: '', COUNTDOWN_MS: '300', REVEAL_MS: '300',
      TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve());
    server.on('exit', () => reject(new Error('serveur arrêté')));
  });
  return server;
}

function client(url, label, opts = {}) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
  const c = { label, socket, state: null, waiters: [], events: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.once = (ev) => new Promise((r) => socket.once(ev, r));
  c.waitFor = (pred, ms = 5000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r, j) => { socket.on('connect', r); socket.on('connect_error', j); });
  return c;
}

const servers = [];
try {
  // ---------------------------------------------------------------- sans code d'accès
  const URL = 'http://localhost:3994';
  servers.push(await startServer(3994));
  const H = client(URL, 'hôte'), P = client(URL, 'joueur'), TV = client(URL, 'télé', { auth: { screen: true } });
  await Promise.all([H.connected, P.connected, TV.connected]);
  const { code } = await H.emit('room:create', { name: 'Hôte' });
  await P.emit('room:join', { code, name: 'Pat' });
  await H.waitFor((s) => s.players.length === 2 && s.tv === false);

  const hello = await TV.emit('screen:hello');
  assert.match(hello.pin, /^\d{4}$/, "l'écran affiche un code à 4 chiffres");
  assert.ok((await P.emit('room:screen', { pin: hello.pin })).error, "seul l'hôte appaire un écran");
  assert.ok((await H.emit('room:screen', { pin: '0000' === hello.pin ? '0001' : '0000' })).error, 'mauvais code refusé');
  const paired = TV.once('screen:paired');
  assert.equal((await H.emit('room:screen', { pin: hello.pin })).ok, true);
  const info = await paired;
  assert.equal(info.code, code);
  assert.equal(info.grant, null, 'pas de laissez-passer sans code d’accès');
  const tvLobby = await TV.waitFor((s) => s.screen === true && s.code === code);
  assert.equal(tvLobby.you, null, "la télé n'est pas un joueur");
  assert.equal(tvLobby.players.length, 2, 'la télé ne compte pas comme joueur');
  await H.waitFor((s) => s.tv === true);
  await P.waitFor((s) => s.tv === true);
  assert.ok((await H.emit('room:screen', { pin: hello.pin })).error, 'un code ne sert qu’une fois');

  // Partie : la télé voit la question, sans réponse personnelle
  await H.emit('room:settings', { mode: 'quiz', rounds: 5, duration: 10, input: 'choice' });
  await H.emit('game:start');
  const q = await TV.waitFor((s) => s.phase === 'question');
  assert.ok(q.round.startsAt && q.round.endsAt, 'mêmes échéances absolues que les joueurs');
  const pq = await P.waitFor((s) => s.phase === 'question' && s.round.id === q.round.id);
  assert.equal(pq.round.endsAt, q.round.endsAt, 'chrono identique télé / téléphone');
  await P.emit('game:answer', { roundId: q.round.id, answer: 0 });
  const tvAfter = await TV.waitFor((s) => s.round?.answeredCount === 1);
  assert.equal(tvAfter.round.yourAnswer, null);
  assert.equal(tvAfter.players.find((p) => p.name === 'Pat').status, 'answered');
  await H.emit('game:answer', { roundId: q.round.id, answer: 1 });
  await TV.waitFor((s) => s.phase === 'reveal');

  // Reprise après rechargement de la page télé (même jeton)
  TV.socket.close();
  await sleep(200);
  assert.equal(P.state.tv, true, 'coupure courte : les téléphones restent en manette');
  const TV2 = client(URL, 'télé 2', { auth: { screen: true } });
  await TV2.connected;
  assert.ok((await TV2.emit('screen:resume', { code, token: 'faux' })).error);
  assert.equal((await TV2.emit('screen:resume', { code, token: info.token })).ok, true);
  await TV2.waitFor((s) => s.screen === true);

  // L'hôte éteint le mode télé
  const closed = TV2.once('screen:closed');
  await H.emit('room:screen-off');
  await closed;
  await P.waitFor((s) => s.tv === false);
  assert.ok((await TV2.emit('screen:resume', { code, token: info.token })).error, 'ancien jeton invalidé');
  for (const c of [H, P, TV2]) c.socket.close();

  // ---------------------------------------------------------------- avec code d'accès
  const URL2 = 'http://localhost:3993';
  servers.push(await startServer(3993, { ACCESS_CODE: 'Mario64' }));
  const r = await fetch(URL2 + '/entree', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: 'Mario64', next: '/' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(URL2 + '/tv', { redirect: 'manual' })).status, 200, 'la page télé est ouverte');
  assert.equal((await fetch(URL2 + '/app.js', { redirect: 'manual' })).status, 401, 'le reste reste protégé');

  // Sans cookie et sans être un écran : refusé ; écran : appairage seulement
  const T = client(URL2, 'télé limitée', { auth: { screen: true } });
  await T.connected;
  const noRoom = await Promise.race([T.emit('room:create', { name: 'pirate' }), sleep(400).then(() => 'ignoré')]);
  assert.equal(noRoom, 'ignoré', 'un écran non entré ne peut pas créer de salon');
  const pin = (await T.emit('screen:hello')).pin;
  const H2 = client(URL2, 'hôte 2', { extraHeaders: { cookie } });
  await H2.connected;
  const { code: code2 } = await H2.emit('room:create', { name: 'Hôte' });
  const got = T.once('screen:paired');
  await H2.emit('room:screen', { pin });
  const { grant, token } = await got;
  assert.match(grant, /^[0-9a-f]{36}$/, "laissez-passer pour l'écran");
  let g = await fetch(`${URL2}/tv/entree?g=${grant}`, { redirect: 'manual' });
  assert.equal(g.status, 303);
  const tvCookie = g.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(URL2 + '/app.js', { headers: { cookie: tvCookie } })).status, 200, 'la télé a maintenant accès aux images et sons');
  g = await fetch(`${URL2}/tv/entree?g=${grant}`, { redirect: 'manual' });
  assert.equal(g.headers.get('set-cookie'), null, 'laissez-passer à usage unique');
  const T2 = client(URL2, 'télé entrée', { extraHeaders: { cookie: tvCookie } });
  await T2.connected;
  assert.equal((await T2.emit('screen:resume', { code: code2, token })).ok, true);
  await H2.waitFor((s) => s.tv === true);
  // Cast : l'hôte demande directement un laissez-passer pour le récepteur
  const cast = await H2.emit('room:screen-grant');
  assert.equal(cast.code, code2);
  assert.ok(cast.grant && cast.token);
  for (const c of [T, H2, T2]) c.socket.close();

  console.log('✓ tv-test : mode télé (appairage, vue télé, manettes, laissez-passer) OK');
} finally {
  for (const s of servers) s.kill();
}
