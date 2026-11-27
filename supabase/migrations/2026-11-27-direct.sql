-- Quiz en direct (server/live.js) : ses parties et réponses s'enregistrent avec la source 'live'.
-- Élargit seulement les valeurs permises : aucune donnée existante modifiée.
alter table public.game_results drop constraint if exists game_results_source_check;
alter table public.game_results add constraint game_results_source_check check (source in ('party', 'daily', 'challenge', 'live'));
alter table public.answers drop constraint if exists answers_source_check;
alter table public.answers add constraint answers_source_check check (source in ('party', 'daily', 'challenge', 'live'));
