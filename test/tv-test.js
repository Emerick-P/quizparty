// Mode télé : appairage d'un écran par code à 4 chiffres, vue « tout le monde » sur la télé,
// téléphones en manette et extinction par l'hôte.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, env = {}) {
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', COUNTDOWN_MS: '300', REVEAL_MS: '300', HOST_HANDOFF_MS: '300',
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

  // Hôte seul, téléphone en veille pendant qu'il allume la télé : il reste l'hôte à son retour
  {
    const S = client(URL, 'solo');
    await S.connected;
    const made = await S.emit('room:create', { name: 'Solo' });
    await S.emit('room:settings', { mode: 'quiz', rounds: 5 });
    await S.emit('game:start');
    S.socket.close();
    await sleep(800); // plus long que HOST_HANDOFF_MS
    const S2 = client(URL, 'solo revenu');
    await S2.connected;
    assert.equal((await S2.emit('room:resume', { code: made.code, token: made.token })).ok, true);
    const back = await S2.waitFor((s) => s.code === made.code);
    assert.equal(back.hostId, back.you, "l'hôte seul garde la main après une coupure");
    S2.socket.close();
  }

  // ---------------------------------------------------------------- cast : l'hôte donne le salon au récepteur
  {
    const H2 = client(URL, 'hôte cast');
    await H2.connected;
    const { code: code2 } = await H2.emit('room:create', { name: 'Hôte' });
    const cast = await H2.emit('room:screen-grant');
    assert.equal(cast.code, code2);
    assert.ok(cast.token);
    const T2 = client(URL, 'récepteur');
    await T2.connected;
    assert.equal((await T2.emit('screen:resume', { code: code2, token: cast.token })).ok, true);
    await H2.waitFor((s) => s.tv === true);
    for (const c of [H2, T2]) c.socket.close();
  }

  console.log('✓ tv-test : mode télé (appairage, vue télé, manettes, cast) OK');
} finally {
  for (const s of servers) s.kill();
}
