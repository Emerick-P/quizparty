// Clés VAPID des notifications des directs : une paire par site, à faire une seule fois (en changer annule
// tous les abonnements).
//   npm run vapid           : affiche une nouvelle paire (à copier dans Render → Environment)
//   npm run vapid -- --env  : l'ajoute au .env local, sans rien afficher, si elle n'y est pas déjà
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVAPIDKeys } from 'web-push';

const { publicKey, privateKey } = generateVAPIDKeys();

if (!process.argv.includes('--env')) {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
} else {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  if (/^VAPID_(PUBLIC|PRIVATE)_KEY=\S/m.test(text)) console.log('.env contient déjà des clés VAPID : rien changé.');
  else {
    const kept = text.replace(/^VAPID_(PUBLIC|PRIVATE)_KEY=[ \t]*\r?\n?/gm, '').replace(/\s*$/, '');
    fs.writeFileSync(file, `${kept}\n\n# Notifications des directs (npm run vapid)\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
    console.log('Clés VAPID ajoutées au .env.');
  }
}
