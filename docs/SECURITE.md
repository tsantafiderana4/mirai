# Sécurité — correctifs de novembre 2026

## Ce qui a changé

| Problème | Correction |
|---|---|
| Clé Gemini injectée dans le JavaScript public (`vite.config.ts` → `define`) | Supprimé. Tous les appels IA passent par l'Edge Function `gemini-api` (`src/services/aiClient.ts`). |
| Le navigateur lisait les clés (`api_keys`, `system_settings.admin_contact.apiKeys`) | Les clés ne sont lues que par l'Edge Function, avec la clé `service_role`. La migration déplace les clés de `system_settings` vers `api_keys`. |
| Voix en direct (LiveTeacher) avec la vraie clé dans le navigateur | Jeton éphémère à usage unique (action `live_token`), créé par le serveur. |
| Un utilisateur pouvait modifier ses `credits`, `role`, `is_suspended` | Trigger `protect_profile_privileged_columns`. |
| Admin vérifié via `user_metadata` (modifiable par l'utilisateur) | Les policies utilisent `public.is_admin()` (lit `profiles.role`, désormais protégé). |
| `consume_credits(-N)` ajoutait N crédits | Montant ≤ 0 refusé. Les remboursements passent par `refund_credits`, réservé au serveur. |
| `admin_add_credits` sans contrôle | Réservé aux admins. |
| Coupons listables par tous, `use_coupon` créditait n'importe qui | Lecture réservée aux admins, crédit au seul appelant. |
| Un utilisateur pouvait approuver sa propre demande | Seuls les admins modifient `admin_requests`. |

## Déploiement (dans cet ordre)

1. **Changer les clés Gemini** dans Google AI Studio : les anciennes ont été publiques.
2. **SQL** : exécuter `supabase/migrations/20261116000000_security_hardening.sql` dans Supabase > SQL Editor. Le script peut être relancé sans risque.
3. **Clés** : ajouter les nouvelles clés dans le tableau de bord admin (table `api_keys`), ou avec `supabase secrets set GEMINI_API_KEY=...`.
4. **Edge Function** : `supabase functions deploy gemini-api`. `SUPABASE_SERVICE_ROLE_KEY` est fourni automatiquement par Supabase.
5. **Front** : redéployer. Retirer `GEMINI_API_KEY` / `VITE_GOOGLE_API_KEY` des variables d'environnement de l'hébergeur (Render…), qui ne servent plus côté front.

## Tester la migration en local

```bash
# Postgres local requis (aucune donnée réelle utilisée)
PGHOST=/chemin/socket PGPORT=5432 ./supabase/tests/run.sh
```

Le script rejoue 10 attaques avant puis après la migration, et vérifie que les usages normaux fonctionnent toujours.

## Reste à faire

- Facturer les crédits **entièrement côté serveur**. Aujourd'hui l'Edge Function exige un solde positif, mais le débit des messages texte est encore déclenché par le client (`creditService`).
- Ajouter une limite de débit (rate limiting) par utilisateur sur l'Edge Function.
- `resolve_login` permet de retrouver l'email d'un compte à partir de son pseudo.
