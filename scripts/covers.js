// Rapport des jaquettes : télécharge celles qui manquent et liste les jeux introuvables.
// Usage : npm run covers   (avec TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET dans .env)
import '../server/env.js';
import { covers } from '../server/images/index.js';

await covers.init();
const rows = covers.games.map((g) => ({ g, e: covers.index[covers.key(g.slug)] }));
const bad = rows.filter(({ e }) => e?.status !== 'ready');
const banned = rows.filter(({ g, e }) => e?.status === 'ready' && covers.isBanned(g.slug, e));
console.log(`\n${covers.ready().length} jeux jouables sur ${covers.games.length}.`);
if (bad.length) {
  console.log('\nIntrouvables (corriger le slug ou l\'année dans server/data/cover-games.js) :');
  for (const { g, e } of bad) console.log(`  - ${g.slug} (${g.title}, ${g.year}) : ${e?.error ?? 'pas encore cherché'}`);
}
if (banned.length) console.log(`\nSur liste noire : ${banned.map(({ g }) => g.slug).join(', ')}`);
const yearGaps = rows.filter(({ g, e }) => e?.status === 'ready' && e.year && e.year !== (g.igdbYear ?? g.year));
if (yearGaps.length) {
  console.log('\nAnnée différente chez IGDB (à vérifier) :');
  for (const { g, e } of yearGaps) console.log(`  - ${g.title} : liste ${g.year}, IGDB ${e.year} (« ${e.name} »)`);
}
