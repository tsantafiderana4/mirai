-- Lot 2 (migration 20261120000000_board_lot2.sql) : mini-test, « Mes mots »,
-- signalements, pré-génération nocturne.
\set ON_ERROR_STOP on
INSERT INTO public.board_lessons (id, cache_key, language, level, lesson_number, title, content)
VALUES ('22222222-2222-2222-2222-222222222222', 'v2|Anglais|A1|2', 'Anglais', 'A1', 2, 'Saluer', '{"steps":[
  {"say":"a","items":[{"kind":"vocab","target":"Hello","fr":"Bonjour","mg":"Manao ahoana"},
                      {"kind":"vocab","target":"Goodbye","fr":"Au revoir","mg":"Veloma"}]},
  {"say":"b","items":[{"kind":"vocab","target":"Hello","fr":"Salut"},{"kind":"explain","text":"x"}]}
]}');
INSERT INTO public.board_lesson_access (user_id, lesson_id)
VALUES ('00000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);

-- Mini-test : on garde le meilleur score, borné à 0-100
SELECT public.board_save_test_score('22222222-2222-2222-2222-222222222222', 60) AS score_60;
SELECT public.board_save_test_score('22222222-2222-2222-2222-222222222222', 40) AS reste_60;
SELECT public.board_save_test_score('22222222-2222-2222-2222-222222222222', 500) AS borne_100;

-- « Mes mots » : vocabulaire lu dans la leçon, sans doublon (Hello deux fois)
SELECT public.board_words_add('22222222-2222-2222-2222-222222222222') AS mots_ajoutes;
SELECT public.board_words_add('22222222-2222-2222-2222-222222222222') AS mots_ajoutes_2e_fois;
SELECT target, box, due_at > now() + interval '19 hours' AS revu_demain FROM public.board_word_reviews ORDER BY target;
DO $$ BEGIN
  INSERT INTO public.board_word_reviews (user_id, language, target)
  VALUES ('00000000-0000-0000-0000-00000000000b', 'Anglais', 'pirate');
  RAISE EXCEPTION 'ÉCHEC : écriture directe dans board_word_reviews';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ ajout direct de mots refusé';
END $$;
DO $$ BEGIN
  UPDATE public.board_word_reviews SET box = 5;
  RAISE EXCEPTION 'ÉCHEC : modification directe de la boîte';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ modification directe de la boîte refusée';
END $$;

-- Révision : pas de promotion en avance, puis Leitner 1 → 2 (3 jours), oubli → 1
SELECT count(*) AS promotion_en_avance FROM public.board_word_review(
  (SELECT id FROM public.board_word_reviews WHERE target = 'Hello'), true);
RESET ROLE;
UPDATE public.board_word_reviews SET due_at = now() - interval '1 minute';
SET ROLE authenticated;
SELECT box, due_at BETWEEN now() + interval '2 days 23 hours' AND now() + interval '3 days 1 hour' AS dans_3_jours
  FROM public.board_word_review((SELECT id FROM public.board_word_reviews WHERE target = 'Hello'), true);
SELECT box, due_at BETWEEN now() + interval '23 hours' AND now() + interval '25 hours' AS demain
  FROM public.board_word_review((SELECT id FROM public.board_word_reviews WHERE target = 'Goodbye'), false);
SELECT target, box, reviews, lapses FROM public.board_word_reviews ORDER BY target;

-- L'élève c ne voit pas les mots de b et ne peut pas réviser ses cartes
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
SELECT count(*) AS c_voit_mots_de_b FROM public.board_word_reviews;
RESET ROLE;
SELECT id AS hello_id FROM public.board_word_reviews WHERE target = 'Hello' \gset
UPDATE public.board_word_reviews SET due_at = now() - interval '1 minute';
SET ROLE authenticated;
SELECT count(*) AS c_revise_carte_de_b FROM public.board_word_review(:'hello_id', true);
SELECT count(*) AS c_oublie_carte_de_b FROM public.board_word_review(:'hello_id', false);
SELECT public.board_words_add('22222222-2222-2222-2222-222222222222') AS c_sans_acces_ajoute;
SELECT public.board_save_test_score('22222222-2222-2222-2222-222222222222', 90) IS NULL AS c_sans_acces_score_ignore;

-- Signalements : leçon débloquée seulement, 10 par jour maximum
DO $$ BEGIN
  PERFORM public.board_report('22222222-2222-2222-2222-222222222222', 0, 'Erreur de traduction');
  RAISE EXCEPTION 'ÉCHEC : signalement sur une leçon non débloquée';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ signalement refusé sans accès';
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SELECT public.board_report('22222222-2222-2222-2222-222222222222', 1, '  Le malagasy de Hello est faux  ') IS NOT NULL AS signale;
SELECT public.board_report('22222222-2222-2222-2222-222222222222', 999, 'Étape hors limite') IS NOT NULL AS signale_etape_hors_limite;
DO $$ BEGIN
  PERFORM public.board_report('22222222-2222-2222-2222-222222222222', 0, 'ab');
  RAISE EXCEPTION 'ÉCHEC : message trop court accepté';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE '✅ message trop court refusé';
END $$;
DO $$ BEGIN
  FOR i IN 1..8 LOOP PERFORM public.board_report('22222222-2222-2222-2222-222222222222', 0, 'Signalement ' || i); END LOOP;
  PERFORM public.board_report('22222222-2222-2222-2222-222222222222', 0, 'Le onzième');
  RAISE EXCEPTION 'ÉCHEC : plus de 10 signalements par jour';
EXCEPTION WHEN program_limit_exceeded THEN RAISE NOTICE '✅ limite de 10 signalements par jour';
END $$;
SELECT step_index, message FROM public.board_lesson_reports ORDER BY created_at, message LIMIT 2;
DO $$ BEGIN
  UPDATE public.board_lesson_reports SET status = 'resolved';
  IF FOUND THEN RAISE EXCEPTION 'ÉCHEC : un élève peut clore un signalement'; END IF;
  RAISE NOTICE '✅ un élève ne peut pas clore un signalement';
END $$;

-- L'admin voit tous les signalements et peut les clore
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SELECT count(*) AS admin_voit_signalements FROM public.board_lesson_reports;
UPDATE public.board_lesson_reports SET status = 'resolved', resolved_at = now() WHERE step_index = 1;
SELECT status, count(*) FROM public.board_lesson_reports GROUP BY status ORDER BY status;

-- Pré-génération : fonctions réservées au serveur
DO $$ BEGIN
  PERFORM public.cron_secret_ok('x');
  RAISE EXCEPTION 'ÉCHEC : cron_secret_ok appelable par un élève';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ cron_secret_ok réservé au serveur';
END $$;
DO $$ BEGIN
  PERFORM * FROM public.board_pregen_candidates(5);
  RAISE EXCEPTION 'ÉCHEC : board_pregen_candidates appelable par un élève';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ board_pregen_candidates réservé au serveur';
END $$;
DO $$ BEGIN
  PERFORM * FROM private.app_config;
  RAISE EXCEPTION 'ÉCHEC : le secret est lisible';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ secret illisible';
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.cron_secret_ok('mauvais') AS mauvais_secret, public.cron_secret_ok(NULL) AS secret_absent;
RESET ROLE;
SELECT public.cron_secret_ok((SELECT value FROM private.app_config WHERE name = 'cron_secret')) AS bon_secret,
       length((SELECT value FROM private.app_config WHERE name = 'cron_secret')) AS longueur_secret;
SET ROLE service_role;
SELECT lesson_id, step_count, learners FROM public.board_pregen_candidates(5);
RESET ROLE;
-- Sans adresse configurée, la tâche ne fait rien (et ne plante pas)
SELECT 'ok' AS tick_sans_config FROM (SELECT private.board_pregen_tick()) x;
