// Test du mode « Pitch mal expliqué » : contenu valide, 2 joueurs simulés, 4 choix puis saisie libre.
// Vérifie : pitch d'une ou deux phrases, niveaux, pas de fuite de la réponse, score selon la rapidité,
// validation stricte des titres tapés, essais multiples. Aucun accès à IGDB n'est nécessaire.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { PITCHES } from '../server/data/pitches.js';
import { COVER_GAMES } from '../server/data/cover-games.js';
import { normalize } from '../server/games/fuzzy.js';

// ------------------------------------------------------------------ contenu
const bySlug = new Map(COVER_GAMES.map((g) => [g.slug, g]));
const seenSlugs = new Set();
for (const p of PITCHES) {
  const game = bySlug.get(p.slug);
  assert.ok(game, `pitch « ${p.slug} » : jeu absent de cover-games.js`);
  assert.ok(!seenSlugs.has(p.slug), `pitch « ${p.slug} » en double`);
  seenSlugs.add(p.slug);
  assert.ok(['easy', 'hard'].includes(p.level), `pitch « ${p.slug} » : niveau easy ou hard`);
  assert.equal(typeof p.pitch, 'string', `pitch « ${p.slug} » : texte manquant`);
  assert.ok(p.pitch.length >= 20 && p.pitch.length <= 140, `pitch « ${p.slug} » : trop court ou trop long (140 caractères max)`);
  const sentences = p.pitch.split(/[.!?…]+(?:\s|$)/).filter((x) => x.trim()).length;
  assert.ok(sentences <= 2, `pitch « ${p.slug} » : deux phrases maximum`);
  // Le titre ne doit pas apparaître tel quel
  const t = normalize(game.title);
  if (t.length >= 5) assert.ok(!` ${normalize(p.pitch)} `.includes(` ${t} `), `pitch « ${p.slug} » : le titre est dans le texte`);
}
const nEasy = PITCHES.filter((p) => p.level === 'easy').length;
assert.ok(nEasy >= 20 && PITCHES.length - nEasy >= 20, 'au moins 20 pitchs par niveau (4 parties de 5 sans répétition)');
console.log(`✓ ${PITCHES.length} pitchs valides (${nEasy} faciles, ${PITCHES.length - nEasy} difficiles)`);

