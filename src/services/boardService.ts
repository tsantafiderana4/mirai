import { callAI } from './aiClient';
import { supabase } from '../lib/supabase';
import type { BoardAnswer, BoardLesson, BoardLessonReport, BoardSyllabus, BoardVoiceMode, ReviewWord } from '../components/Board/types';
import * as Offline from './boardOffline';

/**
 * Service « Leçon au tableau ». Toute la génération et la facturation se
 * font côté serveur (Edge Function gemini-api) : le client n'envoie que la
 * langue, le niveau et le numéro de leçon.
 */

/** « Anglais 🇬🇧 » → « Anglais » (le serveur valide de toute façon). */
export const languageName = (label: string) => label.trim().split(/\s+/)[0] || label;

export const boardService = {
    /** Programme ; sans Internet, la dernière version gardée sur le téléphone. */
    async getSyllabus(language: string, level: string): Promise<BoardSyllabus> {
        try {
            const s = await callAI<BoardSyllabus>('board_syllabus', { language: languageName(language), level });
            Offline.saveSyllabus(s);
            return s;
        } catch (e) {
            if (Offline.isNetworkError(e)) {
                const cached = await Offline.loadSyllabus(language, level);
                if (cached) return { ...cached, offline: true };
            }
            throw e;
        }
    },

    /**
     * Ouvre une leçon : 5 crédits au premier déblocage, gratuit ensuite. La
     * leçon est gardée sur le téléphone ; sans Internet, c'est cette copie
     * qui s'ouvre (OfflineUnavailableError si elle n'a jamais été ouverte).
     */
    async openLesson(language: string, level: string, lessonNumber: number) {
        try {
            const { lesson, alreadyOwned } = await callAI<{ lesson: BoardLesson; alreadyOwned: boolean }>(
                'board_lesson_open', { language: languageName(language), level, lessonNumber }
            );
            Offline.saveLesson(lesson);
            return { lesson, alreadyOwned, offline: false };
        } catch (e) {
            if (!Offline.isNetworkError(e)) throw e;
            const cached = await Offline.loadLesson(language, level, lessonNumber);
            if (!cached) throw new Offline.OfflineUnavailableError();
            return { lesson: cached, alreadyOwned: true, offline: true };
        }
    },

    /**
     * Voix d'une étape, prête à jouer (URL blob locale).
     * 1. Cache du téléphone : si l'étape a déjà été écoutée, rien n'est
     *    téléchargé ni demandé au serveur (data, trafic et quotas épargnés).
     * 2. Sinon : le serveur renvoie une URL signée (MP3 en cache côté
     *    Supabase) ou l'audio en base64 ; on le garde ensuite sur le téléphone.
     */
    async getStepAudio(lessonId: string, stepIndex: number, voiceName?: string, say = ''): Promise<string> {
        // Le texte parlé fait partie de la clé : une étape corrigée par l'admin
        // n'est jamais rejouée avec l'ancienne voix gardée sur le téléphone.
        const cacheKey = audioCacheKey(lessonId, stepIndex, voiceName || 'Kore', say);
        const cached = await readCachedAudio(cacheKey);
        if (cached) return URL.createObjectURL(cached);

        const res = await callAI<{ url?: string; audioBase64?: string; audioMime?: string; audioWavBase64?: string }>(
            'board_step_audio', { lessonId, stepIndex, voiceName }
        );
        let blob: Blob | null = null;
        if (res.audioBase64) blob = base64ToBlob(res.audioBase64, res.audioMime || 'audio/mpeg');
        else if (res.audioWavBase64) blob = base64ToBlob(res.audioWavBase64, 'audio/wav');
        else if (res.url) {
            try {
                const r = await fetch(res.url);
                if (r.ok) blob = await r.blob();
            } catch { /* lecture directe de l'URL ci-dessous */ }
            if (!blob) return res.url;
        }
        if (!blob) throw new Error('Audio indisponible');
        await writeCachedAudio(cacheKey, blob);
        return URL.createObjectURL(blob);
    },

    /** Question de l'élève pendant la leçon (1 crédit). */
    async ask(lessonId: string, stepIndex: number, question: string, voiceName?: string) {
        const res = await callAI<{ answer: BoardAnswer; audioBase64?: string; audioMime?: string; audioWavBase64?: string }>(
            'board_question', { lessonId, stepIndex, question, voiceName }
        );
        const b64 = res.audioBase64 || res.audioWavBase64;
        const mime = res.audioBase64 ? (res.audioMime || 'audio/mpeg') : 'audio/wav';
        return {
            answer: res.answer,
            audioUrl: b64 ? URL.createObjectURL(base64ToBlob(b64, mime)) : undefined,
        };
    },

    /** Marque la leçon comme terminée (envoyé plus tard si hors ligne). */
    async markCompleted(lessonId: string, userId: string) {
        await Offline.sendOrQueue({ kind: 'complete', lessonId, userId });
    },

    /**
     * Télécharge toutes les voix d'une leçon sur le téléphone (hors ligne).
     * Renvoie le nombre d'étapes dont la voix n'a pas pu être gardée.
     */
    async downloadLesson(lesson: BoardLesson, voiceName: string | undefined, onProgress: (done: number, total: number) => void): Promise<number> {
        const voice = voiceName || 'Kore';
        let missing = 0;
        const total = lesson.steps.length;
        for (let i = 0; i < total; i++) {
            const say = lesson.steps[i].say;
            if (!(await hasCachedAudio(lesson.id, i, voice, say))) {
                try {
                    const url = await this.getStepAudio(lesson.id, i, voice, say);
                    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
                } catch { /* compté ci-dessous */ }
                if (!(await hasCachedAudio(lesson.id, i, voice, say))) missing++;
            }
            onProgress(i + 1, total);
        }
        return missing;
    },

    /** Nombre d'étapes dont la voix est déjà sur le téléphone. */
    async cachedAudioCount(lesson: BoardLesson, voiceName?: string): Promise<number> {
        const voice = voiceName || 'Kore';
        let n = 0;
        for (let i = 0; i < lesson.steps.length; i++) if (await hasCachedAudio(lesson.id, i, voice, lesson.steps[i].say)) n++;
        return n;
    },

    // --- Mini-test -------------------------------------------------------
    /** Enregistre le score (0-100) ; renvoie le meilleur score de l'élève. */
    async saveTestScore(lessonId: string, score: number): Promise<number | null> {
        const res = await Offline.sendOrQueue({ kind: 'rpc', fn: 'board_save_test_score', args: { p_lesson_id: lessonId, p_score: Math.round(score) } });
        return res.queued ? null : (res.data as number | null);
    },

    // --- « Mes mots » (révision espacée) -------------------------------------
    /** Ajoute le vocabulaire de la leçon (lu côté serveur) ; renvoie le nombre de mots ajoutés. */
    async addLessonWords(lessonId: string): Promise<number> {
        const res = await Offline.sendOrQueue({ kind: 'rpc', fn: 'board_words_add', args: { p_lesson_id: lessonId } });
        return res.queued ? 0 : ((res.data as number) ?? 0);
    },

    /** Nombre de mots à revoir maintenant et nombre total, pour une langue. */
    async wordStats(language: string): Promise<{ due: number; total: number }> {
        const lang = languageName(language);
        const [due, total] = await Promise.all([
            supabase.from('board_word_reviews').select('id', { count: 'exact', head: true }).eq('language', lang).lte('due_at', new Date().toISOString()),
            supabase.from('board_word_reviews').select('id', { count: 'exact', head: true }).eq('language', lang),
        ]);
        const err = due.error || total.error;
        if (err) {
            const cached = Offline.isNetworkError(err) ? Offline.offlineWordStats(language) : null;
            if (cached) return cached;
            throw err;
        }
        Offline.saveWordsTotal(language, total.count ?? 0);
        return { due: due.count ?? 0, total: total.count ?? 0 };
    },

    /** Mots à revoir (les plus en retard d'abord). */
    async dueWords(language: string, limit = 20): Promise<ReviewWord[]> {
        const { data, error } = await supabase.from('board_word_reviews')
            .select('id, language, target, phonetic, fr, mg, box, due_at')
            .eq('language', languageName(language))
            .lte('due_at', new Date().toISOString())
            .order('due_at', { ascending: true })
            .limit(limit);
        if (error) {
            if (Offline.isNetworkError(error)) return Offline.offlineDueWords(language).slice(0, limit);
            throw error;
        }
        const words = (data ?? []) as ReviewWord[];
        Offline.saveWordsSnapshot(language, words);
        return words;
    },

    /** Prochaine date de révision (quand rien n'est à revoir). */
    async nextDueAt(language: string): Promise<string | null> {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
        const { data } = await supabase.from('board_word_reviews')
            .select('due_at').eq('language', languageName(language))
            .order('due_at', { ascending: true }).limit(1).maybeSingle();
        return (data?.due_at as string | undefined) ?? null;
    },

    async reviewWord(id: string, known: boolean) {
        Offline.markWordReviewedLocally(id);
        await Offline.sendOrQueue({ kind: 'rpc', fn: 'board_word_review', args: { p_id: id, p_known: known } });
    },

    // --- Signalements ------------------------------------------------------
    async report(lessonId: string, stepIndex: number | null, message: string) {
        const { error } = await supabase.rpc('board_report', { p_lesson_id: lessonId, p_step_index: stepIndex, p_message: message });
        if (error) throw error;
    },

    // --- Administration (réservé à l'admin, vérifié côté serveur) ---------
    admin: {
        async listLessons() {
            const { data, error } = await supabase.from('board_lessons')
                .select('id, language, level, lesson_number, title, created_at')
                .order('language').order('level').order('lesson_number');
            if (error) throw error;
            return (data ?? []) as { id: string; language: string; level: string; lesson_number: number; title: string; created_at: string }[];
        },

        async loadLesson(id: string): Promise<BoardLesson> {
            const { data, error } = await supabase.from('board_lessons')
                .select('id, language, level, lesson_number, content').eq('id', id).single();
            if (error) throw error;
            return { id: data.id, language: data.language, level: data.level, number: data.lesson_number, ...(data.content as Omit<BoardLesson, 'id' | 'language' | 'level' | 'number'>) };
        },

        async listReports(status: 'open' | 'resolved' = 'open'): Promise<BoardLessonReport[]> {
            const { data, error } = await supabase.from('board_lesson_reports')
                .select('id, lesson_id, step_index, message, status, created_at, board_lessons(title, language, level, lesson_number)')
                .eq('status', status)
                .order('created_at', { ascending: false })
                .limit(100);
            if (error) throw error;
            return (data ?? []) as unknown as BoardLessonReport[];
        },

        async resolveReport(id: string) {
            const { error } = await supabase.from('board_lesson_reports')
                .update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
            if (error) throw error;
        },

        /** Enregistre une leçon corrigée (validée côté serveur, audio modifié supprimé). */
        save(lesson: BoardLesson) {
            const content = {
                title: lesson.title, titleMg: lesson.titleMg, objective: lesson.objective, objectiveMg: lesson.objectiveMg,
                steps: lesson.steps, summary: lesson.summary, summaryMg: lesson.summaryMg,
            };
            return callAI<{ lesson: BoardLesson; removedAudio: number }>('board_admin_save', { lessonId: lesson.id, content });
        },

        /** Fait réécrire entièrement la leçon par Gemini (quota texte, pas de crédits). */
        regenerate(lessonId: string) {
            return callAI<{ lesson: BoardLesson; removedAudio: number }>('board_admin_regenerate', { lessonId });
        },
    },
};

