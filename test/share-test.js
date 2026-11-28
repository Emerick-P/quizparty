// Test du partage : jeton de score signé, images dessinées en PNG, aperçus (balises Open Graph) de l'accueil
// et d'un salon. Les aperçus du Défi du jour, des directs et des défis entre potes sont vérifiés dans leurs tests.
// Usage : node test/share-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { io } from 'socket.io-client';
import { APP_NAME } from '../server/brand.js';
import { scoreToken, readToken, cellsOfGrid } from '../server/share.js';
import { storyCard, scoreCard, toPng } from '../server/share-card.js';

const PORT = 3996;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-share-'));

// ---- Jeton : aller-retour, et refus de tout ce qui a été modifié
const result = { type: 'jour', id: 42, score: 4320, correct: 8, cells: cellsOfGrid('🟩🟩🟨🟩🟥🟩🟩🟨🟩🟥'), modes: Array(10).fill('covers'), name: 'Léa <3' };
const token = scoreToken(result);
assert.deepEqual(readToken(token), { ...result, at: 0, rounds: 10 });
const [body, sig] = token.split('~');
const forged = Buffer.from(Buffer.from(body, 'base64url').toString().replace('4320', '9999')).toString('base64url');
for (const bad of [`${forged}~${sig}`, `${body}~xxxxxxxxxxxx`, body, `${token}~a`, '', '~', 'a~b']) assert.equal(readToken(bad), null, `refusé : ${bad}`);

// ---- Images : formats attendus, même avec 20 manches, un gros score et un pseudo sans lettres dessinables
const size = async (png) => { const m = await sharp(png).metadata(); return `${m.format} ${m.width}x${m.height}`; };
const long = { score: 123456, correct: 20, rounds: 20, cells: Array(20).fill('fast'), modes: Array(20).fill('quiz') };
assert.equal(await size(await toPng(storyCard({ ...long, heading: 'Direct La finale, 29 novembre à 21:00', site: 'un-nom-de-site-tres-long.onrender.com' }))), 'png 1080x1920');
assert.equal(await size(await toPng(scoreCard({ ...long, title: ['🎮', 'Łukasz'], lines: [] }))), 'png 1200x630');

// ---- Routes
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', IMAGE_CACHE_DIR: tmp, FEEDBACK_FILE: path.join(tmp, 'f.jsonl') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));
  const tags = async (query) => {
    const res = await fetch(`${URL}/${query}`);
    assert.equal(res.status, 200, query);
    const html = await res.text();
    assert.ok(html.includes('<div id="app">'), 'la page de l’app');
    return Object.fromEntries([...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[\w:]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2]]));
  };
  const image = async (url) => {
    const res = await fetch(url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await res.arrayBuffer());
    assert.ok(png.length < 300_000, `image légère pour les messageries (${png.length} octets)`);
    return size(png);
  };

  const home = await tags('');
  assert.equal(home['og:site_name'], APP_NAME);
  assert.equal(home['og:image'], `${URL}/partage/apercu/accueil.png`);
  assert.equal(home['twitter:card'], 'summary_large_image');
  assert.equal(await image(home['og:image']), 'png 1200x630');

  // Salon : le nom de l'hôte et le code ; un nom qui casserait le HTML reste du texte
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  socket.on('srv:ping', (_t, ack) => ack());
  await new Promise((r) => socket.on('connect', r));
  const room = await new Promise((r) => socket.emit('room:create', { name: 'Max"><b>' }, r));
  const salon = await tags(`?code=${room.code.toLowerCase()}`);
  assert.equal(salon['og:image'], `${URL}/partage/apercu/salon-${room.code}.png`);
  assert.match(salon['og:title'], /^Max&quot;&gt;&lt;b.* t’invite à jouer$/);
  assert.ok(salon['og:description'].includes(room.code));
  assert.equal(await image(salon['og:image']), 'png 1200x630');
  socket.close();

  // Adresses inconnues ou bricolées : aperçu général, jamais d'erreur
  for (const q of ['?code=ZZZZ', '?c=ABC234', '?r=nimporte~quoi', '?code=a&code=b', '?c[x]=1']) assert.equal((await tags(q))['og:image'], `${URL}/partage/apercu/accueil.png`, q);
  assert.match((await tags('?defi=perime~jeton'))['og:image'], /\/partage\/apercu\/jour(-\d+)?\.png$/);
  assert.equal(await image(`${URL}/partage/apercu/jour-12.png`), 'png 1200x630');
  assert.equal((await fetch(`${URL}/partage/story/${body}~xxxxxxxxxxxx.png`)).status, 404);
  assert.equal((await fetch(`${URL}/partage/story/accueil.png`)).status, 404);
  console.log('✅ partage : jeton, images, aperçus');
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
