// Test du mode Mix : il pioche dans tous les modes jouables.
// Vérifie : chaque mode disponible est présent et la répartition est équilibrée, un mode grisé est sauté,
// les réglages Réponse (4 choix / tapée) et Niveau sont respectés, jamais deux fois le même jeu dans une partie
// (ni FF7 et FF7 Remake), aucune question qui cite un jeu à deviner, jamais deux épisodes d'une même série dans
// un 4 choix, pas deux manches du même mode d'affilée, pas de répétition d'une partie à l'autre,
// et une vraie partie à 2 joueurs jusqu'au podium.
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { MODES, MIX_PARTS, gameKey } from '../server/games/index.js';
import { covers } from '../server/images/index.js';
import { screens } from '../server/images/screens.js';
import { normalize } from '../server/games/fuzzy.js';
import { seriesOf } from '../server/data/series.js';
import { COVER_GAMES } from '../server/data/cover-games.js';
import { PITCHES } from '../server/data/pitches.js';
import { EMOJI_PUZZLES } from '../server/data/emojis.js';

// ------------------------------------------------------------------ construction des parties
screens.load();
// Jaquettes simulées : toute la liste est « en cache » (le vrai IGDB n'est pas joignable ici)
const fakeCovers = COVER_GAMES.map((game) => ({ game, entry: { id: `id-${game.slug}`, source: 'IGDB' } }));
const real = { ready: covers.ready, status: covers.status, publicImage: covers.publicImage };
const withCovers = (on) => {
  covers.ready = on ? () => fakeCovers : () => [];
  covers.status = on ? () => ({ ready: fakeCovers.length, state: 'ready' }) : () => ({ ready: 0, state: 'error', error: 'pas de jaquettes' });
  covers.publicImage = (e) => ({ url: `/img/${e.id}`, source: 'IGDB' });
};

const GUESS = new Set(['covers', 'pitch', 'emoji', 'hud', 'loading', 'sounds']);
const pitchLevel = new Map(PITCHES.map((p) => [p.pitch, p.level]));
const emojiLevel = new Map(EMOJI_PUZZLES.map((p) => [p.emojis, p.level]));

function checkGame(rounds, n, s, parts) {
  assert.equal(rounds.length, n, `${n} manches`);
  // Répartition : tous les modes disponibles à parts égales (à une manche près)
  const counts = new Map(parts.map((id) => [id, 0]));
  for (const r of rounds) {
    assert.ok(parts.includes(r.mixPart), `mode inattendu dans le Mix : ${r.mixPart}`);
    counts.set(r.mixPart, counts.get(r.mixPart) + 1);
  }
  // Seules les captures (petite banque, déjà vues dans les parties précédentes) peuvent manquer
  const c = [...counts.values()];
  const full = [...counts].filter(([id]) => !['hud', 'loading'].includes(id)).map(([, k]) => k);
  assert.ok(Math.max(...c) - Math.min(...full) <= 1, `répartition déséquilibrée : ${JSON.stringify(Object.fromEntries(counts))}`);
  // Pas deux manches du même mode d'affilée (toujours possible avec 7-8 modes)
  for (let i = 1; i < rounds.length; i++) assert.notEqual(rounds[i].mixPart, rounds[i - 1].mixPart, 'deux manches du même mode d\'affilée');

  const games = new Set();
  const guessNames = [];
  for (const r of rounds) {
    if (GUESS.has(r.mixPart)) {
      // Réglage Réponse
      assert.equal(r.input, s.input, `${r.mixPart} : réglage Réponse ignoré`);
      // Un jeu une seule fois (édition comprise)
      const k = gameKey(r);
      assert.ok(!games.has(k), `jeu deux fois dans la même partie : ${r.title}`);
      games.add(k);
      guessNames.push(normalize(r.title));
      if (r.input === 'choice') {
        assert.equal(r.choices.length, 4);
        assert.equal(r.choices[r.correctIndex], r.title);
        assert.equal(new Set(r.choices.map((t) => gameKey({ title: t }))).size, 4, `propositions en double : ${r.choices.join(' / ')}`);
        const se = seriesOf(r.title);
        if (se) for (const t of r.choices) if (t !== r.title) assert.notEqual(seriesOf(t), se, `deux épisodes de ${se.names[0]} : ${r.choices.join(' / ')}`);
      } else {
        assert.equal(r.choices, undefined);
        assert.ok(r.accepted.length >= 1);
      }
      // Réglage Niveau
      if (r.kind === 'pitch') assert.equal(pitchLevel.get(r.pitch), s.level, 'niveau du pitch ignoré');
      if (r.kind === 'emoji') assert.equal(emojiLevel.get(r.emojis), s.level, 'niveau des emojis ignoré');
    } else if (r.mixPart === 'quiz') {
      assert.equal(r.kind, s.input === 'text' ? 'typed' : 'qcm', 'Quiz : réglage Réponse ignoré');
    } else if (r.mixPart === 'vraifaux') {
      assert.deepEqual(r.choices, ['Vrai', 'Faux']);
    } else {
      assert.equal(r.kind, 'estimation');
    }
  }
  // Aucune question ne cite un jeu à deviner dans la même partie
  for (const r of rounds) {
    if (GUESS.has(r.mixPart)) continue;
    const text = ` ${normalize([r.prompt, ...(r.choices ?? []), r.answer ?? ''].join(' '))} `;
    for (const t of guessNames) if (t.length >= 5) assert.ok(!text.includes(` ${t} `), `« ${r.prompt} » souffle la réponse « ${t} »`);
  }
}

