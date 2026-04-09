import { UserProfile, ChatMessage, ExerciseItem } from "../types";
import { SYSTEM_PROMPT_TEMPLATE, SUPPORT_AGENT_PROMPT } from "../constants";
import { supabase, supabaseUrl, supabaseAnonKey } from "../lib/supabase";
import { useAppStore } from '../store/useAppStore';
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { CREDIT_COSTS, deductCredits } from "./creditService";

// Cache the API keys to avoid querying DB on every request
let cachedApiKeys: string[] = [];
let currentKeyIndex = 0;
let lastKeyFetch: number = 0;

export async function getGeminiApiKey(): Promise<string> {
    // Return cached key if fetched recently (within 5 minutes)
    if (cachedApiKeys.length > 0 && Date.now() - lastKeyFetch < 5 * 60 * 1000) {
        const key = cachedApiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % cachedApiKeys.length;
        return key;
    }

    try {
        // 1. Try to fetch from dedicated api_keys table (New System)
        const { data: tableKeys, error: tableError } = await supabase
            .from('api_keys')
            .select('key_value')
            .eq('is_active', true)
            .eq('provider', 'gemini');

        if (!tableError && tableKeys && tableKeys.length > 0) {
            cachedApiKeys = tableKeys.map(k => k.key_value);
            lastKeyFetch = Date.now();
            currentKeyIndex = 0;
            
            const key = cachedApiKeys[currentKeyIndex];
            currentKeyIndex = (currentKeyIndex + 1) % cachedApiKeys.length;
            return key;
        }

        // 2. Fallback to system_settings (Old System)
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
                cachedApiKeys = fetchedKeys;
                lastKeyFetch = Date.now();
                currentKeyIndex = 0;
                
                const key = cachedApiKeys[currentKeyIndex];
                currentKeyIndex = (currentKeyIndex + 1) % cachedApiKeys.length;
                return key;
            }
        }
    } catch (e) {
        console.warn("Could not fetch API key from DB, falling back to env", e);
    }

    // 3. Fallback to env
    const envKey = process.env.GEMINI_API_KEY;
    if (!envKey) {
        throw new Error("Clé API Gemini non configurée (ni en DB ni en variable d'environnement).");
    }
    return envKey;
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
export const chargeVoiceMinute = async (): Promise<boolean> => {
    try {
        const { data: newCredits, error: rpcError } = await supabase.rpc('consume_credits', { p_amount: CREDIT_COSTS.VOICE_CALL });
        if (rpcError) {
            console.error('[Billing Error]', rpcError);
            return false;
        }
        if (newCredits !== null) {
            if (typeof newCredits === 'number') {
                useAppStore.getState().updateUserCredits(newCredits);
            } else if (typeof (newCredits as any).current_balance === 'number') {
                useAppStore.getState().updateUserCredits((newCredits as any).current_balance);
            }
        }
        return true;
    } catch (e: any) {
        console.error("Erreur de facturation vocale:", e);
        return false;
    }
};

// Modèles par défaut
export const TEXT_MODEL = 'gemini-3-flash-preview';
export const AUDIO_MODEL = 'gemini-2.5-flash-preview-tts';

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

    try {
        const systemInstruction = SUPPORT_AGENT_PROMPT(context, user);
        
        const prompt = `Historique de conversation:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nQuestion actuelle: ${userQuery}`;

        const apiKey = await getGeminiApiKey();
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

  try {
      console.log("[Gemini] Stream started via SDK. Model:", TEXT_MODEL);

      // OPTIMIZATION: Limit history to last 15 messages to reduce latency and token usage
      const recentHistory = history.slice(-15);

      // Format history
      const contextPrompt = recentHistory
        .filter(msg => msg.text && msg.text.trim().length > 0)
        .map(msg => `${msg.role === 'user' ? 'Élève' : 'Professeur'}: ${msg.text}`)
        .join('\n\n');

      const finalMessage = contextPrompt ? `Contexte précédent:\n${contextPrompt}\n\nNouveau message de l'élève: ${message}` : message;
      
      const apiKey = await getGeminiApiKey();
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

      // Deduct credits based on session type
      let cost = 0;
      if (sessionType === 'lesson') cost = CREDIT_COSTS.LESSON;
      else if (sessionType === 'dialogue') cost = CREDIT_COSTS.DIALOGUE_MESSAGE;
      
      if (cost > 0) {
          const newCredits = await deductCredits(cost, user.id);
          if (newCredits !== null) {
              useAppStore.getState().updateUserCredits(newCredits);
          }
      }

  } catch (e: any) {
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[Gemini TTS] Generating speech (attempt ${attempt + 1})...`);
            
            const apiKey = await getApiKey();
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

            // NOTE: Credit deduction is handled by the caller (useAudio hook)
            // to avoid double billing and ensure UI consistency.

            const binaryString = atob(base64Audio);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            console.log("[Gemini TTS] Audio generated successfully.");
            return bytes.buffer as ArrayBuffer;

        } catch (e) {
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

        // Deduct credits (1 credit per question)
        const cost = rawData.length * CREDIT_COSTS.EXERCISE_QUESTION;
        const newCredits = await deductCredits(cost, user.id);
        if (newCredits === null) {
            throw new Error("CREDITS_EXHAUSTED");
        }
        useAppStore.getState().updateUserCredits(newCredits);

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
    const prompt = `Génère 3 exercices (QCM/Vrai-Faux) pour niveau ${user.preferences?.level} (${user.preferences?.targetLanguage}). Format JSON Array.`;

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
                            id: { type: Type.STRING },
                            type: { type: Type.STRING },
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

        // Deduct credits (1 credit per question)
        const cost = exercises.length * CREDIT_COSTS.EXERCISE_QUESTION;
        const newCredits = await deductCredits(cost, user.id);
        if (newCredits === null) {
            throw new Error("CREDITS_EXHAUSTED");
        }
        useAppStore.getState().updateUserCredits(newCredits);

        return exercises;
    } catch (e: any) {
        if (e.message === "CREDITS_EXHAUSTED") {
            throw e;
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

        // Deduct credits (1 credit for dialogue response)
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