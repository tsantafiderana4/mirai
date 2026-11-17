-- =====================================================================
-- « Leçon au tableau » : programme et leçons en cache, accès payé une
-- fois par élève, audio des étapes dans un bucket privé.
--
-- Tout est écrit par l'Edge Function (service_role). Le navigateur ne
-- peut que lire les leçons qu'il a débloquées. Idempotent.
-- =====================================================================

-- Programme de 20 leçons par langue + niveau (généré une fois, partagé)
CREATE TABLE IF NOT EXISTS public.board_syllabus (
    cache_key   text PRIMARY KEY,
    language    text NOT NULL,
    level       text NOT NULL,
    lessons     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Leçons générées (une par langue + niveau + numéro, partagée entre élèves)
CREATE TABLE IF NOT EXISTS public.board_lessons (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key      text UNIQUE NOT NULL,
    language       text NOT NULL,
    level          text NOT NULL,
    lesson_number  integer NOT NULL CHECK (lesson_number BETWEEN 1 AND 20),
    title          text NOT NULL,
    title_mg       text,
    content        jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_lessons_lang_level_idx ON public.board_lessons (language, level, lesson_number);

-- Leçons débloquées par chaque élève (5 crédits la première fois)
CREATE TABLE IF NOT EXISTS public.board_lesson_access (
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    lesson_id   uuid NOT NULL REFERENCES public.board_lessons(id) ON DELETE CASCADE,
    completed   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lesson_id)
);

ALTER TABLE public.board_syllabus      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_lessons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_lesson_access ENABLE ROW LEVEL SECURITY;

-- Le programme (titres) est visible par tout utilisateur connecté
DROP POLICY IF EXISTS "syllabus_read" ON public.board_syllabus;
CREATE POLICY "syllabus_read" ON public.board_syllabus FOR SELECT TO authenticated USING (true);

-- Une leçon n'est lisible que si l'élève l'a débloquée (ou admin)
DROP POLICY IF EXISTS "lessons_read_unlocked" ON public.board_lessons;
CREATE POLICY "lessons_read_unlocked" ON public.board_lessons FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.board_lesson_access a
     WHERE a.lesson_id = board_lessons.id AND a.user_id = auth.uid()));

-- L'élève voit ses accès et peut marquer une leçon comme terminée
DROP POLICY IF EXISTS "access_read_own" ON public.board_lesson_access;
CREATE POLICY "access_read_own" ON public.board_lesson_access FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "access_complete_own" ON public.board_lesson_access;
CREATE POLICY "access_complete_own" ON public.board_lesson_access FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Les écritures (création de leçon, déblocage) passent uniquement par le serveur
REVOKE INSERT, DELETE ON public.board_lesson_access FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.board_lessons, public.board_syllabus FROM anon, authenticated;
REVOKE UPDATE ON public.board_lesson_access FROM anon, authenticated;
GRANT UPDATE (completed) ON public.board_lesson_access TO authenticated;

-- Audio des étapes : bucket privé, lu via des URL signées créées par le serveur
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lesson-audio', 'lesson-audio', false, 10485760, ARRAY['audio/wav'])
ON CONFLICT (id) DO NOTHING;
