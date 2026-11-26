-- QuizParty : tables Supabase. À coller une fois dans Supabase → SQL Editor → Run.
-- Le script peut être relancé sans risque (il ne recrée que ce qui manque).
--
-- Sécurité : RLS activé SANS aucune règle = personne ne peut lire ni écrire avec la clé publique.
-- Seul le serveur QuizParty (clé secrète, variable SUPABASE_SECRET_KEY sur Render) y accède.

-- Propositions des amis (page /proposer)
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  mode        text not null,           -- quiz, vraifaux, estimation, covers, pitch, emoji, sounds (hud et loading : modes supprimés)
  author      text,                    -- pseudo (facultatif)
  game        text,                    -- jeu concerné
  prompt      text,                    -- question, affirmation, pitch ou emojis
  answer      text,                    -- bonne réponse (Vrai/Faux, nombre, titre du jeu…)
  extra       jsonb not null default '{}'::jsonb,  -- mauvaises réponses, unité, explication…
  source      text,                    -- facultative
  file_path   text,                    -- image ou son, dans le bucket Storage « submissions »
  file_type   text,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'rejected', 'doubt')),
  review_note text,                    -- pourquoi refusé / le doute à trancher
  reviewed_at timestamptz,
  integrated_as text                   -- où c'est entré dans le code (ex. questions.js QCM)
);
create index if not exists submissions_status_idx on public.submissions (status, created_at desc);
alter table public.submissions enable row level security;

-- Signalements ⚑ de l'hôte pendant les parties (avant : data/feedback.jsonl, effacé par Render)
create table if not exists public.reports (
  id          text primary key,
  created_at  timestamptz not null default now(),
  type        text not null,           -- accept, wrong, remove, other
  status      text not null default 'pending'
              check (status in ('pending', 'done', 'ignored')),
  data        jsonb not null,          -- question complète, réponses des joueurs, commentaire
  handled_note text
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;

-- Fichiers soumis (privés : servis seulement après validation, en passant par le serveur)
insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 10485760)
on conflict (id) do nothing;

-- Copie EN LECTURE du contenu du jeu (questions, pitchs, emojis…), pour l'explorer dans le Table Editor.
-- La référence reste le code (server/data/…) : cette table est réécrite par le serveur quand le contenu change.
-- Modifier une ligne ici ne change PAS le jeu.
create table if not exists public.content (
  id         text primary key,         -- ex. quiz:12, pitch:super-mario-64:0
  mode       text not null,            -- quiz, vraifaux, estimation, covers, pitch, emoji, sounds, crossword (hud et loading : modes supprimés)
  game       text,
  prompt     text,                     -- question, affirmation, pitch, emojis, description du son…
  answer     text,
  choices    jsonb,                    -- mauvaises réponses du QCM
  level      text,                     -- easy / hard quand le mode a des niveaux
  info       text,                     -- explication affichée à la correction
  extra      jsonb not null default '{}'::jsonb
);
create index if not exists content_mode_idx on public.content (mode);
alter table public.content enable row level security;

create table if not exists public.meta (
  key   text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.meta enable row level security;

-- Droits du serveur (clé secrète = rôle service_role). Les projets Supabase récents ne les donnent plus
-- automatiquement aux nouvelles tables : sans ces lignes, l'API répond « permission denied ».
grant usage on schema public to service_role;
grant select, insert, update, delete on public.submissions, public.reports, public.content, public.meta to service_role;

-- Comptes joueurs (facultatifs, connexion Discord / Google via Supabase Auth).
-- Copie du profil public (nom, avatar) faite par le serveur à la connexion, pour les futures fonctions
-- (stats, défis entre potes, pièces…). L'e-mail reste dans auth.users, jamais copié ici.
-- Supprimer un compte (auth.users) supprime son profil.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  name        text,
  avatar_url  text,
  provider    text,                    -- discord, google
  last_seen   timestamptz
);
alter table public.profiles enable row level security;
grant select, insert, update, delete on public.profiles to service_role;
-- Pseudo choisi dans la page Profil (le même sur tous les appareils)
alter table public.profiles add column if not exists nickname text;
-- Rôle du joueur : modifiable seulement ici, dans Supabase (Table Editor → profiles).
--   player (par défaut) ; friend = ouvre les modes réservés (sons) au salon dont il est
--   l'hôte ; admin = friend + modération. Donner l'accès à un ami (après sa première connexion sur le site) :
--   update public.profiles set role = 'friend' where name = 'Pseudo Discord ou Google';
alter table public.profiles add column if not exists role text not null default 'player';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('player', 'friend', 'admin'));

-- Stats des joueurs connectés (et défi du jour) : une ligne par partie finie et par joueur…
create table if not exists public.game_results (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null check (source in ('party', 'daily')),
  session_id  text not null,           -- code du salon + n° de partie, ou date du défi AAAA-MM-JJ
  mode        text,
  score       int not null default 0,
  rank        int,                     -- place à la fin (1 = vainqueur), null pour le défi
  players     int not null default 1,
  won         boolean not null default false,
  rounds      int not null default 0,
  correct     int not null default 0
);
create index if not exists game_results_user_idx on public.game_results (user_id, created_at desc);
alter table public.game_results enable row level security;