export function base64ToBlob(b64: string, mime: string): Blob {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

// --- Cache audio sur le téléphone (Cache Storage) -----------------------
// ~45 Ko par étape en MP3 : 400 étapes ≈ 18 Mo maximum sur le téléphone.
const AUDIO_CACHE = 'tm-board-audio-v1';
const AUDIO_CACHE_MAX_ENTRIES = 400;

/** Empreinte courte d'un texte (FNV-1a 32 bits). */
export function textHash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

const audioCacheKey = (lessonId: string, stepIndex: number, voice: string, say: string) =>
    `/__board-audio__/${lessonId}/${stepIndex}-${voice}-${textHash(say)}`;

async function readCachedAudio(key: string): Promise<Blob | null> {
    try {
        if (typeof caches === 'undefined') return null;
        const cache = await caches.open(AUDIO_CACHE);
        const hit = await cache.match(key);
        return hit ? await hit.blob() : null;
    } catch {
        return null; // navigation privée, stockage plein… : on télécharge simplement
    }
}

async function hasCachedAudio(lessonId: string, stepIndex: number, voice: string, say: string): Promise<boolean> {
    try {
        if (typeof caches === 'undefined') return false;
        return !!(await (await caches.open(AUDIO_CACHE)).match(audioCacheKey(lessonId, stepIndex, voice, say)));
    } catch {
        return false;
    }
}

async function writeCachedAudio(key: string, blob: Blob): Promise<void> {
    try {
        if (typeof caches === 'undefined') return;
        const cache = await caches.open(AUDIO_CACHE);
        await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
        const keys = await cache.keys();
        // Les entrées les plus anciennes sont retirées en premier
        for (const old of keys.slice(0, Math.max(0, keys.length - AUDIO_CACHE_MAX_ENTRIES))) await cache.delete(old);
    } catch { /* cache facultatif */ }
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
