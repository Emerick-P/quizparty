// Formulaire « Proposer » : validation des champs, enregistrement (local), fichiers, et requêtes envoyées à Supabase
// (vérifiées contre un faux serveur Supabase local, sans toucher à la vraie base).
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseSubmission, SUBMIT_MODES } from '../server/submissions.js';
import { createStore } from '../server/store.js';
import { syncContent } from '../server/content-sync.js';

const PORT = 3990;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-submit-'));
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(400, 1)]);
const pngUrl = `data:image/png;base64,${png.toString('base64')}`;

// ---- 1. Validation pure
assert.throws(() => parseSubmission({ mode: 'crossword' }), /Choisis un mode/);
assert.throws(() => parseSubmission({ mode: 'quiz', prompt: 'Q ?' }), /bonne réponse/);
assert.throws(() => parseSubmission({ mode: 'quiz', prompt: 'Q ?', answer: 'A', wrong: ['a'] }), /identique/);
assert.throws(() => parseSubmission({ mode: 'vraifaux', prompt: 'X' }), /vrai ou faux/);
assert.throws(() => parseSubmission({ mode: 'estimation', prompt: 'X', number: 'beaucoup' }), /nombre/);
assert.throws(() => parseSubmission({ mode: 'hud', game: 'Doom' }), /Ajoute une image/);
assert.throws(() => parseSubmission({ mode: 'hud', game: 'Doom', file: 'data:image/gif;base64,AAAA' }), /JPG, PNG ou WebP/);
assert.throws(() => parseSubmission({ mode: 'sounds', game: 'Doom', file: pngUrl }), /MP3/);
assert.throws(() => parseSubmission({ mode: 'pitch', game: 'Doom' }), /pitch/);
assert.ok(!('crossword' in SUBMIT_MODES), 'mots croisés exclus');
{
  const { row } = parseSubmission({ mode: 'estimation', prompt: 'Combien ?', number: '1 024,5', unit: 'pièces' });
  assert.equal(row.answer, '1024.5');
  assert.deepEqual(row.extra, { unit: 'pièces' });
  const vf = parseSubmission({ mode: 'vraifaux', prompt: 'Le ciel est bleu', truth: false }).row;
  assert.equal(vf.answer, 'Faux');
  const em = parseSubmission({ mode: 'emoji', prompt: '🍰 🤥', game: 'Portal', answer: 'ignoré' }).row;
  assert.equal(em.answer, 'Portal', 'la réponse des modes « trouve le jeu » est le jeu');
  const q = parseSubmission({ mode: 'quiz', prompt: 'Q ?', answer: 'A', wrong: ['B', '', 'C', 'D', 'E'], author: 'x'.repeat(50) }).row;
  assert.deepEqual(q.extra.wrong, ['B', 'C', 'D']);
  assert.equal(q.author.length, 24);
}
console.log('✓ validation des champs');

// ---- 2. Serveur réel avec stockage local
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), SUPABASE_URL: '', SUBMISSIONS_DIR: tmp, TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', IMAGE_CACHE_DIR: path.join(tmp, 'cache'), ACCESS_CODE: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));
try {
  const post = (body) => fetch(`${URL}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const opts = await (await fetch(`${URL}/api/submit/options`)).json();
  assert.ok(opts.games.length > 300 && opts.games.includes('Portal'), 'autocomplétion des jeux');
  assert.equal((await fetch(`${URL}/proposer`)).status, 200, 'page /proposer servie');

  let res = await post({ mode: 'quiz', prompt: 'Dans Portal, que promet GLaDOS ?', answer: 'Un gâteau', author: 'Camille' });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  res = await post({ mode: 'quiz', prompt: 'Sans réponse' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /bonne réponse/);
  res = await post({ mode: 'loading', game: 'Doom', file: pngUrl });
  assert.equal(res.status, 200);

  const rows = fs.readFileSync(path.join(tmp, 'submissions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].author, 'Camille');
  assert.match(rows[1].file_path, /^loading\/[0-9a-f-]+\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(tmp, 'files', rows[1].file_path)), png, 'image enregistrée telle quelle');
  console.log('✓ soumissions enregistrées (local), image comprise');
} finally {
  server.kill();
}

// ---- 3. Requêtes Supabase (faux serveur)
const seen = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/rest/v1/submissions') && req.method === 'POST') return res.end(JSON.stringify([{ ...JSON.parse(body), created_at: 'x' }]));
    if (req.url.startsWith('/storage/v1/object/submissions/')) return res.end(JSON.stringify({ Key: 'ok' }));
    if (req.method === 'GET') return res.end('[]');
    res.end('[]');
  });
});
await new Promise((r) => fake.listen(0, r));
const base = `http://localhost:${fake.address().port}`;
const sb = createStore({ SUPABASE_URL: base + '/', SUPABASE_SECRET_KEY: 'sb_secret_test' });
assert.equal(sb.name, 'supabase');
await sb.upload('hud/abc.png', png, 'image/png');
const saved = await sb.insert('submissions', { id: 'abc', mode: 'hud', status: 'pending' });
assert.equal(saved.id, 'abc');
await sb.list('submissions', { status: 'pending' });
await sb.ping();
assert.equal(seen[0].url, '/storage/v1/object/submissions/hud/abc.png');
assert.equal(seen[0].headers['content-type'], 'image/png');
assert.deepEqual(seen[0].body, png);
assert.equal(seen[0].headers.apikey, 'sb_secret_test');
assert.equal(seen[0].headers.authorization, undefined, 'nouvelle clé : pas de Bearer');
assert.equal(seen[1].url, '/rest/v1/submissions');
assert.equal(seen[1].headers.prefer, 'return=representation');
assert.match(seen[2].url, /status=eq\.pending/);
const legacy = createStore({ SUPABASE_URL: base, SUPABASE_SECRET_KEY: 'eyJhbGciOi.legacy' });
await legacy.ping();
assert.equal(seen.at(-1).headers.authorization, 'Bearer eyJhbGciOi.legacy', 'ancienne clé JWT : Bearer aussi');
console.log('✓ requêtes Supabase (REST + Storage)');

// Copie du contenu : réécrite seulement si elle a changé
seen.length = 0;
const first = await syncContent(sb);
assert.ok(first.updated && first.count > 2000, `contenu copié (${first.count} lignes)`);
assert.equal(seen[1].method, 'DELETE');
const posts = seen.filter((r) => r.method === 'POST' && r.url === '/rest/v1/content');
assert.equal(posts.reduce((n, r) => n + JSON.parse(r.body).length, 0), first.count);
assert.ok(posts.every((r) => JSON.parse(r.body).length <= 500), 'envoi par paquets de 500');
const ids = posts.flatMap((r) => JSON.parse(r.body).map((x) => x.id));
assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
const meta = seen.find((r) => r.url === '/rest/v1/meta' && r.method === 'POST');
assert.equal(meta.headers.prefer, 'resolution=merge-duplicates');
fake.close();
console.log(`✓ copie du contenu pour l'explorer (${first.count} lignes, ${posts.length} paquets)`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('Soumissions : OK');
process.exit(0);
