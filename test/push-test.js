// Test des notifications des quiz en direct (sans base de données, faux service de notification local) :
// - programme de la semaine (week-end différent) ;
// - abonnement : choix enregistrés et relus, adresses inconnues refusées, plus rien de coché = ligne effacée ;
// - à l'ouverture de la salle d'attente : une seule notification par appareil concerné, chiffrée et lisible
//   par lui, aucune pour les autres ; abonnement expiré effacé ; rappel ponctuel oublié une fois servi ;
// - pas de doublon après un redémarrage du serveur.
// Usage : node test/push-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import ece from 'http_ece';
import { generateVAPIDKeys } from 'web-push';
import { weekProgram } from '../server/live.js';

const PORT = 3994;
const URL_ = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-push-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Programme
const program = weekProgram();
assert.deepEqual(program.map((e) => [e.id, e.time, e.days.join('')]), [
  ['midi', '12:45', '12345'], ['soir', '18:30', '1234560'], ['nuit', '22:00', '123456'], ['brunch', '11:00', '60'], ['finale', '21:00', '0'],
]);
console.log('✓ programme de la semaine');

// ---- Faux service de notification : garde ce qu'il reçoit ; « /gone » répond que l'abonnement n'existe plus
const received = [];
const service = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.startsWith('/gone') ? 410 : 201).end();
  });
});
await new Promise((r) => service.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${service.address().port}`;
const device = (name) => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { name, ecdh, auth, sub: { endpoint: `${ORIGIN}/${name}`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } } };
};

const OPEN_MS = 8000;
const at = Math.ceil((Date.now() + OPEN_MS + 7000) / 1000) * 1000;
const hms = new Date(at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false });
const slot = [[hms, 'soir']];
const keys = generateVAPIDKeys();
let server = null;
const logs = [];
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env, PORT: String(PORT), SUPABASE_URL: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', RENDER_EXTERNAL_URL: '',
      IMAGE_CACHE_DIR: tmp, BLACKLIST_FILE: path.join(tmp, 'blacklist.json'), FEEDBACK_FILE: path.join(tmp, 'feedback.jsonl'),
      SUBMISSIONS_DIR: path.join(tmp, 'db'), LIVE_OPEN_MS: String(OPEN_MS), LIVE_SLOTS: JSON.stringify({ week: slot, sat: slot, sun: slot }),
      VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'https://example.org', PUSH_TEST_ORIGIN: ORIGIN,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => { logs.push(d.toString()); if (d.toString().includes('prêt')) resolve(); }));
}
async function client() {
  const socket = io(URL_, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => socket.on('connect', r));
  return { socket, emit: (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r)) };
}

let failed = false;
let c = null;
try {
  await startServer();
  c = await client();
  const info = await c.emit('live:info');
  assert.equal(info.pushKey, keys.publicKey, 'clé publique donnée au navigateur');
  assert.ok(!JSON.stringify(info).includes(keys.privateKey), 'jamais la clé privée');
  assert.ok(info.program.length && typeof info.weekend === 'boolean', 'programme de la semaine');
  const id = info.next.id;

  const [soir, tous, midi, ponctuel, gone, retire] = ['soir', 'tous', 'midi', 'ponctuel', 'gone', 'retire'].map(device);
  const save = async (d, prefs, extra = {}) => {
    const r = await c.emit('push:save', { subscription: d.sub, prefs, ...extra });
    assert.ok(r.ok, `${d.name} : ${r.error}`);
    return r.prefs;
  };
  assert.deepEqual(await save(soir, { formats: ['soir', 'inconnu'], slots: ['2000-01-01T10:00', 'n’importe'] }), { every: false, formats: ['soir'], slots: [] }, 'choix inconnus ou passés écartés');
  await save(tous, { every: true });
  await save(midi, { formats: ['midi'] });
  await save(ponctuel, { slots: [id] });
  await save(gone, { every: true });
  await save(retire, { every: true });
  assert.deepEqual(await save(retire, { every: false, formats: [], slots: [] }), { every: false, formats: [], slots: [] });
  assert.equal((await c.emit('push:get', { subscription: retire.sub })).prefs, null, 'plus rien de coché : effacé');
  assert.deepEqual((await c.emit('push:get', { subscription: ponctuel.sub })).prefs.slots, [id]);
  for (const endpoint of ['https://example.org/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.example.org/x', 'https://127.0.0.1/x', 'rien']) {
    const r = await c.emit('push:save', { subscription: { ...soir.sub, endpoint }, prefs: { every: true } });
    assert.ok(r.error, `adresse refusée : ${endpoint}`);
  }
  assert.ok((await c.emit('push:save', { subscription: { endpoint: soir.sub.endpoint, keys: { p256dh: 'x', auth: 'y' } }, prefs: { every: true } })).error, 'clés invalides refusées');
  // Adresse changée par le navigateur : l'ancienne ligne disparaît
  const [avant, apres] = ['avant', 'apres'].map(device);
  await save(avant, { formats: ['midi'] });
  await save(apres, { formats: ['midi'] }, { previous: avant.sub.endpoint });
  assert.equal((await c.emit('push:get', { subscription: avant.sub })).prefs, null);
  assert.equal(received.length, 0, 'rien avant l’ouverture');
  console.log('✓ abonnements : enregistrés, filtrés, effacés');

  await sleep(Math.max(0, at - OPEN_MS - Date.now() + 2000));
  assert.deepEqual(received.map((r) => r.path).sort(), ['/gone', '/ponctuel', '/soir', '/tous'], 'une seule par appareil concerné');
  for (const d of [soir, tous, ponctuel]) {
    const got = received.find((r) => r.path === `/${d.name}`);
    assert.match(got.headers.authorization, /^vapid /);
    assert.ok(Number(got.headers.ttl) > 0 && Number(got.headers.ttl) <= 30, 'périmée au départ du direct (30 s au minimum)');
    const msg = JSON.parse(ece.decrypt(got.body, { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString());
    assert.equal(msg.slot, id);
    assert.match(msg.title, /^Apéro : départ à \d\d h \d\d$/);
    assert.match(msg.body, /salle d’attente est ouverte/);
  }
  assert.equal((await c.emit('push:get', { subscription: gone.sub })).prefs, null, 'abonnement expiré effacé');
  assert.equal((await c.emit('push:get', { subscription: ponctuel.sub })).prefs, null, 'rappel ponctuel servi : oublié');
  assert.ok((await c.emit('push:get', { subscription: soir.sub })).prefs, 'le créneau reste suivi');
  console.log('✓ envoi à l’ouverture de la salle d’attente, chiffré, sans doublon');

  // Redémarrage pendant la salle d'attente : pas de second envoi
  c.socket.close();
  server.kill();
  await new Promise((r) => server.once('exit', r));
  assert.ok(Date.now() < at - 2000, 'redémarrage encore avant le départ');
  await startServer();
  await sleep(1500);
  assert.equal(received.length, 4, 'pas de doublon après un redémarrage');
  console.log('✓ redémarrage : pas de doublon');
  console.log('✓ notifications : tout est bon');
} catch (err) {
  failed = true;
  console.error('✗', err, logs.join(''));
} finally {
  c?.socket.close();
  server?.kill();
  service.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
