
import { UserProfile } from "../../types";
import { SmartExam, ExamResultDetailed, ExamType } from "./types";
import { TEXT_MODEL, getGeminiApiKey, reportFailedApiKey } from "../../services/geminiService";
import { CREDIT_COSTS, deductCredits } from "../../services/creditService";
import { supabase, supabaseUrl, supabaseAnonKey } from "../../lib/supabase";
import { useAppStore } from "../../store/useAppStore";
import { GoogleGenAI } from "@google/genai";

// Helper to call edge function directly for specific schemas not covered by geminiService generic methods
const callGeminiFunction = async (action: string, payload: Record<string, unknown>) => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        if (!token) {
            throw new Error("Session expirée ou non autorisée. Veuillez vous reconnecter.");
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/gemini-api`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'apikey': supabaseAnonKey
            },
            body: JSON.stringify({ action, ...payload })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.newBalance !== undefined && data.newBalance !== null) {
                useAppStore.getState().updateUserCredits(data.newBalance);
            }
            return data;
        }

        // Handle specific errors from Edge Function
        let errorData;
        try {
            errorData = await response.json();
        } catch {
            const text = await response.text();
            throw new Error(`Erreur serveur IA (Code: ${response.status}). ${text}`);
        }

        console.error(`[Gemini Function] Error calling ${action}:`, errorData);
        
        if (response.status === 402) {
            throw new Error(`Crédits insuffisants: ${errorData.error || errorData.message}`);
        }
        
        if (response.status === 401) {
            throw new Error("Session expirée ou non autorisée. Veuillez vous reconnecter.");
        }

        throw new Error(errorData.error || errorData.message || `Erreur serveur IA (${response.status})`);

    } catch (e: any) {
        // If it's a credit error or auth error, don't fallback, just rethrow
        if (e.message.includes("Crédits insuffisants") || e.message.includes("Session expirée")) {
            throw e;
        }

        console.warn(`[Gemini Function] Edge function failed (${e.message}), falling back to direct SDK...`);
        
        // FALLBACK: Direct SDK Call
        if (action === 'generate_json' || action === 'generate_exam') {
            let apiKey = '';
            try {
                apiKey = await getGeminiApiKey();
                const ai = new GoogleGenAI({ apiKey });
                
                const model = (payload.model as string) || TEXT_MODEL;
                const contents = payload.contents;
                const config = (payload.config as any) || {};
                
                // Format contents for SDK
                const formattedContents = typeof contents === 'string' 
                    ? [{ role: 'user', parts: [{ text: contents }] }] 
                    : contents;

                const result = await ai.models.generateContent({
                    model: model,
                    contents: formattedContents as any,
                    config: {
                        ...config,
                        responseMimeType: 'application/json',
                    }
                });

                const rawText = result.text || "{}";
                const cleanText = rawText.replace(/```json\n?|```/g, '').trim();
                return { json: JSON.parse(cleanText) };

            } catch (sdkError: any) {
                if (apiKey) reportFailedApiKey(apiKey);
                console.error("[Gemini SDK Fallback Error]", sdkError);
                throw new Error(`Erreur IA (Fallback): ${sdkError.message}`);
            }
        }
        
        throw e;
    }
};

export const SmartExamService = {
    
    async checkBalance(): Promise<boolean> {
        // We don't have the user object here, just the ID. 
        // We should fetch the user or rely on the caller to check credits.
        // For now, we'll return true and let the caller or backend handle it.
        return true;
    },

    async startExam(user: UserProfile, type: ExamType): Promise<SmartExam | null> {
        if (!user || !user.id) return null;
        const cost = type === 'certification' ? CREDIT_COSTS.EXAM : CREDIT_COSTS.DIAGNOSTIC;
        
        // 1. Deduct Credits
        // Note: Billing is now handled server-side or via chargeVoiceMinute equivalent.
        // For exams, we should ideally have a specific Edge Function action.
        // For now, we will just simulate success if they have enough credits locally,
        // but the real deduction should happen when generating the exam.
        const success = user.credits >= cost;
        if (!success) return null;

        const level = user.preferences?.level || 'A1';
        const lang = user.preferences?.targetLanguage || 'Anglais';
        
        // Fetch weaknesses from storage instead of user.aiMemory
        let weaknesses: any[] = [];
        try {
            const { data } = await supabase
                .from('user_weakness')
                .select('*')
                .eq('user_id', user.id)
                .order('identified_at', { ascending: false })
                .limit(5);
            if (data) weaknesses = data;
        } catch (e) {
            console.error("Error fetching weaknesses", e);
        }
        
        const difficulties = weaknesses.length > 0 
            ? weaknesses.map(w => w.tag).join(', ') 
            : 'Aucune difficulté majeure';
            
        const explanationLang = user.preferences?.explanationLanguage || 'Français';

        try {
            // 2. Generate Exam
            const prompt = `
            Tu es un concepteur d'examens linguistiques de niveau international (expert certifié IELTS, DELF, TOEFL).
            Génère un examen de certification de type "${type}" pour l'étudiant "${user.username}" (Langue cible : "${lang}").
            Niveau cible strict : "${level}".
            Langue d'explication et d'instruction : "${explanationLang}".
            
            OBJECTIF : Créer un examen sérieux, immersif, non ambigu et capable de mesurer réellement la capacité à communiquer. C'est meilleur que l'examen officiel dans un enseignement supérieur.

            RÈGLES OBLIGATOIRES :
            1. CONTEXTE RÉEL : Chaque question DOIT être basée sur une situation concrète (travail, voyage, vie sociale, étude, communication réelle).
            2. STRUCTURE STRICTE : Chaque question doit contenir :
               - context : la situation ou le texte/dialogue de base.
               - instruction : consigne claire en "${explanationLang}".
               - question : la question précise en "${lang}".
               - options : (si QCM) 4 options avec UNE SEULE bonne réponse, zéro ambiguïté.
            3. TYPES DE COMPÉTENCES : Inclure obligatoirement : compréhension globale, compréhension de détail, intention du locuteur, inférence logique et pièges, vocabulaire/grammaire en contexte.
            4. IMMERSION : Utiliser des scénarios réalistes (emails, conversations, annonces, dialogues naturels).
            5. DIFFICULTÉ PROGRESSIVE (20 questions au total) :
               - Q1-5 : Facile (bases du niveau ${level})
               - Q6-10 : Moyen (cœur du niveau ${level})
               - Q11-15 : Difficile (nuances et pièges)
               - Q16-20 : Avancé (limite supérieure du niveau ${level})
            6. ADAPTATION CEFR : Respect strict du niveau "${level}".
            7. VALIDATION INTERNE : Avant de générer, assure-toi qu'il n'y a aucune ambiguïté et que la cohérence contexte <-> réponse est parfaite.
            
            STRUCTURE DE L'EXAMEN (20 questions) :
            - 5 questions 'listening' (Compréhension Orale) : Fournis un script naturel dans 'context'.
            - 5 questions 'qcm' (Compréhension Écrite & Grammaire) : Textes courts, emails, annonces dans 'context'.
            - 5 questions 'writing' (Expression Écrite) : Scénarios de rédaction (email, essai, réponse).
            - 5 questions 'speaking' (Expression Orale) : Mise en situation où l'élève doit parler.
            
            Difficultés cibles de l'élève à tester si possible : ${difficulties}.
            
            Output JSON Schema:
            {
                "sections": [
                    { "id": "l1", "type": "listening", "instruction": "Écoutez l'audio et répondez...", "context": "Script audio...", "question": "...", "options": ["A", "B", "C", "D"], "weight": 1 },
                    { "id": "q1", "type": "qcm", "instruction": "Lisez le texte et choisissez...", "context": "Texte...", "question": "...", "options": ["A", "B", "C", "D"], "weight": 1 },
                    { "id": "w1", "type": "writing", "instruction": "Rédigez un email...", "context": "Vous avez reçu une invitation...", "question": "Répondez à cet email...", "weight": 3 },
                    { "id": "s1", "type": "speaking", "instruction": "Parlez pendant 1 minute...", "context": "Vous êtes au restaurant...", "question": "Commandez votre repas...", "weight": 3 }
                ]
            }
            `;

            // Define schema for Edge Function - Use uppercase strings for REST API compatibility
            const schema = {
                type: "OBJECT",
                properties: {
                    sections: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                type: { type: "STRING" },
                                instruction: { type: "STRING" },
                                question: { type: "STRING" },
                                context: { type: "STRING" },
                                options: { type: "ARRAY", items: { type: "STRING" } },
                                weight: { type: "NUMBER" }
                            },
                            required: ["id", "type", "instruction", "question", "context", "weight"]
                        }
                    }
                }
            };

            const data = await callGeminiFunction('generate_exam', {
                examType: type,
                model: TEXT_MODEL,
                contents: prompt,
                config: {
                    responseSchema: schema
                }
            });

            const sections = data.json?.sections;
            
            if (!sections || !Array.isArray(sections) || sections.length === 0) {
                // Refund credits since the generation failed to produce a valid exam
                const cost = type === 'certification' ? 100 : 40;
                await supabase.rpc('consume_credits', { p_amount: -cost });
                throw new Error("Format d'examen invalide (Sections manquantes)");
            }

            return {
                id: crypto.randomUUID(),
                type,
                targetLevel: level,
                language: lang,
                sections: sections,
                totalQuestions: sections.length,
                createdAt: Date.now()
            };

        } catch (e) {
            console.error("Exam Gen Error", e);
            return null;
        }
    },

    async evaluateExam(exam: SmartExam, answers: Record<string, string>, user: UserProfile): Promise<ExamResultDetailed> {
        const explanationLang = user.preferences?.explanationLanguage || 'Français';
        const prompt = `
        Tu es un examinateur officiel de niveau international (expert certifié IELTS, DELF, TOEFL).
        Évalue cet examen de certification pour le candidat "${user.username}".
        Langue évaluée : ${exam.language}.
        Niveau visé par l'examen : ${exam.targetLevel}.
        
        Questions & Réponses :
        ${exam.sections.map(s => `[${s.type.toUpperCase()}] Q: ${s.question} \n R: ${answers[s.id] ? answers[s.id] : "AUCUNE RÉPONSE (Temps écoulé ou ignoré)"}`).join('\n\n')}
        
        Tâche :
        1. Analyse la grammaire, le vocabulaire, la cohérence et la pertinence de manière TRÈS STRICTE et professionnelle.
        2. Estime le niveau RÉEL (CEFR) basé sur la performance globale.
           - IMPORTANT : Si le score est inférieur à 70/100, le niveau détecté NE PEUT PAS être supérieur au niveau visé (${exam.targetLevel}).
        3. Calcule un score sur 100 (sois exigeant, les fautes de base pénalisent lourdement).
           - Si "AUCUNE RÉPONSE", comptez 0 pour cette question.
        4. Donne un feedback constructif et professionnel en "${explanationLang}". 
           - Le ton doit être académique, objectif et encourageant.
           - Si l'étudiant réussit (>= 70), félicite-le de manière formelle.
           - Si l'étudiant échoue (< 70), explique-lui clairement les lacunes (grammaire, vocabulaire, compréhension) et donne-lui un plan d'action.
           - FORMAT DU FEEDBACK : Le texte DOIT être aéré. Utilise le caractère spécial '\\n' pour faire des sauts de ligne dans la chaîne JSON.
        5. Ne mentionne jamais que tu es une IA. Parle en tant que "Jury d'Examen TeacherMada".
        
        Output JSON.
        `;

        try {
            const schema = {
                type: "OBJECT",
                properties: {
                    globalScore: { type: "NUMBER" },
                    skillScores: {
                        type: "OBJECT",
                        properties: {
                            reading: { type: "NUMBER" },
                            writing: { type: "NUMBER" },
                            listening: { type: "NUMBER" },
                            speaking: { type: "NUMBER" }
                        }
                    },
                    detectedLevel: { type: "STRING" },
                    feedback: { type: "STRING" },
                    confidenceScore: { type: "NUMBER" }
                }
            };

            const data = await callGeminiFunction('generate_json', {
                model: TEXT_MODEL,
                contents: prompt,
                config: {
                    responseSchema: schema
                }
            });

            const evalData = data.json || {};
            const passed = (evalData.globalScore || 0) >= 70; // Seuil strict de 70%

            // NOTE: Certificate is NOT created automatically anymore.
            // User must pay 100 credits to unlock it if passed.
            const certId = undefined;

            if (exam.type === 'certification' && passed) {
                // Notification for passing (but not certificate yet)
                try {
                    await supabase.from('notifications').insert([{
                        id: crypto.randomUUID(),
                        user_id: user.id,
                        type: 'achievement',
                        title: 'Examen Réussi !',
                        message: `Félicitations ! Vous avez réussi l'examen ${exam.targetLevel} avec un score de ${evalData.globalScore}/100. Vous pouvez maintenant débloquer votre certificat dans votre tableau de bord.`,
                        data: { examId: exam.id }
                    }]);
                } catch (e) {
                    console.error("Error saving notification", e);
                }
            } else if (exam.type === 'certification' && !passed) {
                 // Notification Echec
                 try {
                     await supabase.from('notifications').insert([{
                         id: crypto.randomUUID(),
                         user_id: user.id,
                         type: 'system',
                         title: 'Résultat Examen',
                         message: `Examen terminé. Score: ${evalData.globalScore}/100. Malheureusement, le seuil de réussite est de 70/100. Continuez vos efforts !`,
                         data: { examId: exam.id }
                     }]);
                 } catch (e) {
                     console.error("Error saving notification", e);
                 }
            }

            const resultDetailed: ExamResultDetailed = {
                examId: exam.id,
                userId: user.id,
                userName: user.username,
                userFullName: user.username, 
                language: exam.language,
                date: Date.now(),
                globalScore: evalData.globalScore || 0,
                skillScores: evalData.skillScores || { reading: 0, writing: 0, listening: 0, speaking: 0 },
                detectedLevel: evalData.detectedLevel || "Inconnu",
                passed,
                certificateId: certId,
                feedback: evalData.feedback || "Analyse incomplète.",
                confidenceScore: evalData.confidenceScore || 80
            };

            // SAVE EXAM RESULT TO HISTORY (Passed or Failed)
            try {
                const payload = {
                    id: crypto.randomUUID(),
                    user_id: user.id,
                    language: exam.language,
                    level: exam.targetLevel,
                    score: resultDetailed.globalScore,
                    total_questions: exam.totalQuestions,
                    passed: resultDetailed.passed,
                    details: resultDetailed,
                    created_at: new Date().toISOString()
                };
                console.log("Saving exam result payload:", payload);
                const { error } = await supabase.from('exam_results').insert([payload]);
                if (error) throw error;
                console.log("Exam result saved successfully");
            } catch (e) {
                console.error("Error saving exam result:", e);
            }

            return resultDetailed;

        } catch (e) {
            console.error("Eval Error", e);
            throw new Error("Erreur lors de la correction.");
        }
    },

    async unlockCertificate(result: ExamResultDetailed, user: UserProfile): Promise<string | null> {
        return unlockCertificate(result, user);
    }
};

