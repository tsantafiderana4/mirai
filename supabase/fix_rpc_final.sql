-- Fix consume_credits RPC to be consistent with Edge Function and Frontend
-- It takes p_user_id and p_amount, and returns the new balance (int) or null if insufficient.

CREATE OR REPLACE FUNCTION public.consume_credits(p_amount INT, p_user_id UUID DEFAULT auth.uid())
RETURNS INT AS $$
DECLARE
  current_credits INT;
  new_credits INT;
  v_user_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get current credits and lock the row
  SELECT credits INTO current_credits
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF current_credits IS NULL THEN
    RETURN NULL;
  END IF;

  IF current_credits >= p_amount THEN
    new_credits := current_credits - p_amount;
    
    UPDATE public.profiles
    SET credits = new_credits,
        updated_at = NOW()
    WHERE id = v_user_id;
    
    RETURN new_credits;
  ELSE
    RETURN NULL; 
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.consume_credits(INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credits(INT, UUID) TO service_role;