let built = 0;
for (const coversOn of [true, false]) {
  withCovers(coversOn);
  const parts = MIX_PARTS.filter((id) => !MODES[id].unavailable?.());
  assert.equal(parts.includes('covers'), coversOn, 'Jaquettes sautées quand elles sont indisponibles');
  if (screens.ready('hud').length) assert.ok(parts.includes('hud'));
  for (const input of ['choice', 'text']) {
    for (const level of ['easy', 'hard']) {
      const s = { input, level };
      const used = new Set();
      const seenGuess = new Set();
      const seenQuestions = new Set();
      for (let g = 0; g < 4; g++) {
        for (const n of [10, 20]) {
          const rounds = MODES.mix.build(n, used, s);
          checkGame(rounds, n, s, parts);
          built++;
          // Pas de répétition d'une partie à l'autre (les banques pitch / emojis / jaquettes sont assez grandes)
          for (const r of rounds) {
            if (['pitch', 'emoji', 'covers', 'sounds'].includes(r.mixPart)) {
              const k = `${r.mixPart}:${r.soundId ?? r.title}`; // sons : plusieurs sons par jeu, c'est le son qui ne doit pas revenir
              assert.ok(!seenGuess.has(k), `repris d'une partie à l'autre : ${k}`);
              seenGuess.add(k);
            } else if (!GUESS.has(r.mixPart)) {
              assert.ok(!seenQuestions.has(r.prompt), `question reprise d'une partie à l'autre : ${r.prompt}`);
              seenQuestions.add(r.prompt);
            }
          }
        }
      }
    }
  }
}
// Peu de manches : 5 modes différents tirés au hasard parmi les disponibles
withCovers(true);
{
  const r = MODES.mix.build(5, new Set(), { input: 'choice', level: 'easy' });
  assert.equal(new Set(r.map((x) => x.mixPart)).size, 5, '5 manches = 5 modes différents');
}
// Sur beaucoup de parties de 10, chaque mode sort à peu près aussi souvent
{
  const tally = new Map();
  const used = new Set();
  for (let g = 0; g < 200; g++) for (const r of MODES.mix.build(10, used, { input: 'choice', level: 'hard' })) tally.set(r.mixPart, (tally.get(r.mixPart) ?? 0) + 1);
  const v = [...tally.values()];
  assert.ok(Math.min(...v) / Math.max(...v) > 0.8, `répartition sur 200 parties : ${JSON.stringify(Object.fromEntries(tally))}`);
  console.log(`✓ répartition sur 200 parties : ${[...tally].map(([k, n]) => `${k} ${n}`).join(', ')}`);
}
// Jeux cochés par l'hôte : seulement ceux-là ; réponse au hasard : les deux formats dans la partie
{
  const inputOf = (r) => (r.kind === 'typed' ? 'text' : r.kind === 'qcm' ? 'choice' : r.input);
  for (let g = 0; g < 50; g++) {
    // (HUD et chargements seuls n'ont pas assez d'images pour 10 manches : le Mix complète avec des questions)
    const only = [...MIX_PARTS.filter((x) => !['hud', 'loading', 'bande'].includes(x))].sort(() => Math.random() - 0.5).slice(0, 1 + (g % 4));
    const rounds = MODES.mix.build(10, new Set(), { mixInput: 'mixed', mixParts: only, level: 'easy' });
    assert.equal(rounds.length, 10);
    for (const r of rounds) assert.ok(only.includes(r.mixPart), `${r.mixPart} pas coché (${only.join(', ')})`);
    const flex = rounds.filter((r) => !['vraifaux', 'estimation'].includes(r.mixPart)).map(inputOf);
    if (flex.length >= 2) assert.deepEqual(new Set(flex), new Set(['choice', 'text']), `4 choix et tapé mélangés : ${flex.join(', ')}`);
  }
  for (const mixInput of ['choice', 'text']) {
    const rounds = MODES.mix.build(10, new Set(), { mixInput, level: 'easy' });
    for (const r of rounds) if (!['vraifaux', 'estimation'].includes(r.mixPart)) assert.equal(inputOf(r), mixInput);
  }
  // Liste vide ou inconnue : tous les jeux
  assert.ok(new Set(MODES.mix.build(20, new Set(), { mixParts: [], level: 'easy' }).map((r) => r.mixPart)).size >= 6);
  console.log('✓ jeux cochés respectés, 4 choix et réponse tapée mélangés au hasard');
}
Object.assign(covers, real);
console.log(`✓ ${built} parties de Mix construites (avec / sans jaquettes, 4 choix / tapé, facile / difficile)`);

