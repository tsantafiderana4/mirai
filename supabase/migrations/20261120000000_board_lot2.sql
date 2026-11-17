-- =====================================================================
-- Lot 2 « Leçon au tableau » : mini-test, révision espacée (« Mes mots »),
-- signalements d'erreurs, pré-génération nocturne des voix. Idempotent.
--
-- Aucune écriture directe depuis le navigateur : tout passe par des
-- fonctions SECURITY DEFINER qui vérifient l'élève et bornent les volumes
-- (le plan gratuit de Supabase est préservé).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mini-test de fin de leçon : meilleur score (0-100)
-- ---------------------------------------------------------------------
ALTER TABLE public.board_lesson_access ADD COLUMN IF NOT EXISTS best_score smallint;
ALTER TABLE public.board_lesson_access ADD COLUMN IF NOT EXISTS test_taken_at timestamptz;

CREATE OR REPLACE FUNCTION public.board_save_test_score(p_lesson_id uuid, p_score int)
RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_best smallint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  UPDATE public.board_lesson_access
     SET best_score = GREATEST(COALESCE(best_score, 0), LEAST(GREATEST(p_score, 0), 100)),
         test_taken_at = now()
   WHERE user_id = auth.uid() AND lesson_id = p_lesson_id
  RETURNING best_score INTO v_best;
  RETURN v_best; -- NULL si la leçon n'est pas débloquée
END $$;
REVOKE ALL ON FUNCTION public.board_save_test_score(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_save_test_score(uuid, int) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. « Mes mots » : révision espacée (boîtes de Leitner)
--    Boîte 1 → 1 jour, 2 → 3 j, 3 → 7 j, 4 → 16 j, 5 → 35 j.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_word_reviews (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    language    text NOT NULL,
    target      text NOT NULL,
    phonetic    text,
    fr          text,
    mg          text,
    lesson_id   uuid REFERENCES public.board_lessons(id) ON DELETE SET NULL,
    box         smallint NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
    due_at      timestamptz NOT NULL DEFAULT now(),
    reviews     integer NOT NULL DEFAULT 0,
    lapses      integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, language, target)
);
CREATE INDEX IF NOT EXISTS board_word_reviews_due_idx ON public.board_word_reviews (user_id, language, due_at);

ALTER TABLE public.board_word_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "words_read_own" ON public.board_word_reviews;
CREATE POLICY "words_read_own" ON public.board_word_reviews FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.board_word_reviews FROM anon, authenticated;

/** Intervalle de révision d'une boîte de Leitner. */
CREATE OR REPLACE FUNCTION public.board_box_interval(p_box int)
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE GREATEST(LEAST(p_box, 5), 1)
  WHEN 1 THEN interval '1 day' WHEN 2 THEN interval '3 days' WHEN 3 THEN interval '7 days'
  WHEN 4 THEN interval '16 days' ELSE interval '35 days' END $$;

/**
 * Ajoute à « Mes mots » le vocabulaire d'une leçon débloquée. Les mots sont
 * lus dans la leçon elle-même (jamais envoyés par le navigateur) : pas de
 * texte arbitraire en base. Renvoie le nombre de mots ajoutés.
 */
