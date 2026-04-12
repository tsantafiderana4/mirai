import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { supabase } from "../lib/supabase";
import { useAppStore } from '../store/useAppStore';
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { CREDIT_COSTS, deductCredits } from "./creditService";

// Cache the API keys to avoid querying DB on every request
let cachedApiKeys: { value: string, failures: number, lastUsed: number }[] = [];
let lastKeyFetch: number = 0;

export async function getGeminiApiKey(): Promise<string> {
    // Refresh cache if empty or older than 5 minutes
    if (cachedApiKeys.length === 0 || Date.now() - lastKeyFetch > 5 * 60 * 1000) {
        try {
            // 1. Try to fetch from dedicated api_keys table
            const { data: tableKeys, error: tableError } = await supabase
                .from('api_keys')
                .select('key_value')
                .eq('is_active', true)
                .eq('provider', 'gemini');

            if (!tableError && tableKeys && tableKeys.length > 0) {
                cachedApiKeys = tableKeys.map(k => ({ 
                    value: k.key_value, 
                    failures: 0, 
                    lastUsed: 0 
                }));
                lastKeyFetch = Date.now();
            } else {
                // 2. Fallback to system_settings
                const { data, error } = await supabase.from('system_settings').select('admin_contact').single();
                if (!error && data?.admin_contact?.apiKeys) {
                    const keys = data.admin_contact.apiKeys;
                    let fetchedKeys: string[] = [];
                    
                    if (keys.geminiKeys && Array.isArray(keys.geminiKeys) && keys.geminiKeys.length > 0) {
                        fetchedKeys = keys.geminiKeys;
                    } else if (keys.gemini) {
                        fetchedKeys = [keys.gemini];
                    }
                    
                    if (fetchedKeys.length > 0) {
                        cachedApiKeys = fetchedKeys.map(k => ({ 
                            value: k, 
                            failures: 0, 
                            lastUsed: 0 
                        }));
                        lastKeyFetch = Date.now();
                    }
                }
            }
        } catch (e) {
            console.warn("Could not fetch API key from DB", e);
        }
    }

    // Fallback to env if still empty
    if (cachedApiKeys.length === 0) {
        const envKey = process.env.GEMINI_API_KEY;
        if (!envKey) {
            throw new Error("Clé API Gemini non configurée.");
        }
        return envKey;
    }

    // Intelligent Rotation: Pick the key with the fewest failures, then the least recently used
    // Filter out keys with too many failures (e.g., > 5)
    const availableKeys = cachedApiKeys.filter(k => k.failures < 5);
    const pool = availableKeys.length > 0 ? availableKeys : cachedApiKeys;

    pool.sort((a, b) => {
        if (a.failures !== b.failures) return a.failures - b.failures;
        return a.lastUsed - b.lastUsed;
    });

    const selected = pool[0];
    selected.lastUsed = Date.now();
    return selected.value;
}

/**
 * Report a failed API key so it can be deprioritized in rotation
 */
export function reportFailedApiKey(keyValue: string) {
    const key = cachedApiKeys.find(k => k.value === keyValue);
    if (key) {
        key.failures++;
        // If many failures, maybe force a refresh sooner
        if (key.failures >= 5) {
            lastKeyFetch = 0; 
        }
    }
}

const SUPPORT_QUOTA_KEY = 'tm_support_quota';

const canUseSupportAgent = (): boolean => {
    const today = new Date().toDateString();
    const raw = localStorage.getItem(SUPPORT_QUOTA_KEY);
    let data = raw ? JSON.parse(raw) : { date: today, count: 0 };
    if (data.date !== today) data = { date: today, count: 0 };
    return data.count < 100;
};

const incrementSupportUsage = () => {
    const today = new Date().toDateString();
    const raw = localStorage.getItem(SUPPORT_QUOTA_KEY);
    let data = raw ? JSON.parse(raw) : { date: today, count: 0 };
    if (data.date !== today) data = { date: today, count: 0 };
    data.count++;
    localStorage.setItem(SUPPORT_QUOTA_KEY, JSON.stringify(data));
};

// --- SERVICES EXPORTÉS ---

