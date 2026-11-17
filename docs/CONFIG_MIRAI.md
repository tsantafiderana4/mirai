# Configuration de mirai : où coller quoi

Tout est déjà créé. Il ne reste qu'à **coller tes clés** aux bons endroits et à régler deux options.

## Ce qui est en place

| Élément | État | Adresse |
|---|---|---|
| Base Supabase `mirai` | ✅ tables, sécurité, leçons au tableau | https://supabase.com/dashboard/project/dlrompznifuwrlftmtqw |
| Fonction serveur `gemini-api` | ✅ déployée (version 1) | Supabase, onglet Edge Functions |
| Site Render `mirai` | ✅ en ligne, mis à jour à chaque push sur la branche | https://mirai-2bo3.onrender.com |
| Variables du site (Render) | ✅ `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Render, onglet Environment |

## À coller / régler (dans cet ordre)

### 1. Clé Gemini : seul secret à fournir
- **Où la créer** : https://aistudio.google.com/apikey, bouton **Create API key**. Supprime l'ancienne clé, qui a été exposée.
- **Où la coller** : Supabase, projet **mirai**, **Edge Functions**, onglet **Secrets**, **Add new secret** :

  | Name | Value |
  |---|---|
  | `GEMINI_API_KEY` | `AIza…` (ta nouvelle clé) |

  Pour plusieurs clés en rotation : `AIzaCLE1,AIzaCLE2` (séparées par une virgule).
  **Important** : le quota gratuit de Gemini est compté **par projet Google Cloud**, pas par clé. Deux clés du même projet partagent le même quota et ne servent à rien en rotation. Crée chaque clé dans un **projet différent** (dans AI Studio : *Create API key*, puis *Create API key in new project*). Une clé épuisée est mise en pause automatiquement jusqu'à la remise à zéro du quota (≈ 10 h, heure de Madagascar, pour le quota journalier).
- **Ne la mets jamais** dans Render ni dans le code : le site est public.

### 2. Désactiver la confirmation par email
Supabase, **Authentication**, **Sign In / Providers**, **Email**, décoche **Confirm email**, puis **Save**.
Sinon personne ne peut se connecter : l'app utilise des adresses internes `pseudo@teachermada.com`.

### 3. Adresse du site pour l'authentification
Supabase, **Authentication**, **URL Configuration** :
- **Site URL** : `https://mirai-2bo3.onrender.com`

### 4. Règle de réécriture sur Render (liens des certificats `/verify/...`)
Render, service **mirai**, **Redirects/Rewrites**, **Add Rule** :

| Source | Destination | Action |
|---|---|---|
| `/*` | `/index.html` | **Rewrite** |

### 5. Finir l'installation SQL (3 petites fonctions)
Supabase, **SQL Editor**, **New query** : colle `supabase/FINIR_INSTALL_mirai.sql`, puis **Run**.

### 6. Devenir administrateur
1. Inscris-toi sur https://mirai-2bo3.onrender.com avec **0349310268** comme pseudo.
2. Supabase, **SQL Editor** : colle `supabase/ADMIN_0349310268.sql`, puis **Run**. Tu peux aussi demander à Claude de le faire.
3. Déconnecte-toi puis reconnecte-toi : le tableau de bord admin apparaît (1000 crédits).

## Valeurs publiques (déjà configurées, pour référence)

Ces deux valeurs sont **publiques par nature** : elles sont visibles dans le site, et la sécurité repose sur les règles de la base.

```
VITE_SUPABASE_URL=https://dlrompznifuwrlftmtqw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRscm9tcHpuaWZ1d3JsZnRtdHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NjIyMDEsImV4cCI6MjExMDQzODIwMX0.9hJ_Kavgc665FBLjESR2HUekVw96RpHGPLM3Cb9k0A8
```

Pour lancer l'app sur ton ordinateur : copie `.env.example` en `.env.local`.
