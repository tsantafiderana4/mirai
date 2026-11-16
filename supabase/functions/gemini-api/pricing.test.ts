// deno test supabase/functions/gemini-api/pricing.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { priceRequest, PURPOSE_COSTS, DEFAULT_GENERATION_COST } from './pricing.ts'

Deno.test('message de leçon : 2 crédits', () => {
  assertEquals(priceRequest('generate_stream', 'chat_lesson'), { cost: 2, free: false, generates: true })
})

Deno.test('dialogue : 1 crédit par appel', () => {
  assertEquals(priceRequest('generate_json', 'dialogue_message').cost, 1)
})

Deno.test('exercices : 5 crédits', () => {
  assertEquals(priceRequest('generate_json', 'exercise').cost, 5)
})

Deno.test('audio : message 2, mot 1, examen gratuit', () => {
  assertEquals(priceRequest('generate_speech', 'tts_message').cost, 2)
  assertEquals(priceRequest('generate_speech', 'tts_word').cost, 1)
  assertEquals(priceRequest('generate_speech', 'tts_exam'), { cost: 0, free: true, generates: true })
})

Deno.test('usage inconnu ou absent : coût par défaut, jamais gratuit', () => {
  for (const purpose of [undefined, null, '', 'gratuit_svp', 'constructor', '__proto__', 42]) {
    const p = priceRequest('generate', purpose)
    assertEquals(p.cost, DEFAULT_GENERATION_COST, String(purpose))
    assertEquals(p.free, false, String(purpose))
  }
})

Deno.test('examens : 40 (diagnostic) / 100 (certification), quel que soit purpose', () => {
  assertEquals(priceRequest('generate_exam', 'support', 'diagnostic').cost, 40)
  assertEquals(priceRequest('generate_exam', 'support', 'certification').cost, 100)
  assertEquals(priceRequest('generate_exam', undefined, 'n_importe_quoi').cost, 40)
})

Deno.test('minute vocale : 5 crédits, sans appel Gemini', () => {
  assertEquals(priceRequest('charge_voice_minute', undefined), { cost: 5, free: false, generates: false })
})

Deno.test('aucun tarif négatif', () => {
  for (const [purpose, cost] of Object.entries(PURPOSE_COSTS)) {
    if (cost < 0) throw new Error(`${purpose} a un coût négatif`)
  }
})
