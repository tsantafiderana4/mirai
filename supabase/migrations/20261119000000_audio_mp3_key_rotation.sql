-- =====================================================================
-- Lot 1 : audio MP3 et rotation intelligente des clés Gemini. Idempotent.
-- =====================================================================

-- Pauses des clés épuisées (quota 429), par clé ET par modèle.
-- La clé n'est jamais stockée : seulement une empreinte SHA-256 tronquée.
CREATE TABLE IF NOT EXISTS public.api_key_cooldowns (
    key_fp      text NOT NULL,
    model       text NOT NULL,
    until       timestamptz NOT NULL,
    reason      text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key_fp, model)
);
-- Réservée au serveur (service_role) : aucune règle d'accès pour le navigateur.
ALTER TABLE public.api_key_cooldowns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_key_cooldowns FROM anon, authenticated;

-- Le bucket audio accepte désormais le MP3 (10× plus léger que le WAV).
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['audio/mpeg', 'audio/wav']
 WHERE id = 'lesson-audio';
