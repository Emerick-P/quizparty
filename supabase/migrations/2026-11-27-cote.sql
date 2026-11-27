-- Cote des joueurs et des questions (server/rating.js). Ajouts seulement : aucune donnée existante modifiée.

-- Clé stable de la question sur chaque réponse (sert à « question déjà vue » et à la cote des questions)
alter table public.answers add column if not exists question_key text;
create index if not exists answers_user_question_idx on public.answers (user_id, question_key);

-- Cote d'un joueur, une ligne par saison (mois, heure de Paris) : l'historique des saisons reste
create table if not exists public.player_ratings (
  id            text primary key,        -- '<AAAA-MM>:<user_id>'
  season        text not null,           -- AAAA-MM
  user_id       uuid not null references auth.users (id) on delete cascade,
  rating        double precision not null default 1500,
  rd            double precision not null default 350,   -- incertitude (grandit pendant l'absence)
  vol           double precision not null default 0.06,  -- volatilité (Glicko-2)
  answers       int not null default 0,  -- réponses comptées cette saison
  answers_total int not null default 0,  -- réponses comptées depuis toujours (placement)
  games         int not null default 0,
  peak          double precision,        -- meilleure cote de la saison (une fois placé)
  last_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists player_ratings_board_idx on public.player_ratings (season, rating desc);
create index if not exists player_ratings_user_idx on public.player_ratings (user_id, season desc);
alter table public.player_ratings enable row level security;

-- Cote (difficulté) des questions : jamais remise à zéro
create table if not exists public.question_ratings (
  id          text primary key,          -- clé stable : 'quiz:<empreinte>', 'covers:<slug>', 'sounds:<id>'…
  mode        text,
  rating      double precision not null,
  rd          double precision not null,
  n           int not null default 0,    -- réponses comptées
  score       double precision not null default 0, -- somme des résultats (taux de réussite = score / n)
  prior       int,                       -- note de départ estimée (1 à 5)
  updated_at  timestamptz not null default now()
);
alter table public.question_ratings enable row level security;

-- Journal : une ligne par partie qui a fait bouger une cote (gain affiché, courbes plus tard)
create table if not exists public.rating_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  season        text not null,
  source        text not null,
  session_id    text,
  rating_before double precision,
  rating_after  double precision,
  rd_after      double precision,
  counted       int not null default 0
);
create index if not exists rating_events_user_idx on public.rating_events (user_id, created_at desc);
alter table public.rating_events enable row level security;

grant select, insert, update, delete on public.player_ratings, public.question_ratings, public.rating_events to service_role;
grant usage, select on all sequences in schema public to service_role;
