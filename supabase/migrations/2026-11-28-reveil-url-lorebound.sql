-- Nouvelle adresse publique du site : l'anti-veille (voir 2026-11-28-reveil-render.sql) appelle désormais
-- https://lorebound-quiz.onrender.com. PROD SEULEMENT (absent de schema.sql), à passer après l'autre fichier.
-- À SUPPRIMER si le serveur Render passe en payant :  select cron.unschedule('quizparty-reveil');
--
-- Même nom de tâche : relancer ce script remplace l'ancienne.
select cron.schedule(
  'quizparty-reveil',
  '*/10 * * * *',
  $$ select net.http_get(url := 'https://lorebound-quiz.onrender.com/health', timeout_milliseconds := 90000) $$
);
