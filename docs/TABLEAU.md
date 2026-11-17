# Leçon au tableau

Un professeur IA explique une leçon au tableau, étape par étape : il **parle en français** pendant que le tableau **s'écrit tout seul**, avec la **traduction ou l'explication en malagasy** sous chaque élément.

## Ce que voit l'élève

1. **Programme** : 20 leçons par langue et par niveau, dans l'ordre, avec le titre en français et en malagasy. Une leçon coûte **5 crédits, une seule fois**, et se revoit gratuitement ensuite.
2. **Leçon** : 7 à 10 étapes. À chaque étape, la voix du professeur et l'écriture au tableau sont synchronisées. Le tableau peut contenir :
   - un titre ;
   - une explication ;
   - du vocabulaire avec prononciation et bouton « Écouter » ;
   - une phrase décomposée mot à mot ;
   - un tableau (conjugaison…) ;
   - une astuce ;
   - une erreur fréquente ;
   - un mini-quiz.
3. **Commandes** :
   - lecture et pause, étape précédente et suivante ;
   - bouton de langue, qui passe de **MG + FR** (malagasy d'abord, français en petit) à **FR** (français seul), puis à **FR + MG** (français d'abord). Par défaut : MG + FR si l'élève a choisi les explications en malagasy, et le choix est mémorisé ;
   - sous-titres ;
   - choix de la voix : *premium* (Gemini), *téléphone* (gratuite, économise la data) ou *muet*.
4. **« Avereno » (Répète après moi)** : sur le vocabulaire et les phrases, l'élève appuie, prononce, et le téléphone note sa prononciation en % en soulignant les mots manqués. Le professeur se met en pause pendant l'exercice. La reconnaissance vocale est celle du téléphone : gratuite, sans aucun appel à Gemini. Elle fonctionne sur Chrome Android et n'est pas disponible sur certains navigateurs (le bouton est alors masqué).
5. **Question** : l'élève peut interrompre à tout moment (1 crédit). Le professeur répond à l'oral et écrit au tableau. Des raccourcis sont proposés : « Avereno azafady », « Hazavao amin'ny fomba hafa », « Omeo ohatra hafa aho ».
6. **Fin** : l'écran « À retenir » (français + malagasy). Le vocabulaire de la leçon rejoint « Mes mots ».
7. **Mini-test** (gratuit, sans Gemini) : 5 questions variées construites à partir de la leçon :
   - sens d'un mot ;
   - choisir la bonne traduction ;
   - remettre une phrase dans l'ordre ;
   - écrire le mot au clavier (langues à alphabet latin ; un accent ou une lettre près est accepté, avec une remarque) ;
   - un quiz de la leçon.

   Le score est enregistré (meilleur score gardé). En dessous de 50 %, l'app propose de revoir la leçon.
