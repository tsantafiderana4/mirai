// =====================================================================
// Accès à Gemini partagé par toutes les actions (élèves, admin, tâche de
// nuit) : chargement des clés, rotation intelligente avec mise en pause des
// clés épuisées (voir keyRotation.ts), voix du professeur.
// =====================================================================
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3'
import * as Rot from './keyRotation.ts'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const TEXT_CHAIN = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.1-flash-preview', 'gemini-2.5-flash-lite', 'gemini-1.5-flash']
// Uniquement des modèles de synthèse vocale : un modèle texte renvoie
// « only supports text output » et bloque la rotation des clés.
export const TTS_CHAIN = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']

/** Clés Gemini : table api_keys (via RPC), sinon secret GEMINI_API_KEY (séparées par des virgules). */
export async function loadGeminiKeys(admin: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await admin.rpc('get_active_api_keys', { p_provider: 'gemini' })
    if (!error && Array.isArray(data) && data.length > 0) {
      return (data as { key_value: string }[]).map(k => k.key_value).filter(Boolean)
    }
    if (error && error.code !== 'P0001' && !/does not exist/.test(error.message)) {
      console.warn('[Keys RPC Warning]', error.message)
    }
  } catch (e) {
    console.warn('[Keys RPC Exception]', e)
  }
  return (Deno.env.get('GEMINI_API_KEY') ?? '').split(',').map(k => k.trim()).filter(Boolean)
}

export type FetchGemini = (
  endpoint: string, payload: unknown, availableKeys: string[], requestedModel: string, actionType?: 'text' | 'audio',
) => Promise<Response>

export interface GeminiClient {
  keys: string[]
  fetch: FetchGemini
  /** Toutes les clés sont-elles en pause pour ces modèles ? (aucun appel à Google) */
  allPaused: (models: string[]) => boolean
}

/** Rotation intelligente (modèles + clés), pauses partagées entre toutes les instances. */
export async function createGeminiClient(admin: SupabaseClient, keys: string[]): Promise<GeminiClient> {
  const keyFps = new Map<string, string>()
  for (const k of keys) keyFps.set(k, await Rot.keyFingerprint(k))
  const paused = new Set<string>()
  try {
    const { data: pauses } = await admin.from('api_key_cooldowns')
      .select('key_fp, model').gt('until', new Date().toISOString())
    for (const p of pauses ?? []) paused.add(Rot.pauseKey(p.key_fp as string, p.model as string))
  } catch (e) {
    console.warn('[Rotation] Pauses indisponibles :', e)
  }

  async function pauseKeyModel(key: string, model: string, bodyText: string) {
    const fp = keyFps.get(key)!
    const info = Rot.parseQuotaError(bodyText)
    const until = Rot.cooldownUntil(info)
    paused.add(Rot.pauseKey(fp, model))
    console.warn(`[Rotation] Clé ${fp.slice(0, 6)}… en pause pour ${model} jusqu'à ${until.toISOString()} (${info.daily ? 'quota du jour' : 'quota minute'})`)
    try {
      await admin.from('api_key_cooldowns').upsert({
        key_fp: fp, model, until: until.toISOString(), reason: info.daily ? 'daily' : 'minute', updated_at: new Date().toISOString(),
      }, { onConflict: 'key_fp,model' })
    } catch (e) {
      console.warn('[Rotation] Enregistrement de la pause impossible :', e)
    }
  }

  const isPaused = (key: string, model: string) => paused.has(Rot.pauseKey(keyFps.get(key)!, model))

  const fetchGemini: FetchGemini = async (endpoint, payload, availableKeys, requestedModel, actionType = 'text') => {
    const chain = actionType === 'audio' ? TTS_CHAIN : TEXT_CHAIN
    const modelsToTry = [...new Set([requestedModel, ...chain])]
    // Clés mélangées pour équilibrer la charge
    const shuffledKeys = [...availableKeys].sort(() => Math.random() - 0.5)

    let lastResponse: Response | null = null
    let lastErrorText = ''
    let attempted = 0

    for (const currentModel of modelsToTry) {
      for (let i = 0; i < shuffledKeys.length; i++) {
        const currentKey = shuffledKeys[i]
        // Clé en pause pour ce modèle (quota atteint) : on passe directement
        if (isPaused(currentKey, currentModel)) continue
        attempted++
        const separator = endpoint.includes('?') ? '&' : '?'
        const fullUrl = `${BASE_URL}/${currentModel}:${endpoint}${separator}key=${currentKey}`

        try {
          const res = await fetch(fullUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (res.ok) return res

          lastResponse = res
          lastErrorText = await res.text()
          const status = res.status
          console.warn(`[Smart Rotation] Model: ${currentModel}, KeyIndex: ${i}, Status: ${status}`)

          if (status === 429) {
            // Quota dépassé : la clé est mise en pause pour ce modèle, puis clé suivante
            await pauseKeyModel(currentKey, currentModel, lastErrorText)
            continue
          } else if (status === 400 && lastErrorText.includes('API key not valid')) {
            continue // clé invalide : clé suivante
          } else if (status === 404 || status === 503) {
            break // modèle introuvable ou surchargé : modèle suivant
          } else {
            // Autres erreurs (ex. prompt invalide) : on ne réessaie pas
            let errorJson
            try { errorJson = JSON.parse(lastErrorText) } catch { /* ignore */ }
            throw new Error(`Google API Error (${status}): ${errorJson?.error?.message || lastErrorText}`)
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('Google API Error')) throw e
          console.error('[Smart Rotation] Fetch error:', e)
        }
      }
    }

    // Toutes les clés sont épuisées (ou déjà en pause) pour ces modèles
    if (attempted === 0 || lastResponse?.status === 429) {
      throw new Rot.QuotaExhaustedError(actionType === 'audio' ? 'audio' : 'text')
    }
    if (lastResponse) {
      let errorJson
      try { errorJson = JSON.parse(lastErrorText) } catch { /* ignore */ }
      throw new Error(`Google API Error (${lastResponse.status}) after all retries: ${errorJson?.error?.message || lastErrorText}`)
    }
    throw new Error('Failed to fetch from Google API: All keys and models exhausted.')
  }

  return {
    keys,
    fetch: fetchGemini,
    allPaused: (models) => keys.every(k => models.every(m => isPaused(k, m))),
  }
}

/** Synthèse vocale du professeur (français, ton chaleureux) → base64 PCM 24 kHz. */
export async function teacherVoice(gemini: GeminiClient, spoken: string, voice: string): Promise<string> {
  const res = await gemini.fetch('generateContent', {
    contents: [{ parts: [{ text: `Lis ce texte en français, d'une voix chaleureuse, claire et posée de professeur : ${spoken}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  }, gemini.keys, TTS_CHAIN[0], 'audio')
  const data = await res.json()
  const parts = (data.candidates?.[0]?.content?.parts ?? []) as { inlineData?: { data?: string } }[]
  const b64 = parts.find(p => p.inlineData?.data)?.inlineData?.data
  if (!b64) throw new Error('Audio vide')
  return b64
}
