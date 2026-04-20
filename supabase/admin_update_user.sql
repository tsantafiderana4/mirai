-- Run this in your Supabase SQL Editor to allow admins to update user emails and passwords

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.admin_update_user_auth(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_user_auth(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION admin_update_user_auth(
  p_user_id UUID,
  p_email TEXT DEFAULT NULL,
  p_password TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL
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
        raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"provider": "email", "providers": ["email"]}'::jsonb,
        updated_at = now()
    WHERE id = p_user_id;
    
    -- Sync email to public.profiles
    UPDATE public.profiles
    SET email = p_email,
        updated_at = now()
    WHERE id = p_user_id;
    
    -- Fix the identities table for migrated or detached users
    -- If it exists, update it
    UPDATE auth.identities 
    SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(p_email)) 
    WHERE user_id = p_user_id AND provider = 'email';
    
    -- If it does not exist, initialize it
    IF NOT FOUND THEN
        INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
        VALUES (
            gen_random_uuid(), 
            p_user_id, 
            p_user_id::text, 
            jsonb_build_object('sub', p_user_id, 'email', p_email, 'email_verified', true), 
            'email',
            now(),
            now()
        );
    END IF;
  END IF;

  -- Update username if provided
  IF p_username IS NOT NULL AND p_username <> '' THEN
    UPDATE public.profiles
    SET username = p_username,
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
