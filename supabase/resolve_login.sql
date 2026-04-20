CREATE OR REPLACE FUNCTION resolve_login(p_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
BEGIN
    SELECT email INTO v_email
    FROM public.profiles
    WHERE username ILIKE p_identifier OR phone_number = p_identifier
    LIMIT 1;
    
    RETURN v_email;
END;
$$;
