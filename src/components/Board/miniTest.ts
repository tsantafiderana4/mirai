// Mini-test de fin de leçon, construit uniquement à partir du contenu de la
// leçon (aucun appel à Gemini : gratuit et instantané). Logique pure, testée.
import type { BoardItem, BoardStep } from './types';

export interface ChoiceOption { text: string; mg?: string }

export type TestQuestion =
    | {
        kind: 'meaning';      // « Que veut dire X ? » → choisir le sens
        target: string; phonetic?: string;
        options: ChoiceOption[]; correct: number;
    }
    | {
        kind: 'translate';    // « Comment dit-on … ? » → choisir le mot
        fr: string; mg?: string;
        options: ChoiceOption[]; correct: number;
    }
    | {
        kind: 'quiz';         // quiz de la leçon, repris tel quel
        question: string; options: ChoiceOption[]; correct: number;
        explanation?: string; explanationMg?: string;
    }
    | {
        kind: 'order';        // remettre les mots de la phrase dans l'ordre
        fr?: string; mg?: string; tokens: string[]; answer: string[];
    }
    | {
        kind: 'type';         // écrire le mot (production)
        fr: string; mg?: string; answer: string; phonetic?: string;
    };

export type TestKind = TestQuestion['kind'];
type Rng = () => number;

/** Langues à alphabet latin : on peut demander d'écrire le mot au clavier. */
const LATIN_LANGS = new Set(['anglais', 'français', 'espagnol', 'allemand', 'italien', 'portugais', 'swahili']);
/** Langues écrites sans espaces : la phrase ne se découpe qu'avec le mot à mot. */
const NO_SPACE_LANGS = new Set(['chinois', 'japonais']);

const langKey = (language: string) => language.trim().split(/\s+/)[0].toLowerCase();

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export const normalizeAnswer = (s: string) =>
    s.toLowerCase()
        .replace(/[’']/g, "'")
        .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[b.length];
}

/**
 * Réponse écrite : « exact », « close » (accent ou une lettre près : compté
 * juste, avec une remarque) ou « wrong ». « Hello / Hi » accepte les deux.
 */
export function checkTyped(input: string, answer: string): 'exact' | 'close' | 'wrong' {
    const got = normalizeAnswer(input);
    if (!got) return 'wrong';
    const accepted = answer.split(/\s*[/|]\s*/).map(normalizeAnswer).filter(Boolean);
    if (accepted.includes(got)) return 'exact';
    for (const a of accepted) {
        if (stripAccents(a) === stripAccents(got)) return 'close';
        if (a.length >= 4 && levenshtein(stripAccents(a), stripAccents(got)) <= 1) return 'close';
    }
    return 'wrong';
}

export const checkOrder = (picked: string[], answer: string[]) =>
    normalizeAnswer(picked.join(' ')) === normalizeAnswer(answer.join(' '));

interface Vocab { target: string; phonetic?: string; fr: string; mg?: string }

function sentenceTokens(item: BoardItem, language: string): string[] | null {
    const parts = item.breakdown?.map(b => b.part.trim()).filter(Boolean) ?? [];
    if (parts.length >= 3 && parts.length <= 8) return parts;
    if (NO_SPACE_LANGS.has(langKey(language)) || !item.target) return null;
    const words = item.target.split(/\s+/).filter(Boolean);
    return words.length >= 3 && words.length <= 8 ? words : null;
}

/** Choix multiple : la bonne réponse + jusqu'à 3 distracteurs, mélangés. */
function choice(right: ChoiceOption, others: ChoiceOption[], rng: Rng) {
    const seen = new Set([normalizeAnswer(right.text)]);
    const distractors: ChoiceOption[] = [];
    for (const o of shuffle(others, rng)) {
        const k = normalizeAnswer(o.text);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        distractors.push(o);
        if (distractors.length === 3) break;
    }
    if (distractors.length < 2) return null;
    const options = shuffle([right, ...distractors], rng);
    return { options, correct: options.indexOf(right) };
}

/**
 * Construit le mini-test (5 questions par défaut, variées) : sens d'un mot,
 * phrase à remettre en ordre, traduction, mot à écrire, quiz de la leçon.
 */
export function buildMiniTest(lesson: { language: string; steps: BoardStep[] }, rng: Rng = Math.random, size = 5): TestQuestion[] {
    const items = lesson.steps.flatMap(s => s.items);
    const vocab: Vocab[] = [];
    const seenTargets = new Set<string>();
    for (const it of items) {
        if (it.kind !== 'vocab' || !it.target || !it.fr) continue;
        const k = normalizeAnswer(it.target);
        if (!k || seenTargets.has(k)) continue;
        seenTargets.add(k);
        vocab.push({ target: it.target, phonetic: it.phonetic, fr: it.fr, mg: it.mg });
    }

    const pools: Record<TestKind, { key: string; q: TestQuestion }[]> = {
        meaning: [], order: [], translate: [], type: [], quiz: [],
    };

    for (const v of vocab) {
        const others = vocab.filter(o => o !== v);
        const m = choice({ text: v.fr, mg: v.mg }, others.map(o => ({ text: o.fr, mg: o.mg })), rng);
        if (m) pools.meaning.push({ key: v.target, q: { kind: 'meaning', target: v.target, phonetic: v.phonetic, ...m } });
        const tr = choice({ text: v.target }, others.map(o => ({ text: o.target })), rng);
        if (tr) pools.translate.push({ key: v.target, q: { kind: 'translate', fr: v.fr, mg: v.mg, ...tr } });
        if (LATIN_LANGS.has(langKey(lesson.language)) && v.target.length <= 30) {
            pools.type.push({ key: v.target, q: { kind: 'type', fr: v.fr, mg: v.mg, answer: v.target, phonetic: v.phonetic } });
        }
    }
    for (const it of items) {
        if (it.kind === 'sentence') {
            const tokens = sentenceTokens(it, lesson.language);
            if (!tokens) continue;
            let shuffled = shuffle(tokens, rng);
            if (checkOrder(shuffled, tokens)) shuffled = [...tokens.slice(1), tokens[0]];
            pools.order.push({ key: it.target!, q: { kind: 'order', fr: it.fr, mg: it.mg, tokens: shuffled, answer: tokens } });
        } else if (it.kind === 'quiz' && it.question && it.options && it.answer) {
            const options = it.options.map(text => ({ text }));
            const correct = it.options.indexOf(it.answer);
            if (correct >= 0) pools.quiz.push({ key: it.question, q: { kind: 'quiz', question: it.question, options, correct, explanation: it.explanation, explanationMg: it.mg } });
        }
    }

    const order: TestKind[] = ['meaning', 'order', 'translate', 'type', 'quiz'];
    for (const k of order) pools[k] = shuffle(pools[k], rng);

    const out: TestQuestion[] = [];
    const usedKeys = new Set<string>();
    // Tour à tour dans chaque type ; un même mot ne sert qu'une fois si possible
    for (let pass = 0; pass < 2 && out.length < size; pass++) {
        let progress = true;
        while (out.length < size && progress) {
            progress = false;
            for (const k of order) {
                if (out.length >= size) break;
                const idx = pools[k].findIndex(c => pass === 1 || !usedKeys.has(c.key));
                if (idx < 0) continue;
                const [c] = pools[k].splice(idx, 1);
                usedKeys.add(c.key);
                out.push(c.q);
                progress = true;
            }
        }
    }
    return out;
}

export const scorePercent = (correct: number, total: number) =>
    total > 0 ? Math.round((correct / total) * 100) : 0;
