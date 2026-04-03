import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AuthScreen from './components/AuthScreen';
import Onboarding from './components/Onboarding';
import ChatInterface from './components/ChatInterface';
import SmartDashboard from './components/SmartDashboard';
import ExerciseSession from './components/ExerciseSession';
import DialogueSession from './components/DialogueSession';
// import ExamHub from './modules/SmartExam'; // Lazy Loaded below
import PaymentModal from './components/PaymentModal';
import AdminDashboard from './components/AdminDashboard';
import TutorialAgent from './components/TutorialAgent';
import LiveTeacher from './components/LiveTeacher'; 
import VerifyCertificate from './components/VerifyCertificate'; // Added
import { UserProfile, LearningSession, ExerciseItem, LearningMode } from './types';
import type { UserPreferences } from './types';
import { supabase } from './lib/supabase';
import { generateExerciseFromHistory } from './services/geminiService';
import { Toaster, toast } from './components/Toaster';
import { useAppStore } from './store/useAppStore';
import { useUserProfile } from './hooks/queries/useUserProfile';
import { useLearningSession } from './hooks/queries/useLearningSession';
import { Loader2 } from 'lucide-react';

import DebugConsole from './components/DebugConsole';

// Lazy Load Heavy Modules
const ExamHub = React.lazy(() => import('./modules/SmartExam'));

// Mock Guest User for Landing Page Chatbot
const GUEST_USER: UserProfile = {
  id: 'guest',
  username: 'Visiteur',
  role: 'user',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  credits: 0,
  preferences: {
    targetLanguage: 'Français',
    level: 'Débutant',
    explanationLanguage: 'Français',
    mode: LearningMode.Course,
    voiceName: 'Zephyr'
  }
};

const App: React.FC = () => {
  return (
    <AppContent />
  );
};