// ------------------------------------------------------------------ partie réelle à 2 joueurs
const PORT = 3994;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-mix-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: '', // jamais la vraie base pendant les tests (même si .env la définit)
    COUNTDOWN_MS: '200',
    REVEAL_MS: '300',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp,
    BLACKLIST_FILE: path.join(tmp, 'blacklist.json'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('prêt') && resolve()));

function client(label) {
  const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true });
  const c = { label, socket, state: null, waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 10000) =>
    c.state && pred(c.state)
      ? Promise.resolve(c.state)
      : new Promise((resolve, reject) => {
          c.waiters.push({ pred, resolve });
          setTimeout(() => reject(new Error(`${label}: timeout en attente d'un état`)), ms);
        });
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}

let failed = false;
const A = client('A'), B = client('B');
try {
  await Promise.all([A.connected, B.connected]);
  const { code } = await A.emit('room:create', { name: 'Alice' });
  await B.emit('room:join', { code, name: 'Bob' });
  const mix = A.state.options.modes.find((m) => m.id === 'mix');
  assert.ok(mix.inputs && mix.levels, 'le salon propose Réponse et Niveau pour le Mix');

  assert.equal(A.state.settings.mixInput, 'mixed', 'réponse au hasard par défaut');
  assert.deepEqual(A.state.settings.mixParts, MIX_PARTS, 'tous les jeux cochés par défaut');
  assert.ok((await B.emit('room:settings', { mixPart: 'quiz' })).error, "seul l'hôte coche les jeux");
  assert.ok((await A.emit('room:settings', { mixPart: 'crossword' })).error, 'les mots croisés ne sont pas dans le Mix');
  assert.ok((await A.emit('room:settings', { mixInput: 'voice' })).error);
  for (const id of MIX_PARTS.filter((x) => !['quiz', 'sounds', 'pitch'].includes(x))) assert.equal((await A.emit('room:settings', { mixPart: id })).ok, true);
  assert.deepEqual(A.state.settings.mixParts, ['quiz', 'pitch', 'sounds']);
  assert.equal((await A.emit('room:settings', { mixPart: 'pitch' })).ok, true);
  assert.equal((await A.emit('room:settings', { mixPart: 'sounds' })).ok, true);
  assert.ok((await A.emit('room:settings', { mixPart: 'quiz' })).error, 'le dernier jeu coché reste');
  assert.equal((await A.emit('room:settings', { mixPart: 'pitch' })).ok, true);
  assert.equal((await A.emit('room:settings', { mixPart: 'sounds' })).ok, true);
  // Partie en réponse au hasard sur 3 jeux cochés
  {
    assert.equal((await A.emit('room:settings', { mode: 'mix', rounds: 10, duration: 10, mixInput: 'mixed', level: 'easy' })).ok, true);
    assert.equal((await A.emit('game:start')).ok, true);
    const seen = new Set(), inputs = new Set();
    for (let i = 0; i < 10; i++) {
      const r = (await A.waitFor((x) => x.phase === 'question' && x.round?.index === i)).round;
      seen.add(r.kind);
      assert.ok(['qcm', 'typed', 'pitch', 'sound'].includes(r.kind), `manche hors des jeux cochés : ${r.kind}`);
      inputs.add(r.choices ? 'choice' : 'text');
      assert.equal(r.tries, r.choices ? 1 : 3);
      await A.emit('game:answer', { roundId: r.id, answer: r.choices ? 0 : 'Pas ça' });
      await B.emit('game:answer', { roundId: r.id, answer: r.choices ? 1 : 'Non' });
      if (!r.choices) for (const x of ['a', 'b']) { await A.emit('game:answer', { roundId: r.id, answer: x }); await B.emit('game:answer', { roundId: r.id, answer: x }); }
      await A.waitFor((x) => x.phase === 'reveal' && x.round?.index === i, 20000);
    }
    await A.waitFor((x) => x.phase === 'end', 20000);
    assert.deepEqual(inputs, new Set(['choice', 'text']), 'les deux formats de réponse dans la partie');
    console.log(`✓ partie Mix au hasard sur Quiz, Pitch et sons : ${[...seen].join(', ')} ; 4 choix et tapé`);
  }
  for (const id of MIX_PARTS.filter((x) => !['quiz', 'sounds', 'pitch'].includes(x))) assert.equal((await A.emit('room:settings', { mixPart: id })).ok, true);
  assert.deepEqual(A.state.settings.mixParts, MIX_PARTS);

  for (const input of ['choice', 'text']) {
    assert.equal((await A.emit('room:settings', { mode: 'mix', rounds: 10, duration: 10, mixInput: input, level: 'easy' })).ok, true);
    assert.equal((await A.emit('game:start')).ok, true);
    const kinds = new Set();
    for (let i = 0; i < 10; i++) {
      const s = await A.waitFor((x) => x.phase === 'question' && x.round?.index === i);
      const r = s.round;
      kinds.add(r.kind === 'screen' ? r.screen : r.kind);
      assert.equal(JSON.stringify(r).includes('"title"'), false, 'le titre du jeu ne part pas chez les joueurs');
      const answer = r.kind === 'estimation' ? 1 : r.choices ? 0 : 'Pas ça';
      if (r.kind === 'estimation' || r.choices) assert.equal(r.tries, 1);
      else assert.equal(r.tries, 3);
      if (['cover', 'pitch', 'emoji', 'screen'].includes(r.kind)) assert.equal(r.input, input);
      const bonus = r.choices ? 0 : 5000; // estimation et réponse tapée : 5 s de plus pour taper
      assert.equal(r.durationMs, 10000 + bonus, 'chrono du salon (+5 s pour taper)');
      await A.emit('game:answer', { roundId: r.id, answer });
      // B laisse filer le temps sur la dernière manche ; sinon il répond aussi
      if (i < 9) await B.emit('game:answer', { roundId: r.id, answer });
      if (typeof answer === 'string' && i < 9) {
        await A.emit('game:answer', { roundId: r.id, answer: 'Toujours pas' });
        await A.emit('game:answer', { roundId: r.id, answer: 'Encore raté' });
        await B.emit('game:answer', { roundId: r.id, answer: 'Non' });
        await B.emit('game:answer', { roundId: r.id, answer: 'Non plus' });
      }
      const rv = (await A.waitFor((x) => x.phase === 'reveal' && x.round?.index === i, 20000)).reveal;
      assert.ok(rv.correctText !== undefined || rv.correctIndex !== undefined || rv.answer !== undefined, 'correction affichée');
    }
    await A.waitFor((x) => x.phase === 'end', 20000);
    assert.ok(kinds.size >= 6, `partie variée : ${[...kinds].join(', ')}`);
    console.log(`✓ partie Mix (${input === 'choice' ? '4 choix' : 'tapé'}) jouée jusqu'au podium : ${[...kinds].join(', ')}`);
  }
  console.log('✅ Tests Mix OK');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  A.socket.close();
  B.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
