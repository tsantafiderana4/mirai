-- =====================================================================
-- mirai — INSTALLATION COMPLÈTE (à coller une seule fois dans
-- Supabase > SQL Editor > New query, puis « Run »).
-- Concatène, dans l'ordre : base_schema, security_hardening, ai_rate_limits, board_lessons, audio_mp3_key_rotation, board_lot2 (puis CRON_mirai.sql pour la tâche de nuit).
-- Généré à partir de supabase/migrations/ ; ne pas éditer à la main.
-- =====================================================================

-- >>> 20261115000000_base_schema.sql
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

-- >>> 20261116000000_security_hardening.sql
-- =====================================================================
-- TeacherMada — Correctifs de sécurité (à exécuter UNE fois dans
-- Supabase > SQL Editor, ou via `supabase db push`).
--
-- Ce script est idempotent : on peut le relancer sans risque.
--
-- Corrige :
--   1. Un utilisateur pouvait modifier lui-même `credits`, `role`,
--      `is_suspended` sur son profil (policy UPDATE sans restriction).
--   2. Le statut admin des policies `profiles` était lu dans
--      `user_metadata`, modifiable par l'utilisateur (auth.updateUser).
--   3. `consume_credits(-N)` AJOUTAIT N crédits (montant négatif accepté).
--   4. `admin_add_credits()` ne vérifiait pas que l'appelant est admin.
--   5. `get_active_api_keys()` était appelable par anon/authenticated
--      → fuite de toutes les clés Gemini.
--   6. Les clés Gemini stockées dans `system_settings.admin_contact`
--      étaient lisibles par tout le monde.
--   7. Tous les utilisateurs connectés pouvaient lister les coupons.
--   8. `use_coupon(p_user_id, ...)` créditait n'importe quel compte.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. is_admin() : source de vérité = profiles.role (protégé ci-dessous)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Colonnes privilégiées de `profiles` : seuls les admins (ou le code
--    serveur : fonctions SECURITY DEFINER, service_role) peuvent les changer.
--    Les requêtes directes du navigateur s'exécutent sous le rôle
--    `authenticated` / `anon`, c'est ce qu'on filtre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW; -- code serveur de confiance
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Un utilisateur qui crée son propre profil ne peut pas se donner
    -- de rôle ni de crédits arbitraires.
    NEW.role := 'user';
    NEW.credits := LEAST(COALESCE(NEW.credits, 0), 6);
    NEW.is_suspended := false;
    RETURN NEW;
  END IF;

  IF public.is_admin() THEN
    -- Un admin ne peut pas modifier son propre rôle (évite de perdre le
    -- dernier admin par erreur) ; le reste est autorisé.
    IF NEW.id = auth.uid() AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Un admin ne peut pas modifier son propre rôle';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.credits IS DISTINCT FROM OLD.credits
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    RAISE EXCEPTION 'Modification non autorisée (crédits, rôle ou suspension)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER protect_profile_privileged_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();
REVOKE ALL ON FUNCTION public.protect_profile_privileged_columns() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Policies `profiles` : admin via is_admin(), plus via user_metadata
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. Crédits
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_credits(p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET credits = credits - p_amount,
         updated_at = now()
   WHERE id = auth.uid()
     AND credits >= p_amount
  RETURNING credits INTO v_new;

  RETURN v_new; -- NULL si crédits insuffisants
END;
$$;

REVOKE ALL ON FUNCTION public.consume_credits(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credits(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_add_credits(p_target_user uuid, p_amount int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET credits = GREATEST(credits + p_amount, 0),
         updated_at = now()
   WHERE id = p_target_user;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_credits(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_credits(uuid, int) TO authenticated, service_role;

-- Remboursement utilisé uniquement par l'Edge Function (service_role)
CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id uuid, p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new int;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN NULL;
  END IF;
  UPDATE public.profiles
     SET credits = credits + p_amount, updated_at = now()
   WHERE id = p_user_id
  RETURNING credits INTO v_new;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_credits(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, int) TO service_role;

-- ---------------------------------------------------------------------
-- 4. Clés API : uniquement côté serveur
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT DEFAULT 'gemini',
    key_value TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    error_count INTEGER DEFAULT 0,
    added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage API keys" ON public.api_keys;
CREATE POLICY "Admins manage API keys" ON public.api_keys
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.get_active_api_keys(p_provider TEXT DEFAULT 'gemini')
RETURNS TABLE(key_value TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.key_value FROM public.api_keys a
  WHERE a.provider = p_provider AND a.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_active_api_keys(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_api_keys(TEXT) TO service_role;

-- Déplace les clés éventuellement stockées dans system_settings
-- (lisible publiquement) vers api_keys, puis les supprime du JSON.
DO $$
DECLARE
  v_contact jsonb;
  v_key text;
BEGIN
  IF to_regclass('public.system_settings') IS NULL THEN
    RETURN;
  END IF;

  FOR v_contact IN SELECT admin_contact FROM public.system_settings WHERE admin_contact ? 'apiKeys'
  LOOP
    FOR v_key IN
      SELECT jsonb_array_elements_text(COALESCE(v_contact->'apiKeys'->'geminiKeys', '[]'::jsonb))
      UNION
      SELECT v_contact->'apiKeys'->>'gemini' WHERE v_contact->'apiKeys'->>'gemini' IS NOT NULL
    LOOP
      IF length(trim(v_key)) > 0 THEN
        INSERT INTO public.api_keys (provider, key_value)
        VALUES ('gemini', trim(v_key))
        ON CONFLICT (key_value) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.system_settings
     SET admin_contact = admin_contact - 'apiKeys'
   WHERE admin_contact ? 'apiKeys';
EXCEPTION WHEN undefined_column THEN
  NULL; -- schéma différent : rien à migrer
END $$;

-- ---------------------------------------------------------------------
-- 5. Coupons
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.coupons') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can view coupons" ON public.coupons';
    EXECUTE 'REVOKE ALL ON public.coupons FROM anon';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.use_coupon(p_user_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();  -- p_user_id est ignoré : on crédite l'appelant
    v_coupon_id UUID;
    v_amount INT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Connexion requise.');
    END IF;

    SELECT id, amount INTO v_coupon_id, v_amount
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(p_code))
      AND (expires_at IS NULL OR expires_at > NOW())
    FOR UPDATE SKIP LOCKED;

    IF v_coupon_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Code invalide, expiré ou déjà utilisé.');
    END IF;

    UPDATE public.profiles
       SET credits = credits + v_amount, updated_at = NOW()
     WHERE id = v_uid;

    DELETE FROM public.coupons WHERE id = v_coupon_id;

    RETURN jsonb_build_object('success', true, 'amount', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.use_coupon(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Demandes admin : un utilisateur ne peut pas approuver sa propre demande
-- ---------------------------------------------------------------------
DO $$
DECLARE pol RECORD;
BEGIN
  IF to_regclass('public.admin_requests') IS NULL THEN RETURN; END IF;

  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'admin_requests'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.admin_requests', pol.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY';
  EXECUTE $p$CREATE POLICY "requests_select_own_or_admin" ON public.admin_requests
            FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin())$p$;
  EXECUTE $p$CREATE POLICY "requests_insert_own_pending" ON public.admin_requests
            FOR INSERT TO authenticated
            WITH CHECK (auth.uid() = user_id AND COALESCE(status, 'pending') = 'pending')$p$;
  EXECUTE $p$CREATE POLICY "requests_admin_update" ON public.admin_requests
            FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())$p$;
  EXECUTE $p$CREATE POLICY "requests_admin_delete" ON public.admin_requests
            FOR DELETE TO authenticated USING (public.is_admin())$p$;
END $$;

COMMIT;

-- >>> 20261117000000_ai_rate_limits.sql
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

-- >>> 20261118000000_board_lessons.sql
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

-- >>> 20261119000000_audio_mp3_key_rotation.sql
-- =====================================================================
-- Lot 1 : audio MP3 et rotation intelligente des clés Gemini. Idempotent.
-- =====================================================================

-- Pauses des clés épuisées (quota 429), par clé ET par modèle.
-- La clé n'est jamais stockée : seulement une empreinte SHA-256 tronquée.
CREATE TABLE IF NOT EXISTS public.api_key_cooldowns (
    key_fp      text NOT NULL,
    model       text NOT NULL,
    until       timestamptz NOT NULL,
    reason      text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key_fp, model)
);
-- Réservée au serveur (service_role) : aucune règle d'accès pour le navigateur.
ALTER TABLE public.api_key_cooldowns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_key_cooldowns FROM anon, authenticated;

-- Le bucket audio accepte désormais le MP3 (10× plus léger que le WAV).
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['audio/mpeg', 'audio/wav']
 WHERE id = 'lesson-audio';

-- >>> 20261120000000_board_lot2.sql
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
RETURNS interval LANGUAGE sql IMMUTABLE
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
