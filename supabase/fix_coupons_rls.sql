-- ==========================================
-- FIX COUPONS RLS POLICIES
-- ==========================================

-- 1. Ensure is_admin function exists and is SECURITY DEFINER
-- This bypasses RLS on the profiles table to check the role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND role = 'admin'
  );
END;
$$;

-- 2. Enable RLS on coupons (just in case)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
DROP POLICY IF EXISTS "Users can view coupons" ON public.coupons;
DROP POLICY IF EXISTS "Enable all for admins" ON public.coupons;

-- 4. Create robust policies using is_admin()
-- This covers INSERT, UPDATE, DELETE, and SELECT for admins
CREATE POLICY "Admins can manage coupons" ON public.coupons
    FOR ALL 
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 5. Allow all authenticated users to view coupons 
-- (Required for the use_coupon RPC if it's not SECURITY DEFINER, 
-- but our RPC IS SECURITY DEFINER, so this is mostly for safety/debugging)
CREATE POLICY "Users can view coupons" ON public.coupons
    FOR SELECT 
    TO authenticated
    USING (true);

-- 6. Grant necessary permissions
GRANT ALL ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
