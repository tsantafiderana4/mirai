import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, MessageCircle, Compass, Target, Play, Volume2, ArrowRight, Loader2, X, Sparkles } from 'lucide-react';
import { CulturalIntro, UserProfile } from '../types';
import { generateCulturalIntro } from '../services/culturalService';
import { toast } from './Toaster';

interface CulturalImmersionProps {
  user: UserProfile;
  onComplete: () => void;
}

const CulturalImmersion: React.FC<CulturalImmersionProps> = ({ user, onComplete }) => {
  const [intro, setIntro] = useState<CulturalIntro | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const targetLanguage = user.preferences?.targetLanguage || 'Anglais';
  const level = user.preferences?.level || 'A1';
  const explanationLanguage = user.preferences?.explanationLanguage || 'Français';

  useEffect(() => {
    const fetchIntro = async () => {
      try {
        const data = await generateCulturalIntro(targetLanguage, level, explanationLanguage);
        setIntro(data);
      } catch (error) {
        console.error("Error fetching cultural intro:", error);
        toast.error("Impossible de charger l'introduction culturelle.");
        onComplete(); // Skip if error
      } finally {
        setIsLoading(false);
      }
    };

    fetchIntro();
  }, [targetLanguage, level, explanationLanguage, onComplete]);

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = explanationLanguage.includes('Malagasy') ? 'mg-MG' : 'fr-FR';
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  const sections = intro ? [
    {
      title: "🌍 Informations Essentielles",
      icon: <Globe className="w-6 h-6 text-blue-500" />,
      content: (
        <div className="space-y-4">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-1">Pays & Régions</h4>
            <div className="flex flex-wrap gap-2">
              {intro.essentialInfo.countries.map((c, i) => (
                <span key={i} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full text-xs font-bold">
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-1">Contexte d'usage</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{intro.essentialInfo.usageContext}</p>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-1">Importance Culturelle</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{intro.essentialInfo.culturalImportance}</p>
          </div>
        </div>
      )
    },
    {
      title: "🗣️ Bases de Communication",
      icon: <MessageCircle className="w-6 h-6 text-emerald-500" />,
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
              <h4 className="font-bold text-emerald-700 dark:text-emerald-400 text-xs uppercase mb-2">Salutations</h4>
              <ul className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                {intro.communicationBasics.greetings.map((g, i) => <li key={i}>• {g}</li>)}
              </ul>
            </div>
            <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
              <h4 className="font-bold text-indigo-700 dark:text-indigo-400 text-xs uppercase mb-2">Politesse</h4>
              <ul className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                {intro.communicationBasics.politeness.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-1">Ton & Comportement</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{intro.communicationBasics.toneAndBehavior}</p>
          </div>
        </div>
      )
    },
    {
      title: "🧭 Coutumes & Gestes",
      icon: <Compass className="w-6 h-6 text-amber-500" />,
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
              <h4 className="font-bold text-green-700 dark:text-green-400 text-xs uppercase mb-2">À faire (Do's)</h4>
              <ul className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                {intro.customsAndBehaviors.dos.map((d, i) => <li key={i}>✅ {d}</li>)}
              </ul>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
              <h4 className="font-bold text-red-700 dark:text-red-400 text-xs uppercase mb-2">À éviter (Don'ts)</h4>
              <ul className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                {intro.customsAndBehaviors.donts.map((d, i) => <li key={i}>❌ {d}</li>)}
              </ul>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white mb-1">Gestes Spécifiques</h4>
            <ul className="text-sm space-y-1 text-slate-600 dark:text-slate-400">
              {intro.customsAndBehaviors.gestures.map((g, i) => <li key={i}>👉 {g}</li>)}
            </ul>
          </div>
        </div>
      )
    },
    {
      title: "🎯 Conseils Pratiques",
      icon: <Target className="w-6 h-6 text-rose-500" />,
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
            <h4 className="font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" /> Astuces de progression
            </h4>
            <ul className="text-sm space-y-2 text-slate-600 dark:text-slate-400">
              {intro.practicalTips.progressHacks.map((h, i) => <li key={i} className="flex gap-2"><span>🚀</span> {h}</li>)}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-xs mb-1">Difficultés types</h4>
              <ul className="text-xs space-y-1 text-slate-500">
                {intro.practicalTips.frequentDifficulties.map((d, i) => <li key={i}>• {d}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-xs mb-1">Méthode</h4>
              <ul className="text-xs space-y-1 text-slate-500">
                {intro.practicalTips.learningTips.map((l, i) => <li key={i}>• {l}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )
    }
  ] : [];

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[300] bg-white dark:bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-indigo-600 rounded-[2.5rem] flex items-center justify-center text-white mb-8 shadow-2xl shadow-indigo-500/40"
        >
          <Globe className="w-12 h-12 animate-pulse" />
        </motion.div>
        <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2">Immersion Culturelle</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-xs mb-8">Préparation de votre voyage linguistique en {targetLanguage}...</p>
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 md:p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 md:p-8 bg-gradient-to-br from-indigo-600 to-violet-700 text-white relative">
          <button 
            onClick={onComplete}
            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black">Immersion : {targetLanguage}</h2>
              <p className="text-indigo-100 text-sm font-medium opacity-80">Niveau {level} • Guide Culturel</p>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {sections.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveSection(i)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeSection === i ? 'bg-white text-indigo-600 shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {s.title.split(' ')[1]}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-3">
                  {sections[activeSection].icon}
                  {sections[activeSection].title}
                </h3>
                <button 
                  onClick={() => speak(intro ? JSON.stringify(sections[activeSection]) : "")}
                  className={`p-3 rounded-full transition-all ${isSpeaking ? 'bg-indigo-500 text-white animate-pulse' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-500'}`}
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-800">
                {sections[activeSection].content}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-6 md:p-8 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex gap-1">
            {sections.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all ${activeSection === i ? 'w-8 bg-indigo-600' : 'w-2 bg-slate-300 dark:bg-slate-700'}`} />
            ))}
          </div>

          <div className="flex gap-3">
            {activeSection < sections.length - 1 ? (
              <button 
                onClick={() => setActiveSection(prev => prev + 1)}
                className="px-6 py-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                Suivant <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button 
                onClick={onComplete}
                className="px-8 py-3 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-500/20 hover:scale-105 transition-all flex items-center gap-2"
              >
                C'est parti ! <Play className="w-4 h-4 fill-current" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default CulturalImmersion;
