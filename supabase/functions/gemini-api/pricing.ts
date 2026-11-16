// Tarifs en crédits — SOURCE DE VÉRITÉ.
// Les montants affichés dans l'interface (src/services/creditService.ts,
// CREDIT_COSTS) doivent rester alignés sur ce fichier.

/** Usage déclaré par le client pour une génération. */
export type Purpose =
  | 'chat_lesson'       // message du professeur (chat principal)
  | 'dialogue_message'  // jeu de rôle : démarrage, message ou évaluation finale
  | 'exercise'          // génération d'une série d'exercices
  | 'tts_message'       // lecture audio d'un message entier
  | 'tts_word'          // prononciation d'un mot / d'une expression
  // Usages gratuits (plafonnés par jour, voir ai_rate_check) :
  | 'tts_exam'          // audio pendant / après un examen (déjà payé)
  | 'exam_evaluation'   // correction d'un examen (déjà payé)
  | 'vocabulary'        // extraction de vocabulaire
  | 'support'           // agent d'aide
  | 'cultural'          // fiche culturelle
  | 'translation'       // traduction ponctuelle
  | 'diagnostic'        // test de connexion (console admin)

export const PURPOSE_COSTS: Record<Purpose, number> = {
  chat_lesson: 2,
  dialogue_message: 1,
  exercise: 5,
  tts_message: 2,
  tts_word: 1,
  tts_exam: 0,
  exam_evaluation: 0,
  vocabulary: 0,
  support: 0,
  cultural: 0,
  translation: 0,
  diagnostic: 0,
}

/** Coût appliqué si le client n'indique pas d'usage connu. */
export const DEFAULT_GENERATION_COST = 1

export const VOICE_MINUTE_COST = 5
export const EXAM_COSTS = { certification: 100, diagnostic: 40 } as const

const GENERATION_ACTIONS = new Set(['generate', 'generate_stream', 'generate_json', 'generate_speech'])

export interface Pricing {
  /** Crédits à débiter avant d'appeler Gemini. */
  cost: number
  /** Usage gratuit : compté dans le plafond journalier gratuit. */
  free: boolean
  /** L'action déclenche un appel à Gemini (soumis à la limite de débit). */
  generates: boolean
}

export function priceRequest(action: string, purpose: unknown, examType?: unknown): Pricing {
  if (action === 'charge_voice_minute') {
    return { cost: VOICE_MINUTE_COST, free: false, generates: false }
  }
  if (action === 'live_token') {
    // La voix en direct est facturée à la minute (charge_voice_minute).
    return { cost: 0, free: false, generates: true }
  }
  if (action === 'generate_exam') {
    const cost = examType === 'certification' ? EXAM_COSTS.certification : EXAM_COSTS.diagnostic
    return { cost, free: false, generates: true }
  }
  if (GENERATION_ACTIONS.has(action)) {
    const known = typeof purpose === 'string' && Object.prototype.hasOwnProperty.call(PURPOSE_COSTS, purpose)
    const cost = known ? PURPOSE_COSTS[purpose as Purpose] : DEFAULT_GENERATION_COST
    return { cost, free: cost === 0, generates: true }
  }
  return { cost: 0, free: false, generates: false }
}

export const RATE_LIMIT_MESSAGES: Record<string, string> = {
  minute: 'Trop de requêtes. Patientez une minute.',
  day: 'Limite quotidienne atteinte. Revenez demain.',
  free_day: "Limite quotidienne des fonctions gratuites atteinte. Revenez demain.",
}
