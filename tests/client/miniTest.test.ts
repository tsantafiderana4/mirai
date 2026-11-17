import { assert, assertEquals } from 'jsr:@std/assert@1';
import { buildMiniTest, checkOrder, checkTyped, scorePercent } from '../../src/components/Board/miniTest.ts';
import type { BoardStep } from '../../src/components/Board/types.ts';

/** Générateur pseudo-aléatoire reproductible. */
const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};

const steps: BoardStep[] = [
    { say: 'Voici des mots.', items: [
        { kind: 'vocab', target: 'Hello', fr: 'Bonjour', mg: 'Manao ahoana', phonetic: 'hé-lo' },
        { kind: 'vocab', target: 'Goodbye', fr: 'Au revoir', mg: 'Veloma' },
        { kind: 'vocab', target: 'Thank you', fr: 'Merci', mg: 'Misaotra' },
    ] },
    { say: 'Encore.', items: [
        { kind: 'vocab', target: 'Please', fr: "S'il te plaît", mg: 'Azafady' },
        { kind: 'sentence', target: 'My name is Rado', fr: "Je m'appelle Rado", mg: 'Rado no anarako' },
    ] },
    { say: 'Quiz.', items: [
        { kind: 'quiz', question: 'Comment dit-on « merci » ?', options: ['Hello', 'Thank you', 'Please'], answer: 'Thank you', explanation: 'Thank you = merci.' },
    ] },
];

Deno.test('buildMiniTest : 5 questions variées, toutes cohérentes', () => {
    for (let seed = 1; seed < 30; seed++) {
        const qs = buildMiniTest({ language: 'Anglais 🇬🇧', steps }, seeded(seed));
        assertEquals(qs.length, 5);
        const kinds = new Set(qs.map(q => q.kind));
        assertEquals(kinds.size, 5, `seed ${seed} : ${[...kinds]}`);
        for (const q of qs) {
            if (q.kind === 'meaning' || q.kind === 'translate' || q.kind === 'quiz') {
                assert(q.options.length >= 3 && q.options.length <= 4);
                assert(q.correct >= 0 && q.correct < q.options.length);
                assertEquals(new Set(q.options.map(o => o.text)).size, q.options.length);
            }
            if (q.kind === 'meaning') assertEquals(q.options[q.correct].mg !== undefined, true);
            if (q.kind === 'order') {
                assertEquals([...q.tokens].sort(), [...q.answer].sort());
                assert(!checkOrder(q.tokens, q.answer), 'la phrase doit être mélangée');
            }
        }
    }
});

Deno.test('buildMiniTest : pas de saisie au clavier pour le chinois, découpage par le mot à mot', () => {
    const zh: BoardStep[] = [{ say: 'x', items: [
        { kind: 'vocab', target: '你好', fr: 'Bonjour' },
        { kind: 'vocab', target: '谢谢', fr: 'Merci' },
        { kind: 'vocab', target: '再见', fr: 'Au revoir' },
        { kind: 'sentence', target: '我叫拉多', fr: "Je m'appelle Rado", breakdown: [
            { part: '我', fr: 'je', mg: 'izaho' }, { part: '叫', fr: "m'appelle", mg: 'antsoina' }, { part: '拉多', fr: 'Rado', mg: 'Rado' },
        ] },
    ] }];
    const qs = buildMiniTest({ language: 'Chinois', steps: zh }, seeded(3));
    assert(!qs.some(q => q.kind === 'type'));
    const order = qs.find(q => q.kind === 'order');
    assert(order && order.kind === 'order');
    assertEquals(order.answer, ['我', '叫', '拉多']);
});

Deno.test('buildMiniTest : leçon pauvre → moins de questions, jamais de doublon cassé', () => {
    const tiny: BoardStep[] = [{ say: 'x', items: [{ kind: 'explain', text: 'Rien à tester.' }] }];
    assertEquals(buildMiniTest({ language: 'Anglais', steps: tiny }).length, 0);
});

Deno.test('checkTyped : tolère la casse, la ponctuation, un accent ou une lettre', () => {
    assertEquals(checkTyped('hello', 'Hello'), 'exact');
    assertEquals(checkTyped('  Hello! ', 'Hello'), 'exact');
    assertEquals(checkTyped('hi', 'Hello / Hi'), 'exact');
    assertEquals(checkTyped('cafe', 'café'), 'close');
    assertEquals(checkTyped('helo', 'Hello'), 'close');
    assertEquals(checkTyped('bye', 'Hello'), 'wrong');
    assertEquals(checkTyped('', 'Hello'), 'wrong');
    assertEquals(checkTyped('ab', 'ac'), 'wrong'); // mots courts : pas de tolérance
});

Deno.test('checkOrder et scorePercent', () => {
    assert(checkOrder(['My', 'name', 'is', 'Rado.'], ['My', 'name', 'is', 'Rado']));
    assert(!checkOrder(['name', 'My', 'is', 'Rado'], ['My', 'name', 'is', 'Rado']));
    assertEquals(scorePercent(4, 5), 80);
    assertEquals(scorePercent(0, 0), 0);
});
