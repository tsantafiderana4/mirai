import { useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';

// Initialize the Gemini AI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export type TTSModel = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-2.5-flash-tts';

export const useTTS = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generateSpeech = useCallback(async (text: string, model: TTSModel = 'gemini-2.5-flash-preview-tts', voice: 'Kore' | 'Charon' | 'Puck' | 'Fenrir' | 'Zephyr' = 'Kore') => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voice },
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) {
                throw new Error('No audio data received from the model.');
            }

            // Decode base64 and play
            const audioData = atob(base64Audio);
            const arrayBuffer = new Uint8Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                arrayBuffer[i] = audioData.charCodeAt(i);
            }
            
            const audioBlob = new Blob([arrayBuffer], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            await audio.play();
            
            return audioUrl;
        } catch (err) {
            console.error('TTS Generation Error:', err);
            setError(err instanceof Error ? err.message : 'An unknown error occurred');
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { generateSpeech, isLoading, error };
};
