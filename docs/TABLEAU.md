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
   - bouton 🇲🇬 MG pour afficher ou masquer le malagasy ;
   - sous-titres ;
   - choix de la voix : *premium* (Gemini), *téléphone* (gratuite, économise la data) ou *muet*.
4. **Question** : l'élève peut interrompre à tout moment (1 crédit). Le professeur répond à l'oral et écrit au tableau. Des raccourcis sont proposés : « Avereno azafady », « Hazavao amin'ny fomba hafa », « Omeo ohatra hafa aho ».
5. **Fin** : l'écran « À retenir » (français + malagasy), puis la leçon suivante.

Le quiz bloque l'enchaînement automatique tant que l'élève n'a pas répondu, mais il peut quand même passer à la suite avec « Suivant ».

## Comment ça marche

```
Navigateur ──(langue, niveau, n° leçon)──▶ Edge Function gemini-api
                                            │ 1. programme en cache ? sinon Gemini le génère (schéma JSON imposé)
                                            │ 2. leçon en cache ? sinon Gemini la génère, validation, nettoyage
                                            │ 3. 5 crédits au premier déblocage (remboursés en cas d'échec)
                                            ▼
                         board_syllabus / board_lessons / board_lesson_access (Postgres)
Voix d'une étape ──▶ board_step_audio : TTS Gemini → WAV 16 kHz → bucket privé lesson-audio → URL signée 1 h
```

- **Cache partagé** : quand un élève génère la leçon 3 « Anglais A1 », elle s'ouvre ensuite **instantanément et sans coût IA** pour tous les élèves. Il en va de même pour l'audio de chaque étape.
- **Sécurité** :
  - le client n'envoie jamais de prompt : il n'envoie que langue, niveau et numéro, et les prompts sont construits côté serveur ;
  - un élève ne peut lire qu'une leçon qu'il a débloquée, et ne peut pas se la débloquer lui-même ;
  - tests : `supabase/tests/30_board_lessons.sql`.
- **Qualité** :
  - la sortie de Gemini est validée : un quiz dont la réponse ne figure pas parmi les options est rejeté, un tableau mal formé est corrigé, le markdown et les émojis sont retirés du texte parlé ;
  - si la leçon reste inexploitable après deux essais, l'élève est remboursé.
- **Data mobile** : l'audio est rééchantillonné en 16 kHz (un tiers de moins), et la voix du téléphone reste disponible comme option économique ou comme repli automatique.

## Fichiers

| Rôle | Fichier |
|---|---|
| Prompts, schémas, validation, WAV (serveur, testé) | `supabase/functions/gemini-api/boardLesson.ts` (+ `.test.ts`) |
| Actions `board_syllabus`, `board_lesson_open`, `board_step_audio`, `board_question` | `supabase/functions/gemini-api/index.ts` |
| Tarifs | `supabase/functions/gemini-api/pricing.ts` |
| Tables, règles d'accès, bucket audio | `supabase/migrations/20261118000000_board_lessons.sql` |
| Écran (programme, leçon, question, résumé) | `src/components/Board/BoardLessonScreen.tsx` |
| Rendu des éléments du tableau | `src/components/Board/BoardItemView.tsx` |
| Synchronisation voix / tableau | `src/components/Board/useBoardPlayer.ts` |
| Appels serveur, préférences de voix | `src/services/boardService.ts` |
| Textes de l'interface (fr / mg) | `src/i18n/fr.ts`, `src/i18n/mg.ts` (section `board`) |

## Déploiement

1. **Base** : la migration est déjà appliquée sur le projet Supabase `mirai`. Sur un autre projet, exécute `supabase/migrations/20261118000000_board_lessons.sql`.
2. **Fonction** : `supabase functions deploy gemini-api`. Il faut déployer le dossier entier, avec `boardLesson.ts` et `pricing.ts`.
3. **Front** : redéployer. Le point d'entrée se trouve dans le menu du chat et sur une carte « Leçon au tableau » de l'écran d'accueil du chat.

## À tester en vrai après déploiement

- **Qualité du malagasy** produit par Gemini sur 2 ou 3 leçons. Les consignes sont dans `MALAGASY_RULES` (`boardLesson.ts`) ; à ajuster selon tes retours.
- **Durée de la première génération** : 30 à 60 secondes attendues ; un écran d'attente est prévu.
- **Voix du téléphone** sur Android : la pause et la reprise y sont imparfaites, et le code relance la phrase si besoin.

## Prochaines étapes possibles

- Brancher le même tableau sur l'appel vocal en direct (`LiveTeacher`), en corrigeant d'abord ses deux bugs : l'interruption qui ne coupe pas le son et le micro qui ne se coupe pas.
- Laisser l'élève choisir une notion libre (« je veux une leçon sur le passé simple »).
- Ajouter un bouton admin pour régénérer une leçon jugée mauvaise.
