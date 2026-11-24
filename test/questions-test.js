// Vérifie la banque de questions : format, doublons, réponses valides.
// Usage : npm test
import assert from 'node:assert/strict';
import { QCM, TRUE_FALSE, ESTIMATION } from '../server/data/questions.js';
import { MODES } from '../server/games/index.js';
import { normalize } from '../server/games/fuzzy.js';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const seen = new Map();
function unique(bank, label) {
  for (const x of bank) {
    assert.equal(typeof x.q, 'string', `${label} : énoncé manquant`);
    assert.ok(x.q.trim().length > 10, `${label} : énoncé trop court « ${x.q} »`);
    const k = norm(x.q);
    assert.ok(!seen.has(k), `Question en double : « ${x.q} » (${label} et ${seen.get(k)})`);
    seen.set(k, label);
    if (x.info !== undefined) assert.equal(typeof x.info, 'string', `info invalide : « ${x.q} »`);
  }
}

unique(QCM, 'QCM');
for (const x of QCM) {
  assert.ok(Array.isArray(x.choices) && x.choices.length === 4, `QCM à 4 choix : « ${x.q} »`);
  assert.equal(new Set(x.choices.map(norm)).size, 4, `Choix en double : « ${x.q} »`);
  for (const c of x.choices) assert.ok(typeof c === 'string' && c.trim(), `Choix vide : « ${x.q} »`);
}

// Questions jouables en réponse tapée : réponse fermée, écritures acceptées distinctes des mauvaises réponses
const compact = (s) => normalize(s).replace(/ /g, '');
const typed = QCM.filter((x) => x.typed);
for (const x of typed) {
  assert.ok(x.typed === true || (Array.isArray(x.typed) && x.typed.length), `typed : true ou liste d'écritures : « ${x.q} »`);
  const alts = [x.choices[0], ...(Array.isArray(x.typed) ? x.typed : [])];
  for (const a of alts) assert.ok(typeof a === 'string' && compact(a), `typed : écriture vide : « ${x.q} »`);
  const wrong = new Set(x.choices.slice(1).map(compact));
  for (const a of alts) assert.ok(!wrong.has(compact(a)), `typed : « ${a} » est aussi une mauvaise réponse : « ${x.q} »`);
  assert.ok(compact(x.choices[0]).length <= 60, `typed : réponse trop longue à taper : « ${x.q} »`);
}
assert.ok(typed.length >= 100, 'au moins 100 questions jouables en réponse tapée');

unique(TRUE_FALSE, 'Vrai/Faux');
for (const x of TRUE_FALSE) assert.equal(typeof x.a, 'boolean', `Vrai/Faux sans réponse booléenne : « ${x.q} »`);

unique(ESTIMATION, 'Estimation');
for (const x of ESTIMATION) {
  assert.ok(Number.isFinite(x.a), `Estimation sans valeur : « ${x.q} »`);
  if (x.year) assert.ok(Number.isInteger(x.a) && x.a > 1800 && x.a < 2100, `Année invalide : « ${x.q} »`);
  else assert.equal(typeof (x.unit ?? ''), 'string', `Unité invalide : « ${x.q} »`);
}

// Pas de répétition d'une partie à l'autre dans un même salon, tant que la banque n'est pas épuisée
for (const [id, settings] of [['quiz', {}], ['quiz', { input: 'text' }], ['vraifaux', {}], ['estimation', {}], ['mix', {}]]) {
  const used = new Set();
  const prompts = new Set();
  const games = 5;
  for (let g = 0; g < games; g++) {
    for (const r of MODES[id].build(10, used, settings)) {
      if (!['qcm', 'typed', 'estimation'].includes(r.kind)) continue; // manches « Quel est ce jeu ? » du Mix : voir mix-test.js
      assert.ok(!prompts.has(r.prompt), `${id} : question répétée en ${g + 1}ᵉ partie : « ${r.prompt} »`);
      prompts.add(r.prompt);
    }
  }
}

const years = ESTIMATION.filter((x) => x.year).length;
console.log(`OK banque de questions : ${QCM.length} QCM (dont ${typed.length} en réponse tapée), ${TRUE_FALSE.length} Vrai/Faux, ${ESTIMATION.length} estimations (dont ${years} années)`);
process.exit(0);
