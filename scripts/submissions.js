// Propositions des amis : npm run submissions [-- options]
//   (sans option)                         liste les propositions en attente
//   --all                                 liste tout (100 dernières)
//   --status <id> <accepted|rejected|doubt|pending> ["note"] ["intégré où"]
//   --file <id>                           télécharge l'image ou le son dans data/submissions/files/
// Avec SUPABASE_URL / SUPABASE_SECRET_KEY dans .env : Supabase. Sinon : data/submissions/ en local.
import '../server/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { store } from '../server/store.js';
import { SUBMIT_MODES } from '../server/submissions.js';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === '--status') {
  const [id, status, note, where] = args;
  if (!id || !['accepted', 'rejected', 'doubt', 'pending'].includes(status)) {
    console.error('Usage : npm run submissions -- --status <id> <accepted|rejected|doubt|pending> ["note"] ["intégré où"]');
    process.exit(1);
  }
  const row = await store.update('submissions', id, { status, review_note: note ?? null, integrated_as: where ?? null, reviewed_at: new Date().toISOString() });
  console.log(row ? `${id} → ${status}` : `Introuvable : ${id}`);
} else if (cmd === '--file') {
  const all = await store.list('submissions', { limit: 1000 });
  const row = all.find((r) => r.id === args[0]);
  if (!row?.file_path) { console.error('Pas de fichier pour cette proposition.'); process.exit(1); }
  const out = path.join('data', 'submissions', 'files', row.file_path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await store.download(row.file_path));
  console.log(out);
} else {
  const rows = await store.list('submissions', cmd === '--all' ? { limit: 100 } : { status: 'pending' });
  for (const r of rows.reverse()) {
    console.log(`\n[${r.created_at.slice(0, 16).replace('T', ' ')}] ${SUBMIT_MODES[r.mode]?.name || r.mode} · ${r.status} · ${r.author || 'anonyme'} · ${r.id}`);
    if (r.prompt) console.log(`  Énoncé  : ${r.prompt}`);
    if (r.answer) console.log(`  Réponse : ${r.answer}`);
    if (r.game && r.game !== r.answer) console.log(`  Jeu     : ${r.game}`);
    if (r.extra && Object.keys(r.extra).length) console.log(`  Détails : ${JSON.stringify(r.extra)}`);
    if (r.source) console.log(`  Source  : ${r.source}`);
    if (r.file_path) console.log(`  Fichier : ${r.file_path} (${r.file_type})`);
    if (r.review_note) console.log(`  Note    : ${r.review_note}`);
  }
  console.log(`\n${rows.length} proposition(s) (${store.name})`);
}
