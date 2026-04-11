
# 📘 TeacherMada - Guide Complet & Base de Connaissances

Bienvenue dans la documentation officielle de **TeacherMada**. Ce document détaille chaque aspect de l'application, de l'inscription à l'utilisation des fonctionnalités avancées d'IA. Il est conçu pour les utilisateurs débutants et sert de contexte pour les assistants IA.

---

## 📑 Table des Matières

1.  [Introduction & Concept](#1-introduction--concept)
2.  [Premiers Pas (Installation & Compte)](#2-premiers-pas-installation--compte)
3.  [Configuration Initiale (Onboarding)](#3-configuration-initiale-onboarding)
4.  [L'Interface Principale (Le Chat)](#4-linterface-principale-le-chat)
5.  [Live Teacher (Appel Vocal IA)](#5-live-teacher-appel-vocal-ia)
6.  [Modules d'Apprentissage](#6-modules-dapprentissage)
    *   [Jeux de Rôle (Dialogues)](#jeux-de-rôle)
    *   [Exercices Générés](#exercices)
    *   [Examens & Certificats](#examens--certificats)
7.  [Espace Personnel (Dashboard)](#7-espace-personnel-dashboard)
8.  [Système de Crédits & Paiements](#8-système-de-crédits--paiements)
9.  [Notifications & Alertes](#9-notifications--alertes)
10. [Assistant Guide (Chatbot Aide)](#10-assistant-guide-chatbot-aide)
11. [Architecture Technique (Pour Développeurs/IA)](#11-architecture-technique)

---

## 1. Introduction & Concept

**TeacherMada** est une **PWA (Progressive Web App)** éducative qui utilise l'Intelligence Artificielle Générative (Google Gemini) pour simuler un professeur de langue privé.

*   **Objectif :** Rendre l'apprentissage des langues (Anglais, Français, Chinois, etc.) accessible, interactif et personnalisé.
*   **Philosophie :** "Immersion et Pratique". L'IA corrige, encourage et s'adapte au niveau de l'élève en temps réel.
*   **Technologies Clés :** Reconnaissance vocale, Synthèse vocale (TTS), Génération de texte, Mode Live (Audio temps réel).

---

## 2. Premiers Pas (Installation & Compte)

### 📥 Installation (PWA)
L'application peut s'installer comme une application native sur Android, iOS ou PC sans passer par les stores.
*   **Bouton :** "Installer l'application" (sur la page d'accueil) ou via le menu du navigateur ("Ajouter à l'écran d'accueil").
*   **Avantages :** Fonctionne en plein écran, accès rapide, cache hors-ligne partiel.

### 🔐 Authentification
L'écran d'authentification gère l'accès sécurisé.
*   **Inscription :** Nécessite un Nom d'utilisateur (unique), un Mot de passe, et optionnellement un Email/Téléphone.
*   **Connexion :** Via Nom d'utilisateur et Mot de passe.
*   **Mot de passe oublié :** Il n'y a pas d'email automatique. L'utilisateur remplit un formulaire de "Récupération" qui envoie une requête à l'administrateur. L'admin contactera l'utilisateur manuellement.

---

## 3. Configuration Initiale (Onboarding)

À la première connexion, l'utilisateur passe par 3 étapes cruciales :

1.  **Langue Cible :** Quelle langue apprendre ? (Ex: Anglais, Français, Chinois...).
2.  **Niveau Actuel :**
    *   De **A1** (Débutant) à **C2** (Maîtrise).
    *   Option **"Je ne connais pas mon niveau"** : Place l'utilisateur en niveau par défaut (A1 ou HSK1) avec une évaluation progressive.
3.  **Langue d'Explication :**
    *   **Français 🇫🇷** : Les règles et consignes seront en français.
    *   **Malagasy 🇲🇬** : Les explications seront en Malagasy (idéal pour les locaux).

---

## 4. L'Interface Principale (Le Chat)

C'est le cœur de l'application où se déroule le cours structuré.

### 🧩 Sections de l'écran
1.  **En-tête (Header) :**
    *   **Bouton Retour :** Quitte la session pour revenir à l'accueil.
    *   **Indicateur Langue/Niveau :** Affiche le cours actuel (ex: "Anglais • B1").
    *   **Menu (Chevrons) :** Permet de changer rapidement de mode (Vers Dialogues, Exercices, ou Live).
    *   **Compteur de Crédits (Éclair/Zap) :** Affiche le solde. Clic pour recharger.
    *   **Profil (Avatar) :** Ouvre le Smart Dashboard.

2.  **Zone de Messages (Body) :**
    *   Affiche l'historique de la conversation.
    *   **Messages IA :** Formatés en Markdown (Gras, Listes, Titres).
    *   **Bouton Audio (Haut-parleur) :** Permet d'écouter la prononciation d'un message spécifique (coûte 1 crédit).

3.  **Zone de Saisie (Footer) :**
    *   **Champ Texte :** Pour écrire les réponses.
    *   **Bouton Micro :** Dicter la réponse (Speech-to-Text).
    *   **Bouton Envoyer (Avion) :** Valide la réponse.
    *   **Bouton "Appel Vocal" (Téléphone) :** Bouton spécial avec effet "Glow" pour lancer le mode Live Teacher.

### 🧠 Logique Pédagogique
*   L'IA suit une structure : Objectif -> Concept -> Vocabulaire -> Pratique.
*   Elle corrige systématiquement les fautes avant de continuer.

---

## 5. Live Teacher (Appel Vocal IA)

Le mode le plus avancé pour l'immersion totale.

### ⚡ Fonctionnement
*   Connecte l'utilisateur directement au modèle **Gemini Live** (Audio-to-Audio temps réel).
*   **Latence ultra-faible :** La conversation est fluide comme un appel téléphonique.

### 🎓 Méthodologie "Immersion"
Le système suit un prompt strict :
1.  **Langue :** Parle 90% dans la langue cible.
2.  **Correction Bienveillante :**
    *   Si l'élève fait une faute : Encourager ("Good try!") → Corriger ("Say: ...") → Faire répéter ("Repeat please").
3.  **Débit :** L'IA parle lentement et articule clairement.

### 🎨 Interface Visuelle
*   **Avatar Central :** S'anime avec un halo énergétique (Emerald/Cyan) quand le prof parle.
*   **Ondes Concentriques :** S'animent autour de l'utilisateur quand il parle (réactif au volume micro).
*   **Timer :** Affiche la durée de l'appel.

### 💰 Coût
*   **5 Crédits / Minute**.
*   Notification visuelle "-5 Crédits" chaque 60 secondes.
*   Coupure automatique si le solde est épuisé.

---

## 6. Modules d'Apprentissage

Accessibles via le Menu ou le Dashboard.

### 🎭 Jeux de Rôle (Dialogues)
Mise en situation pratique.
*   **Scénarios :** Marché, Docteur, Entretien d'embauche, Aéroport, etc.
*   **Déroulement :** L'IA joue le rôle opposé (vendeur, médecin).
*   **Correction :** Feedback immédiat si la phrase est incorrecte.
*   **Score Final :** À la fin, l'IA donne une note sur 20 et des conseils.

### 🧠 Exercices
Génération de quiz basés sur l'historique du chat.
*   **Types :** QCM (Choix multiple), Vrai/Faux, Textes à trous.
*   **Feedback :** Explication immédiate après chaque réponse.
*   **Gain :** Réussir des exercices rapporte de l'XP (Expérience).

### 🎓 Examens & Certificats
Validez officiellement vos compétences.
*   **Examens :** Disponibles après avoir atteint un certain niveau d'XP ou complété un module.
*   **Contenu :** Évaluation complète (Grammaire, Vocabulaire, Compréhension).
*   **Certificats :** Générés automatiquement en cas de réussite (Score > 70%).
*   **Vérification :** Chaque certificat possède un QR Code et un hash de validation unique pour garantir son authenticité.

---

## 7. Espace Personnel (Dashboard)

Accessible en cliquant sur l'avatar en haut à droite. C'est le panneau de contrôle de l'utilisateur.

### 📊 Contenu
1.  **En-tête Profil :** Avatar, Nom, Niveau actuel.
2.  **Cartes d'Action Rapide :**
    *   **Dialogues :** Accès aux scénarios.
    *   **Appel Vocal :** Lancer le Live Teacher.
    *   **Exercices :** Lancer une session de quiz.
3.  **Portefeuille :** Affiche le solde de crédits et bouton "Recharger".
4.  **Préférences :**
    *   Changer la langue d'explication.
    *   Mode Sombre/Clair.
    *   Modifier le mot de passe.
5.  **Sauvegarde :**
    *   **Exporter :** Télécharge un fichier `.json` contenant toute la progression (utile si changement de téléphone).
    *   **Importer :** Restaure la progression depuis un fichier.

---

## 8. Système de Crédits & Paiements

TeacherMada fonctionne sur une économie de crédits pour financer les coûts serveurs IA.

### 💎 Économie
*   **1 Message Chat** = 1 Crédit.
*   **1 Exercice** = 5 Crédits.
*   **1 Minute d'Appel Vocal** = 5 Crédits.
*   **1 Audio (TTS)** = 1 Crédit.

### 💳 Rechargement (Paiement)
Le système simule un paiement Mobile Money (très populaire à Madagascar).
1.  L'utilisateur choisit un montant (ex: 2000 Ar).
2.  La modale affiche les numéros **Telma/Mvola**, **Airtel**, **Orange** de l'admin.
3.  L'utilisateur effectue le transfert réel sur son téléphone.
4.  L'utilisateur entre la **Référence de transaction** (reçue par SMS) dans l'app et envoie la demande.
5.  **Validation :** La demande part dans le "Dashboard Admin". L'admin vérifie son téléphone et valide les crédits.

---

## 9. Notifications & Alertes

Restez informé de votre progression et de vos transactions.
*   **Types :** Validation de crédits, Nouveaux messages, Résultats d'examens, Rappels d'étude.
*   **Lecture :** Les notifications peuvent être marquées comme lues individuellement ou globalement.

---

## 10. Assistant Guide (Chatbot Aide)

Un petit robot flottant en bas à gauche de l'écran.
*   **Rôle :** Aider l'utilisateur à naviguer dans l'app.
*   **Fonctionnalité Spéciale :** Bouton **"LIVRE" (Guide)** dans l'en-tête du chatbot.
    *   Ouvre une modale "Tutoriel Complet" avec des explications étape par étape sur toutes les fonctionnalités (similaire à ce document mais intégré dans l'UI).

---

## 11. Architecture Technique

*(Section destinée aux développeurs ou à l'Agent IA pour la maintenance)*

### 📂 Structure des Fichiers
*   `src/App.tsx` : Orchestrateur principal. Gère l'état global (User, Session, Modes).
*   `src/components/` : Contient tous les éléments visuels (ChatInterface, LiveTeacher, SmartDashboard...).
*   `src/services/geminiService.ts` : Pont vers l'API Google Gemini. Gère les prompts, le streaming et la configuration des modèles.
*   `src/services/storageService.ts` : Gère la persistance des données (LocalStorage + Supabase en parallèle pour la synchronisation).

### 🤖 Modèles IA Utilisés
*   **Chat & Texte :** `gemini-3-flash-preview` (Rapide et intelligent).
*   **Live Teacher :** `gemini-2.5-flash-native-audio-preview-09-2025` (Modèle multimodal natif pour l'audio temps réel).
*   **Support Agent :** `gemini-2.0-flash` (Léger pour les réponses rapides).

### ☁️ Backend (Supabase)
*   Table `profiles` : Stocke les utilisateurs, crédits, stats.
*   Table `admin_requests` : Stocke les demandes de paiement en attente de validation.
*   Table `system_settings` : Stocke les configurations globales.
*   Table `exam_results` : Historique des examens passés.
*   Table `certificates` : Certificats officiels générés.
*   Table `notifications` : Système de messagerie interne.
*   Table `user_vocabulary` : Synchronisation du vocabulaire personnel.

### 🔒 Sécurité
*   **RLS (Row Level Security) :** Chaque utilisateur ne peut accéder qu'à ses propres données.
*   **Fonctions RPC :** Utilisation de fonctions SQL sécurisées (`add_credits`, `consume_credits`) pour manipuler les données sensibles.
*   **Validation :** La validation des crédits est manuelle (humaine) pour éviter la fraude.

---
*Dernière mise à jour : Guide v1.1 - TeacherMada App*
