// =====================================================================
// Audio des leçons : sortie TTS Gemini (PCM 16 bits mono 24 kHz, base64)
// → MP3 16 kHz / 24 kbps.
//
// Pourquoi : en WAV, une étape de 15 s pèse ~470 Ko ; en MP3 ~44 Ko
// (10× moins). C'est ce qui permet de rester dans le stockage (1 Go) et le
// trafic gratuits de Supabase, et d'économiser la data des élèves.
// Encodage mesuré : ~0,4 s de CPU pour 15-25 s de voix (limite Edge : 2 s).
// =====================================================================
import { Mp3Encoder } from 'npm:@breezystack/lamejs@1.2.7'
import { base64ToBytes, pcm16ToWav, resamplePcm16 } from './boardLesson.ts'

export const MP3_SAMPLE_RATE = 16000
export const MP3_KBPS = 24
const FRAME = 1152

export interface EncodedAudio {
  bytes: Uint8Array<ArrayBuffer>
  mime: 'audio/mpeg' | 'audio/wav'
  ext: 'mp3' | 'wav'
}

export function pcm16ToMp3(samples: Int16Array, sampleRate: number, kbps = MP3_KBPS): Uint8Array<ArrayBuffer> {
  const encoder = new Mp3Encoder(1, sampleRate, kbps)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < samples.length; i += FRAME) {
    const out = encoder.encodeBuffer(samples.subarray(i, i + FRAME))
    if (out.length) chunks.push(new Uint8Array(out))
  }
  const end = encoder.flush()
  if (end.length) chunks.push(new Uint8Array(end))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const bytes = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const c of chunks) { bytes.set(c, offset); offset += c.length }
  return bytes
}

/**
 * Voix Gemini (base64 PCM 24 kHz) → MP3 compact.
 * Si l'encodeur MP3 échoue pour une raison quelconque, on renvoie un WAV
 * (plus lourd mais toujours lisible) plutôt que de perdre la voix.
 */
export function encodeTeacherAudio(b64: string, inRate = 24000): EncodedAudio {
  const bytes = base64ToBytes(b64)
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
  const resampled = resamplePcm16(pcm, inRate, MP3_SAMPLE_RATE)
  try {
    return { bytes: pcm16ToMp3(resampled, MP3_SAMPLE_RATE), mime: 'audio/mpeg', ext: 'mp3' }
  } catch (e) {
    console.warn('[Audio] Encodage MP3 impossible, repli WAV :', (e as Error).message)
    return { bytes: pcm16ToWav(resampled, MP3_SAMPLE_RATE), mime: 'audio/wav', ext: 'wav' }
  }
}
