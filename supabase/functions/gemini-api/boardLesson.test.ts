// deno test supabase/functions/gemini-api/boardLesson.test.ts
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  normalizeLanguage, normalizeLevel, normalizeLessonNumber, lessonKey,
  sanitizeItem, sanitizeLesson, sanitizeSyllabus, sanitizeAnswer, cleanSpoken,
  parseModelJson, InvalidLessonError, pcm16ToWav, resamplePcm16, geminiPcmToWav, bytesToBase64,
  buildLessonPrompt, buildQuestionPrompt,
} from './boardLesson.ts'

const entry = { title: 'Se présenter', titleMg: 'Mampahafantatra tena', objective: 'Dire son nom' }
const step = (n: number) => ({
  say: `Étape ${n} : **bonjour** 👋 à tous.`,
  items: [{ kind: 'explain', text: `Explication ${n}`, mg: `Fanazavana ${n}` }],
})

Deno.test('langues : libellé avec drapeau accepté, langue inconnue refusée', () => {
  assertEquals(normalizeLanguage('Anglais 🇬🇧'), 'Anglais')
  assertEquals(normalizeLanguage('espagnol'), 'Espagnol')
  assertEquals(normalizeLanguage('Klingon'), null)
  assertEquals(normalizeLanguage(42), null)
})

Deno.test('niveaux et numéros de leçon', () => {
  assertEquals(normalizeLevel('a1'), 'A1')
  assertEquals(normalizeLevel('hsk  2'), 'HSK 2')
  assertEquals(normalizeLevel('Z9'), null)
  assertEquals(normalizeLessonNumber(3), 3)
  assertEquals(normalizeLessonNumber('3'), 3)
  assertEquals(normalizeLessonNumber(0), null)
  assertEquals(normalizeLessonNumber(21), null)
  assertEquals(normalizeLessonNumber(2.5), null)
  assertEquals(lessonKey('Anglais', 'A1', 3), 'v1|Anglais|A1|3')
})

Deno.test('texte parlé : markdown et émojis retirés', () => {
  assertEquals(cleanSpoken('**Hello** 👋 _toi_ # !'), 'Hello toi !')
  assertEquals(cleanSpoken('   '), undefined)
})

Deno.test('élément quiz : la réponse doit être une des options', () => {
  const ok = sanitizeItem({ kind: 'quiz', question: 'Q ?', options: ['a', 'B', 'c'], answer: 'b' })
  assertEquals(ok?.answer, 'B')
  assertEquals(sanitizeItem({ kind: 'quiz', question: 'Q ?', options: ['a', 'b'], answer: 'z' }), null)
  assertEquals(sanitizeItem({ kind: 'quiz', question: 'Q ?', options: ['a'], answer: 'a' }), null)
})

Deno.test('élément tableau : lignes complétées à la largeur des en-têtes', () => {
  const t = sanitizeItem({
    kind: 'table', text: 'Être', headers: ['Pronom', 'Verbe'],
    rows: [{ cells: ['I', 'am'] }, { cells: ['you'] }, { cells: [] }],
  })
  assertEquals(t?.rows, [['I', 'am'], ['you', '']])
  assertEquals(sanitizeItem({ kind: 'table', headers: ['seul'], rows: [{ cells: ['x'] }] }), null)
})

Deno.test('éléments invalides ignorés', () => {
  assertEquals(sanitizeItem({ kind: 'video', text: 'x' }), null)
  assertEquals(sanitizeItem({ kind: 'vocab' }), null)
  assertEquals(sanitizeItem(null), null)
  assertEquals(sanitizeItem({ kind: 'explain', text: '<b>' + 'x'.repeat(1000) })?.text?.length, 400)
})

Deno.test('leçon : étapes vides retirées, minimum 4 étapes', () => {
  const lesson = sanitizeLesson({
    title: 'T', titleMg: 'Tm', objective: 'O', objectiveMg: 'Om',
    steps: [step(1), { say: '', items: [] }, step(2), { say: 'x', items: [{ kind: 'nope' }] }, step(3), step(4)],
    summary: ['a', 'b'], summaryMg: ['A'],
  }, entry)
  assertEquals(lesson.steps.length, 4)
  assertEquals(lesson.steps[0].say, 'Étape 1 : bonjour à tous.')
  // résumé malagasy incohérent (longueur différente) → abandonné plutôt que décalé
  assertEquals(lesson.summaryMg, [])
  assertThrows(() => sanitizeLesson({ steps: [step(1), step(2)] }, entry), InvalidLessonError)
})

Deno.test('leçon : titres manquants repris du programme', () => {
  const lesson = sanitizeLesson({ steps: [step(1), step(2), step(3), step(4)] }, entry)
  assertEquals(lesson.title, 'Se présenter')
  assertEquals(lesson.titleMg, 'Mampahafantatra tena')
})

Deno.test('programme et réponse aux questions', () => {
  assertEquals(sanitizeSyllabus({ lessons: [{ title: 'A', objective: 'o' }, { title: '' }] }).length, 1)
  assertEquals(sanitizeSyllabus(null), [])
  const ans = sanitizeAnswer({ say: 'Bonne question !', items: [{ kind: 'quiz', question: 'q', options: ['a', 'b'], answer: 'a' }, { kind: 'tip', text: 't', mg: 'm' }] })
  assertEquals(ans.items.map(i => i.kind), ['tip'])
  assertThrows(() => sanitizeAnswer({ say: '', items: [] }), InvalidLessonError)
})

Deno.test('JSON entouré de balises markdown', () => {
  assertEquals(parseModelJson('```json\n{"a":1}\n```'), { a: 1 })
})

Deno.test('WAV : en-tête correct et rééchantillonnage 24 kHz → 16 kHz', () => {
  const wav = pcm16ToWav(new Int16Array([0, 1000, -1000]), 16000)
  assertEquals(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF')
  assertEquals(new TextDecoder().decode(wav.subarray(8, 12)), 'WAVE')
  const v = new DataView(wav.buffer)
  assertEquals(v.getUint32(24, true), 16000)
  assertEquals(v.getUint32(40, true), 6)
  assertEquals(wav.length, 44 + 6)

  assertEquals(resamplePcm16(new Int16Array(24000), 24000, 16000).length, 16000)

  const pcm = new Int16Array(2400).map((_, i) => Math.round(Math.sin(i / 10) * 10000))
  const out = geminiPcmToWav(bytesToBase64(new Uint8Array(pcm.buffer)))
  assertEquals(out.length, 44 + 1600 * 2)
})

Deno.test('prompts : contiennent la langue, le niveau et les règles malagasy', () => {
  const p = buildLessonPrompt('Anglais', 'A1', 2, entry, ['Saluer'])
  assert(p.includes('Anglais') && p.includes('A1') && p.includes('Saluer') && p.includes('MALAGASY'))
  const lesson = sanitizeLesson({ steps: [step(1), step(2), step(3), step(4)] }, entry)
  const q = buildQuestionPrompt('Anglais', 'A1', lesson, 99, 'x'.repeat(2000))
  assert(q.includes('Étape 4'))
  assert(q.length < 3000, 'question tronquée')
})