CREATE OR REPLACE FUNCTION public.board_words_add(p_lesson_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.board_lesson_access
                  WHERE user_id = auth.uid() AND lesson_id = p_lesson_id) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.board_word_reviews (user_id, language, target, phonetic, fr, mg, lesson_id, due_at)
  SELECT auth.uid(), l.language,
         left(btrim(it->>'target'), 120), left(it->>'phonetic', 120),
         left(it->>'fr', 200), left(it->>'mg', 300), l.id,
         now() + interval '20 hours'
    FROM public.board_lessons l,
         jsonb_array_elements(COALESCE(l.content->'steps', '[]'::jsonb)) s,
         jsonb_array_elements(COALESCE(s->'items', '[]'::jsonb)) it
   WHERE l.id = p_lesson_id
     AND it->>'kind' = 'vocab'
     AND COALESCE(btrim(it->>'target'), '') <> ''
  ON CONFLICT (user_id, language, target) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.board_words_add(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_words_add(uuid) TO authenticated;

/** Résultat d'une révision : « je savais » fait monter d'une boîte, sinon retour en boîte 1. */
CREATE OR REPLACE FUNCTION public.board_word_review(p_id uuid, p_known boolean)
RETURNS TABLE (box smallint, due_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  UPDATE public.board_word_reviews w
     SET box = CASE WHEN p_known THEN LEAST(w.box + 1, 5) ELSE 1 END,
         due_at = now() + public.board_box_interval(CASE WHEN p_known THEN LEAST(w.box + 1, 5) ELSE 1 END),
         reviews = w.reviews + 1,
         lapses = w.lapses + CASE WHEN p_known THEN 0 ELSE 1 END,
         updated_at = now()
   WHERE w.id = p_id AND w.user_id = auth.uid()
     -- une carte pas encore due ne monte pas de boîte (pas de « triche » en avance)
     AND (NOT p_known OR w.due_at <= now() + interval '4 hours')
  RETURNING w.box, w.due_at;
END $$;
REVOKE ALL ON FUNCTION public.board_word_review(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_word_review(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Signalements d'erreurs par les élèves, traités par l'admin
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_lesson_reports (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id    uuid NOT NULL REFERENCES public.board_lessons(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    step_index   integer,
    message      text NOT NULL CHECK (char_length(message) BETWEEN 3 AND 500),
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);
CREATE INDEX IF NOT EXISTS board_lesson_reports_open_idx ON public.board_lesson_reports (status, created_at DESC);

ALTER TABLE public.board_lesson_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reports_read" ON public.board_lesson_reports;
CREATE POLICY "reports_read" ON public.board_lesson_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "reports_admin_update" ON public.board_lesson_reports;
CREATE POLICY "reports_admin_update" ON public.board_lesson_reports FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE INSERT, DELETE ON public.board_lesson_reports FROM anon, authenticated;
REVOKE UPDATE ON public.board_lesson_reports FROM anon, authenticated;
GRANT UPDATE (status, resolved_at) ON public.board_lesson_reports TO authenticated;

/** Signaler une erreur dans une leçon débloquée (10 signalements max par jour et par élève). */
CREATE OR REPLACE FUNCTION public.board_report(p_lesson_id uuid, p_step_index int, p_message text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_msg text := btrim(COALESCE(p_message, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501'; END IF;
  IF char_length(v_msg) < 3 THEN RAISE EXCEPTION 'Message trop court' USING ERRCODE = '22023'; END IF;
  IF NOT public.is_admin() AND NOT EXISTS (SELECT 1 FROM public.board_lesson_access
                  WHERE user_id = auth.uid() AND lesson_id = p_lesson_id) THEN
    RAISE EXCEPTION 'Leçon non débloquée' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.board_lesson_reports
       WHERE user_id = auth.uid() AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Trop de signalements aujourd''hui' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.board_lesson_reports (lesson_id, user_id, step_index, message)
  VALUES (p_lesson_id, auth.uid(), CASE WHEN p_step_index BETWEEN 0 AND 30 THEN p_step_index END, left(v_msg, 500))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.board_report(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_report(uuid, int, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Pré-génération nocturne des voix (pg_cron + pg_net, inclus en gratuit)
-- ---------------------------------------------------------------------
-- Réglages privés (schéma non exposé par l'API) : adresse de la fonction,
-- clé publique anon et secret partagé avec l'Edge Function.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.app_config (
    name   text PRIMARY KEY,
    value  text NOT NULL
);
INSERT INTO private.app_config (name, value)
VALUES ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (name) DO NOTHING;

/** Vérifie le secret envoyé par la tâche planifiée (réservé au serveur). */
CREATE OR REPLACE FUNCTION public.cron_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private
AS $$ SELECT COALESCE(length(p_secret) >= 32 AND p_secret = (SELECT value FROM private.app_config WHERE name = 'cron_secret'), false) $$;
REVOKE ALL ON FUNCTION public.cron_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_secret_ok(text) TO service_role;

/**
 * Leçons à équiper d'une voix en priorité : les plus suivies d'abord.
 * Réservé au serveur.
 */
CREATE OR REPLACE FUNCTION public.board_pregen_candidates(p_limit int DEFAULT 40)
RETURNS TABLE (lesson_id uuid, step_count int, learners bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id, COALESCE(jsonb_array_length(l.content->'steps'), 0), count(a.user_id)
    FROM public.board_lessons l
    LEFT JOIN public.board_lesson_access a ON a.lesson_id = l.id
   GROUP BY l.id
   ORDER BY count(a.user_id) DESC, l.created_at ASC
   LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;
REVOKE ALL ON FUNCTION public.board_pregen_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_pregen_candidates(int) TO service_role;

/**
 * Appelée par pg_cron : demande à l'Edge Function de produire UNE voix.
 * Ne fait rien tant que l'adresse et la clé anon ne sont pas configurées
 * (voir supabase/CRON_mirai.sql).
 */
CREATE OR REPLACE FUNCTION private.board_pregen_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE v_url text; v_anon text; v_secret text;
BEGIN
  SELECT value INTO v_url FROM private.app_config WHERE name = 'functions_url';
  SELECT value INTO v_anon FROM private.app_config WHERE name = 'anon_key';
  SELECT value INTO v_secret FROM private.app_config WHERE name = 'cron_secret';
  IF v_url IS NULL OR v_anon IS NULL OR v_secret IS NULL THEN RETURN; END IF;
  IF to_regnamespace('net') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    USING v_url || '/gemini-api',
          jsonb_build_object('Content-Type', 'application/json',
                             'Authorization', 'Bearer ' || v_anon,
                             'apikey', v_anon,
                             'x-cron-secret', v_secret),
          jsonb_build_object('action', 'cron_pregen_audio');
END $$;
REVOKE ALL ON FUNCTION private.board_pregen_tick() FROM PUBLIC, anon, authenticated;