-- … et une ligne par réponse (parties entre amis + défi du jour)
create table if not exists public.answers (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  game_id     uuid references public.game_results (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null check (source in ('party', 'daily')),
  session_id  text not null,
  round_index int,
  mode        text,                    -- mode de la manche (quiz, covers, emoji…, celui de la manche dans un Mix)
  kind        text,                    -- type de manche (qcm, cover, emoji…)
  content_id  text,                    -- id de la table content quand il existe (ex. quiz:12)
  game        text,                    -- jeu vidéo concerné, quand il y en a un
  input       text,                    -- choice / text
  answered    boolean not null default false,
  correct     boolean,
  points      int not null default 0,
  time_ms     int
);
create index if not exists answers_user_idx on public.answers (user_id, created_at desc);
create index if not exists answers_game_idx on public.answers (game_id);
alter table public.answers enable row level security;
grant select, insert, update, delete on public.game_results, public.answers to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Calcul des stats d'un joueur (page Profil, carte d'un joueur du salon), appelé par le serveur seulement.
-- Même logique que computeStats() dans server/stats.js (utilisé sans Supabase et dans les tests).
create or replace function public.player_stats(uid uuid) returns jsonb
language sql stable set search_path = public as $$
with g as (select * from game_results where user_id = uid and source = 'party'),
a as (select * from answers where user_id = uid and correct is not null),
runs as (
  select correct, row_number() over (order by created_at, id) - row_number() over (partition by correct order by created_at, id) as grp from a
),
modes as (select mode, count(*) as n, count(*) filter (where correct) as good from a group by mode),
games as (select game, count(*) as n, count(*) filter (where correct) as good from a where game is not null group by game),
fast as (select time_ms, game, mode from a where correct and time_ms is not null and time_ms > 0 order by time_ms limit 1)
select jsonb_build_object(
  'games', (select count(*) from g),
  'wins', (select count(*) from g where won),
  'podiums', (select count(*) from g where rank <= 3 and players >= 2),
  'bestScore', (select max(score) from g),
  'daily', (select count(distinct session_id) from answers where user_id = uid and source = 'daily'),
  'answers', (select count(*) from a),
  'correct', (select count(*) from a where correct),
  'modes', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'n', n, 'good', good) order by n desc) from modes), '[]'::jsonb),
  'best', coalesce((select jsonb_agg(x) from (select jsonb_build_object('game', game, 'n', n, 'good', good) as x from games where good > 0 order by good desc, good::float / n desc, game limit 5) t), '[]'::jsonb),
  'worst', coalesce((select jsonb_agg(x) from (select jsonb_build_object('game', game, 'n', n, 'good', good) as x from games where n - good > 0 order by n - good desc, good::float / n, game limit 3) t), '[]'::jsonb),
  'fastest', (select jsonb_build_object('ms', time_ms, 'game', game, 'mode', mode) from fast),
  'streak', coalesce((select max(c) from (select count(*) as c from runs where correct group by grp) s), 0)
);
$$;
revoke all on function public.player_stats(uuid) from public, anon, authenticated;
grant execute on function public.player_stats(uuid) to service_role;

-- Défi du jour (server/daily.js) : le même quiz pour tout le monde, de minuit à minuit (heure de Paris).
-- daily_challenges : le défi tiré pour chaque jour (gardé pour qu'un redémarrage ne le change pas).
create table if not exists public.daily_challenges (
  id          text primary key,         -- jour 'AAAA-MM-JJ'
  created_at  timestamptz not null default now(),
  number      int not null,             -- n° du défi (1 = premier jour)
  rounds      jsonb not null,           -- manches figées (énoncés, choix, réponses)
  keys        jsonb not null default '[]'::jsonb  -- questions utilisées (pas reposées pendant 30 jours)
);
alter table public.daily_challenges enable row level security;
-- daily_results : une ligne par compte et par jour (une seule tentative), créée dès le départ.
create table if not exists public.daily_results (
  id          text primary key,         -- 'AAAA-MM-JJ:<user_id>'
  day         text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text,                     -- pseudo affiché au classement
  avatar_url  text,
  score       int not null default 0,
  grid        text,                     -- 🟩 trouvé vite, 🟨 trouvé lentement, 🟥 raté
  correct     int not null default 0,
  rounds      int not null default 0,
  streak      int not null default 1,   -- jours joués d'affilée
  finished    boolean not null default false,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists daily_results_day_idx on public.daily_results (day, score desc);
create index if not exists daily_results_user_idx on public.daily_results (user_id, day desc);
alter table public.daily_results enable row level security;
grant select, insert, update, delete on public.daily_challenges, public.daily_results to service_role;

-- Image de profil choisie dans la page Profil : '' (initiale), 'photo' (photo Discord/Google), 'e:<emoji>:<couleur>' (galerie)
alter table public.profiles add column if not exists avatar_look text;
