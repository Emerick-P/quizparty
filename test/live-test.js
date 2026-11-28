// Test du quiz en direct (sans base de données, joueurs invités) :
// - heures de Paris (changements d'heure), créneaux de chaque jour (finale le dimanche) ;
// - salle d'attente : ouverte quelques minutes avant, fermée avant l'heure, plus d'entrée après le départ ;
// - départ à l'heure pile pour tous : mêmes questions, mêmes startsAt/endsAt, fin de question identique
//   même si tout le monde a répondu ;
// - chacun ne voit que lui (ni les autres joueurs, ni leur nombre, ni les compteurs de réponses) ;
// - choix mélangés par joueur, réponse convertie côté serveur ; pas de Passer / Pause / Arrêter ;
// - fin : score et meilleur score du direct ; reconnexion en cours de direct.
// Usage : node test/live-test.js (inclus dans npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { parisTime, slotsOf } from '../server/live.js';

const PORT = 3993;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-live-'));

// ---- Fonctions pures
assert.equal(new Date(parisTime('2026-11-27', 12, 45)).toISOString(), '2026-11-27T11:45:00.000Z', 'hiver : UTC+1');
assert.equal(new Date(parisTime('2026-07-01', 22, 0)).toISOString(), '2026-07-01T20:00:00.000Z', 'été : UTC+2');
assert.equal(new Date(parisTime('2026-03-29', 12, 45)).toISOString(), '2026-03-29T10:45:00.000Z', 'jour du passage à l’heure d’été');
assert.deepEqual(slotsOf('2026-11-27').map((s) => s.time), ['12:45', '18:30', '22:00'], 'vendredi');
assert.deepEqual(slotsOf('2026-11-28').map((s) => s.time), ['12:45', '18:30', '22:00'], 'samedi : comme les autres jours');
assert.deepEqual(slotsOf('2026-11-29').map((s) => [s.time, s.format]), [['12:45', 'midi'], ['21:00', 'finale']], 'dimanche : la finale remplace l’Apéro et le Hardcore');
process.env.LIVE_EVENTS = JSON.stringify([{ day: '2026-11-27', time: '20:00', format: 'soir', name: 'Spécial Zelda', tagline: 'Un direct à thème', theme: 'zelda' }]);
const evs = slotsOf('2026-11-27');
assert.deepEqual(evs.map((s) => s.time), ['12:45', '18:30', '20:00', '22:00'], 'direct exceptionnel inséré dans la journée');
assert.ok(evs.find((s) => s.event)?.id.endsWith('-evt'), 'identifiant distinct');
delete process.env.LIVE_EVENTS;
assert.equal(slotsOf('2026-11-27').length, 3, 'sans LIVE_EVENTS : créneaux habituels');
console.log('✓ heures de Paris et créneaux');

// ---- Un créneau dans quelques secondes (heure de Paris, avec les secondes)
const START_IN = 9000;
const at = Math.ceil((Date.now() + START_IN) / 1000) * 1000;
const hms = new Date(at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false });
const slot = [[hms, 'soir']];
const OPEN_MS = 6000;

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env, PORT: String(PORT), SUPABASE_URL: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '',
    IMAGE_CACHE_DIR: tmp, BLACKLIST_FILE: path.join(tmp, 'blacklist.json'), FEEDBACK_FILE: path.join(tmp, 'feedback.jsonl'),
    COUNTDOWN_MS: '1000', LIVE_REVEAL_MS: '700', LIVE_ROUNDS: '6', LIVE_DURATION: '2', LIVE_OPEN_MS: String(OPEN_MS),
    LIVE_SLOTS: JSON.stringify({ week: slot, sat: slot, sun: slot }),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const logs = [];
await new Promise((resolve) => server.stdout.on('data', (d) => { logs.push(d.toString()); if (d.toString().includes('prêt')) resolve(); }));

