-- ==========================================
-- TEACHERMADA V5 - PRODUCTION READY
-- ==========================================
-- Objectifs : Restauration des tables manquantes, gestion des API Keys,
-- et stratégie anti-surcharge (Free Tier Supabase).

-- ==========================================
-- 1. TABLES
-- ==========================================

-- RÉSULTATS D'EXAMENS
CREATE TABLE IF NOT EXISTS public.exam_results (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('diagnostic', 'certification')),
    score NUMERIC NOT NULL,
    total_questions INTEGER NOT NULL,
    language TEXT NOT NULL,
    level TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CERTIFICATS
CREATE TABLE IF NOT EXISTS public.certificates (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    exam_id UUID REFERENCES public.exam_results(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    level TEXT NOT NULL,
    issue_date TIMESTAMPTZ DEFAULT NOW(),
    certificate_url TEXT
);

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API KEYS (Gestion dynamique par l'Admin)
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    provider TEXT DEFAULT 'gemini',
    key_value TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    error_count INTEGER DEFAULT 0,
    added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- ==========================================
-- 2. INDEXES (Performances)
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_exam_results_user ON public.exam_results(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON public.certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON public.api_keys(provider) WHERE is_active = true;

-- ==========================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Examens
CREATE POLICY "Users view own exams" ON public.exam_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own exams" ON public.exam_results FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Certificats
CREATE POLICY "Users view own certificates" ON public.certificates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own certificates" ON public.certificates FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Notifications
CREATE POLICY "Users view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own notifications" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- API Keys (Sécurité stricte : Seul l'admin peut voir et modifier)
CREATE POLICY "Admins manage API keys" ON public.api_keys FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ==========================================
-- 4. FONCTIONS RPC (SÉCURITÉ & LOGIQUE SERVEUR)
-- ==========================================

-- Fonction sécurisée pour que l'Edge Function récupère les clés actives
-- SECURITY DEFINER permet à la fonction de contourner la RLS (l'Edge Function pourra l'appeler)
CREATE OR REPLACE FUNCTION public.get_active_api_keys(p_provider TEXT DEFAULT 'gemini')
RETURNS TABLE(key_value TEXT) AS $$
BEGIN
  RETURN QUERY 
  SELECT a.key_value 
  FROM public.api_keys a 
  WHERE a.provider = p_provider AND a.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 5. STRATÉGIE ANTI-SURCHARGE (FREE TIER)
-- ==========================================

-- Fonction de nettoyage automatique
CREATE OR REPLACE FUNCTION public.cleanup_old_data()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Supprime les notifications de l'utilisateur vieilles de plus de 30 jours
  DELETE FROM public.notifications 
  WHERE user_id = NEW.user_id AND created_at < NOW() - INTERVAL '30 days';
  
  -- 2. Limite stricte : Garde uniquement les 50 dernières notifications par utilisateur
  DELETE FROM public.notifications
  WHERE user_id = NEW.user_id 
  AND id NOT IN (
      SELECT id FROM public.notifications 
      WHERE user_id = NEW.user_id 
      ORDER BY created_at DESC 
      LIMIT 50
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger qui s'exécute à chaque nouvelle notification
DROP TRIGGER IF EXISTS trigger_cleanup_notifications ON public.notifications;
CREATE TRIGGER trigger_cleanup_notifications
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE PROCEDURE public.cleanup_old_data();
