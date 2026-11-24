// Charge le fichier .env s'il existe (Node 20.12+). Importé en premier par server/index.js.
try {
  process.loadEnvFile?.();
} catch {
  /* pas de .env : on utilise les variables d'environnement du système */
}
