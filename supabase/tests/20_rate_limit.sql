-- Limite de débit IA (migration 20261117000000_ai_rate_limits.sql)
\set ON_ERROR_STOP on
DELETE FROM public.ai_rate_limits;

-- 1. Inaccessible depuis le navigateur
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.ai_rate_check('00000000-0000-0000-0000-00000000000b', false);
  RAISE EXCEPTION 'ÉCHEC : authenticated peut appeler ai_rate_check';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '✅ ai_rate_check refusé au rôle authenticated';
END $$;
RESET ROLE;

SET ROLE service_role;
-- 2. 20 requêtes payantes passent, la 21e est bloquée (minute)
SELECT count(*) FILTER (WHERE r IS NULL) AS autorisees,
       count(*) FILTER (WHERE r = 'minute') AS bloquees_minute
FROM (SELECT public.ai_rate_check('00000000-0000-0000-0000-00000000000b', false) AS r
      FROM generate_series(1, 21)) t;

-- 3. Plafond gratuit : 3 max/jour (paramètre réduit pour le test)
SELECT array_agg(coalesce(public.ai_rate_check('00000000-0000-0000-0000-00000000000c', true, 100, 400, 3), 'ok') ORDER BY g)
       AS gratuit_4_appels
FROM generate_series(1, 4) g;

-- 4. Changement de minute : le compteur repart
RESET ROLE;
UPDATE public.ai_rate_limits SET minute_start = minute_start - interval '1 minute'
 WHERE user_id = '00000000-0000-0000-0000-00000000000b';
SET ROLE service_role;
SELECT coalesce(public.ai_rate_check('00000000-0000-0000-0000-00000000000b', false), 'ok') AS apres_une_minute;

-- 5. Plafond journalier (paramètre réduit) puis changement de jour
SELECT coalesce(public.ai_rate_check('00000000-0000-0000-0000-00000000000b', false, 100, 22), 'ok') AS jour_22e,
       coalesce(public.ai_rate_check('00000000-0000-0000-0000-00000000000b', false, 100, 22), 'ok') AS jour_23e;
RESET ROLE;
UPDATE public.ai_rate_limits SET day = day - 1 WHERE user_id = '00000000-0000-0000-0000-00000000000b';
SET ROLE service_role;
SELECT coalesce(public.ai_rate_check('00000000-0000-0000-0000-00000000000b', false, 100, 22), 'ok') AS lendemain;
RESET ROLE;
