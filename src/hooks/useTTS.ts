import { useState, useCallback } from 'react';
import { generateSpeech as fetchSpeech } from '../services/geminiService';

export type TTSModel = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-2.5-flash-tts';

const SAMPLE_RATE = 24000; // le TTS Gemini renvoie du PCM 16 bits mono 24 kHz

/**
 * Lecture vocale d'un texte (utilisée pour les retours d'examen : gratuite).
 * L'audio est généré côté serveur (Edge Function),
 * puis joué via Web Audio (PCM brut, pas un fichier WAV).
 * Le paramètre `model` est conservé pour compatibilité ; le serveur choisit
 * le modèle TTS disponible.
 */
export const useTTS = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generateSpeech = useCallback(async (
        text: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _model: TTSModel = 'gemini-2.5-flash-preview-tts',
        voice: 'Kore' | 'Charon' | 'Puck' | 'Fenrir' | 'Zephyr' = 'Kore'
    ) => {
        setIsLoading(true);
        setError(null);

        try {
            const pcm = await fetchSpeech(text, voice, 'tts_exam');
            if (!pcm) throw new Error('Aucun audio reçu.');

            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
            const pcm16 = new Int16Array(pcm);
            const buffer = ctx.createBuffer(1, pcm16.length, SAMPLE_RATE);
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i] / 32768;

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.onended = () => { ctx.close().catch(() => {}); };
            source.start();
            return true;
        } catch (err) {
            console.error('TTS Generation Error:', err);
            setError(err instanceof Error ? err.message : 'Erreur inconnue');
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { generateSpeech, isLoading, error };
};
