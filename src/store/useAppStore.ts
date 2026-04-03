import { create } from 'zustand';
import { UserProfile, LearningSession } from '../types';
import { storageService } from '../services/storageService';

interface AppState {
  user: UserProfile | null;
  currentSession: LearningSession | null;
  isDarkMode: boolean;
  
  // Actions
  setUser: (user: UserProfile | null) => void;
  setCurrentSession: (session: LearningSession | null) => void;
  updateUserCredits: (credits: number) => void;
  toggleDarkMode: () => void;
  logout: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  currentSession: null,
  isDarkMode: typeof window !== 'undefined' ? localStorage.getItem('tm_theme') === 'dark' : false,

  setUser: (user) => set({ user }),
  
  setCurrentSession: (session) => set({ currentSession: session }),
  
  updateUserCredits: (credits) => set((state) => ({
    user: state.user ? { ...state.user, credits } : null
  })),

  toggleDarkMode: () => set((state) => {
    const newMode = !state.isDarkMode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('tm_theme', newMode ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', newMode);
    }
    return { isDarkMode: newMode };
  }),

  logout: async () => {
    await storageService.logout();
    set({ user: null, currentSession: null });
  }
}));
