
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Phone, ArrowLeft, Sun, Moon, Zap, ChevronDown, Repeat, MessageCircle, Brain, Loader2, AlertTriangle, Play, BookOpen, Trophy, Cloud, CloudOff, CloudLightning, Award, Check, Volume2 } from 'lucide-react';
import { ExplanationLanguage } from '../types';
import { ChatMessage } from '../types';
import { generateText } from '../services/geminiService';
import { CREDIT_COSTS } from '../services/creditService';
import { useUserProfile } from '../hooks/queries/useUserProfile';
import { useLearningSession } from '../hooks/queries/useLearningSession';
import { useNotifications } from '../hooks/queries/useNotifications';
import { getFlagUrl } from '../constants';
import { useTranslation } from '../contexts/LanguageContext';
import { useAppStore } from '../store/useAppStore';
import { useChat } from '../hooks/useChat';
import { useAudio } from '../hooks/useAudio';
import { MessageList } from './Chat/MessageList';
import { ChatInput } from './Chat/ChatInput';

interface Props {
  onShowProfile: () => void;
  onExit: () => void;
  onStartPractice: () => void;
  onStartExercise: () => void;
  onStartVoiceCall: () => void; 
  onStartExam: () => void;
  notify: (m: string, t?: string) => void;
  onShowPayment: () => void;
  onChangeCourse: () => void;
}

// Helper to convert Raw PCM to AudioBuffer
/*
function pcmToAudioBuffer(data: Uint8Array, ctx: AudioContext, sampleRate: number = 30000) {
    const pcm16 = new Int16Array(data.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0; 
    }
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    return buffer;
}
*/


