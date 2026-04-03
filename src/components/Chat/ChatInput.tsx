import React, { useState } from 'react';
import { Send, Languages, ArrowRight, Check, X } from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';

interface Props {
    input: string;
    setInput: (input: string) => void;
    onSend: (text: string) => void;
    onTranslate: (text: string) => void;
    isStreaming: boolean;
    isLowCredits: boolean;
    onNextLesson: () => void;
    onConfirmNextLesson: (lesson: string) => void;
}

export const ChatInput: React.FC<Props> = ({ input, setInput, onSend, onTranslate, isStreaming, isLowCredits, onNextLesson, onConfirmNextLesson }) => {
    const [showNextInput, setShowNextInput] = useState(false);
    const [nextLessonInput, setNextLessonInput] = useState('');
    const { t } = useTranslation();

    const handleSend = () => { if (input.trim()) onSend(input); setInput(''); };

    return (
        <div className={`flex items-end gap-2 bg-slate-100 dark:bg-slate-800 p-2 rounded-[1.5rem] border transition-all shadow-inner ${isLowCredits ? 'border-red-500/50' : 'border-transparent focus-within:border-indigo-500/30'}`}>
            <textarea
                value={input}
                onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = '40px';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => { 
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { 
                        e.preventDefault(); 
                        handleSend(); 
                    }
                }}
                placeholder={isLowCredits ? t('chat.low_credits_warning') : t('chat.placeholder')}
                className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-white text-sm px-2 resize-none max-h-32 placeholder:text-slate-400 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                rows={1}
                style={{ minHeight: '40px', height: '40px' }}
                disabled={isLowCredits}
            />
            
            <button 
                onClick={() => onTranslate(input)}
                className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition-colors text-slate-400 hover:text-indigo-500 hover:bg-indigo-50" 
                title={t('chat.translate_help')}
            >
                <Languages className="w-5 h-5" />
            </button>

            {input.trim().length === 0 ? (
                showNextInput ? (
                    <div className="h-10 flex items-center gap-1 bg-white dark:bg-slate-900 rounded-full px-1 border border-indigo-500/30 animate-fade-in shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase pl-2">{t('dashboard.lessons')}</span>
                        <input type="number" value={nextLessonInput} onChange={(e) => setNextLessonInput(e.target.value)} className="w-10 bg-transparent font-black text-indigo-600 dark:text-indigo-400 outline-none text-center text-sm" autoFocus onKeyDown={(e) => { if(e.key === 'Enter') onConfirmNextLesson(nextLessonInput); }} />
                        <button onClick={() => onConfirmNextLesson(nextLessonInput)} className="p-1.5 bg-indigo-600 rounded-full text-white hover:bg-indigo-700 transition-colors"><Check size={14}/></button>
                        <button onClick={() => setShowNextInput(false)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><X size={14}/></button>
                    </div>
                ) : (
                    <button onClick={onNextLesson} disabled={isStreaming} className="h-10 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                        {t('common.next')} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                )
            ) : (
                <button onClick={handleSend} disabled={isStreaming} className="h-10 w-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md transition-all active:scale-95 flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Send className="w-4 h-4 ml-0.5" />
                </button>
            )}
        </div>
    );
};
