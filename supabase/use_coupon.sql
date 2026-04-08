-- RPC function to atomically validate and use a coupon
CREATE OR REPLACE FUNCTION use_coupon(p_user_id UUID, p_code TEXT)
RETURNS JSONB AS $$
DECLARE
    v_settings RECORD;
    v_coupons JSONB;
    v_coupon_index INT;
    v_coupon JSONB;
    v_amount INT;
    v_user_credits INT;
BEGIN
    -- 1. Get current settings
    SELECT * INTO v_settings FROM system_settings WHERE id = 1;
    v_coupons := v_settings.valid_coupons;

    -- 2. Find coupon
    SELECT index INTO v_coupon_index
    FROM jsonb_array_elements(v_coupons) WITH ORDINALITY AS t(val, index)
    WHERE val->>'code' = p_code;

    IF v_coupon_index IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Code invalide.');
    END IF;

    v_coupon := v_coupons->(v_coupon_index::int - 1);
    v_amount := (v_coupon->>'amount')::int;

    -- 3. Check expiry
    IF v_coupon->>'expiresAt' IS NOT NULL AND (v_coupon->>'expiresAt')::timestamp < NOW() THEN
        -- Remove expired
        v_coupons := v_coupons - (v_coupon_index::int - 1);
        UPDATE system_settings SET valid_coupons = v_coupons WHERE id = 1;
        RETURN jsonb_build_object('success', false, 'message', 'Code expiré.');
    END IF;

    -- 4. Add credits
    SELECT credits INTO v_user_credits FROM profiles WHERE id = p_user_id;
    UPDATE profiles SET credits = v_user_credits + v_amount WHERE id = p_user_id;

    -- 5. Remove coupon
    v_coupons := v_coupons - (v_coupon_index::int - 1);
    UPDATE system_settings SET valid_coupons = v_coupons WHERE id = 1;

    RETURN jsonb_build_object('success', true, 'amount', v_amount);
END;
$$ LANGUAGE plpgsql;
