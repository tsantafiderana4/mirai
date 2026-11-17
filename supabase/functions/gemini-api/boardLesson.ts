// =====================================================================
// « Leçon au tableau » — logique pure côté serveur (sans réseau) :
// langues/niveaux autorisés, prompts pédagogiques, schémas imposés à
// Gemini, validation/nettoyage des leçons, encodage audio WAV.
//
// Les types ci-dessous sont dupliqués côté client dans
// src/types/board.ts : garder les deux fichiers alignés.
// =====================================================================

export const BOARD_LESSON_VERSION = 'v1'
export const SYLLABUS_SIZE = 20

// --------------------------------------------------------------------
// Types
// --------------------------------------------------------------------
export type BoardItemKind =
  | 'title' | 'explain' | 'vocab' | 'sentence' | 'table' | 'tip' | 'warning' | 'quiz'

export interface BreakdownPart { part: string; fr: string; mg: string }

export interface BoardItem {
  kind: BoardItemKind
  /** Texte en français (explication, astuce, titre, consigne de quiz). */
  text?: string
  /** Traduction / aide en malagasy du texte ou de la notion. */
  mg?: string
  /** Texte dans la langue étudiée (mot, phrase). */
  target?: string
  /** Prononciation simplifiée, lisible par un francophone malgache. */
  phonetic?: string
  /** Sens en français. */
  fr?: string
  example?: string
  exampleFr?: string
  exampleMg?: string
  breakdown?: BreakdownPart[]
  headers?: string[]
  rows?: string[][]
  question?: string
  options?: string[]
  answer?: string
  explanation?: string
}

export interface BoardStep {
  /** Ce que le professeur DIT (français, avec les mots de la langue étudiée). */
  say: string
  /** Ce qu'il ÉCRIT au tableau pendant ce temps. */
  items: BoardItem[]
}

export interface BoardLessonContent {
  title: string
  titleMg: string
  objective: string
  objectiveMg: string
  steps: BoardStep[]
  summary: string[]
  summaryMg: string[]
}

export interface SyllabusEntry { title: string; titleMg: string; objective: string }

export interface BoardAnswer { say: string; items: BoardItem[] }

// --------------------------------------------------------------------
// Langues et niveaux (mêmes valeurs que src/types.ts TargetLanguage)
// --------------------------------------------------------------------
export const ALLOWED_LANGUAGES = [
  'Anglais', 'Français', 'Chinois', 'Espagnol', 'Allemand', 'Italien', 'Portugais',
  'Russe', 'Japonais', 'Coréen', 'Hindi', 'Arabe', 'Swahili',
] as const

export const ALLOWED_LEVELS = [
  'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
  'HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6',
] as const

/** « Anglais 🇬🇧 » → « Anglais » ; null si langue non autorisée. */
export function normalizeLanguage(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const word = input.trim().split(/\s+/)[0]?.toLowerCase()
  return ALLOWED_LANGUAGES.find(l => l.toLowerCase() === word) ?? null
}

export function normalizeLevel(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const v = input.trim().toUpperCase().replace(/\s+/g, ' ')
  return ALLOWED_LEVELS.find(l => l === v) ?? null
}

export function normalizeLessonNumber(input: unknown): number | null {
  const n = typeof input === 'number' ? input : Number(input)
  return Number.isInteger(n) && n >= 1 && n <= SYLLABUS_SIZE ? n : null
}

export const syllabusKey = (lang: string, level: string) =>
  `${BOARD_LESSON_VERSION}|${lang}|${level}`

export const lessonKey = (lang: string, level: string, n: number) =>
  `${BOARD_LESSON_VERSION}|${lang}|${level}|${n}`

// --------------------------------------------------------------------
// Prompts
// --------------------------------------------------------------------
const MALAGASY_RULES = `
RÈGLES POUR LE MALAGASY (champs "mg", "titleMg", "objectiveMg", "summaryMg", "exampleMg") :
- Le public est malgache : le malagasy sert à TRADUIRE ou à CLARIFIER l'explication française.
- Utilise un malagasy officiel, simple et naturel (comme un bon enseignant à Antananarivo).
- N'invente jamais de mots. Si un terme technique n'a pas d'équivalent courant, garde le mot
  français entre guillemets et explique-le en malagasy simple.
- Phrases courtes. Pas de traduction mot à mot maladroite.`

