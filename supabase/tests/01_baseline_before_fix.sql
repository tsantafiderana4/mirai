-- État AVANT correctif, reconstitué à partir des fichiers SQL du dépôt
-- (supabase/rpc.sql, fix_rls_final.sql, coupons_system_v2.sql,
--  supabase_schema.sql, supabase_schema_v5_production.sql).
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text, email text, phone_number text,
  role text DEFAULT 'user', credits int DEFAULT 6,
  preferences jsonb, is_suspended boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

CREATE TABLE public.system_settings (id int PRIMARY KEY DEFAULT 1, admin_contact jsonb);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view settings" ON public.system_settings FOR SELECT USING (true);

CREATE TABLE public.api_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, provider text DEFAULT 'gemini',
  key_value text UNIQUE NOT NULL, is_active boolean DEFAULT true, error_count int DEFAULT 0,
  added_by uuid, created_at timestamptz DEFAULT now(), last_used_at timestamptz
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage API keys" ON public.api_keys FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE FUNCTION public.get_active_api_keys(p_provider text DEFAULT 'gemini') RETURNS TABLE(key_value text) AS $$
BEGIN RETURN QUERY SELECT a.key_value FROM public.api_keys a WHERE a.provider = p_provider AND a.is_active = true; END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE public.coupons (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, code text UNIQUE, amount int, expires_at timestamptz, created_at timestamptz DEFAULT now());
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view coupons" ON public.coupons FOR SELECT TO authenticated USING (true);

CREATE TABLE public.admin_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, username text, type text, amount int, message text, status text DEFAULT 'pending', created_at timestamptz DEFAULT now());
ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own requests" ON public.admin_requests FOR ALL USING (auth.uid() = user_id);

CREATE FUNCTION consume_credits(p_amount int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE current_credits int; new_credits int;
BEGIN
  SELECT credits INTO current_credits FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF current_credits >= p_amount THEN
    new_credits := current_credits - p_amount;
    UPDATE profiles SET credits = new_credits, updated_at = now() WHERE id = auth.uid();
    RETURN new_credits;
  ELSE RETURN NULL; END IF;
END; $$;

CREATE FUNCTION admin_add_credits(p_target_user uuid, p_amount int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE profiles SET credits = credits + p_amount, updated_at = now() WHERE id = p_target_user; END; $$;

CREATE FUNCTION public.use_coupon(p_user_id uuid, p_code text) RETURNS jsonb AS $$
DECLARE v_coupon_id uuid; v_amount int;
BEGIN
  SELECT id, amount INTO v_coupon_id, v_amount FROM public.coupons WHERE UPPER(code) = UPPER(p_code) AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE SKIP LOCKED;
  IF v_coupon_id IS NULL THEN RETURN jsonb_build_object('success', false); END IF;
  UPDATE public.profiles SET credits = credits + v_amount WHERE id = p_user_id;
  DELETE FROM public.coupons WHERE id = v_coupon_id;
  RETURN jsonb_build_object('success', true, 'amount', v_amount);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Données de test
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'eleve@test'),
  ('00000000-0000-0000-0000-00000000000c', 'autre@test');
INSERT INTO public.profiles (id, username, role, credits) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'admin', 1000),
  ('00000000-0000-0000-0000-00000000000b', 'eleve', 'user', 10),
  ('00000000-0000-0000-0000-00000000000c', 'autre', 'user', 10);
INSERT INTO public.system_settings (id, admin_contact) VALUES
  (1, '{"phone":"034","apiKeys":{"geminiKeys":["AIzaSECRET_SETTINGS_1"],"gemini":"AIzaSECRET_SETTINGS_2"}}');
INSERT INTO public.api_keys (key_value) VALUES ('AIzaSECRET_TABLE');
INSERT INTO public.coupons (code, amount) VALUES ('PROMO100', 100);
INSERT INTO public.admin_requests (user_id, type, amount) VALUES ('00000000-0000-0000-0000-00000000000b', 'credit', 500);
