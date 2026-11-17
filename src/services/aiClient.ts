/**
 * Client unique vers l'Edge Function `gemini-api`.
 *
 * Toutes les requêtes IA passent par le serveur : aucune clé Gemini n'est
 * présente dans le navigateur. L'Edge Function vérifie la session, l'état
 * du compte, débite éventuellement les crédits et fait la rotation des clés.
 */
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';

export type AIAction =
    | 'generate'
    | 'generate_stream'
    | 'generate_json'
    | 'generate_exam'
    | 'generate_speech'
    | 'charge_voice_minute'
    | 'live_token'
    | 'board_syllabus'
    | 'board_lesson_open'
    | 'board_step_audio'
    | 'board_question';

/** Usage déclaré au serveur : il détermine le prix (voir pricing.ts côté serveur). */
export type AIPurpose =
    | 'chat_lesson'
    | 'dialogue_message'
    | 'exercise'
    | 'tts_message'
    | 'tts_word'
    | 'tts_exam'
    | 'exam_evaluation'
    | 'vocabulary'
    | 'support'
    | 'cultural'
    | 'translation'
    | 'diagnostic';

export class AIError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = 'AIError';
    }
}

const FUNCTION_PATH = '/functions/v1/gemini-api';

async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
        throw new AIError('Session expirée ou non autorisée. Veuillez vous reconnecter.', 401);
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
    };
}

async function post(action: AIAction, payload: Record<string, unknown>): Promise<Response> {
    const response = await fetch(`${supabaseUrl}${FUNCTION_PATH}`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action, ...payload }),
    });

    if (!response.ok) {
        let message = `Erreur serveur IA (${response.status})`;
        try {
            const data = await response.json();
            message = data.error || data.message || message;
        } catch {
            /* corps non JSON */
        }
        if (response.status === 402) message = `Crédits insuffisants: ${message}`;
        if (response.status === 401) message = 'Session expirée ou non autorisée. Veuillez vous reconnecter.';
        throw new AIError(message, response.status);
    }
    return response;
}

/** Appel JSON simple. Met à jour le solde affiché si le serveur l'a renvoyé. */
export async function callAI<T = Record<string, unknown>>(
    action: AIAction,
    payload: Record<string, unknown> = {}
): Promise<T> {
    const response = await post(action, payload);
    const data = await response.json();
    if (typeof data?.newBalance === 'number') {
        useAppStore.getState().updateUserCredits(data.newBalance);
    }
    return data as T;
}

/** Streaming SSE : renvoie les morceaux de texte au fil de l'eau. */
export async function* streamAI(payload: Record<string, unknown>): AsyncGenerator<string> {
    const response = await post('generate_stream', payload);
    const balance = Number(response.headers.get('x-new-balance'));
    if (response.headers.has('x-new-balance') && Number.isFinite(balance)) {
        useAppStore.getState().updateUserCredits(balance);
    }
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
            const line = evt.split('\n').find(l => l.startsWith('data: '));
            if (!line) continue;
            try {
                const { text } = JSON.parse(line.slice(6));
                if (text) yield text as string;
            } catch {
                /* morceau incomplet ignoré */
            }
        }
    }
}

/** Décode un audio base64 (PCM renvoyé par le TTS) en ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer as ArrayBuffer;
}

export const isCreditError = (e: unknown) => e instanceof AIError && e.status === 402;
export const isRateLimitError = (e: unknown) => e instanceof AIError && e.status === 429;