export function buildSyllabusPrompt(lang: string, level: string): string {
  return `Tu es un concepteur pédagogique expert du CECRL, spécialisé dans l'enseignement des langues
à des apprenants malgaches francophones.

Conçois le programme de ${SYLLABUS_SIZE} leçons pour apprendre le ${lang}, niveau ${level}.
- Progression logique, du plus fondamental au plus avancé pour ce niveau.
- Chaque leçon = UNE notion claire (grammaire, vocabulaire thématique ou situation de communication),
  réalisable en 10 minutes.
- Mélange équilibré : communication utile au quotidien, grammaire essentielle, vocabulaire fréquent.
- "title" en français (court, concret), "titleMg" en malagasy, "objective" en français
  (« À la fin, tu sauras… »).
${MALAGASY_RULES}`
}

export function buildLessonPrompt(
  lang: string, level: string, n: number, entry: SyllabusEntry, previousTitles: string[],
): string {
  const prev = previousTitles.length
    ? `Leçons déjà vues (ne pas les répéter, tu peux t'appuyer dessus) : ${previousTitles.join(' ; ')}.`
    : `C'est la toute première leçon du niveau.`

  return `Tu es TeacherMada, un professeur de ${lang} exceptionnel, chaleureux et très clair.
Tu donnes un cours AU TABLEAU à un(e) élève malgache francophone, niveau ${level}.

LEÇON ${n} : « ${entry.title} »
Objectif : ${entry.objective}
${prev}

FORMAT : une suite de 7 à 10 ÉTAPES. Chaque étape contient :
- "say" : ce que tu DIS à voix haute, en FRANÇAIS, 2 à 4 phrases (40 à 70 mots), ton naturel et
  encourageant, comme en classe. Tu peux y prononcer des mots en ${lang}. Pas d'émojis, pas de
  markdown, pas de listes : uniquement du texte parlé.
- "items" : ce que tu ÉCRIS au tableau pendant que tu parles (1 à 4 éléments).

TYPES D'ÉLÉMENTS ("kind") ET CHAMPS :
- "title" : grand titre de section. text (fr), mg.
- "explain" : explication courte. text (fr, 1-2 phrases), mg (traduction/aide).
- "vocab" : un mot ou une expression. target (${lang}), phonetic (prononciation simplifiée lisible
  par un francophone, ex. « hé-lo »), fr, mg, et si utile example (${lang}) + exampleFr + exampleMg.
- "sentence" : phrase modèle. target (${lang}), fr, mg, et breakdown = découpage mot à mot
  [{part (${lang}), fr, mg}] quand cela aide à comprendre la structure.
- "table" : tableau (conjugaison, pronoms, comparaison…). text (titre du tableau, fr), mg,
  headers (2 à 4 colonnes), rows (2 à 8 lignes, même nombre de cellules que headers).
- "tip" : astuce de mémorisation. text (fr), mg.
- "warning" : erreur fréquente à éviter (pense aux erreurs typiques des locuteurs malgaches et
  francophones). text (fr), mg.
- "quiz" : question à choix multiple pour vérifier la compréhension. question (fr, peut contenir du
  ${lang}), options (3 ou 4 choix), answer (copie EXACTE d'une des options), explanation (fr), mg
  (explication en malagasy).

DÉROULÉ ATTENDU :
1. Accroche + titre + objectif de la leçon.
2. Présentation progressive de la notion, avec exemples concrets de la vie quotidienne à Madagascar
   quand c'est possible.
3. Au moins un "table" OU un "sentence" avec breakdown.
4. Au moins un "warning".
5. Un "quiz" au milieu et un autre vers la fin.
6. Dernière étape : récapitulatif oral bref et encouragement.

RÈGLES :
- Tout ce qui est en ${lang} va dans target/example/breakdown.part/headers/rows, jamais dans "mg".
- Adapté STRICTEMENT au niveau ${level} : vocabulaire et phrases à la portée de l'élève.
- "summary" : 3 à 5 points clés (fr) et "summaryMg" : les mêmes en malagasy, dans le même ordre.
- "title"/"titleMg"/"objective"/"objectiveMg" de la leçon : reprends et précise ceux du programme.
${MALAGASY_RULES}`
}

export function buildQuestionPrompt(
  lang: string, level: string, lesson: BoardLessonContent, stepIndex: number, question: string,
): string {
  const step = lesson.steps[Math.min(Math.max(stepIndex, 0), lesson.steps.length - 1)]
  const context = step ? step.say : ''
  return `Tu es TeacherMada, professeur de ${lang} (niveau ${level}) qui fait cours au tableau à un(e)
élève malgache francophone. Leçon en cours : « ${lesson.title} ».
Ce que tu venais d'expliquer : « ${context} »

L'élève t'interrompt avec cette question (elle peut être en français, en malagasy ou en ${lang}) :
« ${question.slice(0, 500)} »

Réponds comme un excellent professeur :
- "say" : ta réponse orale en FRANÇAIS, 2 à 4 phrases, claire et bienveillante, sans markdown.
- "items" : 1 à 3 éléments que tu écris au tableau pour illustrer ta réponse (mêmes types et champs
  que dans le cours : explain, vocab, sentence, table, tip, warning), toujours avec la traduction
  ou l'aide en malagasy dans "mg".
- Si la question est hors sujet ou inappropriée, réponds poliment en ramenant l'élève à la leçon.
${MALAGASY_RULES}`
}

