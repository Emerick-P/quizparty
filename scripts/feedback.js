// Affiche les retours de l'hôte enregistrés pendant les parties : npm run feedback
// Avec SUPABASE_URL / SUPABASE_SECRET_KEY dans .env : lit la table « reports » de Supabase (retours faits en ligne).
// Sinon : fichier local data/feedback.jsonl.
import '../server/env.js';
import { feedback, FEEDBACK_TYPES } from '../server/feedback.js';
import { store } from '../server/store.js';

const online = store.name === 'supabase';
const list = online
  ? (await store.list('reports', { status: 'pending' })).map((r) => ({ ...r.data, id: r.id, at: r.created_at, type: r.type })).reverse()
  : feedback.list();
const where = online ? 'Supabase (table reports, statut pending)' : feedback.file;
if (!list.length) {
  console.log(`Aucun retour pour l'instant (${where}).`);
} else {
  for (const f of list) {
    const q = f.question || {};
    const what = q.prompt || q.pitch || (q.emojis && q.emojis.join(' ')) || q.title || q.slug || q.kind;
    console.log(`\n[${f.at.slice(0, 16).replace('T', ' ')}] ${FEEDBACK_TYPES[f.type] || f.type} · ${f.kind} (${f.mode})`);
    console.log(`  Question : ${what}`);
    if (q.answer || q.title) console.log(`  Réponse  : ${q.answer || q.title}`);
    if (f.accept) console.log(`  À accepter : ${f.accept}`);
    if (f.comment) console.log(`  Commentaire : ${f.comment}`);
  }
  console.log(`\n${list.length} retour(s) dans ${where}`);
}
