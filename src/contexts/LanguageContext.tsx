import React, { createContext, useContext, useState, useEffect } from 'react';
import { Language, getTranslation } from '../i18n';
import { UserProfile } from '../types';
import { useAppStore } from '../store/useAppStore';
import { supabase } from '../lib/supabase';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => any;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('tm_language');
    return (saved === 'mg' || saved === 'fr') ? saved : 'fr';
  });

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('tm_language', lang);
    
    // Update user profile if logged in
    const user = useAppStore.getState().user;
    if (user && user.preferences) {
      const updatedUser = {
        ...user,
        preferences: {
          ...user.preferences,
          explanationLanguage: lang === 'mg' ? 'Malagasy 🇲🇬' : 'Français 🇫🇷'
        }
      };
      useAppStore.getState().setUser(updatedUser);
      await supabase.from('profiles').update({ preferences: updatedUser.preferences }).eq('id', user.id);
    }
  };

  // Sync with user profile on load/change
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const user = state.user;
      if (user && user.preferences && user.preferences.explanationLanguage) {
        const prefLang = user.preferences.explanationLanguage.includes('Malagasy') ? 'mg' : 'fr';
        if (prefLang !== language) {
          setLanguageState(prefLang);
          localStorage.setItem('tm_language', prefLang);
        }
      }
    });
    return () => unsub();
  }, [language]);

  const t = (key: string, params?: Record<string, string | number>) => {
    return getTranslation(language, key, params);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
};
