import React from 'react';
import { ChatMessage } from '../../types';
import MarkdownRenderer from '../MarkdownRenderer';
import { Volume2, Loader2, StopCircle } from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';
import { CREDIT_COSTS } from '../../services/creditService';

interface Props {
    msg: ChatMessage;
    speakingMessageId: string | null;
    isLoadingAudio: boolean;
    onPlayAudio: (text: string, id: string, cost: number) => void;
    onStopAudio: () => void;
    onExit: () => void;
}

const TEACHER_AVATAR = "https://i.ibb.co/B2XmRwmJ/logo.png";

export const MessageItem: React.FC<Props> = ({ msg, speakingMessageId, isLoadingAudio, onPlayAudio, onStopAudio, onExit }) => {
    const { t } = useTranslation();
    
    return (
        <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up group`}>
            {msg.role === 'model' && (
                <div 
                    onClick={onExit}
                    title="Retour à l'accueil"
                    className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mr-3 mt-1 shrink-0 overflow-hidden shadow-sm cursor-pointer hover:scale-110 transition-transform"
                >
                    <img src={TEACHER_AVATAR} className="w-full h-full object-cover p-1" />
                </div>
            )}
            <div className={`max-w-[90%] md:max-w-[80%] p-5 rounded-2xl text-sm leading-relaxed shadow-sm transition-all duration-200 ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm shadow-indigo-500/20 [&_*]:text-white' : 'bg-white dark:bg-[#131825] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-tl-sm'}`}>
                <MarkdownRenderer content={msg.text.replace(/\[Leçon \d+\]/g, '')} onPlayAudio={(text) => onPlayAudio(text, msg.id + text, CREDIT_COSTS.AUDIO_PRONUNCIATION)} />
                {msg.role === 'model' && (
                    <div className="mt-2 flex justify-end">
                            <button 
                            onClick={() => speakingMessageId === msg.id ? onStopAudio() : onPlayAudio(msg.text, msg.id, CREDIT_COSTS.AUDIO_MESSAGE)} 
                            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-2 ${speakingMessageId === msg.id ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-100'}`}
                            title="Écouter tout le message"
                        >
                            <span className="text-xs font-bold">{t('common.listen')}</span>
                            {isLoadingAudio && speakingMessageId === msg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : speakingMessageId === msg.id ? <StopCircle className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                            </button>
                    </div>
                )}
            </div>
        </div>
    );
};
