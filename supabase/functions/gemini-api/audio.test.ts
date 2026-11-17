// deno test supabase/functions/gemini-api/audio.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { encodeTeacherAudio, pcm16ToMp3 } from './audio.ts'
import { bytesToBase64 } from './boardLesson.ts'

/** Voix simulée : 15 s de PCM 24 kHz, comme la sortie TTS de Gemini. */
function fakeGeminiPcm(seconds: number): string {
  const pcm = new Int16Array(24000 * seconds).map((_, i) => Math.round(Math.sin(i / 8) * 8000 + Math.sin(i / 37) * 4000))
  return bytesToBase64(new Uint8Array(pcm.buffer))
}

Deno.test('voix → MP3 valide, au moins 8× plus léger que le WAV', () => {
  const out = encodeTeacherAudio(fakeGeminiPcm(15))
  assertEquals(out.mime, 'audio/mpeg')
  assertEquals(out.ext, 'mp3')
  // En-tête de trame MP3 (synchro 11 bits à 1)
  assert(out.bytes[0] === 0xff && (out.bytes[1] & 0xe0) === 0xe0, 'trame MP3 attendue')
  const wavSize = 44 + 16000 * 2 * 15
  assert(out.bytes.length * 8 < wavSize, `MP3 trop lourd : ${out.bytes.length} o`)
  assert(out.bytes.length > 20_000, 'MP3 anormalement petit')
})

Deno.test('encodage rapide (marge sous la limite CPU de 2 s des Edge Functions)', () => {
  const b64 = fakeGeminiPcm(25)
  encodeTeacherAudio(fakeGeminiPcm(1)) // échauffement
  const t0 = performance.now()
  encodeTeacherAudio(b64)
  const ms = performance.now() - t0
  assert(ms < 1500, `encodage trop lent : ${Math.round(ms)} ms`)
})

Deno.test('silence très court : MP3 valide quand même', () => {
  const out = pcm16ToMp3(new Int16Array(100), 16000)
  assert(out.length > 0)
})
