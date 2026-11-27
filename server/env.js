// Charge l'environnement, puis vérifie quelle base Supabase est visée. Importé en premier par server/index.js
// et par les scripts.
//
// - Par défaut : fichier .env, qui pointe sur la base de DEV (projet Supabase « quizparty-dev »).
// - Avec --prod (scripts de maintenance, ex. npm run submissions -- --prod) : fichier .env.prod.
// - Garde-fou : hors Render, viser la base de PROD sans --prod (ou ALLOW_PROD_DB=1) arrête le programme.
//   Évite qu'un npm run dev ou un test écrive des parties, des cotes ou des comptes de test dans la prod.
// Les variables déjà définies (Render, tests) gardent la priorité sur les fichiers.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Projet Supabase de prod (identifiant public, pas un secret). */
export const PROD_REF = 'kmdcsvcvmgpleeqlpnmm';

const wantsProd = process.argv.includes('--prod');
const file = path.join(ROOT, wantsProd ? '.env.prod' : '.env');
try {
  process.loadEnvFile?.(file);
} catch {
  if (wantsProd) {
    console.error('[env] --prod demandé mais le fichier .env.prod est introuvable (voir .env.example).');
    process.exit(1);
  }
  /* pas de .env : on utilise les variables d'environnement du système */
}

/** Base visée : 'prod', 'dev' (autre projet Supabase) ou 'local' (sans Supabase). */
export function dbTarget(env = process.env) {
  const url = (env.SUPABASE_URL || '').trim();
  if (!url || !(env.SUPABASE_SECRET_KEY || '').trim()) return 'local';
  return url.includes(PROD_REF) ? 'prod' : 'dev';
}

/** Message d'erreur si la base de prod est visée sans autorisation, sinon null. */
export function prodGuard(env = process.env, argv = process.argv) {
  if (dbTarget(env) !== 'prod') return null;
  if (env.RENDER || argv.includes('--prod') || env.ALLOW_PROD_DB === '1') return null;
  return '[env] Ce .env vise la base Supabase de PROD. En local, utilise la base de dev (voir .env.example).\n'
    + "      Pour un script de maintenance sur la prod : ajoute --prod (il lit alors .env.prod).";
}

const refused = prodGuard();
if (refused) {
  console.error(refused);
  process.exit(1);
}
if (dbTarget() === 'prod' && !process.env.RENDER) console.warn('[env] Attention : base Supabase de PROD.');
