import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3'

import { priceRequest, RATE_LIMIT_MESSAGES } from './pricing.ts'

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

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Non autorisé. Token manquant.' }, 401)
    }

    // Client "utilisateur" : les RPC s'exécutent avec SES droits (RLS).
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    // Client "serveur" : lecture des clés API et remboursements uniquement.
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
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
    const { cost, free, generates } = priceRequest(action, body.purpose, body.examType)

    if (!isAdmin && cost === 0 && (profile.credits ?? 0) <= 0) {
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

    // 4. RÉCUPÉRATION DES CLÉS API (ROTATION DYNAMIQUE)
    let keys: string[] = []
    
    // Tentative de récupération depuis la base de données (Table api_keys)
    try {
        const { data: dbKeys, error: keysError } = await adminClient.rpc('get_active_api_keys', { p_provider: 'gemini' })
        if (!keysError && dbKeys && dbKeys.length > 0) {
            keys = (dbKeys as { key_value: string }[]).map(k => k.key_value)
        } else if (keysError && keysError.code !== 'P0001' && keysError.message !== 'function public.get_active_api_keys(text) does not exist') {
            console.warn('[Keys RPC Warning]', keysError.message)
        }
    } catch (e) {
        console.warn('[Keys RPC Exception]', e)
    }

    // Fallback sur les variables d'environnement si la BDD est vide
    if (keys.length === 0) {
        const envKey = Deno.env.get('GEMINI_API_KEY')
        if (envKey) {
            keys = envKey.split(',').map(k => k.trim()).filter(k => k)
        }
    }

    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: 'Aucune clé API Gemini disponible (ni en BDD, ni en ENV).' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fonction de rotation intelligente (Modèles + Clés)
    async function fetchWithSmartRotation(endpoint: string, payload: unknown, availableKeys: string[], requestedModel: string, actionType: string = 'text') {
        const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
        // Chaîne de fallback par défaut
        let defaultChain = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.1-flash-preview', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];
        
        if (actionType === 'audio') {
            defaultChain = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts-001', 'gemini-2.5-pro-tts-001', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'];
        }

        const modelsToTry = [...new Set([requestedModel, ...defaultChain])];
        
        // Mélanger les clés pour équilibrer la charge
        const shuffledKeys = [...availableKeys].sort(() => Math.random() - 0.5);
        
        let lastResponse: Response | null = null;
        let lastErrorText = "";

        for (const currentModel of modelsToTry) {
            for (let i = 0; i < shuffledKeys.length; i++) {
                const currentKey = shuffledKeys[i];
                const separator = endpoint.includes('?') ? '&' : '?';
                const fullUrl = `${BASE_URL}/${currentModel}:${endpoint}${separator}key=${currentKey}`;

                try {
                    const res = await fetch(fullUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (res.ok) {
                        return res;
                    }

                    lastResponse = res;
                    lastErrorText = await res.text();
                    const status = res.status;

                    console.warn(`[Smart Rotation] Model: ${currentModel}, KeyIndex: ${i}, Status: ${status}`);

                    if (status === 429) {
                        continue; // Quota dépassé, on essaie la clé suivante
                    } else if (status === 400 && lastErrorText.includes("API key not valid")) {
                        continue; // Clé invalide, on essaie la clé suivante
                    } else if (status === 404 || status === 503) {
                        break; // Modèle introuvable ou surchargé, on passe au modèle suivant
                    } else {
                        // Autres erreurs (ex: prompt invalide), on ne réessaie pas
                        let errorJson;
                        try { errorJson = JSON.parse(lastErrorText); } catch { /* ignore */ }
                        const message = errorJson?.error?.message || lastErrorText;
                        throw new Error(`Google API Error (${status}): ${message}`);
                    }
                } catch (e) {
                    if (e instanceof Error && e.message.includes('Google API Error')) {
                        throw e;
                    }
                    console.error(`[Smart Rotation] Fetch error:`, e);
                }
            }
        }

        if (lastResponse) {
            let errorJson;
            try { errorJson = JSON.parse(lastErrorText); } catch { /* ignore */ }
            const message = errorJson?.error?.message || lastErrorText;
            throw new Error(`Google API Error (${lastResponse.status}) after all retries: ${message}`);
        }

        throw new Error("Failed to fetch from Google API: All keys and models exhausted.");
    }

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
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Edge Function Error]', error)
    return json({ error: errorMessage }, 500)
  }
})
