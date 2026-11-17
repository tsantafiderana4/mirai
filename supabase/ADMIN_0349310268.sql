-- =====================================================================
-- Faire du compte 0349310268 l'administrateur de mirai.
-- À exécuter APRÈS t'être inscrit sur le site avec ce numéro comme
-- pseudo (ou comme numéro de téléphone).
-- Supabase > projet mirai > SQL Editor > New query > coller > Run.
-- =====================================================================

UPDATE public.profiles
   SET role = 'admin', credits = GREATEST(credits, 1000)
 WHERE lower(username) = '0349310268'
    OR phone_number = '0349310268';

-- Vérification : doit afficher une ligne avec role = admin
SELECT username, phone_number, role, credits
  FROM public.profiles
 WHERE lower(username) = '0349310268' OR phone_number = '0349310268';