// --------------------------------------------------------------------
// Schémas imposés à Gemini (responseSchema)
// --------------------------------------------------------------------
const STR = { type: 'STRING' }
const STR_ARRAY = { type: 'ARRAY', items: STR }

const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['title', 'explain', 'vocab', 'sentence', 'table', 'tip', 'warning', 'quiz'] },
    text: STR, mg: STR, target: STR, phonetic: STR, fr: STR,
    example: STR, exampleFr: STR, exampleMg: STR,
    breakdown: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { part: STR, fr: STR, mg: STR }, required: ['part', 'fr', 'mg'] },
    },
    headers: STR_ARRAY,
    rows: { type: 'ARRAY', items: { type: 'OBJECT', properties: { cells: STR_ARRAY }, required: ['cells'] } },
    question: STR, options: STR_ARRAY, answer: STR, explanation: STR,
  },
  required: ['kind'],
}

export const SYLLABUS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lessons: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: STR, titleMg: STR, objective: STR },
        required: ['title', 'titleMg', 'objective'],
      },
    },
  },
  required: ['lessons'],
}

export const LESSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: STR, titleMg: STR, objective: STR, objectiveMg: STR,
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { say: STR, items: { type: 'ARRAY', items: ITEM_SCHEMA } },
        required: ['say', 'items'],
      },
    },
    summary: STR_ARRAY,
    summaryMg: STR_ARRAY,
  },
  required: ['title', 'titleMg', 'objective', 'objectiveMg', 'steps', 'summary', 'summaryMg'],
}

export const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: { say: STR, items: { type: 'ARRAY', items: ITEM_SCHEMA } },
  required: ['say', 'items'],
}

// --------------------------------------------------------------------
// Validation / nettoyage (la sortie d'un LLM n'est jamais fiable à 100 %)
// --------------------------------------------------------------------
const clean = (v: unknown, max = 400): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}

const cleanArray = (v: unknown, maxItems: number, maxLen = 200): string[] =>
  Array.isArray(v) ? v.map(x => clean(x, maxLen)).filter((x): x is string => !!x).slice(0, maxItems) : []

