-- QuizParty : tables Supabase. À coller une fois dans Supabase → SQL Editor → Run.
-- Le script peut être relancé sans risque (il ne recrée que ce qui manque).
--
-- Sécurité : RLS activé SANS aucune règle = personne ne peut lire ni écrire avec la clé publique.
-- Seul le serveur QuizParty (clé secrète, variable SUPABASE_SECRET_KEY sur Render) y accède.

-- Propositions des amis (page /proposer)
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  mode        text not null,           -- quiz, vraifaux, estimation, covers, pitch, emoji, hud, loading, sounds
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
  mode       text not null,            -- quiz, vraifaux, estimation, covers, pitch, emoji, hud, loading, sounds, crossword
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
-- Rôle du joueur (player par défaut, admin) : modifiable seulement ici, dans Supabase (Table Editor → profiles).
alter table public.profiles add column if not exists role text not null default 'player';
do $$ begin
  alter table public.profiles add constraint profiles_role_check check (role in ('player', 'admin'));
exception when duplicate_object then null; end $$;

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
