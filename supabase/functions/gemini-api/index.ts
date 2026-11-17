import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3'

import { priceRequest, RATE_LIMIT_MESSAGES, BOARD_LESSON_COST } from './pricing.ts'
import * as Board from './boardLesson.ts'
import * as Rot from './keyRotation.ts'
import { encodeTeacherAudio, type EncodedAudio } from './audio.ts'
import { createGeminiClient, loadGeminiKeys, teacherVoice, TTS_CHAIN, type GeminiClient } from './gemini.ts'
import { audioFilesForSteps, changedSpokenSteps, firstMissingStep, PREGEN_VOICE } from './boardOps.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // Permet au navigateur de lire le nouveau solde pendant un streaming
  'Access-Control-Expose-Headers': 'x-new-balance',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Produit la voix d'une étape (MP3), la range dans le bucket et renvoie une URL signée. */
async function storeStepAudio(
  db: SupabaseClient, gemini: GeminiClient, lessonId: string, i: number, voice: string, say: string,
): Promise<{ audio: EncodedAudio; url?: string }> {
  const audio = encodeTeacherAudio(await teacherVoice(gemini, say, voice))
  const bucket = db.storage.from('lesson-audio')
  const path = `${lessonId}/${i}-${voice}.${audio.ext}`
  const { error } = await bucket.upload(path, new Blob([audio.bytes], { type: audio.mime }), { contentType: audio.mime, upsert: true })
  if (error) {
    console.warn('[Board] Stockage audio indisponible :', error.message)
    return { audio }
  }
  const signed = await bucket.createSignedUrl(path, 3600)
  return { audio, url: signed.data?.signedUrl }
}

/** Supprime l'audio stocké des étapes données (après une correction admin). */
async function purgeStepAudio(db: SupabaseClient, lessonId: string, steps: number[] | 'all'): Promise<number> {
  const bucket = db.storage.from('lesson-audio')
  const { data: files } = await bucket.list(lessonId, { limit: 500 })
  const names = audioFilesForSteps((files ?? []).map(f => f.name), steps)
  if (!names.length) return 0
  const { error } = await bucket.remove(names.map(n => `${lessonId}/${n}`))
  if (error) console.warn('[Board] Suppression audio impossible :', error.message)
  return error ? 0 : names.length
}

/**
 * Tâche de nuit (pg_cron) : produit UNE voix manquante, en commençant par
 * les leçons les plus suivies. Elle consomme le quota TTS gratuit restant
 * avant sa remise à zéro ; dès qu'une clé est épuisée, elle est en pause et
 * les appels suivants s'arrêtent sans rien demander à Google.
 */
