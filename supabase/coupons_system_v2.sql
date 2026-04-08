-- ==========================================
-- COUPONS SYSTEM V2 (Atomic & Secure)
-- ==========================================

-- 1. Create dedicated coupons table
CREATE TABLE IF NOT EXISTS public.coupons (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id)
);

-- 2. Enable RLS
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- 3. Policies
CREATE POLICY "Admins can manage coupons" ON public.coupons
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can view coupons" ON public.coupons
    FOR SELECT USING (true); -- Needed for the RPC to find them, but we could also use SECURITY DEFINER

-- 4. Atomic RPC to use a coupon
CREATE OR REPLACE FUNCTION public.use_coupon(p_user_id UUID, p_code TEXT)
RETURNS JSONB AS $$
DECLARE
    v_coupon_id UUID;
    v_amount INT;
BEGIN
    -- 1. Find and lock the coupon row to prevent concurrent usage
    -- We use UPPER() for case-insensitive matching
    SELECT id, amount INTO v_coupon_id, v_amount
    FROM public.coupons
    WHERE UPPER(code) = UPPER(p_code)
    AND (expires_at IS NULL OR expires_at > NOW())
    FOR UPDATE SKIP LOCKED;

    -- 2. If not found or locked, it's either invalid, expired, or being used
    IF v_coupon_id IS NULL THEN
        -- Check if it exists but is expired
        IF EXISTS (SELECT 1 FROM public.coupons WHERE UPPER(code) = UPPER(p_code) AND expires_at <= NOW()) THEN
            -- Optional: auto-cleanup expired coupon
            DELETE FROM public.coupons WHERE UPPER(code) = UPPER(p_code);
            RETURN jsonb_build_object('success', false, 'message', 'Ce code a expiré.');
        END IF;
        
        RETURN jsonb_build_object('success', false, 'message', 'Code invalide ou déjà utilisé.');
    END IF;

    -- 3. Add credits to the user
    UPDATE public.profiles 
    SET credits = credits + v_amount,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- 4. Delete the coupon (One-time use)
    DELETE FROM public.coupons WHERE id = v_coupon_id;

    -- 5. Return success
    RETURN jsonb_build_object('success', true, 'amount', v_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
