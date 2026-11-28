-- Anti-veille de Render (offre gratuite) : la base appelle /health toutes les 10 minutes, avant que Render
-- n'endorme le serveur (15 min sans visite). Les directs et leurs notifications partent ainsi à l'heure.
-- .github/workflows/live-wake.yml reste en secours.
--
-- PROD SEULEMENT (absent de schema.sql) : sur la base de dev, c'est le site de prod qui serait tenu éveillé.
-- À SUPPRIMER si le serveur Render passe en payant :  select cron.unschedule('quizparty-reveil');
--
-- Quota Render gratuit : 750 h par mois pour tout l'espace de travail, un service toujours allumé en prend
-- jusqu'à 744. Un second service gratuit ferait dépasser (Render suspend alors jusqu'au mois suivant).
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Relancer ce script remplace la tâche du même nom
select cron.schedule(
  'quizparty-reveil',
  '*/10 * * * *',
  $$ select net.http_get(url := 'https://quizparty-3g8q.onrender.com/health', timeout_milliseconds := 90000) $$
);