/** Retire le markdown et les émojis du texte parlé (lu par la synthèse vocale). */
export function cleanSpoken(v: unknown): string | undefined {
  const s = clean(v, 900)
  if (!s) return undefined
  return s
    .replace(/[*_#`>~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || undefined
}

const KINDS: ReadonlySet<string> = new Set(['title', 'explain', 'vocab', 'sentence', 'table', 'tip', 'warning', 'quiz'])

export function sanitizeItem(raw: unknown): BoardItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind as BoardItemKind : null
  if (!kind) return null

  const base = { kind, mg: clean(r.mg, 500) }

  switch (kind) {
    case 'title':
    case 'explain':
    case 'tip':
    case 'warning': {
      const text = clean(r.text, kind === 'title' ? 120 : 400)
      return text ? { ...base, text } : null
    }
    case 'vocab': {
      const target = clean(r.target, 120)
      if (!target) return null
      return {
        ...base, target,
        phonetic: clean(r.phonetic, 120), fr: clean(r.fr, 200),
        example: clean(r.example, 250), exampleFr: clean(r.exampleFr, 250), exampleMg: clean(r.exampleMg, 250),
      }
    }
    case 'sentence': {
      const target = clean(r.target, 250)
      if (!target) return null
      const breakdown = Array.isArray(r.breakdown)
        ? r.breakdown.map(b => {
            const o = (b ?? {}) as Record<string, unknown>
            const part = clean(o.part, 80)
            return part ? { part, fr: clean(o.fr, 120) ?? '', mg: clean(o.mg, 120) ?? '' } : null
          }).filter((b): b is BreakdownPart => !!b).slice(0, 12)
        : []
      return { ...base, target, fr: clean(r.fr, 250), breakdown: breakdown.length ? breakdown : undefined }
    }
    case 'table': {
      const headers = cleanArray(r.headers, 4, 60)
      if (headers.length < 2) return null
      const rows = Array.isArray(r.rows)
        ? r.rows.map(row => {
            const cells = Array.isArray(row) ? row : (row as Record<string, unknown>)?.cells
            const arr = cleanArray(cells, headers.length, 80)
            while (arr.length < headers.length) arr.push('')
            return arr
          }).filter(row => row.some(c => c)).slice(0, 8)
        : []
      if (rows.length < 1) return null
      return { ...base, text: clean(r.text, 120), headers, rows }
    }
    case 'quiz': {
      const question = clean(r.question, 300)
      const options = [...new Set(cleanArray(r.options, 4, 150))]
      const answer = clean(r.answer, 150)
      if (!question || options.length < 2 || !answer) return null
      // La réponse doit être l'une des options (tolère la casse / espaces)
      const match = options.find(o => o.toLowerCase() === answer.toLowerCase())
      if (!match) return null
      return { ...base, question, options, answer: match, explanation: clean(r.explanation, 400) }
    }
  }
}

function sanitizeSteps(raw: unknown, maxSteps: number): BoardStep[] {
  if (!Array.isArray(raw)) return []
  return raw.map(s => {
    const o = (s ?? {}) as Record<string, unknown>
    const say = cleanSpoken(o.say)
    const items = Array.isArray(o.items)
      ? o.items.map(sanitizeItem).filter((i): i is BoardItem => !!i).slice(0, 4)
      : []
    return say && items.length ? { say, items } : null
  }).filter((s): s is BoardStep => !!s).slice(0, maxSteps)
}

export class InvalidLessonError extends Error {}

export function sanitizeLesson(raw: unknown, fallback: SyllabusEntry): BoardLessonContent {
  const r = (raw ?? {}) as Record<string, unknown>
  const steps = sanitizeSteps(r.steps, 14)
  if (steps.length < 4) {
    throw new InvalidLessonError(`Leçon générée inexploitable (${steps.length} étapes valides)`)
  }
  const summary = cleanArray(r.summary, 6, 250)
  const summaryMg = cleanArray(r.summaryMg, 6, 250)
  return {
    title: clean(r.title, 120) ?? fallback.title,
    titleMg: clean(r.titleMg, 120) ?? fallback.titleMg,
    objective: clean(r.objective, 300) ?? fallback.objective,
    objectiveMg: clean(r.objectiveMg, 300) ?? '',
    steps,
    summary,
    summaryMg: summaryMg.length === summary.length ? summaryMg : [],
  }
}

export function sanitizeSyllabus(raw: unknown): SyllabusEntry[] {
  const lessons = (raw as Record<string, unknown> | null)?.lessons
  if (!Array.isArray(lessons)) return []
  return lessons.map(l => {
    const o = (l ?? {}) as Record<string, unknown>
    const title = clean(o.title, 120)
    const objective = clean(o.objective, 300)
    return title && objective ? { title, titleMg: clean(o.titleMg, 120) ?? '', objective } : null
  }).filter((l): l is SyllabusEntry => !!l).slice(0, SYLLABUS_SIZE)
}

export function sanitizeAnswer(raw: unknown): BoardAnswer {
  const r = (raw ?? {}) as Record<string, unknown>
  const say = cleanSpoken(r.say) ?? ''
  const items = Array.isArray(r.items)
    ? r.items.map(sanitizeItem).filter((i): i is BoardItem => !!i && i.kind !== 'quiz').slice(0, 3)
    : []
  if (!say && !items.length) throw new InvalidLessonError('Réponse vide')
  return { say, items }
}

/** Gemini peut renvoyer du JSON entouré de ```json … ``` */
export function parseModelJson(rawText: string): unknown {
  const t = rawText.replace(/```json\s*|```/g, '').trim()
  return JSON.parse(t)
}

// --------------------------------------------------------------------
// Audio : PCM 16 bits mono 24 kHz (sortie TTS Gemini) → WAV 16 kHz
// (un tiers de données en moins, important pour le mobile à Madagascar)
// --------------------------------------------------------------------
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function resamplePcm16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = Math.round(input[i0] * (1 - frac) + input[i1] * frac)
  }
  return out
}

export function pcm16ToWav(samples: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  writeStr(36, 'data'); v.setUint32(40, dataLen, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true)
  return new Uint8Array(buf)
}

/** Sortie TTS Gemini (base64 PCM 24 kHz) → fichier WAV 16 kHz prêt à lire. */
export function geminiPcmToWav(b64: string, inRate = 24000, outRate = 16000): Uint8Array<ArrayBuffer> {
  const bytes = base64ToBytes(b64)
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
  return pcm16ToWav(resamplePcm16(pcm, inRate, outRate), outRate)
}
