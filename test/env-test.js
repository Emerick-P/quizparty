// Garde-fou prod/dev (server/env.js) : en local, la base Supabase de prod est refusée sans --prod.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Import après coup : le .env du PC (peut-être encore sur la prod) ne doit pas arrêter ce test.
process.env.ALLOW_PROD_DB = '1';
const { dbTarget, prodGuard, PROD_REF } = await import('../server/env.js');

const PROD = { SUPABASE_URL: `https://${PROD_REF}.supabase.co`, SUPABASE_SECRET_KEY: 'x' };
const DEV = { SUPABASE_URL: 'https://autreprojet.supabase.co', SUPABASE_SECRET_KEY: 'x' };

assert.equal(dbTarget({}), 'local');
assert.equal(dbTarget({ SUPABASE_URL: PROD.SUPABASE_URL }), 'local', 'sans clé : pas de Supabase');
assert.equal(dbTarget(DEV), 'dev');
assert.equal(dbTarget(PROD), 'prod');

assert.equal(prodGuard(DEV, []), null);
assert.equal(prodGuard({}, []), null);
assert.match(prodGuard(PROD, []), /PROD/);
assert.equal(prodGuard({ ...PROD, RENDER: 'true' }, []), null, 'Render = la prod');
assert.equal(prodGuard({ ...PROD, ALLOW_PROD_DB: '1' }, []), null);
assert.equal(prodGuard(PROD, ['node', 'x.js', '--prod']), null);

// Bout en bout : le serveur refuse de démarrer sur la prod (sortie 1, avant d'écouter)
const env = { ...process.env, ...PROD, PORT: '0' };
delete env.RENDER; delete env.ALLOW_PROD_DB;
const r = spawnSync(process.execPath, ['server/index.js'], { env, encoding: 'utf8', timeout: 15000 });
assert.equal(r.status, 1, r.stderr);
assert.match(r.stderr, /base Supabase de PROD/);

console.log('env-test : OK');
