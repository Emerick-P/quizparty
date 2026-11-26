// Plan du code généré : docs/CODEMAP.md (fichier → rôle → déclarations de premier niveau).
// Sert aux futures tâches à trouver le bon fichier sans tout relire. Usage : npm run codemap
// `--check` (lancé par npm test) échoue si le plan n'est plus à jour.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'CODEMAP.md');
const DIRS = ['server', 'server/games', 'server/images', 'public/js', 'scripts'];
const EXTRA = ['public/proposer.js'];
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|class\s+(\w+)|(?:const|let)\s+(\w+)\s*=)/;
const ACTION = /^(?:actions\.(\w+)\s*=|Object\.assign\(actions)/;

function describe(lines) {
  // première ligne de commentaire utile (après l'en-tête « QuizParty — » des scripts du client)
  for (const l of lines.slice(0, 12)) {
    const m = l.match(/^\s*(?:\/\/|\/\*\*?|\*)\s*(.*?)\s*(?:\*\/)?$/);
    if (m && m[1] && !/^global|^Script classique|^eslint/.test(m[1])) return m[1].replace(/^QuizParty — /, '');
  }
  return '';
}

function entry(rel) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  const names = [];
  const actions = [];
  const keys = {}; // clés des grands objets de premier niveau (actions, views, SHEETS…)
  let obj = null;
  for (const l of lines) {
    const d = l.match(DECL);
    if (d) names.push(d[1] || d[2] || d[3]);
    const a = l.match(ACTION);
    if (a?.[1]) actions.push(a[1]);
    if (/^};?$/.test(l)) obj = null;
    const k = obj && l.match(/^ {2}(?:async\s+)?(\w+)\s*(?:\(|:)/);
    if (k) (keys[obj] ??= []).push(k[1]);
    const o = l.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*\{$/);
    if (o) obj = o[1];
  }
  let s = `### ${rel} (${lines.length} l.)\n${describe(lines)}\n`;
  if (names.length) s += `\n${names.join(', ')}\n`;
  if (actions.length) s += `\nactions : ${actions.join(', ')}\n`;
  for (const [o, ks] of Object.entries(keys)) if (ks.length > 2) s += `\n${o} : ${ks.join(', ')}\n`;
  return s;
}

const files = [
  ...DIRS.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).sort().map((f) => `${d}/${f}`)),
  ...EXTRA,
];
const order = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8').match(/\/js\/[\w-]+\.js/g) || [];
const md = `# Plan du code (généré par \`npm run codemap\`, ne pas modifier à la main)

Données (\`server/data/*.js\`) et tests (\`test/\`) non listés. Ordre de chargement du client : ${order.map((f) => f.slice(4, -3)).join(' → ')}.

${files.map(entry).join('\n')}`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''; // CRLF sous Windows
  if (cur !== md) { console.error('docs/CODEMAP.md n’est plus à jour : lance npm run codemap'); process.exit(1); }
  console.log('✓ plan du code à jour');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);
  console.log(`docs/CODEMAP.md : ${files.length} fichiers`);
}
