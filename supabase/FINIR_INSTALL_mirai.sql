-- =====================================================================
-- mirai : DERNIÈRE ÉTAPE d'installation (projet dlrompznifuwrlftmtqw)
-- Tout le reste est déjà installé. À coller dans Supabase > SQL Editor
-- > New query, puis « Run ». Supabase peut signaler des opérations
-- « destructrices » (les DELETE à l'intérieur des fonctions) : c'est
-- normal, ces fonctions suppriment des données seulement quand l'app
-- les appelle (notification ancienne, compte supprimé par l'admin,
-- coupon utilisé).
-- =====================================================================

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
REVOKE ALL ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trigger_cleanup_notifications ON public.notifications;
CREATE TRIGGER trigger_cleanup_notifications AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_old_notifications();

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

CREATE OR REPLACE FUNCTION public.use_coupon(p_user_id UUID, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
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
    UPDATE public.profiles SET credits = credits + v_amount, updated_at = NOW() WHERE id = v_uid;
    DELETE FROM public.coupons WHERE id = v_coupon_id;
    RETURN jsonb_build_object('success', true, 'amount', v_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.use_coupon(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, TEXT) TO authenticated;
