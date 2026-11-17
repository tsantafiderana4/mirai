// =====================================================================
// « Leçon au tableau » hors ligne.
//
// - Le programme et chaque leçon ouverte sont gardés sur le téléphone
//   (Cache Storage, quelques Ko par leçon) : sans Internet, l'élève revoit
//   ses leçons, fait le mini-test et révise « Mes mots ».
// - Les progrès faits hors ligne (leçon terminée, score, mots, révisions)
//   sont mis en file d'attente et envoyés au retour d'Internet.
// L'audio des étapes a son propre cache (boardService.ts).
// =====================================================================
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BoardLesson, BoardSyllabus, ReviewWord } from '../components/Board/types';

const DATA_CACHE = 'tm-board-data-v1';
const MAX_LESSONS = 80;
const OUTBOX_KEY = 'tm_board_outbox_v1';
const WORDS_KEY = 'tm_board_words_v1';

const lang = (label: string) => label.trim().split(/\s+/)[0] || label;
const lessonPath = (language: string, level: string, n: number) =>
    `/__board-lesson__/${encodeURIComponent(`${lang(language)}|${level}|${n}`)}`;
const syllabusPath = (language: string, level: string) =>
    `/__board-syllabus__/${encodeURIComponent(`${lang(language)}|${level}`)}`;

/** Erreur réseau (pas d'Internet, coupure) — par opposition à un refus du serveur. */
export function isNetworkError(e: unknown): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (e instanceof TypeError) return true;
    const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
    return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg);
}

/** Leçon demandée hors ligne mais jamais ouverte sur ce téléphone. */
export class OfflineUnavailableError extends Error {
    constructor() { super('Leçon non disponible hors ligne'); }
}

async function putJson(path: string, value: unknown) {
    try {
        if (typeof caches === 'undefined') return;
        const cache = await caches.open(DATA_CACHE);
        await cache.put(path, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
    } catch { /* stockage facultatif */ }
}

async function getJson<T>(path: string): Promise<T | null> {
    try {
        if (typeof caches === 'undefined') return null;
        const hit = await (await caches.open(DATA_CACHE)).match(path);
        return hit ? (await hit.json()) as T : null;
    } catch {
        return null;
    }
}

export async function saveSyllabus(s: BoardSyllabus) {
    await putJson(syllabusPath(s.language, s.level), { ...s, offline: undefined });
}

export const loadSyllabus = (language: string, level: string) =>
    getJson<BoardSyllabus>(syllabusPath(language, level));

export async function saveLesson(lesson: BoardLesson) {
    await putJson(lessonPath(lesson.language, lesson.level, lesson.number), lesson);
    try {
        const cache = await caches.open(DATA_CACHE);
        const keys = (await cache.keys()).filter(r => r.url.includes('/__board-lesson__/'));
        // Les plus anciennes leçons gardées sont retirées en premier
        for (const old of keys.slice(0, Math.max(0, keys.length - MAX_LESSONS))) await cache.delete(old);
    } catch { /* ignore */ }
}

export const loadLesson = (language: string, level: string, n: number) =>
    getJson<BoardLesson>(lessonPath(language, level, n));

/** Numéros des leçons de ce programme disponibles sur le téléphone. */
export async function offlineLessonNumbers(language: string, level: string): Promise<Set<number>> {
    const out = new Set<number>();
    try {
        if (typeof caches === 'undefined') return out;
        const prefix = `/__board-lesson__/${encodeURIComponent(`${lang(language)}|${level}|`)}`;
        for (const req of await (await caches.open(DATA_CACHE)).keys()) {
            const path = new URL(req.url).pathname;
            if (path.startsWith(prefix)) out.add(Number(decodeURIComponent(path).split('|').pop()));
        }
    } catch { /* ignore */ }
    return out;
}

// --- « Mes mots » hors ligne -------------------------------------------
interface WordsSnapshot { words: ReviewWord[]; total: number }

function readWords(): Record<string, WordsSnapshot> {
    try { return JSON.parse(localStorage.getItem(WORDS_KEY) || '{}'); } catch { return {}; }
}

export function saveWordsSnapshot(language: string, words: ReviewWord[], total?: number) {
    try {
        const all = readWords();
        const prev = all[lang(language)];
        all[lang(language)] = { words: words.slice(0, 50), total: total ?? prev?.total ?? words.length };
        localStorage.setItem(WORDS_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
}

export function saveWordsTotal(language: string, total: number) {
    const snap = readWords()[lang(language)];
    saveWordsSnapshot(language, snap?.words ?? [], total);
}

/** Mots à revoir maintenant, d'après la dernière liste reçue du serveur. */
export function offlineDueWords(language: string): ReviewWord[] {
    const now = new Date().toISOString();
    return (readWords()[lang(language)]?.words ?? []).filter(w => w.due_at <= now);
}

export function offlineWordStats(language: string): { due: number; total: number } | null {
    const snap = readWords()[lang(language)];
    return snap ? { due: offlineDueWords(language).length, total: snap.total } : null;
}

/** Après une révision : la carte ne revient pas avant le lendemain (même hors ligne). */
export function markWordReviewedLocally(id: string) {
    try {
        const all = readWords();
        const tomorrow = new Date(Date.now() + 20 * 3600e3).toISOString();
        for (const k of Object.keys(all)) {
            all[k].words = all[k].words.map(w => (w.id === id ? { ...w, due_at: tomorrow } : w));
        }
        localStorage.setItem(WORDS_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
}

// --- File d'attente des progrès faits hors ligne -------------------------
export type OutboxItem =
    | { kind: 'rpc'; fn: 'board_save_test_score' | 'board_words_add' | 'board_word_review'; args: Record<string, unknown> }
    | { kind: 'complete'; lessonId: string; userId: string };

function readOutbox(): OutboxItem[] {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
}

function writeOutbox(items: OutboxItem[]) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-300))); } catch { /* ignore */ }
}

