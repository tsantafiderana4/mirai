import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const COSTS: Record<string, number> = {
  generate: 1,
  generate_stream: 1,
  generate_json: 1,
  generate_speech: 2,
  charge_voice_minute: 3
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Non autorisé. Token manquant.' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    const body = await req.json()
    const { action, model, contents, config, schemaType, text, voiceName } = body
    
    if (action === 'health') {
        const apiKey = Deno.env.get('GEMINI_API_KEY');
        return new Response(JSON.stringify({ status: 'ok', hasKey: !!apiKey }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const cost = COSTS[action] || 0
    let newBalance: number | null = null;
    if (cost > 0) {
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Utilisateur non authentifié.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data: newBalanceResult, error: rpcError } = await supabaseClient.rpc('consume_credits', { p_user_id: user.id, p_amount: cost })
      
      if (rpcError || newBalanceResult === null) {
        console.error('[Billing Error]', rpcError || 'Insufficient credits')
        return new Response(JSON.stringify({ error: 'Crédits insuffisants ou accès refusé.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      newBalance = newBalanceResult;
    }

    if (action === 'charge_voice_minute') {
       return new Response(JSON.stringify({ success: true, newBalance }), { 
         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
       })
    }

    // 4. RÉCUPÉRATION DES CLÉS API (ROTATION DYNAMIQUE)
    let keys: string[] = []
    
    // Tentative de récupération depuis la base de données (Table api_keys)
    const { data: dbKeys, error: keysError } = await supabaseClient.rpc('get_active_api_keys', { p_provider: 'gemini' })
    if (!keysError && dbKeys && dbKeys.length > 0) {
        keys = (dbKeys as { key_value: string }[]).map(k => k.key_value)
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

    // Sélection aléatoire d'une clé (Load Balancing / Rotation)
    const selectedKey = keys[Math.floor(Math.random() * keys.length)]
    const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    const targetModel = model || 'gemini-1.5-flash'
    const { systemInstruction, ...genConfig } = config || {}

    if (action === 'generate') {
      const payload: Record<string, unknown> = {
          contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
          generationConfig: genConfig
      }
      if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] }

      const res = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return new Response(JSON.stringify({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || "" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'generate_stream') {
        const payload: Record<string, unknown> = {
            contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
            generationConfig: genConfig
        }
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] }

        const res = await fetch(`${BASE_URL}/${targetModel}:streamGenerateContent?alt=sse&key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!res.ok) throw new Error(await res.text())

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
                                } catch (_e) {
                                    // Ignore parse errors for individual chunks
                                }
                            }
                        }
                    }
                    controller.close()
                } catch (e) { controller.error(e) }
            }
        })

        return new Response(stream, { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' } })
    }

    if (action === 'generate_json') {
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

        const res = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`[Google API Error] ${res.status}:`, errorText);
            throw new Error(`Google API Error: ${res.status} - ${errorText}`);
        }
        const data = await res.json()
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}"
        try {
            const cleanText = rawText.replace(/```json\n?|```/g, '').trim();
            return new Response(JSON.stringify({ json: JSON.parse(cleanText), newBalance }), {
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

        const res = await fetch(`${BASE_URL}/${model || 'gemini-1.5-flash'}:generateContent?key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        return new Response(JSON.stringify({ audioBase64: data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data, newBalance }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    return new Response(JSON.stringify({ error: `Action inconnue: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Edge Function Error]', error)
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
