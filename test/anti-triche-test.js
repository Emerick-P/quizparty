/**
 * Anti-triche : aucune bonne réponse (ni indice qui la donne) dans ce que reçoit le navigateur avant la
 * correction, choix mélangés pour chaque joueur dans les défis, paliers de jaquette servis à leur heure.
 * Test sans serveur : appelle directement les modules.
 */
import assert from 'node:assert/strict';
import { MODES, KINDS } from '../server/games/index.js';
import { pixLevels, PIX_COLS, PIX_PREFETCH_MS } from '../server/games/cover.js';
import { Room } from '../server/room.js';
import { shuffleChoices } from '../server/daily.js';

// Champs qui donnent la réponse : jamais envoyés pendant la question
const SECRET_KEYS = ['correctIndex', 'answer', 'accepted', 'title', 'slug', 'why', 'info', 'pageUrl', 'series', 'soundId', 'what'];
const keysOf = (o, out = new Set()) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysOf(v, out); }
  return out;
};

let checked = 0;
for (const mode of ['quiz', 'vraifaux', 'estimation', 'pitch', 'emoji']) {
  for (const input of MODES[mode].inputs ? ['choice', 'text'] : ['choice']) {
    for (const level of ['easy', 'hard']) {
      const rounds = MODES[mode].build(40, new Set(), { input, level, rounds: 40 });
      for (const r of rounds) {
        Object.assign(r, { startsAt: 1000, endsAt: 16000, durationMs: 15000 });
        const pub = KINDS[r.kind].publicRound(r);
        const keys = keysOf(pub);
        for (const k of SECRET_KEYS) assert.ok(!keys.has(k), `${mode}/${input} : « ${k} » envoyé pendant la question`);
        // Réponse tapée : le titre n'apparaît nulle part (énoncé, pitch, emojis)
        if (r.title && !pub.choices) {
          assert.ok(!JSON.stringify(pub).toLowerCase().includes(`"${r.title.toLowerCase()}"`), `${mode}/${input} : titre « ${r.title} » dans la question`);
        }
        assert.ok(pub.year === undefined || typeof pub.year === 'boolean', 'year : seulement « question de date »');
        checked++;
      }
    }
  }
}
console.log(`✓ ${checked} manches : aucun champ de réponse dans la question`);

// ---------------- défis : 4 choix mélangés pour chaque joueur, Vrai/Faux intact
const base = { kind: 'qcm', prompt: 'Q', choices: ['A', 'B', 'C', 'D'], correctIndex: 2 };
const orders = new Set();
for (let i = 0; i < 200; i++) {
  const r = shuffleChoices(structuredClone(base));
  assert.equal(r.choices[r.correctIndex], 'C', 'la bonne réponse suit le mélange');
  assert.deepEqual([...r.choices].sort(), base.choices, 'mêmes choix');
  orders.add(r.choices.join(''));
}
assert.ok(orders.size >= 20, `ordres variés (${orders.size}/24)`);
const tf = shuffleChoices({ kind: 'qcm', choices: ['Vrai', 'Faux'], correctIndex: 1 });
assert.deepEqual(tf.choices, ['Vrai', 'Faux'], 'Vrai/Faux garde son ordre');
assert.equal(tf.correctIndex, 1);
const est = shuffleChoices({ kind: 'estimation', answer: 1998 });
assert.equal(est.choices, undefined, 'estimation inchangée');
console.log(`✓ défis : choix mélangés par joueur (${orders.size} ordres sur 24), Vrai/Faux intact`);

// ---------------- préchargement : jamais la jaquette nette de la réponse suivante
const pre = (next) => Room.prototype.preloadUrl.call(null, next);
assert.equal(pre({ kind: 'qcm', image: { url: '/img/abc' } }), null, 'pitch/emoji/QCM : pas de jaquette préchargée');
assert.equal(pre({ kind: 'sound', sound: { url: '/sfx/x.mp3?r=A&k=B' }, image: { url: '/img/abc' } }), '/sfx/x.mp3?r=A&k=B', 'son : le son, pas la jaquette');
assert.equal(pre({ kind: 'cover', image: { url: '/img/abc' }, pix: { token: 't', q: '?r=ABCD' } }), '/pix/t/0?r=ABCD', 'jaquette : premier palier');
console.log('✓ préchargement sans image nette');

// ---------------- paliers de jaquette servis à leur heure
const now = Date.now();
const cover = (i, extra = {}) => ({ kind: 'cover', input: 'choice', image: { url: `/img/id${i}` }, pix: { token: `t${i}`, q: '' }, ...extra });
const live = cover(0, { startsAt: now - 1000, endsAt: now + 14000 });
const room = { rounds: [live, cover(1), cover(2)], roundIndex: 0, phase: 'question', paused: null };
const allow = (token, k) => Room.prototype.pixAllowed.call(room, token, k);
const levels = pixLevels(live);
assert.deepEqual(allow('t0', 0), { imageId: 'id0', cols: PIX_COLS[0] });
const reached = levels.filter((l) => l.at - PIX_PREFETCH_MS <= now).length;
assert.ok(reached >= 1 && reached < levels.length);
assert.ok(allow('t0', reached - 1), 'palier atteint servi');
assert.equal(allow('t0', reached), null, 'palier à venir refusé');
assert.equal(allow('t0', levels.length - 1), null, 'dernier palier refusé');
assert.equal(allow('t0', 99), null);
assert.ok(allow('t1', 0), 'premier palier de la manche suivante (préchargement)');
assert.equal(allow('t1', 1), null, 'pas plus loin pour la manche suivante');
assert.equal(allow('t2', 0), null, 'rien pour les manches lointaines');
assert.equal(allow('inconnu', 0), null);
assert.ok(allow('t0', 1), 'palier 1 atteint');
room.paused = { at: levels[1].at - PIX_PREFETCH_MS - 1 };
assert.equal(allow('t0', 1), null, 'en pause : l\'heure est figée');
room.paused = null;
room.phase = 'reveal';
assert.ok(allow('t0', levels.length - 1), 'après la correction : tous les paliers');
assert.equal(allow('t1', 1), null);
console.log(`✓ ${levels.length} paliers de jaquette, chacun servi à son heure`);

console.log('✅ Tests anti-triche OK');
