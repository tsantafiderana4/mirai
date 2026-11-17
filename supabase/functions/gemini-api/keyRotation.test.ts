// deno test supabase/functions/gemini-api/keyRotation.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cooldownUntil, keyFingerprint, nextPacificMidnight, parseQuotaError } from './keyRotation.ts'

// Réponse 429 réelle (forme renvoyée par l'API Gemini en offre gratuite)
const DAILY_429 = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 15, model: gemini-2.5-flash-preview-tts. Please retry in 34.5s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'm', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' },
    ],
  },
})

const MINUTE_429 = JSON.stringify({
  error: {
    code: 429, message: 'Quota exceeded. Please retry in 12s.', status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
    ],
  },
})

Deno.test('429 journalier : détecté, pause jusqu\'à minuit (Pacifique)', () => {
  const info = parseQuotaError(DAILY_429)
  assertEquals(info, { daily: true, retryDelayMs: 34000 })
  const now = new Date('2026-11-17T06:00:00Z') // 22 h la veille à Los Angeles (UTC-8)
  assertEquals(cooldownUntil(info, now).toISOString(), '2026-11-17T08:01:00.000Z')
})

Deno.test('429 par minute : pause du délai indiqué (minimum 30 s)', () => {
  const info = parseQuotaError(MINUTE_429)
  assertEquals(info, { daily: false, retryDelayMs: 12000 })
  const now = new Date('2026-11-17T06:00:00Z')
  assertEquals(cooldownUntil(info, now).getTime() - now.getTime(), 30_000)
  assertEquals(cooldownUntil({ daily: false, retryDelayMs: 45_000 }, now).getTime() - now.getTime(), 45_000)
})

Deno.test('429 sans détails : délai lu dans le message, sinon 60 s', () => {
  assertEquals(parseQuotaError('Please retry in 20.2s'), { daily: false, retryDelayMs: 20200 })
  const info = parseQuotaError('Too many requests')
  assertEquals(info, { daily: false, retryDelayMs: null })
  const now = new Date()
  assertEquals(cooldownUntil(info, now).getTime() - now.getTime(), 60_000)
})

Deno.test('minuit Pacifique : heure d\'été et heure d\'hiver', () => {
  // Hiver (PST, UTC-8)
  assertEquals(nextPacificMidnight(new Date('2026-01-10T12:00:00Z')).toISOString(), '2026-01-11T08:00:00.000Z')
  // Été (PDT, UTC-7)
  assertEquals(nextPacificMidnight(new Date('2026-07-10T12:00:00Z')).toISOString(), '2026-07-11T07:00:00.000Z')
  // Juste avant minuit à Los Angeles
  assertEquals(nextPacificMidnight(new Date('2026-07-11T06:59:00Z')).toISOString(), '2026-07-11T07:00:00.000Z')
})

Deno.test('empreinte de clé : stable, courte, ne révèle pas la clé', async () => {
  const a = await keyFingerprint('AIzaSecret1')
  assertEquals(a, await keyFingerprint('AIzaSecret1'))
  assertEquals(a.length, 24)
  assert(a !== await keyFingerprint('AIzaSecret2'))
  assert(!a.includes('AIza'))
})
