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

## Facturation côté serveur (2e étape)

L'Edge Function débite les crédits **avant** d'appeler Gemini et rembourse automatiquement en cas d'échec. Le navigateur indique seulement l'usage (`purpose`), et le prix est fixé par le serveur dans `supabase/functions/gemini-api/pricing.ts`. Un usage inconnu coûte 1 crédit et n'est jamais gratuit.

| Usage | Crédits |
|---|---|
| Message de leçon (chat) | 2 |
| Message de dialogue (démarrage, réponse, évaluation) | 1 |
| Série d'exercices | 5 |
| Audio d'un message / d'un mot | 2 / 1 |
| Minute d'appel vocal | 5 |
| Examen diagnostic / certification | 40 / 100 |
| Aide, vocabulaire, culture, traduction, correction et audio d'examen | 0, mais plafonné à 150 par jour |

Limites par utilisateur (admins exemptés) : 20 requêtes IA par minute et 400 par jour (`ai_rate_check`).

Au passage, deux doubles facturations sont corrigées : un message de leçon coûtait 3 crédits au lieu de 2, et un message de dialogue 2 au lieu de 1. La minute vocale est réalignée sur les 5 crédits affichés.

## Déploiement (dans cet ordre)

1. **Changer les clés Gemini** dans Google AI Studio : les anciennes ont été publiques.
2. **SQL** : exécuter dans Supabase > SQL Editor, dans l'ordre :
   - `supabase/migrations/20261116000000_security_hardening.sql`
   - `supabase/migrations/20261117000000_ai_rate_limits.sql`

   Les deux scripts peuvent être relancés sans risque.
3. **Clés** : ajouter les nouvelles clés dans le tableau de bord admin (table `api_keys`), ou avec `supabase secrets set GEMINI_API_KEY=...`.
4. **Edge Function** : `supabase functions deploy gemini-api`. `SUPABASE_SERVICE_ROLE_KEY` est fourni automatiquement par Supabase.
5. **Front** : redéployer. Retirer `GEMINI_API_KEY` / `VITE_GOOGLE_API_KEY` des variables d'environnement de l'hébergeur (Render…), qui ne servent plus côté front.

## Tester la migration en local

```bash
# Postgres local requis (aucune donnée réelle utilisée)
PGHOST=/chemin/socket PGPORT=5432 ./supabase/tests/run.sh
```

Le script rejoue 10 attaques avant puis après la migration, vérifie que les usages normaux fonctionnent toujours, puis teste la limite de débit.

Tests de tarification (Deno) : `deno test supabase/functions/gemini-api/pricing.test.ts`

## Reste à faire

- Le déblocage de certificat (100 crédits) est encore débité depuis le client.
- Si Gemini coupe en plein streaming, le message déjà commencé n'est pas remboursé.
- `resolve_login` permet de retrouver l'email d'un compte à partir de son pseudo.