8. **« Mes mots »** (révision espacée) : une carte en haut du programme indique les mots à revoir aujourd'hui. L'élève voit le mot (et peut l'écouter), se rappelle le sens, retourne la carte et se note : « Je savais » ou « À revoir ». Un mot connu revient après 1, 3, 7, 16 puis 35 jours ; un mot oublié revient en fin de séance et le lendemain.
9. **« Signaler une erreur »** (gratuit, 10 par jour) : depuis la feuille « Poser une question » ou l'écran de fin. Le signalement indique l'étape concernée.

Le quiz bloque l'enchaînement automatique tant que l'élève n'a pas répondu, mais il peut quand même passer à la suite avec « Suivant ».

## Comment ça marche

```
Navigateur ──(langue, niveau, n° leçon)──▶ Edge Function gemini-api
                                            │ 1. programme en cache ? sinon Gemini le génère (schéma JSON imposé)
                                            │ 2. leçon en cache ? sinon Gemini la génère, validation, nettoyage
                                            │ 3. 5 crédits au premier déblocage (remboursés en cas d'échec)
                                            ▼
                         board_syllabus / board_lessons / board_lesson_access (Postgres)
Voix d'une étape ──▶ board_step_audio : TTS Gemini → MP3 16 kHz 24 kbit/s → bucket privé lesson-audio → URL signée 1 h
                     └─▶ téléphone : cache local (Cache Storage, 400 fichiers max) → plus aucun téléchargement à la 2ᵉ écoute
```

- **Cache partagé** : quand un élève génère la leçon 3 « Anglais A1 », elle s'ouvre ensuite **instantanément et sans coût IA** pour tous les élèves. Il en va de même pour l'audio de chaque étape.
- **Sécurité** :
  - le client n'envoie jamais de prompt : il n'envoie que langue, niveau et numéro, et les prompts sont construits côté serveur ;
  - un élève ne peut lire qu'une leçon qu'il a débloquée, et ne peut pas se la débloquer lui-même ;
  - tests : `supabase/tests/30_board_lessons.sql`.
- **Qualité** :
  - la sortie de Gemini est validée : un quiz dont la réponse ne figure pas parmi les options est rejeté, un tableau mal formé est corrigé, le markdown et les émojis sont retirés du texte parlé ;
  - si la leçon reste inexploitable après deux essais, l'élève est remboursé.
- **Data mobile** :
  - l'audio est en **MP3** : environ 45 Ko pour 15 secondes, contre 470 Ko en WAV, soit **10 fois moins** de data et de stockage Supabase. Si l'encodage échoue, le serveur se replie sur le WAV ;
  - chaque étape écoutée est gardée **sur le téléphone** : revoir une leçon ne consomme plus de data ni de bande passante Supabase ;
  - la voix du téléphone reste disponible comme option économique ou comme repli automatique.
- **Rotation intelligente des clés Gemini** (offre gratuite) :
  - quand une clé reçoit une erreur 429 (quota), elle est **mise en pause pour ce modèle** dans la table `api_key_cooldowns`, et les requêtes suivantes ne la réessaient plus ;
  - la durée de pause suit Google : le délai indiqué par l'erreur (30 s à 1 h) pour un quota par minute, ou **jusqu'à minuit heure du Pacifique** (≈ 10 h à Madagascar) pour un quota journalier ;
  - seule une empreinte SHA-256 tronquée de la clé est stockée, jamais la clé ;
  - si toutes les clés sont en pause, l'élève est remboursé et reçoit un message clair, et la voix du téléphone prend le relais.

## Correction des leçons (admin)

Console admin, onglet **Leçons** :
- **Signalements des élèves** : leçon, étape et message. **Corriger** ouvre la leçon à l'étape signalée ; **Résolu** clôt le signalement.
- **Leçons générées** : toutes les leçons, filtrables (« Anglais A1 », un mot du titre…).
- **Éditeur** : chaque texte est modifiable (français, malagasy, langue étudiée, mot à mot, tableaux, quiz). On peut aussi supprimer un élément ou une étape.
  - **Enregistrer** : la leçon est validée par le serveur, puis corrigée pour tous les élèves. Seules les voix des étapes dont le texte parlé a changé sont supprimées ; elles se refont à la demande ou la nuit.
  - **Régénérer** : Gemini réécrit toute la leçon. Cela consomme du quota texte, mais aucun crédit.
- Les téléphones ne rejouent jamais une voix périmée : la clé du cache audio contient une empreinte du texte parlé.

## Pré-génération nocturne des voix

Une tâche planifiée (pg_cron + pg_net, inclus dans l'offre gratuite de Supabase) appelle la fonction toutes les 5 minutes, **de 2 h à 6 h 55, heure de Madagascar**. Chaque passage produit **une seule** voix manquante (voix Kore), en commençant par les leçons les plus suivies.

Cet horaire précède la remise à zéro des quotas Gemini (minuit, heure du Pacifique, soit 10 h ou 11 h à Madagascar). La tâche utilise donc le quota de voix gratuit qui serait perdu, sans gêner les élèves de la journée. Dès qu'une clé est épuisée, elle est mise en pause et les passages suivants ne demandent plus rien à Google.

- **Réglage** : `supabase/CRON_mirai.sql` (déjà exécuté sur mirai).
- **Suspendre** : `SELECT cron.unschedule('board-pregen-audio');`
- **Historique** : `SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;`
- **Sécurité** : l'appel est authentifié par un secret aléatoire stocké dans le schéma `private`, illisible par le navigateur et vérifié par la fonction (`cron_secret_ok`).

## Fichiers

| Rôle | Fichier |
|---|---|
| Prompts, schémas, validation, WAV (serveur, testé) | `supabase/functions/gemini-api/boardLesson.ts` (+ `.test.ts`) |
| Actions `board_syllabus`, `board_lesson_open`, `board_step_audio`, `board_question` | `supabase/functions/gemini-api/index.ts` |
| Tarifs | `supabase/functions/gemini-api/pricing.ts` |
| Encodage MP3 (serveur, testé) | `supabase/functions/gemini-api/audio.ts` (+ `.test.ts`) |
| Pause des clés épuisées (serveur, testé) | `supabase/functions/gemini-api/keyRotation.ts` (+ `.test.ts`) |
| Tables, règles d'accès, bucket audio | `supabase/migrations/20261118000000_board_lessons.sql`, `20261119000000_audio_mp3_key_rotation.sql` |
| Note de prononciation « Avereno » (testé) | `src/components/Board/speechScore.ts` (+ `tests/client/speechScore.test.ts`) |
| Accès Gemini partagé (clés, rotation, voix) | `supabase/functions/gemini-api/gemini.ts` |
| Pré-génération et invalidation de l'audio (testé) | `supabase/functions/gemini-api/boardOps.ts` (+ `.test.ts`) |
| Mini-test (testé) | `src/components/Board/miniTest.ts` (+ `tests/client/miniTest.test.ts`), `MiniTestView.tsx` |
| « Mes mots » | `src/components/Board/ReviewView.tsx` |
| Signaler une erreur | `src/components/Board/ReportSheet.tsx` |
| Console admin « Leçons » | `src/components/Board/BoardAdminPanel.tsx` |
| Tables et fonctions du lot 2, tests SQL | `supabase/migrations/20261120000000_board_lot2.sql`, `supabase/tests/40_board_lot2.sql`, `supabase/CRON_mirai.sql` |
| Écran (programme, leçon, question, résumé) | `src/components/Board/BoardLessonScreen.tsx` |
| Rendu des éléments du tableau | `src/components/Board/BoardItemView.tsx` |
| Synchronisation voix / tableau | `src/components/Board/useBoardPlayer.ts` |
| Appels serveur, préférences de voix | `src/services/boardService.ts` |
| Textes de l'interface (fr / mg) | `src/i18n/fr.ts`, `src/i18n/mg.ts` (section `board`) |

## Déploiement

1. **Base** : les migrations sont déjà appliquées sur le projet Supabase `mirai`. Sur un autre projet, exécute `supabase/INSTALL_mirai.sql`.
2. **Fonction** : `supabase functions deploy gemini-api`. Il faut déployer le dossier entier (`index.ts`, `gemini.ts`, `boardLesson.ts`, `boardOps.ts`, `pricing.ts`, `audio.ts`, `keyRotation.ts`).
3. **Tâche de nuit** : exécuter `supabase/CRON_mirai.sql` une fois (adresse et clé anon du projet).
4. **Front** : redéployer. Le point d'entrée se trouve dans le menu du chat et sur une carte « Leçon au tableau » de l'écran d'accueil du chat.

## À tester en vrai après déploiement

- **Qualité du malagasy** produit par Gemini sur 2 ou 3 leçons. Les consignes sont dans `MALAGASY_RULES` (`boardLesson.ts`) ; à ajuster selon tes retours.
- **Durée de la première génération** : 30 à 60 secondes attendues ; un écran d'attente est prévu.
- **« Avereno »** sur ton téléphone : la première fois, Chrome demande l'accès au micro.
- **Voix du téléphone** sur Android : la pause et la reprise y sont imparfaites, et le code relance la phrase si besoin.

## Prochaines étapes possibles

- Brancher le même tableau sur l'appel vocal en direct (`LiveTeacher`), en corrigeant d'abord ses deux bugs : l'interruption qui ne coupe pas le son et le micro qui ne se coupe pas.
- Laisser l'élève choisir une notion libre (« je veux une leçon sur le passé simple »).
- Leçons disponibles hors ligne, thème clair, taille du texte réglable (lot 3).
