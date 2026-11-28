-- Notifications des quiz en direct (server/push.js) : un abonnement du navigateur par appareil, et les choix.
-- Compte connecté : choix dans push_accounts, appareils rattachés par user_id. Invité : choix sur l'appareil.
-- Nouvelles tables seulement : aucune donnée existante modifiée. RLS sans règle = seul le serveur y accède.
create table if not exists public.push_subscriptions (
  id          text primary key,          -- empreinte de l'adresse de l'abonnement
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  endpoint    text not null,             -- adresse donnée par le navigateur (Google, Mozilla, Apple, Microsoft)
  p256dh      text not null,             -- clés de chiffrement de l'appareil
  auth        text not null,
  every_live  boolean not null default false,   -- « Tous les directs »
  formats     jsonb not null default '[]'::jsonb,  -- créneaux cochés : midi, soir, nuit, finale
  slots       jsonb not null default '[]'::jsonb   -- directs précis : « 2026-11-28T18:30 »
);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to service_role;
-- Appareil d'un compte connecté (supprimé avec le compte)
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users (id) on delete cascade;
create table if not exists public.push_accounts (
  id          uuid primary key references auth.users (id) on delete cascade,
  updated_at  timestamptz not null default now(),
  every_live  boolean not null default false,
  formats     jsonb not null default '[]'::jsonb,
  slots       jsonb not null default '[]'::jsonb
);
alter table public.push_accounts enable row level security;
grant select, insert, update, delete on public.push_accounts to service_role;
