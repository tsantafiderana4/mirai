// =====================================================================
// Opérations sur l'audio stocké des leçons (logique pure, testée) :
// pré-génération nocturne et invalidation après une correction admin.
// Fichiers du bucket lesson-audio : « <leçon>/<étape>-<voix>.mp3 » (ou .wav
// pour les anciens fichiers).
// =====================================================================

export const PREGEN_VOICE = 'Kore'

const AUDIO_NAME_RE = /^(\d+)-([A-Za-z]+)\.(mp3|wav)$/

/** Index de la première étape sans voix pour cette voix, ou -1 si tout est prêt. */
export function firstMissingStep(stepCount: number, fileNames: string[], voice = PREGEN_VOICE): number {
  const have = new Set<number>()
  for (const name of fileNames) {
    const m = AUDIO_NAME_RE.exec(name)
    if (m && m[2] === voice) have.add(Number(m[1]))
  }
  for (let i = 0; i < stepCount; i++) if (!have.has(i)) return i
  return -1
}

/**
 * Étapes dont l'audio n'est plus valable après une modification : texte
 * parlé changé, ou étape supprimée.
 */
export function changedSpokenSteps(oldSays: string[], newSays: string[]): number[] {
  const out: number[] = []
  const n = Math.max(oldSays.length, newSays.length)
  for (let i = 0; i < n; i++) {
    if (i >= newSays.length || oldSays[i] !== newSays[i]) out.push(i)
  }
  return out
}

/** Fichiers audio (toutes voix, MP3 et WAV) appartenant aux étapes données. */
export function audioFilesForSteps(fileNames: string[], steps: number[] | 'all'): string[] {
  const wanted = steps === 'all' ? null : new Set(steps)
  return fileNames.filter(name => {
    const m = AUDIO_NAME_RE.exec(name)
    return !!m && (wanted === null || wanted.has(Number(m[1])))
  })
}