// Nouvelle fonction pour facturer le LiveTeacher
export const chargeVoiceMinute = async (userId: string): Promise<boolean> => {
    try {
        const { data: newCredits, error: rpcError } = await supabase.rpc('consume_credits', { 
            p_amount: CREDIT_COSTS.VOICE_CALL_PER_MINUTE
        });
        if (rpcError) {
            console.error('[Billing Error]', rpcError);
            return false;
        }
        if (newCredits !== null) {
            if (typeof newCredits === 'number') {
                useAppStore.getState().updateUserCredits(newCredits);
            } else if (newCredits && typeof newCredits === 'object' && 'current_balance' in newCredits) {
                // Handle case where RPC might return an object (legacy support)
                useAppStore.getState().updateUserCredits((newCredits as { current_balance: number }).current_balance);
            }
        }
        return true;
    } catch (e: unknown) {
        console.error("Erreur de facturation vocale:", e);
        return false;
    }
};

// Modèles par défaut
export const TEXT_MODEL = 'gemini-2.5-flash';
export const AUDIO_MODEL = 'gemini-2.5-flash';

// --- SERVICES EXPORTÉS ---

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

    let apiKey = '';
    try {
        const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
        
        const prompt = `Historique de conversation:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion actuelle: ${userQuery}`;

        apiKey = await getGeminiApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                maxOutputTokens: 2000, 
                temperature: 0.5
            }
        });
        
        incrementSupportUsage();
        return response.text || "Je n'ai pas de réponse pour le moment.";
    } catch (e) {
        if (apiKey) reportFailedApiKey(apiKey);
        console.error("Support error:", e);
        return "Désolé, je rencontre un problème technique momentané. Veuillez réessayer.";
    }
};

// 2. MAIN CHAT (STREAMING VIA SDK)
export async function* sendMessageStream(
  message: string,
  user: UserProfile,
  history: ChatMessage[],
  sessionType: 'lesson' | 'exercise' | 'dialogue' | 'exam' | 'call' = 'lesson'
) {
  if (!user.preferences) throw new Error("Profil incomplet");

  console.log("[Gemini] Stream started via SDK. Model:", TEXT_MODEL);

  // OPTIMIZATION: Limit history to last 15 messages to reduce latency and token usage
  const recentHistory = history.slice(-15);

  // Format history
  const contextPrompt = recentHistory
    .filter(msg => msg.text && msg.text.trim().length > 0)
    .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
    .join('\n\n');

  const finalMessage = contextPrompt ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}` : message;
  
  let apiKey = '';
  try {
      apiKey = await getGeminiApiKey();
      const ai = new GoogleGenAI({ apiKey });

      const responseStream = await ai.models.generateContentStream({
          model: TEXT_MODEL,
          contents: finalMessage,
          config: {
              systemInstruction: SYSTEM_PROMPT_TEMPLATE(user, user.preferences!, sessionType),
              temperature: 0.7,
              maxOutputTokens: 8192,
          }
      });

      for await (const chunk of responseStream) {
          if (chunk.text) {
              yield chunk.text;
          }
      }
      
      console.log("[Gemini] Stream completed successfully.");

      // Deduct credits (1 credit for text generation)
      const newCredits = await deductCredits(CREDIT_COSTS.DIALOGUE_MESSAGE, user.id);
      if (newCredits !== null) {
          useAppStore.getState().updateUserCredits(newCredits);
      }

  } catch (e: any) {
      if (apiKey) reportFailedApiKey(apiKey);
      console.error("[Gemini] Stream exception:", e);
      console.error("[Gemini] Error details:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
      if (e.message === "CREDITS_EXHAUSTED") {
          yield "⛔ **Crédits épuisés.**\n\nVeuillez recharger votre compte pour continuer.";
      } else {
          yield "⚠️ Désolé, le service est temporairement indisponible. Veuillez réessayer dans un instant.";
      }
  }
}

// 3. TEXT-TO-SPEECH (TTS)
export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<ArrayBuffer | null> => {
    const MAX_RETRIES = 3;
    
    // Fonction pour récupérer une clé API de manière dynamique
    const getApiKey = async (): Promise<string> => {
        try {
            return await getGeminiApiKey();
        } catch (e) {
            return '';
        }
    };

    let apiKey = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[Gemini TTS] Generating speech (attempt ${attempt + 1})...`);
            
            apiKey = await getApiKey();
            if (!apiKey) {
                throw new Error("Aucune clé API Gemini disponible.");
            }

            const ai = new GoogleGenAI({ apiKey });

            const response = await ai.models.generateContent({
                model: AUDIO_MODEL,
                contents: [{ parts: [{ text: text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

            if (!base64Audio) {
                throw new Error("No audio data received.");
            }

            // Deduct credits directly via RPC (Reduced to 1 credit)
            /*
            const userId = useAppStore.getState().user?.id;
            if (userId) {
                const newCredits = await deductCredits(CREDIT_COSTS.AUDIO_PRONUNCIATION, userId);
                if (newCredits !== null) {
                    useAppStore.getState().updateUserCredits(newCredits);
                } else {
                    throw new Error("Crédits insuffisants");
                }
            } else {
                throw new Error("Utilisateur non authentifié");
            }
            */

            const binaryString = atob(base64Audio);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            console.log("[Gemini TTS] Audio generated successfully.");
            return bytes.buffer as ArrayBuffer;

        } catch (e) {
            if (apiKey) reportFailedApiKey(apiKey);
            console.warn(`[Gemini TTS] Failed (attempt ${attempt + 1}):`, e);
            if (attempt === MAX_RETRIES) return null;
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    return null;
};

// 4. EXTRACTION VOCABULAIRE
export const extractVocabulary = async (history: ChatMessage[]): Promise<any[]> => {
    const user = useAppStore.getState().user;
    if (!user) return [];

    const context = history.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
    const prompt = `Based on the following conversation, extract 3 to 5 key vocabulary words. Return JSON array [{word, translation, example}].\n${context}`;

    try {
        const apiKey = await getGeminiApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            word: { type: Type.STRING },
                            translation: { type: Type.STRING },
                            example: { type: Type.STRING }
                        }
                    }
                }
            }
        });

        const rawData = JSON.parse(response.text || "[]");
        
        return rawData.map((item: any) => ({
            id: crypto.randomUUID(),
            word: item.word,
            translation: item.translation,
            example: item.example,
            mastered: false,
            addedAt: Date.now()
        }));

    } catch (e) {
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
        // Deduct credits first (1 credit for exercise generation)
        const newCredits = await deductCredits(CREDIT_COSTS.EXERCISE, user.id);
        if (newCredits === null) {
            throw new Error("CREDITS_EXHAUSTED");
        }
        useAppStore.getState().updateUserCredits(newCredits);

        const apiKey = await getGeminiApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
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
        
        const exercises = JSON.parse(response.text || "[]");
        return exercises.map((ex: any) => ({
            ...ex,
            id: ex.id || crypto.randomUUID()
        }));
    } catch (e: any) {
        console.error("generateExerciseFromHistory error:", e);
        if (e.message === "CREDITS_EXHAUSTED") {
            throw new Error("CREDITS_EXHAUSTED");
        }
        return [];
    }
};

