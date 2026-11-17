import { callAI } from './aiClient';
import { supabase } from '../lib/supabase';
import type { BoardAnswer, BoardLesson, BoardSyllabus, BoardVoiceMode } from '../components/Board/types';

/**
 * Service « Leçon au tableau ». Toute la génération et la facturation se
 * font côté serveur (Edge Function gemini-api) : le client n'envoie que la
 * langue, le niveau et le numéro de leçon.
 */

/** « Anglais 🇬🇧 » → « Anglais » (le serveur valide de toute façon). */
export const languageName = (label: string) => label.trim().split(/\s+/)[0] || label;

export const boardService = {
    getSyllabus(language: string, level: string) {
        return callAI<BoardSyllabus>('board_syllabus', { language: languageName(language), level });
    },

    /** Ouvre une leçon : 5 crédits au premier déblocage, gratuit ensuite. */
    async openLesson(language: string, level: string, lessonNumber: number) {
        const { lesson, alreadyOwned } = await callAI<{ lesson: BoardLesson; alreadyOwned: boolean }>(
            'board_lesson_open', { language: languageName(language), level, lessonNumber }
        );
        return { lesson, alreadyOwned };
    },

    /** URL (signée, 1 h) ou WAV en base64 de la voix d'une étape. */
    async getStepAudio(lessonId: string, stepIndex: number, voiceName?: string): Promise<string> {
        const res = await callAI<{ url?: string; audioWavBase64?: string }>(
            'board_step_audio', { lessonId, stepIndex, voiceName }
        );
        if (res.url) return res.url;
        if (res.audioWavBase64) return wavBase64ToObjectUrl(res.audioWavBase64);
        throw new Error('Audio indisponible');
    },

    /** Question de l'élève pendant la leçon (1 crédit). */
    async ask(lessonId: string, stepIndex: number, question: string, voiceName?: string) {
        const res = await callAI<{ answer: BoardAnswer; audioWavBase64?: string }>(
            'board_question', { lessonId, stepIndex, question, voiceName }
        );
        return {
            answer: res.answer,
            audioUrl: res.audioWavBase64 ? wavBase64ToObjectUrl(res.audioWavBase64) : undefined,
        };
    },

    /** Marque la leçon comme terminée (seule colonne modifiable par l'élève). */
    async markCompleted(lessonId: string, userId: string) {
        await supabase.from('board_lesson_access')
            .update({ completed: true })
            .eq('lesson_id', lessonId)
            .eq('user_id', userId);
    },
};

export function wavBase64ToObjectUrl(b64: string): string {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

// --- Préférence de voix (par appareil) ---------------------------------
const VOICE_KEY = 'tm_board_voice';

export function loadVoiceMode(): BoardVoiceMode {
    try {
        const v = localStorage.getItem(VOICE_KEY);
        if (v === 'premium' || v === 'device' || v === 'off') return v;
    } catch { /* stockage indisponible */ }
    return 'premium';
}

export function saveVoiceMode(mode: BoardVoiceMode) {
    try { localStorage.setItem(VOICE_KEY, mode); } catch { /* ignore */ }
}

// --- Prononciation d'un mot avec la voix du téléphone (gratuit, hors-ligne) --
const BCP47: Record<string, string> = {
    Anglais: 'en-US', Français: 'fr-FR', Chinois: 'zh-CN', Espagnol: 'es-ES',
    Allemand: 'de-DE', Italien: 'it-IT', Portugais: 'pt-PT', Russe: 'ru-RU',
    Japonais: 'ja-JP', Coréen: 'ko-KR', Hindi: 'hi-IN', Arabe: 'ar-SA', Swahili: 'sw-KE',
};

export const langToBcp47 = (language: string) => BCP47[languageName(language)] || 'en-US';

export function canUseDeviceSpeech(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
    if (!canUseDeviceSpeech()) return undefined;
    const voices = window.speechSynthesis.getVoices();
    const base = lang.split('-')[0];
    return voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(base));
}

/** Fait prononcer un mot/une phrase dans la langue étudiée. */
export function pronounce(text: string, language: string) {
    if (!canUseDeviceSpeech() || !text) return;
    const lang = langToBcp47(language);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.85;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
}