const ChatInterface: React.FC<Props> = ({ 
  onShowProfile, onExit, 
  onStartPractice, onStartExercise, onStartVoiceCall, onStartExam,
  notify, onShowPayment, onChangeCourse
}) => {
  const { user, setUser, setCurrentSession } = useAppStore();
  const { refetch: refetchUser } = useUserProfile(user?.id || '');
  const { session: learningSession, refetch: refetchSession, updateSession } = useLearningSession(user?.id || '', user?.preferences);
  const { notifications } = useNotifications(user?.id || '');
  const unreadCount = notifications?.filter(n => !n.read).length || 0;
  const { t } = useTranslation();

  const { messages, setMessages, isStreaming, processMessage } = useChat(user, learningSession || null, updateSession, notify, onShowPayment);
  const { speakingMessageId, isLoadingAudio, playMessageAudio, stopSpeaking } = useAudio(user, notify, onShowPayment);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [input, setInput] = useState('');
  const [showStartButton, setShowStartButton] = useState(false);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('tm_theme') === 'dark');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>('synced');
  const [openGuideItem, setOpenGuideItem] = useState<string | null>('start_lesson');
  const [showVoiceCallConfirm, setShowVoiceCallConfirm] = useState(false);
  
  const LOADING_PHRASES = useMemo(() => [
    t('chat.teacher_thinking'),
    t('chat.processing'),
    t('chat.recording'),
    t('chat.analyzing'),
    t('chat.drafting'),
    t('chat.correcting'),
    t('chat.searching')
  ], [t]);

  const [loadingText, setLoadingText] = useState(LOADING_PHRASES[0]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isStreaming) {
      setLoadingText(LOADING_PHRASES[0]);
      let index = 0;
      interval = setInterval(() => {
        index = (index + 1) % LOADING_PHRASES.length;
        setLoadingText(LOADING_PHRASES[index]);
      }, 2500);
    }
    return () => {
        if (interval) clearInterval(interval);
    };
  }, [isStreaming, LOADING_PHRASES]);

  const handleRefresh = async () => {
      setIsRefreshing(true);
      setSyncStatus('syncing');
      try {
          if (user && user.preferences) {
               const { data: s } = await refetchSession();
               if (s) {
                   setMessages(s.messages);
                   setCurrentSession(s);
               }
               const { data: updatedUser } = await refetchUser();
               if (updatedUser) setUser(updatedUser);
          }
          setRefreshSuccess(true);
          setSyncStatus('synced');
          setTimeout(() => setRefreshSuccess(false), 2000);
      } catch (e) {
          console.error(e);
          setSyncStatus('error');
      } finally {
          setIsRefreshing(false);
      }
  };

  // Periodic Intelligence Analysis
  useEffect(() => {
      if (!user || messages.length === 0) return;
      // Removed intelligenceService analysis
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const handleVoiceCallClick = async () => {
      setShowVoiceCallConfirm(true);
  };

  const confirmVoiceCall = async () => {
      setShowVoiceCallConfirm(false);
      if (!user) return;
      const allowed = user.credits >= CREDIT_COSTS.VOICE_CALL; 
      if (!allowed) {
          notify(t('chat.voice_call_min_credits', { cost: CREDIT_COSTS.VOICE_CALL }), "error");
          onShowPayment();
          return;
      }
      onStartVoiceCall();
  };

  const currentLessonNum = useMemo(() => {
      if (!user) return 1;
      const lastAiMessage = [...messages].reverse().find(m => m.role === 'model');
      if (lastAiMessage) {
          const match = lastAiMessage.text.match(/(?:Leçon|Lesson)\s+(\d+)/i);
          if (match) return parseInt(match[1], 10);
      }
      return 1;
  }, [messages, user]);

  const currentLessonTitle = `${t('dashboard.lessons')} ${currentLessonNum}`;

  useEffect(() => {
      if (!user) return;
      if (messages.length === 0) {
          const targetLang = user.preferences?.targetLanguage;
          const level = user.preferences?.level;

          const welcomeTitle = t('chat.welcome_title');
          const welcomeBody = t('chat.welcome_text', { 
              targetLang: targetLang || '', 
              level: level || '',
              teacherName: user.preferences?.teacherName || 'TeacherMada'
          });
          const welcomeText = `${welcomeTitle}\n\n${welcomeBody}`;

          const initialMsg: ChatMessage = {
              id: 'welcome_msg',
              role: 'model',
              text: welcomeText,
              timestamp: Date.now()
          };
          setMessages([initialMsg]);
          setShowStartButton(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effects for notifications and user updates removed as React Query handles them

  const toggleTheme = () => {
      const newMode = !isDarkMode;
      setIsDarkMode(newMode);
      document.documentElement.classList.toggle('dark', newMode);
      localStorage.setItem('tm_theme', newMode ? 'dark' : 'light');
  };

  const progressData = useMemo(() => {
      if (!user) return { percentage: 0, nextLevel: 'A1', currentLevel: 'A1', completed: 0, total: 50 };
      
      const isChinese = user.preferences?.targetLanguage?.includes('Chinois');
      const levels = isChinese 
          ? ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6']
          : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
          
      const currentLevel = user.preferences?.level || (isChinese ? 'HSK 1' : 'A1');
      const currentIndex = levels.indexOf(currentLevel);
      const nextLevel = currentIndex !== -1 && currentIndex < levels.length - 1 ? levels[currentIndex + 1] : 'Expert';
      
      const lessonsPerLevel = 50;
      // Sync with current lesson number from chat if higher than stats
      const effectiveCompleted = currentLessonNum;
      const percentage = Math.min((effectiveCompleted / lessonsPerLevel) * 100, 100);
      
      return { percentage: Math.round(percentage), nextLevel, currentLevel, completed: effectiveCompleted, total: lessonsPerLevel };
  }, [user, currentLessonNum]);

  const userFlagUrl = useMemo(() => {
      if (!user) return '';
      const lang = user.preferences?.targetLanguage || '';
      return getFlagUrl(lang.split(' ')[0]);
  }, [user]);

  const isLowCredits = user ? user.credits < 5 : false;

  const handleStartCourse = () => {
      if (!user) return;
      const allowed = user.credits >= CREDIT_COSTS.LESSON;
      if (!allowed) {
          notify(t('chat.insufficient_credits'), "error");
          onShowPayment();
          return;
      }
      setShowStartButton(false); // Hide button
      const isMalagasy = user.preferences?.explanationLanguage === ExplanationLanguage.Malagasy;
      processMessage(isMalagasy ? "HANOMBOKA LESONA" : "COMMENCER");
  };

  // Smart Scroll
  const scrollToBottom = () => {
      if (scrollRef.current) {
          scrollRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  };

  useEffect(() => {
      scrollToBottom();
  }, [messages, isStreaming, showStartButton]);

  // Permanent Tutorial Display
  useEffect(() => {
      // setShowTutorial(true);
  }, []);

  useEffect(() => {
      // Sync status is handled by React Query internally
  }, []);

  if (!user) return null;

  return (
    <div className="flex flex-col h-[100dvh] bg-[#F0F2F5] dark:bg-[#0B0F19] font-sans transition-colors duration-300 overflow-hidden" onClick={() => setShowTopMenu(false)}>
      
      {/* --- HEADER --- */}
      <header className="shrink-0 w-full z-30 bg-white/80 dark:bg-[#131825]/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm safe-top">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
                <button onClick={onExit} className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors shrink-0">
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setShowTopMenu(!showTopMenu); }}
                        className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                        <img src={userFlagUrl} alt="Flag" className="w-5 h-auto rounded-sm shadow-sm" />
                        <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase">{progressData.currentLevel}</span>
                        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showTopMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showTopMenu && (
                        <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden z-50 animate-fade-in-up">
                            <button onClick={onStartPractice} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><MessageCircle className="w-4 h-4 text-indigo-500" /> {t('dashboard.start_dialogue')}</button>
                            <button onClick={onStartExercise} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Brain className="w-4 h-4 text-emerald-500" /> {t('dashboard.start_exercise')}</button>
                            <button onClick={onStartExam} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Trophy className="w-4 h-4 text-rose-500" /> {t('dashboard.start_exam')}</button>
                            <button onClick={handleVoiceCallClick} className="w-full text-left px-4 py-3 flex items-center gap-2 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200"><Phone className="w-4 h-4 text-purple-500" /> {t('dashboard.start_voice')}</button>
                            <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1"></div>
                            <button onClick={onChangeCourse} className="w-full text-left px-4 py-3 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2 text-xs font-bold text-red-500"><Repeat className="w-3.5 h-3.5" /> {t('dashboard.change_course')}</button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col items-center justify-center shrink-0">
                <h1 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-widest leading-tight mb-0.5">
                    {currentLessonTitle}
                </h1>
                <div onClick={onShowPayment} className={`flex items-center gap-1 cursor-pointer transition-all duration-500 px-2 py-0.5 rounded-full border ${isLowCredits ? 'animate-pulse text-red-600 bg-red-100 dark:bg-red-900/30 ring-2 ring-red-500 border-red-500 scale-105' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:scale-105'}`}>
                    {isLowCredits ? <AlertTriangle className="w-3 h-3" /> : <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />}
                    <span className={`text-[10px] font-bold ${isLowCredits ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {user.credits} {t('common.credits')}
                    </span>
                </div>
            </div>

            <div className="flex items-center justify-end gap-3 flex-1">
                <button 
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="flex items-center justify-center relative group hover:bg-slate-100 dark:hover:bg-slate-800 p-2 rounded-full transition-colors disabled:opacity-50" 
                    title={t('common.refresh_app') || "Actualiser l'application"}
                >
                    {isRefreshing ? (
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                    ) : refreshSuccess ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                        <>
                            {syncStatus === 'synced' && <Cloud className="w-4 h-4 text-emerald-500" />}
                            {syncStatus === 'syncing' && <CloudLightning className="w-4 h-4 text-amber-500 animate-pulse" />}
                            {syncStatus === 'offline' && <CloudOff className="w-4 h-4 text-slate-400" />}
                            {syncStatus === 'error' && <CloudOff className="w-4 h-4 text-red-500" />}
                        </>
                    )}
                </button>
                <button onClick={toggleTheme} className="p-2 text-slate-400 hover:text-indigo-600 rounded-full transition-colors">
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <button onClick={onShowProfile} className="relative group flex items-center gap-2">
                    <div className="relative">
                        <img src={`https://api.dicebear.com/9.x/micah/svg?seed=${user.username}`} alt="User" className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800 shadow-md border border-white dark:border-slate-600"/>
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900 animate-bounce">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </div>
                </button>
            </div>
        </div>
      </header>

      {/* --- CHAT AREA --- */}
      <main className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-6 scrollbar-hide relative no-scrollbar">
        <style>{`
            .no-scrollbar::-webkit-scrollbar {
                display: none;
            }
            .no-scrollbar {
                -ms-overflow-style: none;
                scrollbar-width: none;
            }
        `}</style>
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="w-full mb-6 animate-fade-in">
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
                    <h3 className="font-black text-slate-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2 text-xs">
                        <BookOpen className="w-4 h-4 text-indigo-500"/>
                        {t('common.guide.title')}
                    </h3>
                    <div className="space-y-2">
                        {[
                            { id: 'start_lesson', icon: Play, color: 'text-emerald-500', action: handleStartCourse },
                            { id: 'pronunciation', icon: Volume2, color: 'text-cyan-500' },
                            { id: 'exercise', icon: Brain, color: 'text-purple-500', action: onStartExercise },
                            { id: 'dialogue', icon: MessageCircle, color: 'text-blue-500', action: onStartPractice },
                            { id: 'voice_call', icon: Phone, color: 'text-indigo-500', action: handleVoiceCallClick },
                            { id: 'exam', icon: Trophy, color: 'text-rose-500', action: onStartExam },
                            { id: 'certificate', icon: Award, color: 'text-yellow-500' },
                            { id: 'credits', icon: Zap, color: 'text-amber-500', action: onShowPayment },
                            { id: 'change_course', icon: Repeat, color: 'text-red-500', action: onChangeCourse }
                        ].map((item) => {
                            const isOpen = openGuideItem === item.id;
                            const guideText = t(`common.guide.${item.id}`);
                            const [title, ...descParts] = guideText.includes(':') ? guideText.split(':') : [guideText, ''];
                            const description = descParts.join(':').trim();

                            return (
                                <div key={item.id} className="border border-slate-100 dark:border-slate-700/50 rounded-xl overflow-hidden">
                                    <div className="w-full flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                        <div 
                                            className={`flex items-center gap-3 flex-1 ${item.action ? 'cursor-pointer group' : ''}`}
                                            onClick={(e) => {
                                                if (item.action) {
                                                    e.stopPropagation();
                                                    item.action();
                                                } else {
                                                    setOpenGuideItem(isOpen ? null : item.id);
                                                }
                                            }}
                                        >
                                            <item.icon className={`w-4 h-4 ${item.color}`} />
                                            <span className={`text-xs font-bold ${item.action ? 'text-indigo-600 dark:text-indigo-400 group-hover:underline' : 'text-slate-700 dark:text-slate-200'}`} title={item.action ? "Cliquez pour ouvrir" : ""}>
                                                {title.trim()}
                                            </span>
                                        </div>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenGuideItem(isOpen ? null : item.id);
                                            }}
                                            className="p-1 -mr-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
                                            title="Voir l'explication"
                                        >
                                            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                    </div>
                                    {isOpen && description && (
                                        <div className="p-3 pt-0 bg-slate-50/50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-700/50">
                                            {description}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <MessageList 
                messages={messages} 
                speakingMessageId={speakingMessageId} 
                isLoadingAudio={isLoadingAudio} 
                onPlayAudio={playMessageAudio} 
                onStopAudio={stopSpeaking} 
                onExit={onExit} 
            />
            
            {showStartButton && !isStreaming && (
                <div className="flex flex-col items-center gap-4 animate-fade-in-up w-full max-w-sm mx-auto">
                    <button onClick={handleStartCourse} className="w-full px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black rounded-2xl shadow-xl hover:scale-105 transition-transform flex items-center justify-center gap-3 active:scale-95 text-lg">
                        <Play className="w-6 h-6 fill-current" />
                        {t('chat.start_button')}
                    </button>
                </div>
            )}

            {isStreaming && (
                <div className="flex justify-start animate-fade-in-up">
                    <div className="w-10 h-10 mr-3"></div>
                    <div className="bg-white dark:bg-slate-800 px-4 py-3 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-3">
                        <div className="flex gap-1 shrink-0">
                            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></div>
                            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-75"></div>
                            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150"></div>
                        </div>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 animate-pulse min-w-[120px]">
                            {loadingText}
                        </span>
                    </div>
                </div>
            )}
            <div ref={scrollRef} className="h-4" />
        </div>
      </main>

      {/* --- FOOTER --- */}
      <footer className="shrink-0 w-full bg-white/95 dark:bg-[#131825]/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 safe-bottom z-30 shadow-2xl">
        <div className="max-w-3xl mx-auto p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 px-2">
                <span className="text-[10px] font-black text-indigo-500 dark:text-indigo-400 uppercase min-w-[30px]">{progressData.currentLevel}</span>
                <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative border border-slate-200 dark:border-slate-700">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all duration-1000 ease-out" style={{ width: `${progressData.percentage}%` }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-black/50 px-1.5 rounded-full backdrop-blur-sm">{progressData.percentage}%</span>
                    </div>
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase min-w-[30px] text-right">{progressData.nextLevel}</span>
            </div>

            <ChatInput 
                input={input}
                setInput={setInput}
                onSend={processMessage}
                onTranslate={async (text) => {
                    if (!user || !text.trim()) return;
                    const targetLang = user.preferences?.targetLanguage || 'English';
                    const prompt = `Translate the following text to ${targetLang}. Return ONLY the translated text, nothing else. Text: "${text}"`;
                    try {
                        const translated = await generateText(prompt);
                        if (translated) {
                            setInput(translated.trim());
                        }
                    } catch {
                        notify(t('chat.translation_error'), "error");
                    }
                }}
                isStreaming={isStreaming}
                isLowCredits={isLowCredits}
                onConfirmNextLesson={(lesson) => {
                    if (lesson.trim()) {
                        processMessage(`Commence la Leçon ${lesson}`); 
                    }
                }}
                onStartVoiceCall={handleVoiceCallClick}
                suggestedNextLesson={currentLessonNum + 1}
            />
        </div>
      </footer>

      {/* Voice Call Confirmation Modal */}
      {showVoiceCallConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-fade-in-up border border-slate-200 dark:border-slate-700">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2 flex items-center gap-2">
                      <Phone className="w-5 h-5 text-purple-500" />
                      {t('dashboard.start_voice') || 'Appel Vocal'}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
                      Voulez-vous vraiment lancer un appel vocal ? Cela consommera {CREDIT_COSTS.VOICE_CALL} crédits.
                  </p>
                  <div className="flex justify-end gap-3">
                      <button onClick={() => setShowVoiceCallConfirm(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                          {t('common.cancel') || 'Annuler'}
                      </button>
                      <button onClick={confirmVoiceCall} className="px-4 py-2 text-sm font-bold text-white bg-purple-500 hover:bg-purple-600 rounded-full transition-colors shadow-md">
                          {t('common.confirm') || 'Confirmer'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default ChatInterface;
