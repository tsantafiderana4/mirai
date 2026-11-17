-- =====================================================================
-- mirai : pré-génération nocturne des voix des leçons au tableau.
-- À exécuter UNE fois, après la migration 20261120000000_board_lot2.sql
-- (Supabase > SQL Editor). Pour un autre projet : changer l'adresse et la
-- clé anon (publique) ci-dessous.
--
-- Horaire : toutes les 5 min de 23 h à 3 h 55 UTC, soit 2 h à 6 h 55 à
-- Madagascar, juste AVANT la remise à zéro des quotas Gemini (minuit heure
-- du Pacifique = 7 h ou 8 h UTC). La tâche utilise donc le quota de voix
-- gratuit qui serait perdu, sans gêner les élèves de la journée.
-- Chaque passage produit au plus UNE voix ; dès qu'une clé est épuisée, elle
-- est mise en pause et les passages suivants ne demandent plus rien à Google.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO private.app_config (name, value) VALUES
  ('functions_url', 'https://dlrompznifuwrlftmtqw.supabase.co/functions/v1'),
  ('anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRscm9tcHpuaWZ1d3JsZnRtdHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NjIyMDEsImV4cCI6MjExMDQzODIwMX0.9hJ_Kavgc665FBLjESR2HUekVw96RpHGPLM3Cb9k0A8')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

SELECT cron.schedule('board-pregen-audio', '*/5 23,0-3 * * *', $$SELECT private.board_pregen_tick()$$);

-- Pour suspendre la tâche : SELECT cron.unschedule('board-pregen-audio');
-- Pour voir les derniers passages :
--   SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
