-- Profil Steam lié depuis la page Profil (mode « Ta bande »). À appliquer d'abord au dev.
alter table public.profiles add column if not exists steam_input text;
