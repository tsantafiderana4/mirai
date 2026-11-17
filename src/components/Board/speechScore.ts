// « Répète après moi » : compare ce que la reconnaissance vocale du
// téléphone a entendu avec la phrase attendue. Logique pure (testée).

export interface SpeechScore {
    /** 0 à 1 : part des mots attendus bien prononcés, dans l'ordre. */
    score: number;
    /** Pour chaque mot attendu : reconnu ou non (pour le surligner). */
    words: { text: string; ok: boolean }[];
    level: 'great' | 'close' | 'retry';
}

/** Langues écrites sans espaces : on compare caractère par caractère. */
const CHAR_LANGS = /^(chinois|japonais|zh|ja)/i;

const normalize = (s: string) =>
    s.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
        .replace(/[’']/g, "'")
        .replace(/[^\p{L}\p{N}'\s]/gu, ' ')                // ponctuation
        .replace(/\s+/g, ' ')
        .trim();

export function tokenize(text: string, language: string): { display: string[]; norm: string[] } {
    if (CHAR_LANGS.test(language.trim())) {
        const chars = [...text.replace(/\s+/g, '')].filter(c => /[\p{L}\p{N}]/u.test(c));
        return { display: chars, norm: chars.map(normalize) };
    }
    const display = text.split(/\s+/).filter(w => normalize(w));
    return { display, norm: display.map(normalize) };
}

/** Plus longue sous-séquence commune : quels mots attendus ont été dits, dans l'ordre. */
function matchedIndexes(expected: string[], heard: string[]): Set<number> {
    const n = expected.length, m = heard.length;
    const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = expected[i] === heard[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ok = new Set<number>();
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (expected[i] === heard[j]) { ok.add(i); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    return ok;
}

export function scoreSpeech(expected: string, heard: string, language: string): SpeechScore {
    const exp = tokenize(expected, language);
    const got = tokenize(heard, language);
    if (!exp.norm.length) return { score: 0, words: [], level: 'retry' };
    const ok = matchedIndexes(exp.norm, got.norm);
    const score = ok.size / exp.norm.length;
    return {
        score,
        words: exp.display.map((text, i) => ({ text, ok: ok.has(i) })),
        level: score >= 0.85 ? 'great' : score >= 0.5 ? 'close' : 'retry',
    };
}

/** Meilleur score parmi les différentes transcriptions proposées par le téléphone. */
export function bestScore(expected: string, alternatives: string[], language: string): SpeechScore & { heard: string } {
    let best = { ...scoreSpeech(expected, '', language), heard: '' };
    for (const alt of alternatives) {
        const s = scoreSpeech(expected, alt, language);
        if (s.score > best.score) best = { ...s, heard: alt };
    }
    return best;
}
