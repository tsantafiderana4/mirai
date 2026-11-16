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
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

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