const AppContent: React.FC = () => {
  const { user, setUser, currentSession, setCurrentSession, isDarkMode, toggleDarkMode, logout } = useAppStore();
  const [authUserId, setAuthUserId] = useState<string | undefined>(undefined);
  
  const { profile, updateProfile } = useUserProfile(authUserId);
  const { session: fetchedSession } = useLearningSession(authUserId, profile?.preferences ?? undefined);

  const [showAuth, setShowAuth] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false); // State remonté
  const [verifyCertId, setVerifyCertId] = useState<string | null>(null); // Verification State
  
  // Modes
  const [activeMode, setActiveMode] = useState<'chat' | 'exercise' | 'practice' | 'exam'>('chat');
  const [currentExercises, setCurrentExercises] = useState<ExerciseItem[]>([]);
  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  // 1. INITIALIZATION & AUTH LISTENER
  useEffect(() => {
    // Check URL for verification
    const path = window.location.pathname;
    if (path.startsWith('/verify/')) {
        const certId = path.split('/verify/')[1];
        if (certId) setVerifyCertId(certId);
    }

    const initAuth = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            setAuthUserId(session.user.id);
        }
    };
    initAuth();
    
    // Auth State Listener
    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
            setAuthUserId(undefined);
            setUser(null);
            setCurrentSession(null);
            setShowDashboard(false);
            setShowAdmin(false);
            setActiveMode('chat');
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            if (session?.user) {
                setAuthUserId(session.user.id);
            }
        }
    });

    return () => {
        authListener.unsubscribe();
    };
  }, []);

  // Sync profile to Zustand store
  useEffect(() => {
      if (profile) {
          setUser(profile);
      }
  }, [profile, setUser]);

  // Sync session to Zustand store
  useEffect(() => {
      if (fetchedSession) {
          setCurrentSession(fetchedSession);
      }
  }, [fetchedSession, setCurrentSession]);

  // 3. THEME & OFFLINE HANDLERS
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
      const handleOffline = () => toast.error("Vous êtes hors ligne. Vérifiez votre connexion.");
      const handleOnline = () => toast.success("Connexion rétablie !");
      
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);
      return () => {
          window.removeEventListener('offline', handleOffline);
          window.removeEventListener('online', handleOnline);
      };
  }, []);

  // 4. FOCUS REFRESH
  useEffect(() => {
      const handleFocus = async () => {
          // React Query handles refetchOnWindowFocus automatically
      };
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const notify = (msg: string, type: string = 'info') => {
    if (type === 'error') toast.error(msg);
    else if (type === 'success') toast.success(msg);
    else toast.info(msg);
  };

  const handleAuthSuccess = async (u: UserProfile) => {
    setAuthUserId(u.id);
    setShowAuth(false);
  };

  const handleChangeCourse = async () => {
      if (!user) return;
      const updatedUser: UserProfile = {
          ...user,
          preferences: {
              ...user.preferences!,
              targetLanguage: '', 
              level: '',
          }
      };
      await updateProfile(updatedUser);
      setCurrentSession(null);
  };

  const handleOnboardingComplete = async (prefs: any) => {
    if (!user || !prefs) return;
    const selectedLang = prefs.targetLanguage || "English"; // Default fallback
    
    // Ensure preferences match UserPreferences type strictly
    const newPreferences: UserPreferences = {
        ...prefs,
        targetLanguage: selectedLang,
        // Ensure other required fields if any, or spread prefs
    };

    const updated: UserProfile = { 
        ...user, 
        preferences: newPreferences
    };
    await updateProfile(updated);
  };

  const handleLogout = async () => {
    await logout();
    setShowDashboard(false);
    setShowAdmin(false);
    setActiveMode('chat');
  };

  const startExercise = async () => {
      if (!user || !currentSession) return;
      setIsGeneratingExercise(true);
      try {
          const exercises = await generateExerciseFromHistory(currentSession.messages, user);
          if (exercises.length > 0) {
              setCurrentExercises(exercises);
              setActiveMode('exercise');
          } else {
              toast.error("Impossible de générer des exercices (Contexte insuffisant ou erreur).");
          }
      } catch (e) {
          toast.error("Erreur lors de la génération.");
      } finally {
          setIsGeneratingExercise(false);
      }
  };

  const startExam = () => {
      setShowDashboard(false);
      setActiveMode('exam');
  };

  const finishExercise = async (score: number, total: number) => {
      if (user) {
          toast.success(`Exercice terminé ! Score : ${score}/${total}`);
      }
      setActiveMode('chat');
  };

  // Handlers pour le Dashboard
  const handleStartVoiceCall = () => {
      setShowDashboard(false);
      setShowVoiceCall(true);
  };

  const handleStartPractice = () => {
      setShowDashboard(false);
      setActiveMode('practice');
  };

  const handleStartExerciseFromDash = () => {
      setShowDashboard(false);
      startExercise();
  };

  const handleStartExamFromDash = () => {
      setShowDashboard(false);
      startExam();
  };

  const needsOnboarding = !user?.preferences || !user?.preferences?.targetLanguage;

  const getAgentContext = () => {
      if (!user) return "Page d'Accueil (Visiteur non connecté) - Présentation de TeacherMada";
      if (needsOnboarding) return "Configuration du Profil (Langue/Niveau)";
      if (showAdmin) return "Panneau Administrateur";
      if (showPayment) return "Rechargement de Crédits";
      if (showDashboard) return "Profil Utilisateur & Statistiques";
      if (activeMode === 'exercise') return "Session d'Exercices (Quiz)";
      if (activeMode === 'exam') return "Examen Final & Certification";
      if (activeMode === 'practice') return "Session de Dialogue (Roleplay)";
      if (showVoiceCall) return "Appel Vocal en Direct (TeacherMada Live)";
      return `Chat Principal - Apprentissage du ${user.preferences?.targetLanguage || 'Language'}`;
  };

  const handleResumeCourse = async () => {
    if (!user || !user.preferences) return;
    if (isResuming) return;
    
    setIsResuming(true);
    
    try {
        console.log("Resuming course for user:", user.id);
        
        if (fetchedSession && fetchedSession.id) {
            setCurrentSession(fetchedSession);
            toast.success("Cours repris avec succès !");
        } else {
            throw new Error("Session invalide");
        }
    } catch (error) {
        console.error("Error resuming course:", error);
        toast.error("Impossible de reprendre le cours. Vérifiez votre connexion.");
    } finally {
        setIsResuming(false);
    }
  };

  if (verifyCertId) {
      return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300">
              <Toaster />
              <VerifyCertificate 
                  certId={verifyCertId} 
                  onClose={() => {
                      setVerifyCertId(null);
                      window.history.pushState({}, '', '/');
                  }} 
              />
          </div>
      );
  }

  if (showAdmin && user?.role === 'admin') {
      return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300">
              <Toaster />
              <AdminDashboard 
                  currentUser={user}
                  onBack={() => setShowAdmin(false)}
                  onLogout={handleLogout}
                  isDarkMode={isDarkMode}
                  notify={notify}
              />
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans transition-colors duration-300">
      <Toaster />
      <DebugConsole />

      {!showAdmin && (
          <TutorialAgent user={user || GUEST_USER} context={getAgentContext()} />
      )}

      {isGeneratingExercise && (
          <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
              <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-500" />
              <p className="font-bold text-lg">Un prof prépare vos exercices...</p>
          </div>
      )}

      {/* Live Voice Call Overlay */}
      {showVoiceCall && user && (
          <LiveTeacher 
              user={user} 
              onClose={() => setShowVoiceCall(false)} 
              onUpdateUser={(updated) => {
                  const currentUser = useAppStore.getState().user;
                  setUser(currentUser ? { ...updated, preferences: currentUser.preferences } : updated);
              }} 
              notify={notify}
              onShowPayment={() => setShowPayment(true)}
          />
      )}

      {!user && !showAuth && (
        <LandingPage onStart={() => setShowAuth(true)} isDarkMode={isDarkMode} toggleTheme={toggleDarkMode} />
      )}

      {!user && showAuth && (
        <AuthScreen 
          onAuthSuccess={handleAuthSuccess} 
          onBack={() => setShowAuth(false)} 
          isDarkMode={isDarkMode} 
          toggleTheme={toggleDarkMode} 
          notify={notify} 
        />
      )}

      {user && needsOnboarding && (
        <Onboarding 
          onComplete={handleOnboardingComplete} 
          isDarkMode={isDarkMode} 
          toggleTheme={toggleDarkMode} 
        />
      )}

      {user && !needsOnboarding && currentSession && (
        <>
          {activeMode === 'chat' && !showVoiceCall && (
              <ChatInterface 
                onShowProfile={() => setShowDashboard(true)}
                onExit={() => setCurrentSession(null)}
                onStartPractice={() => setActiveMode('practice')}
                onStartExercise={startExercise}
                onStartExam={startExam}
                notify={notify}
                onShowPayment={() => setShowPayment(true)}
                onChangeCourse={handleChangeCourse}
                onStartVoiceCall={() => setShowVoiceCall(true)}
              />
          )}

          {activeMode === 'exercise' && (
              <ExerciseSession 
                  exercises={currentExercises}
                  onClose={() => setActiveMode('chat')}
                  onComplete={finishExercise}
              />
          )}

          {activeMode === 'exam' && (
              <React.Suspense fallback={
                  <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                      <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-500" />
                      <p className="font-bold text-lg">Chargement du module Examen...</p>
                  </div>
              }>
                  <ExamHub 
                      user={user}
                      onClose={() => setActiveMode('chat')}
                      onUpdateUser={setUser}
                      onShowPayment={() => setShowPayment(true)}
                  />
              </React.Suspense>
          )}

          {activeMode === 'practice' && (
              <DialogueSession 
                  user={user}
                  onClose={() => setActiveMode('chat')}
                  onUpdateUser={(updated) => {
                      const currentUser = useAppStore.getState().user;
                      setUser(currentUser ? { ...updated, preferences: currentUser.preferences } : updated);
                  }}
                  notify={notify}
                  onShowPayment={() => setShowPayment(true)}
              />
          )}

          {showDashboard && (
            <SmartDashboard 
              onClose={() => setShowDashboard(false)} 
              onOpenAdmin={() => { setShowDashboard(false); setShowAdmin(true); }}
              onShowPayment={() => { setShowDashboard(false); setShowPayment(true); }}
              onStartPractice={handleStartPractice}
              onStartExercise={handleStartExerciseFromDash}
              onStartVoice={handleStartVoiceCall}
              onStartExam={handleStartExamFromDash}
            />
          )}

          {showPayment && (
              <PaymentModal 
                  user={user}
                  onClose={() => setShowPayment(false)}
              />
          )}
        </>
      )}

      {user && !needsOnboarding && !currentSession && !showAdmin && !showVoiceCall && (
        <div className="h-screen flex flex-col items-center justify-center p-6 bg-white dark:bg-slate-900 animate-fade-in">
           <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white mb-8 shadow-2xl shadow-indigo-500/40">
             <img src="https://i.ibb.co/B2XmRwmJ/logo.png" className="w-12 h-12" />
           </div>
           <h1 className="text-2xl font-black mb-2">Bon retour, {user.username} !</h1>
           <p className="text-slate-500 mb-10 text-center">Prêt à continuer votre apprentissage du {user.preferences?.targetLanguage} ?</p>
           
           <div className="space-y-4 w-full max-w-sm">
             <button 
                onClick={handleResumeCourse}
                disabled={isResuming}
                className="w-full py-5 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-500/20 hover:scale-[1.02] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
             >
               {isResuming ? (
                   <>
                       <Loader2 className="w-5 h-5 animate-spin" />
                       Reprise en cours...
                   </>
               ) : (
                   "Reprendre mon cours"
               )}
             </button>
             <button 
                onClick={handleChangeCourse}
                className="w-full py-4 text-slate-500 font-bold hover:text-indigo-600 transition-colors"
             >
               Changer de langue ou niveau
             </button>
             <button onClick={handleLogout} className="w-full py-2 text-red-500 text-sm font-bold">Déconnexion</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;