// ------------------------------------------------------------------ partie
const PORT = 3997;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-pitch-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: '', // jamais la vraie base pendant les tests (même si .env la définit)
    COUNTDOWN_MS: '300',
    REVEAL_MS: '500',
    // Pas d'IGDB : le mode doit marcher sans jaquettes (le .env éventuel ne remplace pas ces valeurs)
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pitchOf = (r) => PITCHES.find((p) => p.pitch === r.pitch);

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const created = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code: created.code, name: 'Bob' });
  await A.waitFor((s) => s.players.length === 2);
  const modes = A.state.options.modes;
  assert.equal(modes.find((m) => m.id === 'pitch')?.unavailable, null, 'mode pitch disponible sans IGDB');
  assert.equal(modes.find((m) => m.id === 'pitch').inputs, true, 'pitch : choix du format de réponse');
  assert.ok(!modes.some((m) => m.id === 'pitchtext'), 'une seule entrée Pitch dans le salon');

  // ---------------- 4 propositions
  assert.equal((await A.emit('room:settings', { mode: 'pitch', rounds: 5, duration: 10 })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const s = await A.waitFor((x) => x.round?.index === i && ['countdown', 'question'].includes(x.phase));
    const r = s.round;
    const rB = (await B.waitFor((x) => x.round?.id === r.id)).round;
    assert.equal(r.kind, 'pitch');
    assert.equal(r.input, 'choice');
    assert.equal(rB.pitch, r.pitch, 'même pitch pour tous');
    assert.equal(rB.startsAt, r.startsAt, 'même départ du chrono pour tous');
    assert.equal(r.correctIndex, undefined, 'la bonne réponse ne fuit pas');
    assert.equal(r.title, undefined);
    assert.equal(r.slug, undefined);
    assert.equal(new Set(r.choices).size, 4, 'propositions distinctes');
    const p = pitchOf(r);
    assert.ok(p, 'pitch reconnu');
    assert.ok(!seen.has(p.slug), 'pas deux fois le même jeu');
    assert.equal(p.level, 'easy', 'niveau facile par défaut');
    const easyTitles = new Set(PITCHES.filter((x) => x.level === 'easy').map((x) => bySlug.get(x.slug).title));
    assert.ok(r.choices.every((c) => easyTitles.has(c)), 'en facile, les fausses propositions sont aussi des jeux connus');
    seen.add(p.slug);
    const right = r.choices.indexOf(bySlug.get(p.slug).title);
    assert.ok(right >= 0, 'le bon titre est parmi les propositions');

    await A.waitFor((x) => x.phase === 'question' && x.round.index === i);
    assert.equal((await A.emit('game:answer', { roundId: r.id, answer: right })).ok, true);
    if (i === 0) await sleep(1500); // Bob répond tard : moins de points
    assert.equal((await B.emit('game:answer', { roundId: r.id, answer: i === 0 ? right : (right + 1) % 4 })).ok, true);
    const rv = (await A.waitFor((x) => x.phase === 'reveal' && x.round.index === i)).reveal;
    assert.equal(rv.correctIndex, right);
    assert.equal(rv.correctText, bySlug.get(p.slug).title);
    assert.equal(rv.pitch, p.pitch);
    assert.equal(rv.image, null, 'pas de jaquette sans IGDB');
    const a = rv.results.find((x) => x.name === 'Alice'), b = rv.results.find((x) => x.name === 'Bob');
    assert.ok(a.correct && a.points > 900, 'réponse rapide bien payée');
    if (i === 0) assert.ok(b.correct && b.points < a.points, 'réponse tardive moins payée');
    else assert.equal(b.points, 0);
  }
  await A.waitFor((s) => s.phase === 'end');
  console.log('✓ pitch 4 choix : 5 manches, mêmes pitchs pour tous, scores');

  // ---------------- saisie libre
  assert.equal((await A.emit('game:stop')).ok, true);
  assert.ok((await A.emit('room:settings', { level: 'expert' })).error, 'niveau hors liste refusé');
  assert.equal((await A.emit('room:settings', { mode: 'pitch', input: 'text', rounds: 5, level: 'hard' })).ok, true);
  assert.equal((await A.emit('game:start')).ok, true);
  const s = await A.waitFor((x) => x.phase === 'question' && x.round?.index === 0);
  const r = s.round;
  assert.equal(r.input, 'text');
  assert.equal(r.choices, undefined);
  assert.equal(r.tries, 3);
  assert.equal(r.durationMs, 15000, '5 s de plus pour taper');
  assert.equal(pitchOf(r).level, 'hard', 'niveau difficile respecté');
  const game = bySlug.get(pitchOf(r).slug);
  // Validation stricte : une faute de frappe est refusée (et coûte un essai), le titre exact sans accents ni majuscules passe
  const t = game.title;
  const k = [...t].findIndex((c, j) => /[a-z]/.test(c) && /[a-z]/.test(t[j + 1] ?? '') && c !== t[j + 1]);
  const typo = t.slice(0, k) + t[k + 1] + t[k] + t.slice(k + 2);
  const w1 = await B.emit('game:answer', { roundId: r.id, answer: 'Nimportequoi' });
  assert.deepEqual(w1, { wrong: true, triesLeft: 2 });
  assert.deepEqual(await A.emit('game:answer', { roundId: r.id, answer: typo }), { wrong: true, triesLeft: 2 }, `« ${typo} » refusé pour « ${t} »`);
  const plain = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, '');
  const okA = await A.emit('game:answer', { roundId: r.id, answer: plain });
  assert.equal(okA.correct, true, `« ${plain} » accepté pour « ${t} »`);
  await B.emit('game:answer', { roundId: r.id, answer: 'Encore faux' });
  const last = await B.emit('game:answer', { roundId: r.id, answer: 'Toujours faux' });
  assert.equal(last.correct, false, '3e essai raté : manche finie pour Bob');
  const rv = (await A.waitFor((x) => x.phase === 'reveal')).reveal;
  assert.equal(rv.correctText, t);
  assert.ok(rv.results.find((x) => x.name === 'Alice').points > 0);
  console.log(`✓ pitch saisie libre : « ${typo} » refusé, « ${plain} » accepté pour « ${t} », 3 essais`);
} catch (e) {
  failed = true;
  console.error('✗', e);
} finally {
  A.socket.close();
  B.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
