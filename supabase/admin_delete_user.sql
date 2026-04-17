-- RPC to allow Admins to delete a user account (Auth and Profile)
-- This function runs with SECURITY DEFINER to allow it to delete from auth.users

DROP FUNCTION IF EXISTS public.admin_delete_user(UUID);

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Check if the requester is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;

  -- Delete from auth.users (this will cascade to public.profiles due to the FK)
  -- Note: This requires the function to be SECURITY DEFINER
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (the function itself checks for admin role)
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO service_role;
