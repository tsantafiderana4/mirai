import { useState, useRef, useEffect } from 'react';
import { ChatMessage, UserProfile, LearningSession } from '../types';
import { sendMessageStream } from '../services/geminiService';
import { CREDIT_COSTS } from '../services/creditService';
import { useTranslation } from '../contexts/LanguageContext';

export const useChat = (user: UserProfile | null, session: LearningSession | null, updateSession: (s: LearningSession) => Promise<void>, notify: (m: string, t?: string) => void, onShowPayment: () => void) => {
    const [messages, setMessages] = useState<ChatMessage[]>(session?.messages || []);
    const [isStreaming, setIsStreaming] = useState(false);
    const { t } = useTranslation();

    const processMessage = async (text: string) => {
        if (!user || isStreaming) return;

        const canRequest = user.credits >= CREDIT_COSTS.LESSON;
        if (!canRequest) {
            notify(t('chat.buy_credits'), "error");
            onShowPayment();
            return;
        }

        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text, timestamp: Date.now() };
        const newHistory = [...messages, userMsg];
        setMessages(newHistory);
        setIsStreaming(true);

        try {
            const stream = sendMessageStream(text, user, messages);
            let fullText = "";
            const aiMsgId = (Date.now() + 1).toString();
            setMessages(prev => [...prev, { id: aiMsgId, role: 'model', text: "", timestamp: Date.now() }]);

            for await (const chunk of stream) {
                if (chunk) {
                    fullText += chunk;
                    setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: fullText } : m));
                }
            }
            
            const newMessages = [...newHistory, { id: aiMsgId, role: 'model' as const, text: fullText, timestamp: Date.now() }];
            const updatedSession = { ...session, messages: newMessages, lastActive: Date.now() } as LearningSession;
            await updateSession(updatedSession);
        } catch (_e) {
            notify(t('chat.connection_error'), "error");
        } finally {
            setIsStreaming(false);
        }
    };

    return { messages, setMessages, isStreaming, processMessage };
};