/**
 * Unlocks a certificate for a passed exam
 */
export const unlockCertificate = async (result: ExamResultDetailed, user: UserProfile): Promise<string | null> => {
    if (!result.passed || (result.globalScore || 0) < 70) return null;
    
    try {
        // 1. Deduct credits
        const newCredits = await deductCredits(CREDIT_COSTS.CERTIFICATE_UNLOCK, user.id);
        if (newCredits === null) return null;
        useAppStore.getState().updateUserCredits(newCredits);

        // 2. Create Cert ID
        // (No longer needed, using existing certId from database)

        // 3. Update existing certificate record
        console.log("Searching for certificate with exam_id:", result.examId);
        const { data: existingCertData, error: fetchError } = await supabase
            .from('certificates')
            .select('id, status')
            .eq('exam_id', result.examId)
            .single();

        let existingCert = existingCertData;

        console.log("Found certificate:", existingCert, "Error:", fetchError);

        if (fetchError || !existingCert) {
            console.log("Certificate not found, creating new one for exam_id:", result.examId);
            const newCert = {
                id: `CERT-${crypto.randomUUID().slice(0, 8).toUpperCase()}-${user.id.slice(0, 4)}`,
                user_id: user.id,
                user_name: user.username,
                user_full_name: user.username,
                language: result.language,
                level: result.detectedLevel,
                exam_id: result.examId,
                issue_date: new Date().toISOString(),
                validation_hash: crypto.randomUUID(),
                qr_code_data: `${window.location.origin}/verify/TEMP`,
                score: result.globalScore,
                status: 'débloqué'
            };
            
            const { data: insertedCert, error: insertError } = await supabase.from('certificates').insert([newCert]).select().single();
            if (insertError) {
                console.error("Insert error:", insertError);
                throw insertError;
            }
            existingCert = insertedCert;
        }

        if (!existingCert) {
            throw new Error("Certificate record not found or could not be created.");
        }

        console.log("Updating certificate status to 'débloqué' for exam_id:", result.examId);
        const { data: updateData, error: certError } = await supabase.from('certificates')
            .update({
                status: 'débloqué',
                qr_code_data: `${window.location.origin}/verify/${existingCert.id}`,
                issue_date: new Date().toISOString()
            })
            .eq('exam_id', result.examId)
            .select();

        if (certError) {
            console.error("Update error:", certError);
            throw certError;
        }
        console.log("Certificate updated successfully, result:", updateData);
        const certId = existingCert.id;

        // 4. Update exam_results with certificate_id
        await supabase.from('exam_results')
            .update({ certificate_id: certId })
            .eq('id', result.examId);

        // 5. Notification
        await supabase.from('notifications').insert([{
            id: crypto.randomUUID(),
            user_id: user.id,
            type: 'achievement',
            title: 'Certificat Débloqué !',
            message: `Votre certificat ${result.detectedLevel} est maintenant disponible.`,
            data: { certificateId: certId }
        }]);

        // Force a reload of the certificates by triggering a state update if possible, 
        // or just rely on the user refreshing the page for now.
        // The issue is that SmartExamService is not a React component, so we cannot use hooks directly.
        
        return certId;
    } catch (e) {
        console.error("Error unlocking certificate:", e);
        return null;
    }
};
