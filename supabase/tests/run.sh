#!/usr/bin/env bash
# Teste la migration de sécurité sur un Postgres local jetable.
# Usage : PGPORT=54329 PGHOST=/chemin/socket ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=tm_security_test
PSQL="psql -X -q -v ON_ERROR_STOP=1 -U ${PGUSER:-postgres}"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
$PSQL -d $DB -f 00_supabase_shim.sql >/dev/null
$PSQL -d $DB -f 01_baseline_before_fix.sql >/dev/null
echo "=== AVANT la migration ==="
$PSQL -d $DB -f 10_attack_scenarios.sql
$PSQL -d $DB -f ../migrations/20261116000000_security_hardening.sql >/dev/null
echo "=== APRÈS la migration ==="
$PSQL -d $DB -f 10_attack_scenarios.sql
$PSQL -d $DB -f ../migrations/20261117000000_ai_rate_limits.sql >/dev/null
echo "=== Limite de débit IA ==="
$PSQL -d $DB -f 20_rate_limit.sql
$PSQL -d $DB -f ../migrations/20261118000000_board_lessons.sql >/dev/null
echo "=== Leçon au tableau ==="
$PSQL -d $DB -f 30_board_lessons.sql
echo "=== Clés migrées de system_settings vers api_keys ==="
$PSQL -d $DB -c "SELECT key_value FROM public.api_keys ORDER BY 1" -c "SELECT admin_contact FROM public.system_settings"
