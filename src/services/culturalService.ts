import { Type } from "@google/genai";
import { CulturalIntro } from "../types";
import { callAI } from "./aiClient";

// Use the same model as geminiService
const TEXT_MODEL = 'gemini-3-flash-preview';

export async function generateCulturalIntro(
  targetLanguage: string,
  level: string,
  explanationLanguage: string
): Promise<CulturalIntro> {
  const prompt = `
    Génère une introduction culturelle et d'immersion pour un apprenant de la langue "${targetLanguage}" au niveau "${level}".
    La langue d'explication doit être "${explanationLanguage}".
    
    L'objectif est de fournir un contexte culturel riche, des bases de communication réelles, des coutumes locales et des conseils pratiques pour progresser.
    Sois précis, encourageant et utilise des exemples concrets.
  `;

  const { json } = await callAI<{ json: Omit<CulturalIntro, 'language' | 'level'> }>('generate_json', {
    purpose: 'cultural',
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          essentialInfo: {
            type: Type.OBJECT,
            properties: {
              countries: { type: Type.ARRAY, items: { type: Type.STRING } },
              usageContext: { type: Type.STRING },
              culturalImportance: { type: Type.STRING },
            },
            required: ["countries", "usageContext", "culturalImportance"],
          },
          communicationBasics: {
            type: Type.OBJECT,
            properties: {
              greetings: { type: Type.ARRAY, items: { type: Type.STRING } },
              politeness: { type: Type.ARRAY, items: { type: Type.STRING } },
              toneAndBehavior: { type: Type.STRING },
            },
            required: ["greetings", "politeness", "toneAndBehavior"],
          },
          customsAndBehaviors: {
            type: Type.OBJECT,
            properties: {
              dos: { type: Type.ARRAY, items: { type: Type.STRING } },
              donts: { type: Type.ARRAY, items: { type: Type.STRING } },
              gestures: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["dos", "donts", "gestures"],
          },
          practicalTips: {
            type: Type.OBJECT,
            properties: {
              learningTips: { type: Type.ARRAY, items: { type: Type.STRING } },
              frequentDifficulties: { type: Type.ARRAY, items: { type: Type.STRING } },
              progressHacks: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["learningTips", "frequentDifficulties", "progressHacks"],
          },
        },
        required: ["essentialInfo", "communicationBasics", "customsAndBehaviors", "practicalTips"],
      }
    }
  });

  const data = json || {};

  return {
    language: targetLanguage,
    level,
    ...data,
  };
}
