-- Données FICTIVES pour la base de DEV uniquement (jamais en prod).
-- 6 joueurs inventés (comptes sans connexion possible), leur cote du mois, des parties et le défi du jour.
-- Rejouable : chaque ligne a un identifiant fixe et « on conflict do nothing » ou une mise à jour.
-- Les dates suivent le jour où on le lance (heure de Paris), donc on peut le relancer pour rafraîchir.
-- Lancer : Supabase (projet dev) → SQL Editor → coller ce fichier, ou demander à Claude.

do $$
declare
  season text := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM');
  today  text := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD');
  p record;
begin
  for p in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'Alex (test)',    'friend', 1712, 120, 9, 'g:01'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'Sam (test)',     'player', 1655, 95,  7, 'g:02'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'Lou (test)',     'player', 1580, 80,  6, 'g:03'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'Max (test)',     'player', 1502, 60,  4, 'g:04'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'Noa (test)',     'player', 1448, 45,  3, 'g:05'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'Novice (test)',  'player', 1500, 12,  1, 'g:06')
    ) as t(id, name, role, rating, answers, daily, look)
  loop
    -- Compte Supabase Auth inventé (e-mail en .invalid : aucune connexion possible)
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, email_confirmed_at)
    values (p.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'seed' || right(p.id::text, 2) || '@quizparty.invalid',
            '{"provider":"seed"}'::jsonb, jsonb_build_object('full_name', p.name),
            now() - interval '20 days', now(), now() - interval '20 days')
    on conflict (id) do nothing;

    insert into public.profiles (id, name, provider, role, last_seen)
    values (p.id, p.name, 'discord', p.role, now())
    on conflict (id) do update set name = excluded.name, role = excluded.role, last_seen = excluded.last_seen;

    -- Cote du mois (placé à partir de 30 réponses : « Novice (test) » est encore en placement)
    insert into public.player_ratings (id, season, user_id, rating, rd, answers, answers_total, games, peak, last_at)
    values (season || ':' || p.id, season, p.id, p.rating, case when p.answers >= 30 then 90 else 250 end,
            p.answers, p.answers, p.answers / 10, case when p.answers >= 30 then p.rating + 20 end, now())
    on conflict (id) do update set rating = excluded.rating, answers = excluded.answers,
      answers_total = excluded.answers_total, last_at = excluded.last_at;

    -- Une partie entre amis gagnée ou perdue (pour la page Stats)
    insert into public.game_results (id, user_id, source, session_id, mode, score, rank, players, won, rounds, correct, created_at)
    values (md5('seed-party-' || p.id)::uuid, p.id, 'party', 'SEED#1', 'quiz', p.rating - 900,
            ((p.rating::int % 4) + 1), 4, p.rating > 1700, 10, p.daily, now() - interval '2 days')
    on conflict (id) do nothing;

    -- Défi du jour terminé aujourd'hui (sauf le novice)
    if p.daily > 1 then
      insert into public.daily_results (id, day, user_id, name, score, grid, correct, rounds, streak, finished, finished_at)
      values (today || ':' || p.id, today, p.id, p.name, p.daily * 900, repeat('🟩', p.daily) || repeat('🟥', 10 - p.daily),
              p.daily, 10, p.daily, true, now())
      on conflict (id) do nothing;
    end if;
  end loop;
end $$;

-- Tout effacer (les lignes liées partent avec, grâce aux « on delete cascade ») :
-- delete from auth.users where email like '%@quizparty.invalid';
