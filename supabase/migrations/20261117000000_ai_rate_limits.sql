-- =====================================================================
-- TeacherMada — Limites d'utilisation de l'IA (anti-abus)
--
-- Appelé uniquement par l'Edge Function `gemini-api` (service_role),
-- avant chaque génération. Les admins ne sont pas limités (géré dans
-- l'Edge Function). Idempotent.
--
-- Limites par utilisateur :
--   - 20 requêtes IA par minute
--   - 400 requêtes IA par jour
--   - 150 requêtes « gratuites » par jour (aide, vocabulaire, culture,
--     traduction, audio des examens) : ces usages ne coûtent pas de
--     crédits, ce plafond évite qu'ils servent à consommer l'IA sans payer.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
    user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    minute_start   timestamptz NOT NULL DEFAULT date_trunc('minute', now()),
    minute_count   int NOT NULL DEFAULT 0,
    day            date NOT NULL DEFAULT current_date,
    day_count      int NOT NULL DEFAULT 0,
    free_day_count int NOT NULL DEFAULT 0
);

-- Personne ne lit/écrit cette table depuis le navigateur.
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_rate_check(
    p_user_id uuid,
    p_is_free boolean DEFAULT false,
    p_per_minute int DEFAULT 20,
    p_per_day int DEFAULT 400,
    p_free_per_day int DEFAULT 150
)
RETURNS text   -- NULL = autorisé ; sinon 'minute' | 'day' | 'free_day'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r public.ai_rate_limits%ROWTYPE;
    v_minute timestamptz := date_trunc('minute', now());
BEGIN
    INSERT INTO public.ai_rate_limits (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO r FROM public.ai_rate_limits WHERE user_id = p_user_id FOR UPDATE;

    IF r.minute_start <> v_minute THEN
        r.minute_start := v_minute;
        r.minute_count := 0;
    END IF;
    IF r.day <> current_date THEN
        r.day := current_date;
        r.day_count := 0;
        r.free_day_count := 0;
    END IF;

    IF r.minute_count >= p_per_minute THEN
        RETURN 'minute';
    END IF;
    IF r.day_count >= p_per_day THEN
        RETURN 'day';
    END IF;
    IF p_is_free AND r.free_day_count >= p_free_per_day THEN
        RETURN 'free_day';
    END IF;

    UPDATE public.ai_rate_limits
       SET minute_start   = r.minute_start,
           minute_count   = r.minute_count + 1,
           day            = r.day,
           day_count      = r.day_count + 1,
           free_day_count = r.free_day_count + CASE WHEN p_is_free THEN 1 ELSE 0 END
     WHERE user_id = p_user_id;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_rate_check(uuid, boolean, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rate_check(uuid, boolean, int, int, int) TO service_role;

COMMIT;
