import { useState, useRef, useEffect } from 'react';
import { UserProfile } from '../types';
import { generateSpeech } from '../services/geminiService';
import { CREDIT_COSTS, deductCredits } from '../services/creditService';
import { useTranslation } from '../contexts/LanguageContext';

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

export const useAudio = (user: UserProfile | null, notify: (m: string, t?: string) => void, onShowPayment: () => void) => {
    const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
    const [currentSource, setCurrentSource] = useState<AudioBufferSourceNode | null>(null);
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const { t } = useTranslation();

    const stopSpeaking = () => {
        if (currentSource) {
            try { currentSource.stop(); } catch (_e) { /* ignore */ }
            setCurrentSource(null);
        }
        window.speechSynthesis.cancel();
        setSpeakingMessageId(null);
        setIsLoadingAudio(false);
    };

    const playMessageAudio = async (text: string, id: string, cost: number = CREDIT_COSTS.AUDIO_MESSAGE) => {
        if (!user) return;
        if (speakingMessageId === id) {
            stopSpeaking();
            return;
        }
        const canPlay = user.credits >= cost;
        if (!canPlay) {
            notify(t('chat.insufficient_credits'), "error");
            onShowPayment();
            return;
        }
        
        // Deduct credits
        try {
            await deductCredits(cost, user.id);
        } catch (e) {
            notify(t('chat.credit_deduction_error'), "error");
            return;
        }

        stopSpeaking();
        setIsLoadingAudio(true);
        setSpeakingMessageId(id);

        try {
            const cleanText = text.replace(/[#*`_]/g, '').replace(/\[Leçon \d+\]/gi, '');
            const pcmBuffer = await generateSpeech(cleanText, user.preferences?.voiceName || 'Kore');
            
            if (!pcmBuffer) {
                const utterance = new SpeechSynthesisUtterance(cleanText);
                const voices = window.speechSynthesis.getVoices();
                const targetLang = user.preferences?.targetLanguage || 'en-US';
                const langCode = targetLang.toLowerCase().includes('fr') ? 'fr-FR' : 
                                 targetLang.toLowerCase().includes('es') ? 'es-ES' : 
                                 targetLang.toLowerCase().includes('de') ? 'de-DE' : 'en-US';
                
                utterance.lang = langCode;
                const voice = voices.find(v => v.lang.startsWith(langCode));
                if (voice) utterance.voice = voice;
                
                utterance.onend = () => { setSpeakingMessageId(null); };
                utterance.onerror = () => { setSpeakingMessageId(null); notify(t('chat.audio_error'), "error"); };
                
                window.speechSynthesis.speak(utterance);
                return;
            }
            
            let ctx = audioContext;
            if (!ctx) {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                ctx = new AudioContextClass({sampleRate: 24000});
                setAudioContext(ctx);
            }
            if (ctx.state === 'suspended') await ctx.resume();

            const audioBuffer = pcmToAudioBuffer(new Uint8Array(pcmBuffer), ctx, 24000);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            source.onended = () => { setSpeakingMessageId(null); setCurrentSource(null); };
            source.start(0);
            setCurrentSource(source);
        } catch (e) {
            notify(t('chat.audio_error'), "error");
            setSpeakingMessageId(null);
        } finally {
            setIsLoadingAudio(false);
        }
    };

    return { speakingMessageId, isLoadingAudio, playMessageAudio, stopSpeaking };
};
