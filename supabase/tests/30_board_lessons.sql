-- Leçon au tableau (migration 20261118000000_board_lessons.sql)
\set ON_ERROR_STOP on
INSERT INTO public.board_lessons (id, cache_key, language, level, lesson_number, title, content)
VALUES ('11111111-1111-1111-1111-111111111111', 'v1|Anglais|A1|1', 'Anglais', 'A1', 1, 'Se présenter', '{"steps":[]}');
INSERT INTO public.board_lesson_access (user_id, lesson_id)
VALUES ('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111');

SET ROLE authenticated;
-- L'élève b a débloqué la leçon : il la voit ; l'élève c non.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SELECT count(*) AS b_voit_la_lecon FROM public.board_lessons;
UPDATE public.board_lesson_access SET completed = true WHERE lesson_id = '11111111-1111-1111-1111-111111111111';
SELECT completed AS b_a_termine FROM public.board_lesson_access;
DO $$ BEGIN
  INSERT INTO public.board_lesson_access (user_id, lesson_id)
  VALUES ('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111');
  RAISE EXCEPTION 'ÉCHEC : un élève peut se débloquer une leçon sans payer';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ déblocage sans payer refusé';
END $$;
DO $$ BEGIN
  UPDATE public.board_lessons SET title = 'pirate';
  RAISE EXCEPTION 'ÉCHEC : un élève peut modifier une leçon partagée';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '✅ modification de leçon refusée';
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
SELECT count(*) AS c_voit_la_lecon FROM public.board_lessons;
RESET ROLE;
SELECT id, public FROM storage.buckets;
