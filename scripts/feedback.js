// Affiche les retours de l'hôte enregistrés pendant les parties : npm run feedback
// (sur la VM : cd ~/quizparty && npm run feedback). Fichier brut : data/feedback.jsonl.
import { feedback, FEEDBACK_TYPES } from '../server/feedback.js';

const list = feedback.list();
if (!list.length) {
  console.log(`Aucun retour pour l'instant (${feedback.file}).`);
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
  console.log(`\n${list.length} retour(s) dans ${feedback.file}`);
}