async function runNightlyPregen(db: SupabaseClient, secret: string | null): Promise<Response> {
  const { data: ok } = await db.rpc('cron_secret_ok', { p_secret: secret ?? '' })
  if (ok !== true) return json({ error: 'Non autorisé.' }, 401)

  const keys = await loadGeminiKeys(db)
  if (!keys.length) return json({ skipped: 'no_keys' })
  const gemini = await createGeminiClient(db, keys)
  if (gemini.allPaused(TTS_CHAIN)) return json({ skipped: 'quota' })

  const { data: candidates, error } = await db.rpc('board_pregen_candidates', { p_limit: 40 })
  if (error) throw new Error(error.message)
  const bucket = db.storage.from('lesson-audio')
  for (const c of (candidates ?? []) as { lesson_id: string; step_count: number }[]) {
    const { data: files } = await bucket.list(c.lesson_id, { limit: 500 })
    const i = firstMissingStep(c.step_count, (files ?? []).map(f => f.name), PREGEN_VOICE)
    if (i < 0) continue
    const { data: row } = await db.from('board_lessons').select('content').eq('id', c.lesson_id).single()
    const say = (row?.content as Board.BoardLessonContent | undefined)?.steps?.[i]?.say
    if (!say) continue
    try {
      await storeStepAudio(db, gemini, c.lesson_id, i, PREGEN_VOICE, say)
    } catch (e) {
      if (e instanceof Rot.QuotaExhaustedError) return json({ skipped: 'quota' })
      throw e
    }
    console.log(`[Pregen] Voix prête : leçon ${c.lesson_id}, étape ${i}`)
    return json({ generated: { lessonId: c.lesson_id, step: i } })
  }
  return json({ done: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let creditsDeducted = 0;
  let refundUserId: string | null = null;
  let adminClient: SupabaseClient | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      console.error('Missing Supabase environment variables')
      return json({ error: 'Configuration serveur incomplète (Env vars manquantes).' }, 500)
    }

    const body = await req.json()
    const { action, model, contents, config, schemaType, text, voiceName } = body

    if (action === 'health') {
      return json({ status: 'ok' })
    }

    // Client "serveur" : clés API, écritures des leçons, remboursements.
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

    // Tâche planifiée (pas d'utilisateur) : authentifiée par un secret partagé
    if (action === 'cron_pregen_audio') {
      return await runNightlyPregen(adminClient, req.headers.get('x-cron-secret'))
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Non autorisé. Token manquant.' }, 401)
    }

    // Client "utilisateur" : les RPC s'exécutent avec SES droits (RLS).
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Utilisateur non authentifié.' }, 401)
    }

    const { data: profile } = await adminClient
      .from('profiles')
      .select('credits, is_suspended, role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.is_suspended) {
      return json({ error: 'Compte suspendu ou introuvable.' }, 403)
    }

    const isAdmin = profile.role === 'admin'
    const { cost, free, generates, selfBilled } = priceRequest(action, body.purpose, body.examType)

    if (!isAdmin && !selfBilled && cost === 0 && (profile.credits ?? 0) <= 0) {
      return json({ error: 'Crédits insuffisants.' }, 402)
    }

    // Limite de débit (anti-abus) avant tout appel à Gemini
    if (generates && !isAdmin) {
      const { data: limited, error: rateError } = await adminClient.rpc('ai_rate_check', {
        p_user_id: user.id,
        p_is_free: free,
      })
      if (rateError) {
        console.warn('[Rate limit] indisponible :', rateError.message)
      } else if (limited) {
        return json({ error: RATE_LIMIT_MESSAGES[limited as string] || 'Limite atteinte.', limit: limited }, 429)
      }
    }

    let newBalance: number | null = null

    if (cost > 0 && !isAdmin) {
      const { data: newBalanceResult, error: rpcError } = await supabaseClient.rpc('consume_credits', { p_amount: cost })
      if (rpcError || newBalanceResult === null) {
        return json({ error: 'Crédits insuffisants.' }, 402)
      }
      newBalance = newBalanceResult as number
      creditsDeducted = cost
      refundUserId = user.id
    }

    if (action === 'charge_voice_minute') {
      return json({ success: true, newBalance })
    }

    // Clés Gemini + rotation intelligente (pauses des clés épuisées)
    const keys = await loadGeminiKeys(adminClient)
    if (keys.length === 0) {
      return json({ error: 'Aucune clé API Gemini disponible (ni en BDD, ni en ENV).' }, 500)
    }
    const gemini = await createGeminiClient(adminClient, keys)
    const fetchWithSmartRotation = gemini.fetch

    const targetModel = model || 'gemini-3-flash-preview'
    const { systemInstruction, ...genConfig } = config || {}

    if (action === 'live_token') {
      // Jeton éphémère pour l'API Live (voix temps réel) : la vraie clé ne
      // quitte jamais le serveur. 1 utilisation, session à ouvrir sous 2 min.
      const now = Date.now()
      const tokenBody = {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
      }
      let lastErr = ''
      for (const k of [...keys].sort(() => Math.random() - 0.5)) {
        const res = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
          body: JSON.stringify(tokenBody),
        })
        if (res.ok) {
          const data = await res.json()
          return json({ token: data.name })
        }
        lastErr = `${res.status} ${await res.text()}`
      }
      throw new Error(`Impossible de créer un jeton Live: ${lastErr}`)
    }

    // =================================================================
    // LEÇON AU TABLEAU
    // =================================================================
    const VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'])
    const db = adminClient

    // Les Edge Functions sont coupées au bout de 150 s : on ne relance un essai
    // que s'il reste assez de temps pour qu'il aboutisse.
    const BOARD_RETRY_DEADLINE_MS = 60_000
    const boardStart = Date.now()

    /**
     * Appel Gemini avec schéma JSON imposé ; ignore les parties « pensée ».
     * Sortie plafonnée : une leçon tient en ~4 000 jetons ; au-delà, le modèle
     * « s'emballe » (répétitions). Une réponse coupée est récupérée jusqu'au
     * dernier élément complet.
     */
    async function generateJson(prompt: string, schema: unknown, temperature = 0.6): Promise<unknown> {
      const res = await fetchWithSmartRotation('generateContent', {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature, maxOutputTokens: 10000 },
      }, keys, 'gemini-3-flash-preview')
      const data = await res.json()
      const candidate = data.candidates?.[0]
      const parts = (candidate?.content?.parts ?? []) as { text?: string; thought?: boolean }[]
      const raw = parts.filter(p => !p.thought).map(p => p.text ?? '').join('')
      try {
        const parsed = Board.parseModelJsonDetailed(raw)
        if (parsed.repaired) {
          console.warn(`[Board] Réponse coupée (finishReason=${candidate?.finishReason}, ${raw.length} car.) : partie complète récupérée`)
        }
        return parsed.value
      } catch (e) {
        console.warn(`[Board] JSON illisible (finishReason=${candidate?.finishReason}, ${raw.length} car.). Fin : …${raw.slice(-300)}`)
        throw e
      }
    }

    /** Génère, valide et réessaie une fois si la sortie est inexploitable ET s'il reste du temps. */
    async function generateValid<T>(prompt: string, schema: unknown, sanitize: (raw: unknown) => T): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          return sanitize(await generateJson(prompt, schema, attempt === 0 ? 0.6 : 0.3))
        } catch (e) {
          const retryable = e instanceof Board.InvalidLessonError || e instanceof SyntaxError
          const elapsed = Date.now() - boardStart
          if (!retryable || attempt >= 1 || elapsed > BOARD_RETRY_DEADLINE_MS) throw e
          console.warn(`[Board] Sortie invalide après ${Math.round(elapsed / 1000)} s, nouvel essai :`, (e as Error).message)
        }
      }
    }

    async function getSyllabus(lang: string, level: string): Promise<Board.SyllabusEntry[]> {
      const key = Board.syllabusKey(lang, level)
      const { data: cached } = await db.from('board_syllabus').select('lessons').eq('cache_key', key).maybeSingle()
      if (cached?.lessons) return cached.lessons as Board.SyllabusEntry[]

      const lessons = await generateValid(Board.buildSyllabusPrompt(lang, level), Board.SYLLABUS_SCHEMA, raw => {
        const l = Board.sanitizeSyllabus(raw)
        if (l.length < 10) throw new Board.InvalidLessonError(`Programme trop court (${l.length})`)
        return l
      })
      await db.from('board_syllabus').upsert({ cache_key: key, language: lang, level, lessons }, { onConflict: 'cache_key', ignoreDuplicates: true })
      // En cas de génération simultanée, on garde la version enregistrée en premier
      const { data: saved } = await db.from('board_syllabus').select('lessons').eq('cache_key', key).single()
      return (saved?.lessons ?? lessons) as Board.SyllabusEntry[]
    }

    /** Leçon débloquée par l'utilisateur (ou admin), sinon null. */
    async function loadUnlockedLesson(lessonId: unknown) {
      if (typeof lessonId !== 'string' || !UUID_RE.test(lessonId)) return null
      if (!isAdmin) {
        const { data: acc } = await db.from('board_lesson_access').select('lesson_id')
          .eq('user_id', user!.id).eq('lesson_id', lessonId).maybeSingle()
        if (!acc) return null
      }
      const { data } = await db.from('board_lessons').select('id, language, level, content').eq('id', lessonId).maybeSingle()
      return data as { id: string; language: string; level: string; content: Board.BoardLessonContent } | null
    }

    if (action === 'board_syllabus') {
      const lang = Board.normalizeLanguage(body.language)
      const level = Board.normalizeLevel(body.level)
      if (!lang || !level) return json({ error: 'Langue ou niveau invalide.' }, 400)

      const syllabus = await getSyllabus(lang, level)
      const { data: rows } = await db.from('board_lessons').select('id, lesson_number').eq('language', lang).eq('level', level)
      const ids = (rows ?? []).map(r => r.id)
      const { data: access } = ids.length
        ? await db.from('board_lesson_access').select('lesson_id, completed').eq('user_id', user.id).in('lesson_id', ids)
        : { data: [] as { lesson_id: string; completed: boolean }[] }
      const byNumber = new Map((rows ?? []).map(r => [r.lesson_number as number, r.id as string]))
      const accessById = new Map((access ?? []).map(a => [a.lesson_id, a.completed]))

      return json({
        language: lang, level, price: BOARD_LESSON_COST,
        lessons: syllabus.map((e, i) => {
          const id = byNumber.get(i + 1)
          return {
            number: i + 1, ...e,
            unlocked: isAdmin || (!!id && accessById.has(id)),
            completed: !!id && accessById.get(id) === true,
          }
        }),
      })
    }

    if (action === 'board_lesson_open') {
      const lang = Board.normalizeLanguage(body.language)
      const level = Board.normalizeLevel(body.level)
      const n = Board.normalizeLessonNumber(body.lessonNumber)
      if (!lang || !level || !n) return json({ error: 'Paramètres de leçon invalides.' }, 400)

      const key = Board.lessonKey(lang, level, n)
      let { data: row } = await db.from('board_lessons').select('id, content').eq('cache_key', key).maybeSingle()

      let alreadyOwned = isAdmin
      if (row && !isAdmin) {
        const { data: acc } = await db.from('board_lesson_access').select('lesson_id')
          .eq('user_id', user.id).eq('lesson_id', row.id).maybeSingle()
        alreadyOwned = !!acc
      }

      // Paiement AVANT la génération : en cas d'échec, le catch rembourse.
      if (!alreadyOwned) {
        const { data: bal, error: payErr } = await supabaseClient.rpc('consume_credits', { p_amount: BOARD_LESSON_COST })
        if (payErr || bal === null) return json({ error: 'Crédits insuffisants.' }, 402)
        newBalance = bal as number
        creditsDeducted = BOARD_LESSON_COST
        refundUserId = user.id
      }

      if (!row) {
        const syllabus = await getSyllabus(lang, level)
        const entry = syllabus[n - 1]
        if (!entry) throw new Error(`Leçon ${n} absente du programme.`)
        const prompt = Board.buildLessonPrompt(lang, level, n, entry, syllabus.slice(0, n - 1).map(e => e.title))
        const content = await generateValid(prompt, Board.LESSON_SCHEMA, raw => Board.sanitizeLesson(raw, entry))

        await db.from('board_lessons').upsert({
          cache_key: key, language: lang, level, lesson_number: n,
          title: content.title, title_mg: content.titleMg, content,
        }, { onConflict: 'cache_key', ignoreDuplicates: true })
        const { data: saved, error: savedErr } = await db.from('board_lessons').select('id, content').eq('cache_key', key).single()
        if (savedErr || !saved) throw new Error('Enregistrement de la leçon impossible.')
        row = saved
      }

      if (!isAdmin) {
        const { error: accErr } = await db.from('board_lesson_access')
          .upsert({ user_id: user.id, lesson_id: row.id }, { onConflict: 'user_id,lesson_id', ignoreDuplicates: true })
        if (accErr) throw new Error("Déblocage de la leçon impossible.")
      }

      creditsDeducted = 0 // succès : plus rien à rembourser
      return json({
        lesson: { id: row.id, language: lang, level, number: n, ...(row.content as Board.BoardLessonContent) },
        alreadyOwned, newBalance,
      })
    }

    if (action === 'board_step_audio') {
      const lesson = await loadUnlockedLesson(body.lessonId)
      if (!lesson) return json({ error: 'Leçon non débloquée.' }, 403)
      const i = Number(body.stepIndex)
      const step = Number.isInteger(i) ? lesson.content.steps[i] : undefined
      if (!step) return json({ error: 'Étape inconnue.' }, 400)
      const voice = VOICES.has(body.voiceName) ? body.voiceName as string : 'Kore'

      // MP3 compact (~10× plus léger que le WAV) : stockage et trafic gratuits préservés
      const bucket = db.storage.from('lesson-audio')
      const path = `${lesson.id}/${i}-${voice}.mp3`
      const legacyPath = `${lesson.id}/${i}-${voice}.wav`
      // Audio déjà produit (MP3, ou ancien WAV) : aucun nouvel appel TTS, le quota est préservé
      for (const p of [path, legacyPath]) {
        const existing = await bucket.createSignedUrl(p, 3600)
        if (existing.data?.signedUrl) return json({ url: existing.data.signedUrl })
      }

      const stored = await storeStepAudio(db, gemini, lesson.id, i, voice, step.say)
      if (stored.url) return json({ url: stored.url })
      return json({ audioBase64: Board.bytesToBase64(stored.audio.bytes), audioMime: stored.audio.mime })
    }

    // -----------------------------------------------------------------
    // Correction d'une leçon par l'admin : modification ou régénération.
    // La correction vaut pour tous les élèves ; l'audio périmé est supprimé.
    // -----------------------------------------------------------------
    if (action === 'board_admin_save' || action === 'board_admin_regenerate') {
      if (!isAdmin) return json({ error: "Réservé à l'administrateur." }, 403)
      if (typeof body.lessonId !== 'string' || !UUID_RE.test(body.lessonId)) return json({ error: 'Leçon invalide.' }, 400)
      const { data: row } = await db.from('board_lessons')
        .select('id, language, level, lesson_number, content').eq('id', body.lessonId).maybeSingle()
      if (!row) return json({ error: 'Leçon introuvable.' }, 404)
      const old = row.content as Board.BoardLessonContent
      const fallback: Board.SyllabusEntry = { title: old.title, titleMg: old.titleMg, objective: old.objective }

      let content: Board.BoardLessonContent
      if (action === 'board_admin_save') {
        try {
          content = Board.sanitizeLesson(body.content, fallback)
        } catch (e) {
          if (e instanceof Board.InvalidLessonError) return json({ error: 'Leçon incomplète : il faut au moins 4 étapes avec un texte parlé et un élément au tableau.' }, 400)
          throw e
        }
      } else {
        const syllabus = await getSyllabus(row.language, row.level)
        const n = row.lesson_number as number
        const entry = syllabus[n - 1] ?? fallback
        const prompt = Board.buildLessonPrompt(row.language, row.level, n, entry, syllabus.slice(0, n - 1).map(e => e.title))
        content = await generateValid(prompt, Board.LESSON_SCHEMA, raw => Board.sanitizeLesson(raw, entry))
      }

      const { error: upErr } = await db.from('board_lessons')
        .update({ content, title: content.title, title_mg: content.titleMg }).eq('id', row.id)
      if (upErr) throw new Error(`Enregistrement impossible : ${upErr.message}`)
      const stale = action === 'board_admin_regenerate'
        ? 'all' as const
        : changedSpokenSteps((old.steps ?? []).map(s => s.say), content.steps.map(s => s.say))
      const removedAudio = await purgeStepAudio(db, row.id, stale)
      return json({
        lesson: { id: row.id, language: row.language, level: row.level, number: row.lesson_number, ...content },
        removedAudio,
      })
    }

    if (action === 'board_question') {
      const lesson = await loadUnlockedLesson(body.lessonId)
      if (!lesson) return json({ error: 'Leçon non débloquée.' }, 403)
      const question = typeof body.question === 'string' ? body.question.trim() : ''
      if (question.length < 2) return json({ error: 'Question vide.' }, 400)

      const prompt = Board.buildQuestionPrompt(lesson.language, lesson.level, lesson.content, Number(body.stepIndex) || 0, question)
      const answer = await generateValid(prompt, Board.ANSWER_SCHEMA, Board.sanitizeAnswer)

      // Voix : facultative, la réponse écrite reste utilisable si la TTS échoue
      let audioBase64: string | undefined
      let audioMime: string | undefined
      if (answer.say) {
        try {
          const voice = VOICES.has(body.voiceName) ? body.voiceName as string : 'Kore'
          const audio = encodeTeacherAudio(await teacherVoice(gemini, answer.say, voice))
          audioBase64 = Board.bytesToBase64(audio.bytes)
          audioMime = audio.mime
        } catch (e) {
          console.warn('[Board] Voix de la réponse indisponible :', (e as Error).message)
        }
      }
      creditsDeducted = 0
      return json({ answer, audioBase64, audioMime, newBalance })
    }

    if (action === 'generate') {
      const payload: Record<string, unknown> = {
          contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
          generationConfig: genConfig
      }
      if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] }

      const res = await fetchWithSmartRotation('generateContent', payload, keys, targetModel);
      const data = await res.json()
      return new Response(JSON.stringify({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || "", newBalance }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'generate_stream') {
        const payload: Record<string, unknown> = {
            contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
            generationConfig: genConfig
        }
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] }

        const res = await fetchWithSmartRotation('streamGenerateContent?alt=sse', payload, keys, targetModel);

        const reader = res.body?.getReader()
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()

        const stream = new ReadableStream({
            async start(controller) {
                if (!reader) { controller.close(); return; }
                try {
                    let buffer = ""
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        buffer += decoder.decode(value, { stream: true })
                        const lines = buffer.split('\n')
                        buffer = lines.pop() || ""
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const jsonStr = line.slice(6).trim()
                                if (jsonStr === '[DONE]') continue
                                try {
                                    const data = JSON.parse(jsonStr)
                                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
                                    if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
                                } catch {
                                    // Ignore parse errors for individual chunks
                                }
                            }
                        }
                    }
                    controller.close()
                } catch (e) { controller.error(e) }
            }
        })

        const streamHeaders: Record<string, string> = { ...corsHeaders, 'Content-Type': 'text/event-stream' }
        if (newBalance !== null) streamHeaders['x-new-balance'] = String(newBalance)
        return new Response(stream, { headers: streamHeaders })
    }

    if (action === 'generate_json' || action === 'generate_exam') {
        let schema = config?.responseSchema
        if (schemaType === 'ARRAY_VOCAB') {
            schema = { type: 'ARRAY', items: { type: 'OBJECT', properties: { word: { type: 'STRING' }, translation: { type: 'STRING' }, example: { type: 'STRING' } } } }
        } else if (schemaType === 'ARRAY_EXERCISE') {
            schema = { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, type: { type: 'STRING' }, question: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } }, correctAnswer: { type: 'STRING' }, explanation: { type: 'STRING' } }, required: ["type", "question", "correctAnswer", "explanation"] } }
        } else if (schemaType === 'OBJECT_ROLEPLAY') {
            schema = { type: 'OBJECT', properties: { aiReply: { type: 'STRING' }, correction: { type: 'STRING' }, explanation: { type: 'STRING' }, score: { type: 'NUMBER' }, feedback: { type: 'STRING' } }, required: ["aiReply"] }
        }

        const payload: Record<string, unknown> = {
            contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
            generationConfig: { ...genConfig, responseMimeType: 'application/json', responseSchema: schema }
        }
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] }

        const res = await fetchWithSmartRotation('generateContent', payload, keys, targetModel);
        
        const data = await res.json()
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}"
        try {
            const cleanText = rawText.replace(/```json\n?|```/g, '').trim();
            const parsed = JSON.parse(cleanText)
            if (action === 'generate_exam' && (!Array.isArray(parsed?.sections) || parsed.sections.length === 0)) {
                // Examen inutilisable : on lève une erreur pour déclencher le remboursement
                throw new Error("Examen généré invalide (sections manquantes)")
            }
            return new Response(JSON.stringify({ json: parsed, newBalance }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        } catch (parseError: unknown) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            console.error("[JSON Parse Error]", parseError, "Raw Text:", rawText);
            throw new Error(`Failed to parse AI response as JSON: ${errorMessage}`);
        }
    }

    if (action === 'generate_speech') {
        const payload: Record<string, unknown> = {
            contents: [{ parts: [{ text: text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } } }
        }

        const res = await fetchWithSmartRotation('generateContent', payload, keys, targetModel, 'audio');
        
        const data = await res.json()
        return new Response(JSON.stringify({ audioBase64: data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data, newBalance }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    return new Response(JSON.stringify({ error: `Action inconnue: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: unknown) {
    if (creditsDeducted > 0 && refundUserId && adminClient) {
      console.log(`[Refund] ${creditsDeducted} crédits remboursés à ${refundUserId}`)
      await adminClient.rpc('refund_credits', { p_user_id: refundUserId, p_amount: creditsDeducted })
    }
    if (error instanceof Rot.QuotaExhaustedError) {
      console.warn('[Rotation] Toutes les clés sont en pause :', error.kind)
      return json({ error: error.message, quota: error.kind }, 429)
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Edge Function Error]', error)
    return json({ error: errorMessage }, 500)
  }
})
