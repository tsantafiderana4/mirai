// deno test tests/client/speechScore.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { bestScore, scoreSpeech, tokenize } from '../../src/components/Board/speechScore.ts'

Deno.test('phrase parfaite malgré majuscules, ponctuation et accents', () => {
  const s = scoreSpeech('My name is Rado.', 'my name is rado', 'Anglais')
  assertEquals(s.score, 1); assertEquals(s.level, 'great')
  assertEquals(scoreSpeech('¿Cómo estás?', 'como estas', 'Espagnol').score, 1)
})

Deno.test('mot oublié : surligné, niveau « presque »', () => {
  const s = scoreSpeech('I am a student', 'I am student', 'Anglais')
  assertEquals(s.words.map(w => w.ok), [true, true, false, true])
  assertEquals(s.score, 0.75); assertEquals(s.level, 'close')
})

Deno.test('mauvaise phrase : à recommencer', () => {
  assertEquals(scoreSpeech('Nice to meet you', 'hello world', 'Anglais').level, 'retry')
  assertEquals(scoreSpeech('Nice to meet you', '', 'Anglais').score, 0)
})

Deno.test('ordre respecté : mots dits dans le désordre ne comptent pas tous', () => {
  assert(scoreSpeech('I am from Madagascar', 'Madagascar from am I', 'Anglais').score < 0.5)
})

Deno.test('chinois / japonais : comparaison caractère par caractère', () => {
  assertEquals(tokenize('你好吗？', 'Chinois 🇨🇳').display, ['你', '好', '吗'])
  assertEquals(scoreSpeech('你好吗', '你好', 'Chinois').score, 2 / 3)
  assertEquals(scoreSpeech('こんにちは', 'こんにちは', 'Japonais').level, 'great')
})

Deno.test('plusieurs transcriptions : on garde la meilleure', () => {
  const b = bestScore('I am a teacher', ['I am the teacher', 'I am a teacher'], 'Anglais')
  assertEquals(b.score, 1); assertEquals(b.heard, 'I am a teacher')
})
