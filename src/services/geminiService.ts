import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { useAppStore } from '../store/useAppStore';
import { Type } from "@google/genai";
import { callAI, streamAI, base64ToArrayBuffer, isCreditError, AIPurpose } from "./aiClient";

// Toutes les fonctions ci-dessous passent par l'Edge Function `gemini-api`
// (voir aiClient.ts). Le serveur gère la rotation des clés, le repli
// automatique sur d'autres modèles ET la facturation : chaque appel
// indique son usage (`purpose`) et le serveur débite le bon montant.
// Le navigateur ne débite plus jamais de crédits lui-même pour l'IA.

// Modèles par défaut (le serveur essaie ensuite sa propre chaîne de repli)
export const TEXT_MODELS = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-3.1-flash-preview',
    'gemini-2.5-flash-lite',
    'gemini-1.5-flash'
];
export const TEXT_MODEL = TEXT_MODELS[0];
export const AUDIO_MODEL = 'gemini-2.5-flash-preview-tts';

// --- QUOTA AGENT SUPPORT (local) ---
const SUPPORT_QUOTA_KEY = 'tm_support_quota';

const readSupportQuota = () => {
    const today = new Date().toDateString();
    try {
        const raw = localStorage.getItem(SUPPORT_QUOTA_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (data && data.date === today) return data as { date: string; count: number };
    } catch { /* stockage indisponible */ }
    return { date: today, count: 0 };
};

const canUseSupportAgent = (): boolean => readSupportQuota().count < 100;

const incrementSupportUsage = () => {
    const data = readSupportQuota();
    data.count++;
    try { localStorage.setItem(SUPPORT_QUOTA_KEY, JSON.stringify(data)); } catch { /* ignore */ }
};

// --- SERVICES EXPORTÉS ---

/** Facture une minute d'appel vocal (LiveTeacher), côté serveur. */
export const chargeVoiceMinute = async (): Promise<boolean> => {
    try {
        await callAI('charge_voice_minute');
        return true;
    } catch (e: unknown) {
        console.error("Erreur de facturation vocale:", e);
        return false;
    }
};

/** Jeton éphémère (1 session) pour l'API Live, délivré par le serveur. */
export const getLiveToken = async (): Promise<string> => {
    const { token } = await callAI<{ token: string }>('live_token');
    if (!token) throw new Error("Jeton vocal indisponible.");
    return token;
};

// 1. TUTORIAL AGENT (SUPPORT)
export const generateSupportResponse = async (
    userQuery: string,
    context: string,
    user: UserProfile,
    history: {role: string, text: string}[]
): Promise<string> => {

    if (!canUseSupportAgent()) {
        return "⛔ Quota journalier d'aide atteint (100/100). Revenez demain.";
    }

    const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
    const prompt = `Historique de conversation:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion actuelle: ${userQuery}`;

    try {
        const { text } = await callAI<{ text: string }>('generate', {
            purpose: 'support',
            model: TEXT_MODEL,
            contents: prompt,
            config: { systemInstruction, maxOutputTokens: 2000, temperature: 0.5 }
        });
        incrementSupportUsage();
        return text || "Je n'ai pas de réponse pour le moment.";
    } catch (e) {
        console.warn('Support error:', e);
        return "Désolé, je rencontre un problème technique momentané. Veuillez réessayer.";
    }
};

// 2. MAIN CHAT (STREAMING)
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[],
  sessionType: 'lesson' | 'exercise' | 'dialogue' | 'exam' | 'call' = 'lesson',
  overrides?: { language?: string, level?: string }
) {
  if (!user.preferences) throw new Error("Profil incomplet");

  const effectivePrefs = {
      ...user.preferences,
      targetLanguage: overrides?.language || user.preferences.targetLanguage,
      level: overrides?.level || user.preferences.level
  };

  // Limite l'historique aux 15 derniers messages (latence et coût)
  const contextPrompt = history.slice(-15)
    .filter(msg => msg.text && msg.text.trim().length > 0)
    .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
    .join('\n\n');

  const finalMessage = contextPrompt ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}` : message;
  const systemInstruction = SYSTEM_PROMPT_TEMPLATE(user, effectivePrefs, sessionType);

  let success = false;
  try {
      for await (const chunk of streamAI({
          purpose: 'chat_lesson',
          model: TEXT_MODEL,
          contents: finalMessage,
          config: { systemInstruction, temperature: 0.7, maxOutputTokens: 8192 }
      })) {
          success = true;
          yield chunk;
      }
  } catch (e: unknown) {
      console.warn('[Gemini] Stream failed:', e);
      if (isCreditError(e)) {
          throw new Error("CREDITS_EXHAUSTED");
      }
      if (e instanceof Error && e.message && !success) {
          yield `⚠️ ${e.message}`;
          return;
      }
  }

  if (!success) {
      yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer dans un instant.";
  }
}

// 3. TEXT-TO-SPEECH (TTS) — renvoie du PCM brut (24 kHz, 16 bits)
export const generateSpeech = async (
    text: string,
    voiceName: string = 'Kore',
    purpose: Extract<AIPurpose, 'tts_message' | 'tts_word' | 'tts_exam'> = 'tts_message'
): Promise<ArrayBuffer | null> => {
    try {
        const { audioBase64 } = await callAI<{ audioBase64?: string }>('generate_speech', {
            purpose,
            model: AUDIO_MODEL,
            text,
            voiceName: voiceName || 'Kore'
        });
        if (!audioBase64) throw new Error("No audio data received.");
        return base64ToArrayBuffer(audioBase64);
    } catch (e) {
        console.warn('[Gemini TTS] Failed:', e);
        return null;
    }
};

// 4. EXTRACTION VOCABULAIRE
export const extractVocabulary = async (history: ChatMessage[]): Promise<{ id: string; word: string; translation: string; example: string; mastered: boolean; addedAt: number }[]> => {
    const user = useAppStore.getState().user;
    if (!user) return [];

    const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
    const prompt = `Based on the following conversation, extract 3 to 5 key vocabulary words. Return JSON array [{word, translation, example}].\n${context}`;

    try {
        const { json } = await callAI<{ json: { word: string; translation: string; example: string }[] }>('generate_json', {
            purpose: 'vocabulary',
            model: TEXT_MODEL,
            contents: prompt,
            schemaType: 'ARRAY_VOCAB'
        });
        return (Array.isArray(json) ? json : []).map(item => ({
            id: crypto.randomUUID(),
            word: item.word,
            translation: item.translation,
            example: item.example,
            mastered: false,
            addedAt: Date.now()
        }));
    } catch (e: unknown) {
        console.warn('extractVocabulary failed:', e);
        return [];
    }
};

// 5. EXERCICES
export const generateExerciseFromHistory = async (history: ChatMessage[], user: UserProfile): Promise<ExerciseItem[]> => {
    const recentContext = history.slice(-15).map(m => `${m.role === 'user' ? 'Élève' : 'Professeur'}: ${m.text}`).join('\n');

    const prompt = `En tant que professeur de langue expert, génère 5 exercices interactifs basés sur la conversation récente ci-dessous pour un élève de niveau ${user.preferences?.level} apprenant le ${user.preferences?.targetLanguage}.

    CONTEXTE DE LA CONVERSATION:
    ${recentContext}

    INSTRUCTIONS:
    1. Les exercices doivent renforcer le vocabulaire et la grammaire vus dans la conversation.
    2. Varie les types d'exercices : multiple_choice (QCM), fill_blank (phrases à trous), true_false (vrai/faux).
    3. Pour 'fill_blank', la question doit contenir un "___" à l'endroit du mot manquant.
    4. Fournis une explication pédagogique détaillée pour chaque réponse.
    5. Adapte strictement la difficulté au niveau ${user.preferences?.level}.

    Format JSON Array.`;

    try {
        const { json } = await callAI<{ json: ExerciseItem[] }>('generate_json', {
            purpose: 'exercise',
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            type: { type: Type.STRING, enum: ["multiple_choice", "fill_blank", "true_false"] },
                            question: { type: Type.STRING },
                            options: { type: Type.ARRAY, items: { type: Type.STRING } },
                            correctAnswer: { type: Type.STRING },
                            explanation: { type: Type.STRING }
                        },
                        required: ["type", "question", "correctAnswer", "explanation"]
                    }
                }
            }
        });
        return (Array.isArray(json) ? json : []).map(ex => ({ ...ex, id: ex.id || crypto.randomUUID() }));
    } catch (e: unknown) {
        console.warn('generateExerciseFromHistory failed:', e);
        if (isCreditError(e)) throw new Error("CREDITS_EXHAUSTED");
        return [];
    }
};

// 6. ROLEPLAY
export const generateRoleplayResponse = async (
    history: ChatMessage[],
    scenarioPrompt: string,
    user: UserProfile,
    isClosing: boolean = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {

    const systemInstruction = `Partenaire de jeu de rôle (${user.preferences?.targetLanguage}, ${user.preferences?.level}). Scénario: ${scenarioPrompt}.`;

    const contextPrompt = history
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(m => `${m.role}: ${m.text}`)
        .join('\n');

    const finalPrompt = isClosing ? `${contextPrompt}\n\nÉvaluation finale` : (contextPrompt || "Start");

    try {
        const { json } = await callAI<{ json: { aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string } }>('generate_json', {
            purpose: 'dialogue_message',
            model: TEXT_MODEL,
            contents: finalPrompt,
            config: { systemInstruction },
            schemaType: 'OBJECT_ROLEPLAY'
        });

        return json?.aiReply ? json : { aiReply: "Problème technique." };
    } catch (e: unknown) {
        console.warn('generateRoleplayResponse failed:', e);
        if (isCreditError(e)) return { aiReply: "⚠️ Crédits insuffisants." };
        return { aiReply: "Problème technique." };
    }
};

// 7. GENERIC TEXT GENERATION
export const generateText = async (
    prompt: string,
    purpose: Extract<AIPurpose, 'translation' | 'diagnostic'> = 'translation'
): Promise<string> => {
    try {
        const { text } = await callAI<{ text: string }>('generate', { purpose, model: TEXT_MODEL, contents: prompt });
        return text || "";
    } catch (e) {
        console.warn('generateText failed:', e);
        return "";
    }
};
