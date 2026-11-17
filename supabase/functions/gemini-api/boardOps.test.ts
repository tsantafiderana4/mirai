import { assertEquals } from 'jsr:@std/assert@1'
import { audioFilesForSteps, changedSpokenSteps, firstMissingStep } from './boardOps.ts'

Deno.test('firstMissingStep : première étape sans voix Kore', () => {
  assertEquals(firstMissingStep(4, ['0-Kore.mp3', '1-Kore.wav', '2-Puck.mp3']), 2)
  assertEquals(firstMissingStep(2, ['0-Kore.mp3', '1-Kore.mp3']), -1)
  assertEquals(firstMissingStep(3, []), 0)
  assertEquals(firstMissingStep(1, ['.emptyFolderPlaceholder', '0-Kore.mp3']), -1)
})

Deno.test('changedSpokenSteps : texte modifié ou étape supprimée', () => {
  assertEquals(changedSpokenSteps(['a', 'b', 'c'], ['a', 'B', 'c']), [1])
  assertEquals(changedSpokenSteps(['a', 'b', 'c'], ['a']), [1, 2])
  assertEquals(changedSpokenSteps(['a'], ['a', 'nouveau']), [1])
  assertEquals(changedSpokenSteps(['a', 'b'], ['a', 'b']), [])
})

Deno.test('audioFilesForSteps : toutes les voix et formats des étapes visées', () => {
  const files = ['0-Kore.mp3', '1-Kore.mp3', '1-Puck.wav', '10-Kore.mp3', 'autre.txt']
  assertEquals(audioFilesForSteps(files, [1]), ['1-Kore.mp3', '1-Puck.wav'])
  assertEquals(audioFilesForSteps(files, 'all'), ['0-Kore.mp3', '1-Kore.mp3', '1-Puck.wav', '10-Kore.mp3'])
  assertEquals(audioFilesForSteps(files, []), [])
})
