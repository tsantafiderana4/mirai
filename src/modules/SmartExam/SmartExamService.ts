
import { UserProfile } from "../../types";
import { SmartExam, ExamResultDetailed, ExamType, ExamQuestion } from "./types";
import { TEXT_MODEL } from "../../services/geminiService";
import { callAI, AIAction } from "../../services/aiClient";
import { CREDIT_COSTS, deductCredits } from "../../services/creditService";
import { supabase } from "../../lib/supabase";
import { useAppStore } from "../../store/useAppStore";

// Appel à l'Edge Function (facturation des examens faite côté serveur)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AIJson = any; // forme validée au cas par cas par les appelants
const callGeminiFunction = (action: AIAction, payload: Record<string, unknown>) =>
    callAI<{ json?: AIJson; text?: string; newBalance?: number }>(action, payload);

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
        let weaknesses: { tag: string }[] = [];
        try {
            const { data } = await supabase
                .from('user_weakness')
                .select('*')
                .eq('user_id', user.id)
                .order('identified_at', { ascending: false })
                .limit(5);
            if (data) weaknesses = data as { tag: string }[];
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
            
            STRATÉGIE PÉDAGOGIQUE :
            - Variabilité : Chaque question doit explorer un contexte différent (ne pas rester sur le même sujet tout au long de la section).
            - Authenticité : Utilise des documents réels simulés (emails, extraits de presse, dialogues de rue, annonces aéroport).
            - Évaluation Holistique : Teste non seulement la compréhension littérale mais aussi l'inférence, le ton, et l'intention de l'auteur.
            - Adaptabilité : Si l'élève a des faiblesses (${difficulties}), cible-les spécifiquement avec des questions stratégiques.

            RÈGLES OBLIGATOIRES :
            1. NOMBRE DE QUESTIONS : Génère EXACTEMENT 20 questions au total pour l'ensemble de l'examen.
            2. VARIÉTÉ DES COMPÉTENCES (STRICT 5/5/5/5) : L'examen doit obligatoirement être structuré ainsi :
               - 5 questions de Compréhension Orale (Listening)
               - 5 questions de Compréhension Écrite (Reading)
               - 5 questions d'Expression Écrite (Writing)
               - 5 questions d'Expression Orale (Speaking)
            3. DIFFICULTÉ PROGRESSIVE : Les questions doivent suivre une courbe de difficulté croissante adaptée au niveau ${level} :
               - Questions 1-5 (Listening) : Facile
               - Questions 6-10 (Reading) : Moyenne
               - Questions 11-15 (Writing) : Difficile
               - Questions 16-20 (Speaking) : Avancé
            4. CONTEXTE RÉEL ET VARIABLE : Chaque question DOIT avoir son propre contexte unique. Ne réutilise pas le même texte ou la même situation pour deux questions.
            5. STRUCTURE STRICTE ET LANGUES : Chaque question DOIT être totalement autonome et contenir :
               - context : la situation ou le texte/dialogue de base spécifique à CETTE question. DOIT ÊTRE EN LANGUE CIBLE ("${lang}").
               - instruction : consigne claire pour CETTE question. DOIT ÊTRE EN LANGUE D'EXPLICATION ("${explanationLang}").
               - explanation : explication pédagogique de ce qui est testé (utilisé pour la correction interne). DOIT ÊTRE EN LANGUE D'EXPLICATION ("${explanationLang}").
               - script : pour les questions orales, le script exact de l'audio. DOIT ÊTRE EN LANGUE CIBLE ("${lang}").
               - question : LA QUESTION EN LANGUE CIBLE ("${lang}").
               - options : (si QCM) LES OPTIONS EN LANGUE CIBLE ("${lang}"). DOIT ÊTRE UN TABLEAU DE 4 CHAINES DE CARACTÈRES UNIQUES.
            6. TYPES DE QUESTIONS : Variez les formats :
               - 'qcm' : Choix multiple classique. OBLIGATOIRE : Fournir EXACTEMENT 4 options uniques, pertinentes et non ambiguës dans 'options' qui correspondent parfaitement au contexte et à la question.
               - 'true_false_not_given' : Vrai / Faux / Non Donné. OBLIGATOIRE : Fournir ces 3 options exactes dans 'options'.
               - 'fill_in_the_blanks' : Texte à trous (phrase avec "_____").
               - 'open' : Question ouverte (obligatoire pour 'writing' et 'speaking').
            7. IMMERSION : Utiliser des scénarios réalistes (emails, conversations, annonces, dialogues naturels).
            8. QUALITÉ DES DONNÉES : Vérifie qu'il n'y a pas de doublons dans les options, que chaque question QCM a bien ses options, et que les options sont logiquement liées à la question.
            
            STRUCTURE DE L'EXAMEN (Total 20 questions) :
            - LISTENING (5 questions)
            - READING (5 questions)
            - WRITING (5 questions)
            - SPEAKING (5 questions)
            
            Difficultés cibles de l'élève à tester si possible : ${difficulties}.
            
            Output JSON Schema:
            {
                "sections": [
                    { 
                        "id": "l1", "type": "listening", "instruction": "Écoutez l'audio et répondez...", "context": "Script audio long...", "weight": 1,
                        "questions": [
                            { "id": "l1_q1", "question": "...", "options": ["A", "B", "C", "D"] },
                            { "id": "l1_q2", "question": "...", "options": ["A", "B", "C", "D"] }
                        ]
                    },
                    { 
                        "id": "q1", "type": "qcm", "instruction": "Lisez le texte et choisissez...", "context": "Texte très long...", "weight": 1,
                        "questions": [
                            { "id": "q1_q1", "question": "...", "options": ["A", "B", "C", "D"] }
                        ]
                    },
                    { 
                        "id": "w1", "type": "writing", "instruction": "Rédigez un email...", "context": "Vous avez reçu une invitation...", "weight": 3,
                        "questions": [
                            { "id": "w1_q1", "question": "Répondez à cet email..." }
                        ]
                    },
                    { 
                        "id": "s1", "type": "speaking", "instruction": "Parlez pendant 1 minute...", "context": "Vous êtes au restaurant...", "weight": 3,
                        "questions": [
                            { "id": "s1_q1", "question": "Commandez votre repas..." }
                        ]
                    }
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
                                context: { type: "STRING" },
                                weight: { type: "NUMBER" },
                                questions: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            id: { type: "STRING" },
                                            type: { type: "STRING", description: "qcm, true_false_not_given, fill_in_the_blanks, open" },
                                            question: { type: "STRING" },
                                            options: { type: "ARRAY", items: { type: "STRING" } },
                                            context: { type: "STRING" },
                                            instruction: { type: "STRING" },
                                            explanation: { type: "STRING" },
                                            script: { type: "STRING" }
                                        },
                                        required: ["id", "type", "question", "context", "instruction"]
                                    }
                                }
                            },
                            required: ["id", "type", "instruction", "context", "weight", "questions"]
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

            // Le serveur rembourse automatiquement si l'examen est invalide.
            const sections = (data.json as { sections?: SmartExam['sections'] } | undefined)?.sections;

            if (!sections || !Array.isArray(sections) || sections.length === 0) {
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
        
        let promptText = `
        Tu es un examinateur officiel de niveau international (expert certifié IELTS, DELF, TOEFL).
        Évalue cet examen de certification pour le candidat "${user.username}".
        Langue évaluée : ${exam.language}.
        Niveau visé par l'examen : ${exam.targetLevel}.
        
        Questions & Réponses :
        `;

        const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
        
        for (const s of exam.sections) {
            const questionsToEval = s.questions && s.questions.length > 0 
                ? s.questions 
                : [{ id: s.id, question: s.question || '' } as ExamQuestion];
            
            promptText += `\n--- SECTION: ${s.type.toUpperCase()} ---\n`;
            if (s.context) promptText += `CONTEXTE: ${s.context}\n`;

            for (const q of questionsToEval) {
                const ans = answers[q.id];
                if (s.type === 'speaking' && ans && ans.startsWith('data:audio/')) {
                    const [prefix, base64] = ans.split(',');
                    const mimeType = prefix.split(':')[1].split(';')[0];
                    promptText += `Q: ${q.question} \n R: [AUDIO FOURNI CI-JOINT]\n\n`;
                    parts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64
                        }
                    });
                } else {
                    promptText += `Q: ${q.question} \n R: ${ans ? ans : "AUCUNE RÉPONSE (Temps écoulé ou ignoré)"}\n\n`;
                }
            }
        }

        promptText += `
        Tâche :
        1. Analyse la grammaire, le vocabulaire, la cohérence et la pertinence de manière TRÈS STRICTE et professionnelle.
        2. Pour les épreuves orales (fichiers audio joints), évalue rigoureusement la prononciation, la fluidité, l'accentuation et l'intonation.
        3. Estime le niveau RÉEL (CEFR) basé sur la performance globale.
           - IMPORTANT : Si le score est inférieur à 70/100, le niveau détecté NE PEUT PAS être supérieur au niveau visé (${exam.targetLevel}).
        4. Calcule un score sur 100 de façon intelligente :
           - Chaque question a un poids égal.
           - Les fautes de grammaire et de vocabulaire dans les réponses ouvertes (Writing/Speaking) doivent être pénalisées avec précision.
           - Si "AUCUNE RÉPONSE", comptez 0 pour cette question.
        5. Évalue 5 critères spécifiques sur 100 :
           - grammar (Grammaire et Syntaxe)
           - vocabulary (Richesse Lexicale)
           - comprehension (Compréhension Écrite et Orale)
           - fluency (Fluidité et Cohérence)
           - pronunciation (Prononciation - mettez 0 si aucune épreuve orale n'est présente)
        6. Donne un rapport d'évaluation EXTRÊMEMENT DÉTAILLÉ et clair en "${explanationLang}". 
           - L'étudiant doit comprendre exactement ses points forts et ses points faibles.
           - Explique les erreurs commises dans les sections ouvertes.
           - Le ton doit être académique, objectif et encourageant.
           - Fournis un feedback global complet dans 'feedback'.
           - Fournis un feedback spécifique détaillé (3-4 phrases) pour chaque critère dans 'criteriaFeedback'.
           - Si l'étudiant réussit (>= 70), félicite-le de manière formelle.
           - Si l'étudiant échoue (< 70), explique-lui clairement les lacunes et donne-lui un plan d'action précis.
        7. Ne mentionne jamais que tu es une IA. Parle en tant que "Jury d'Examen TeacherMada".
        
        Output JSON.
        `;

        parts.unshift({ text: promptText });

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
                    criteriaScores: {
                        type: "OBJECT",
                        properties: {
                            grammar: { type: "NUMBER" },
                            vocabulary: { type: "NUMBER" },
                            comprehension: { type: "NUMBER" },
                            fluency: { type: "NUMBER" },
                            pronunciation: { type: "NUMBER" }
                        }
                    },
                    criteriaFeedback: {
                        type: "OBJECT",
                        properties: {
                            grammar: { type: "STRING" },
                            vocabulary: { type: "STRING" },
                            comprehension: { type: "STRING" },
                            fluency: { type: "STRING" },
                            pronunciation: { type: "STRING" }
                        }
                    },
                    detectedLevel: { type: "STRING" },
                    feedback: { type: "STRING" },
                    confidenceScore: { type: "NUMBER" }
                }
            };

            const data = await callGeminiFunction('generate_json', {
                purpose: 'exam_evaluation', // gratuit : l'examen a déjà été payé
                model: TEXT_MODEL,
                contents: parts,
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
