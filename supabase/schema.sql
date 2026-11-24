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