function client(label) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { label, socket, state: null, states: [], waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.states.push(s);
    c.waiters = c.waiters.filter((w) => !(w.pred(s) && (w.resolve(s), true)));
  });
  socket.on('srv:ping', (_t, ack) => ack());
  c.emit = (ev, payload = {}) => new Promise((r) => socket.emit(ev, payload, r));
  c.waitFor = (pred, ms = 15000) => (c.state && pred(c.state) ? Promise.resolve(c.state)
    : new Promise((resolve, reject) => {
        c.waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error(`${c.label}: timeout en attente d'un état`)), ms);
      }));
  c.connected = new Promise((r) => socket.on('connect', r));
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const all = [];
try {
  const A = client('A'), B = client('B'), C = client('C'), Late = client('Late');
  all.push(A, B, C, Late);
  await Promise.all(all.map((c) => c.connected));

  // Avant l'ouverture de la salle d'attente
  let info = await A.emit('live:info');
  assert.ok(info.ok && info.next, 'prochain direct annoncé');
  assert.equal(info.next.startsAt, at, 'heure du créneau');
  assert.equal(info.next.open, false);
  assert.equal(info.next.when, new Date(at).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }) === new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }) ? 'aujourd’hui' : 'demain', 'jour annoncé par le serveur');
  assert.equal(info.next.rounds, 6);
  assert.ok(!('players' in info.next) && !JSON.stringify(info).includes('players'), 'jamais de nombre de joueurs');
  assert.equal(info.next.status, 'upcoming', 'statut du prochain direct');
  assert.ok(Array.isArray(info.today) && info.today.every((x) => ['upcoming', 'open', 'running', 'done'].includes(x.status)), 'créneaux du jour avec leur statut');
  assert.deepEqual((await A.emit('live:mine')).results, {}, 'invité : pas de résultats gardés côté serveur');
  const early = await A.emit('live:join', { name: 'Alice' });
  assert.match(early.error || '', /pas encore ouverte/);

  await sleep(Math.max(0, at - OPEN_MS - Date.now() + 300));
  info = await A.emit('live:info');
  assert.equal(info.next.open, true, 'salle d’attente ouverte');
  assert.equal(info.next.status, 'open');
  const ja = await A.emit('live:join', { name: 'Alice' });
  const jb = await B.emit('live:join', { name: 'Bruno' });
  const jc = await C.emit('live:join', { name: 'Carla' });
  assert.ok(ja.ok && jb.ok && jc.ok, JSON.stringify([ja, jb, jc]));
  assert.equal(ja.code, jb.code, 'un seul salon par créneau');
  const wa = await A.waitFor((s) => s.phase === 'lobby' && s.daily?.live);
  assert.equal(wa.players.length, 1, 'je ne vois que moi');
  assert.equal(wa.hostId, null, 'pas d’hôte');
  assert.equal(wa.daily.live.startsAt, at);
  assert.ok((await A.emit('game:start')).error, 'personne ne lance le direct');
  const byCode = await Late.emit('room:join', { code: ja.code, name: 'Intrus' });
  assert.ok(byCode.error, 'on n’entre pas avec le code du salon');
  console.log('✓ salle d’attente');

  // Départ : la 1re question s'affiche à l'heure pile, pour tous
  const qa = await A.waitFor((s) => s.round?.index === 0);
  const qb = await B.waitFor((s) => s.round?.index === 0);
  const qc = await C.waitFor((s) => s.round?.index === 0);
  for (const q of [qa, qb, qc]) {
    assert.equal(q.round.startsAt, at, 'question à l’heure pile');
    assert.equal(q.round.endsAt, qa.round.endsAt, 'même fin de chrono');
    assert.equal(q.round.prompt, qa.round.prompt, 'même question');
    assert.equal(q.players.length, 1);
    assert.ok(!('answeredCount' in q.round) && !('expected' in q.round), 'pas de compteur de réponses');
  }
  const late = await Late.emit('live:join', { name: 'Retard' });
  assert.ok(late.error, 'plus d’entrée après le départ');
  assert.ok((await A.emit('game:skip')).error && (await A.emit('game:pause')).error && (await A.emit('game:stop')).error, 'ni Passer, ni Pause, ni Arrêter');
  console.log('✓ départ à l’heure pile, mêmes questions');

  // Trois manches : A et B répondent tout de suite, C jamais ; la question dure quand même jusqu'au bout
  let sawShuffle = false;
  for (let i = 0; i < 6; i++) {
    const sa = await A.waitFor((s) => s.round?.index === i && ['countdown', 'question'].includes(s.phase));
    const sb = await B.waitFor((s) => s.round?.index === i && ['countdown', 'question'].includes(s.phase));
    const r = sa.round;
    if (r.choices?.length > 2 && JSON.stringify(r.choices) !== JSON.stringify(sb.round.choices)) sawShuffle = true;
    if (r.choices) assert.deepEqual([...r.choices].sort(), [...sb.round.choices].sort(), 'mêmes choix (ordre propre à chacun)');
    await sleep(Math.max(0, r.startsAt - Date.now() + 50));
    const ans = (rr) => (rr.kind === 'estimation' ? (rr.year ? 1995 : 50) : rr.choices ? 0 : 'zzz');
    for (const [c, s] of [[A, sa], [B, sb]]) {
      for (let t = 0; t < (s.round.tries || 1); t++) {
        const a = await c.emit('game:answer', { roundId: s.round.id, answer: ans(s.round) });
        assert.ok(!a.error, a.error);
        if (!a.wrong) break;
      }
    }
    const ra = await A.waitFor((s) => s.phase === 'reveal' && s.round.index === i);
    const rb = await B.waitFor((s) => s.phase === 'reveal' && s.round.index === i);
    assert.ok(Date.now() >= r.endsAt, 'la question va au bout du chrono, même si tout le monde a répondu');
    assert.equal(ra.phaseEndsAt, rb.phaseEndsAt, 'même fin de correction');
    assert.ok(ra.reveal.results.every((x) => x.playerId === ra.you), 'correction : seulement moi');
    assert.ok(!('counts' in ra.reveal), 'pas de nombre de réponses par choix');
    // Ma réponse « 0 » (affichée en premier chez moi) est bien celle que je vois cochée
    if (r.choices && r.kind !== 'estimation' && (r.kind === 'qcm' || r.input === 'choice')) {
      const mine = ra.reveal.results[0];
      assert.equal(mine.answer, 0, 'ma réponse dans mon ordre');
      assert.equal(mine.correct, ra.reveal.correctIndex === 0, 'juste/faux cohérent avec mon ordre');
      assert.equal(ra.reveal.correctText, ra.round.choices[ra.reveal.correctIndex], 'bonne réponse au bon endroit chez moi');
    }
    if (i === 1) {
      // Coupure réseau de C en plein direct : il revient avec son jeton
      C.socket.disconnect();
      const C2 = client('C2');
      all.push(C2);
      await C2.connected;
      const back = await C2.emit('room:resume', { code: jc.code, token: jc.token });
      assert.ok(back.ok, back.error);
      const sc = await C2.waitFor((s) => s.daily?.live && s.round);
      assert.equal(sc.players.length, 1);
    }
  }
  if (!sawShuffle) console.log('  (aucune manche à 4 choix tirée : mélange non vérifié cette fois)');
  const endA = await A.waitFor((s) => s.phase === 'end');
  const endB = await B.waitFor((s) => s.phase === 'end');
  const top = Math.max(endA.players[0].score, endB.players[0].score);
  assert.equal(endA.daily.live.best, top, 'meilleur score du direct');
  assert.equal(endA.daily.cells.length, 6);
  assert.equal(endA.players.length, 1);
  const shared = await (await fetch(`${URL}/?r=${encodeURIComponent(endA.daily.share)}`)).text();
  assert.match(shared, /og:description" content="Direct .+ sur 6\./);
  assert.equal((await fetch(`${URL}/partage/story/${encodeURIComponent(endA.daily.share)}.png`)).status, 200);
  assert.ok(logs.join('').includes('3 joueur(s)'), 'comptage dans les logs serveur seulement');
  info = await A.emit('live:info');
  assert.ok(info.next.startsAt > at, 'le créneau suivant est annoncé');
  console.log('✓ correction, fin et meilleur score, reconnexion');
  console.log('✓ direct : tout est bon');
} catch (err) {
  failed = true;
  console.error('✗', err);
} finally {
  for (const c of all) c.socket.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