// 6. ROLEPLAY
export const generateRoleplayResponse = async (
    history: ChatMessage[],
    scenarioPrompt: string,
    user: UserProfile,
    isClosing: boolean = false,
    isInitial: boolean = false
): Promise<{ aiReply: string; correction?: string; explanation?: string; score?: number; feedback?: string }> => {
    
    const sysInstruct = `Partenaire de jeu de rôle (${user.preferences?.targetLanguage}, ${user.preferences?.level}). Scénario: ${scenarioPrompt}.`;
    
    const contextPrompt = history
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(m => `${m.role}: ${m.text}`)
        .join('\n');
        
    const finalPrompt = isClosing ? `${contextPrompt}\n\nÉvaluation finale` : (contextPrompt || "Start");

    try {
        const apiKey = await getGeminiApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: finalPrompt,
            config: {
                systemInstruction: sysInstruct,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        aiReply: { type: Type.STRING },
                        correction: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                        score: { type: Type.NUMBER },
                        feedback: { type: Type.STRING }
                    },
                    required: ["aiReply"]
                }
            }
        });

        // Deduct credits (1 credit for text generation)
        const newCredits = await deductCredits(CREDIT_COSTS.DIALOGUE_MESSAGE, user.id);
        if (newCredits === null) {
            throw new Error("CREDITS_EXHAUSTED");
        }
        useAppStore.getState().updateUserCredits(newCredits);

        return JSON.parse(response.text || "{}");
    } catch (e: any) {
        if (e.message === "CREDITS_EXHAUSTED") {
            return { aiReply: "⚠️ Crédits insuffisants." };
        }
        return { aiReply: "Problème technique." };
    }
};

// 7. GENERIC TEXT GENERATION
export const generateText = async (prompt: string): Promise<string> => {
    try {
        const apiKey = await getGeminiApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt
        });
        return response.text || "";
    } catch (e) {
        console.error("generateText error:", e);
        return "";
    }
};