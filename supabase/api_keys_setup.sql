-- Script to ensure API keys table and RPC exist
-- This table allows rotating API keys and managing them from the dashboard

CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL, -- 'gemini', 'openai', etc.
    key_value TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    label TEXT -- Optional label to identify the key
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_api_keys_provider_active ON public.api_keys(provider, is_active);

-- Drop function first to avoid "cannot remove parameter defaults" error
DROP FUNCTION IF EXISTS public.get_active_api_keys(text);

-- RPC to get active keys (used by Edge Function)
CREATE OR REPLACE FUNCTION public.get_active_api_keys(p_provider TEXT)
RETURNS TABLE(key_value TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT ak.key_value
    FROM public.api_keys ak
    WHERE ak.provider = p_provider
      AND ak.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (Edge Function calls this with user token)
GRANT EXECUTE ON FUNCTION public.get_active_api_keys(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_api_keys(TEXT) TO service_role;

-- Enable RLS but don't allow public access to keys
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Only admins should be able to manage keys
CREATE POLICY "Admins can manage api_keys" ON public.api_keys
    FOR ALL USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

-- Add a default key if none exists (User should replace this)
-- INSERT INTO public.api_keys (provider, key_value, label)
-- VALUES ('gemini', 'YOUR_GEMINI_API_KEY', 'Default Key');
