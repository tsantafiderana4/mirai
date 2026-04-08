-- Run this in your Supabase SQL Editor to allow admins to update user emails and passwords

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION admin_update_user_auth(
  p_user_id UUID,
  p_email TEXT DEFAULT NULL,
  p_password TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can perform this action';
  END IF;

  -- Update email if provided
  IF p_email IS NOT NULL AND p_email <> '' THEN
    UPDATE auth.users 
    SET email = p_email, 
        email_confirmed_at = now(),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  -- Update password if provided
  IF p_password IS NOT NULL AND p_password <> '' THEN
    UPDATE auth.users 
    SET encrypted_password = crypt(p_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;
END;
$$;
