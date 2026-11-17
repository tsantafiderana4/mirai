// =====================================================================
// Rotation intelligente des clés Gemini (plans gratuits).
//
// Quand Google répond 429 (quota dépassé), la paire « clé + modèle » est
// mise en pause jusqu'à ce que le quota revienne :
//   - quota PAR MINUTE  → pause du délai indiqué par Google (RetryInfo) ;
//   - quota PAR JOUR    → pause jusqu'à minuit, heure du Pacifique
//                         (heure de remise à zéro des quotas Gemini).
// Les pauses sont enregistrées en base (table api_key_cooldowns) : toutes
// les instances de la fonction en profitent, et on ne perd plus de temps à
// réessayer une clé épuisée à chaque requête.
//
// NB : les quotas gratuits sont comptés PAR PROJET Google Cloud. Plusieurs
// clés créées dans le même projet partagent le même quota.
// =====================================================================

export interface QuotaInfo {
  /** Quota journalier (sinon : par minute / ponctuel). */
  daily: boolean
  /** Délai conseillé par Google, en millisecondes, s'il est fourni. */
  retryDelayMs: number | null
}

const MIN_PAUSE_MS = 30_000
const DEFAULT_PAUSE_MS = 60_000
const MAX_SHORT_PAUSE_MS = 60 * 60_000

/** Analyse le corps d'une réponse 429 de l'API Gemini. */
export function parseQuotaError(bodyText: string): QuotaInfo {
  let daily = /per ?day|PerDay|daily/i.test(bodyText)
  let retryDelayMs: number | null = null
  try {
    const details = JSON.parse(bodyText)?.error?.details
    if (Array.isArray(details)) {
      for (const d of details) {
        const type = String(d?.['@type'] ?? '')
        if (type.endsWith('RetryInfo') && typeof d.retryDelay === 'string') {
          const s = parseFloat(d.retryDelay)
          if (Number.isFinite(s)) retryDelayMs = Math.round(s * 1000)
        }
        if (type.endsWith('QuotaFailure') && Array.isArray(d.violations)) {
          if (d.violations.some((v: { quotaId?: string }) => /PerDay/i.test(String(v?.quotaId ?? '')))) daily = true
        }
      }
    }
  } catch { /* corps non JSON : on garde l'analyse textuelle */ }
  if (retryDelayMs === null) {
    const m = bodyText.match(/retry in ([\d.]+)\s*s/i)
    if (m) retryDelayMs = Math.round(parseFloat(m[1]) * 1000)
  }
  return { daily, retryDelayMs }
}

/** Décalage (ms) de l'heure du Pacifique par rapport à UTC à cet instant (DST compris). */
function pacificOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** Prochain minuit à Los Angeles (remise à zéro des quotas journaliers Gemini). */
export function nextPacificMidnight(now: Date): Date {
  const offset = pacificOffsetMs(now)
  const local = new Date(now.getTime() + offset) // « heure murale » du Pacifique, lue en UTC
  const nextLocalMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)
  // Le décalage du lendemain peut différer (changement d'heure) : on le recalcule
  const guess = new Date(nextLocalMidnight - offset)
  return new Date(nextLocalMidnight - pacificOffsetMs(guess))
}

/** Jusqu'à quand mettre en pause une clé (pour un modèle) après un 429. */
export function cooldownUntil(info: QuotaInfo, now: Date = new Date()): Date {
  if (info.daily) return new Date(nextPacificMidnight(now).getTime() + 60_000)
  const ms = info.retryDelayMs === null
    ? DEFAULT_PAUSE_MS
    : Math.min(Math.max(info.retryDelayMs, MIN_PAUSE_MS), MAX_SHORT_PAUSE_MS)
  return new Date(now.getTime() + ms)
}

/** Empreinte d'une clé (on ne stocke jamais la clé elle-même dans la table des pauses). */
export async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const pauseKey = (fingerprint: string, model: string) => `${fingerprint}|${model}`

/** Erreur levée quand toutes les clés sont en pause pour les modèles demandés. */
export class QuotaExhaustedError extends Error {
  constructor(public readonly kind: 'text' | 'audio') {
    super(kind === 'audio'
      ? "Quota de voix IA atteint pour aujourd'hui."
      : "Quota de l'IA atteint pour le moment. Réessaie plus tard.")
  }
}