export function enqueue(item: OutboxItem) {
    writeOutbox([...readOutbox(), item]);
}

export const pendingCount = () => readOutbox().length;

async function send(item: OutboxItem): Promise<{ error: unknown }> {
    if (item.kind === 'complete') {
        const { error } = await supabase.from('board_lesson_access')
            .update({ completed: true }).eq('lesson_id', item.lessonId).eq('user_id', item.userId);
        return { error };
    }
    const { error } = await supabase.rpc(item.fn, item.args);
    return { error };
}

let flushing = false;
/** Envoie les progrès en attente, dans l'ordre. S'arrête à la première coupure réseau. */
export async function flushOutbox(): Promise<number> {
    if (flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
    flushing = true;
    let sent = 0;
    try {
        let items = readOutbox();
        while (items.length) {
            const { error } = await send(items[0]);
            if (error && isNetworkError(error)) break;
            // Envoyé, ou refusé par le serveur (inutile de réessayer indéfiniment)
            items = items.slice(1);
            writeOutbox(items);
            if (!error) sent++;
        }
    } finally {
        flushing = false;
    }
    return sent;
}

/** Appel Supabase « au mieux » : hors ligne, il part dans la file d'attente. */
export async function sendOrQueue(item: OutboxItem): Promise<{ queued: boolean; data?: unknown }> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueue(item);
        return { queued: true };
    }
    if (item.kind === 'complete') {
        const { error } = await send(item);
        if (error && isNetworkError(error)) { enqueue(item); return { queued: true }; }
        if (error) throw error;
        return { queued: false };
    }
    const { data, error } = await supabase.rpc(item.fn, item.args);
    if (error && isNetworkError(error)) { enqueue(item); return { queued: true }; }
    if (error) throw error;
    return { queued: false, data };
}

/** État de la connexion, mis à jour en direct. */
export function useOnline(): boolean {
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    }, []);
    return online;
}
