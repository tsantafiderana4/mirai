-- =====================================================================
-- TeacherMada / mirai — Schéma de base
--
-- Reconstitué à partir des colonnes réellement utilisées par le code
-- (src/), en remplacement des anciens fichiers contradictoires
-- (supabase_schema*.sql, supabase/fix_*.sql).
--
-- À appliquer sur un projet NEUF, avant :
--   20261116000000_security_hardening.sql
--   20261117000000_ai_rate_limits.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Profils
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username      text NOT NULL,
    email         text,
    phone_number  text,
    role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    credits       integer NOT NULL DEFAULT 6 CHECK (credits >= 0),
    preferences   jsonb,
    is_suspended  boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx ON public.profiles (lower(username));
CREATE INDEX IF NOT EXISTS profiles_phone_idx ON public.profiles (phone_number);

-- Création automatique du profil à l'inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text := COALESCE(NULLIF(NEW.raw_user_meta_data->>'username', ''), split_part(NEW.email, '@', 1));
BEGIN
  -- Évite l'échec de l'inscription si le pseudo est déjà pris
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_username)) THEN
    v_username := v_username || '_' || substr(NEW.id::text, 1, 4);
  END IF;

  INSERT INTO public.profiles (id, username, email, phone_number)
  VALUES (NEW.id, v_username, NEW.email, NULLIF(NEW.raw_user_meta_data->>'phone_number', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- Sessions d'apprentissage (chat, dialogues, appels…)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_sessions (
    id          text PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type        text NOT NULL DEFAULT 'lesson',
    language    text NOT NULL,
    level       text NOT NULL,
    messages    jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_sessions_user_idx ON public.learning_sessions (user_id, language, level);

DROP TRIGGER IF EXISTS set_sessions_updated_at ON public.learning_sessions;
CREATE TRIGGER set_sessions_updated_at BEFORE UPDATE ON public.learning_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- Points faibles détectés (mémoire pédagogique légère)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_weakness (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category      text NOT NULL,
    tag           text NOT NULL,
    error_count   integer NOT NULL DEFAULT 1,
    identified_at timestamptz NOT NULL DEFAULT now(),
    last_seen     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, category, tag)
);

-- ---------------------------------------------------------------------
-- Examens et certificats
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_results (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type             text,
    language         text NOT NULL,
    level            text NOT NULL,
    score            numeric NOT NULL,
    total_questions  integer NOT NULL DEFAULT 0,
    passed           boolean NOT NULL DEFAULT false,
    details          jsonb NOT NULL DEFAULT '{}'::jsonb,
    certificate_id   text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_results_user_idx ON public.exam_results (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.certificates (
    id               text PRIMARY KEY,
    user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_name        text,
    user_full_name   text,
    language         text NOT NULL,
    level            text NOT NULL,
    exam_id          uuid REFERENCES public.exam_results(id) ON DELETE SET NULL,
    issue_date       timestamptz NOT NULL DEFAULT now(),
    validation_hash  text UNIQUE,
    qr_code_data     text,
    score            numeric,
    global_score     numeric,
    skill_scores     jsonb,
    status           text
);
CREATE INDEX IF NOT EXISTS certificates_user_idx ON public.certificates (user_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS certificates_exam_idx ON public.certificates (exam_id);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type        text NOT NULL DEFAULT 'info',
    title       text NOT NULL,
    message     text NOT NULL,
    read        boolean NOT NULL DEFAULT false,
    data        jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);

-- Garde au plus 50 notifications (et 30 jours) par utilisateur
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
   WHERE user_id = NEW.user_id
     AND (created_at < now() - interval '30 days'
          OR id NOT IN (SELECT id FROM public.notifications
                         WHERE user_id = NEW.user_id
                         ORDER BY created_at DESC LIMIT 50));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_cleanup_notifications ON public.notifications;
CREATE TRIGGER trigger_cleanup_notifications AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_old_notifications();

-- ---------------------------------------------------------------------
-- Paiements / demandes à l'admin, coupons, réglages
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_requests (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    username    text,
    type        text NOT NULL,
    amount      integer,
    message     text,
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_requests_created_idx ON public.admin_requests (created_at DESC);

CREATE TABLE IF NOT EXISTS public.coupons (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text UNIQUE NOT NULL,
    amount      integer NOT NULL CHECK (amount > 0),
    expires_at  timestamptz,
    created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
    id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    credit_price            integer NOT NULL DEFAULT 50,
    valid_transaction_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
    valid_coupons           jsonb NOT NULL DEFAULT '[]'::jsonb,
    admin_contact           jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- RLS (les policies de profiles, api_keys, coupons et admin_requests
-- sont posées par 20261116000000_security_hardening.sql)
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_weakness     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings   ENABLE ROW LEVEL SECURITY;

-- Fonction admin (redéfinie à l'identique par la migration de sécurité)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

DROP POLICY IF EXISTS "sessions_own" ON public.learning_sessions;
CREATE POLICY "sessions_own" ON public.learning_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "weakness_own" ON public.user_weakness;
CREATE POLICY "weakness_own" ON public.user_weakness FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "exams_select_own_or_admin" ON public.exam_results;
CREATE POLICY "exams_select_own_or_admin" ON public.exam_results FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "exams_insert_own" ON public.exam_results;
CREATE POLICY "exams_insert_own" ON public.exam_results FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "exams_update_own" ON public.exam_results;
CREATE POLICY "exams_update_own" ON public.exam_results FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Les certificats sont vérifiables publiquement (QR code)
DROP POLICY IF EXISTS "certificates_public_read" ON public.certificates;
CREATE POLICY "certificates_public_read" ON public.certificates FOR SELECT
  USING (true);
DROP POLICY IF EXISTS "certificates_insert_own" ON public.certificates;
CREATE POLICY "certificates_insert_own" ON public.certificates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "certificates_update_own" ON public.certificates;
CREATE POLICY "certificates_update_own" ON public.certificates FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
CREATE POLICY "notifications_own" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_admin_insert" ON public.notifications;
CREATE POLICY "notifications_admin_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "coupons_admin_all" ON public.coupons;
CREATE POLICY "coupons_admin_all" ON public.coupons FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "settings_public_read" ON public.system_settings;
CREATE POLICY "settings_public_read" ON public.system_settings FOR SELECT
  USING (true);
DROP POLICY IF EXISTS "settings_admin_write" ON public.system_settings;
CREATE POLICY "settings_admin_write" ON public.system_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- RPC utilisées par l'app (crédits, coupons, api_keys : voir migration
-- de sécurité)
-- ---------------------------------------------------------------------

-- Connexion par pseudo ou téléphone : renvoie l'email du compte
CREATE OR REPLACE FUNCTION public.resolve_login(p_identifier text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT email FROM public.profiles
   WHERE lower(username) = lower(trim(p_identifier)) OR phone_number = trim(p_identifier)
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login(text) TO anon, authenticated;

-- Admin : modifier email / mot de passe / pseudo d'un utilisateur
CREATE OR REPLACE FUNCTION public.admin_update_user_auth(
  p_user_id uuid, p_email text DEFAULT NULL, p_password text DEFAULT NULL, p_username text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs' USING ERRCODE = '42501';
  END IF;

  IF p_email IS NOT NULL AND p_email <> '' THEN
    UPDATE auth.users SET email = p_email, email_confirmed_at = now(), updated_at = now() WHERE id = p_user_id;
    UPDATE auth.identities SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(p_email))
     WHERE user_id = p_user_id AND provider = 'email';
    UPDATE public.profiles SET email = p_email WHERE id = p_user_id;
  END IF;

  IF p_username IS NOT NULL AND p_username <> '' THEN
    UPDATE public.profiles SET username = p_username WHERE id = p_user_id;
  END IF;

  IF p_password IS NOT NULL AND p_password <> '' THEN
    UPDATE auth.users SET encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
     WHERE id = p_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_user_auth(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_auth(uuid, text, text, text) TO authenticated;

-- Fonctions de trigger : jamais appelables directement via l'API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Admin : supprimer un compte (cascade sur le profil et ses données)
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Impossible de supprimer son propre compte ici';
  END IF;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

COMMIT;
