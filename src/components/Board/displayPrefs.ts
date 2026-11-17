// Préférences d'affichage de la Leçon au tableau (par téléphone).
import { useEffect } from 'react';

export type BoardTheme = 'dark' | 'light';
export type TextSize = 'normal' | 'large' | 'xl';

export interface DisplayPrefs {
    theme: BoardTheme;
    size: TextSize;
    subtitles: boolean;
    /** Animations réduites (téléphones modestes, économie de batterie). */
    reduceMotion: boolean;
}

const KEY = 'tm_board_display_v1';
const SIZE_PERCENT: Record<TextSize, string> = { normal: '100%', large: '112.5%', xl: '125%' };

/** Téléphone modeste : peu de mémoire ou de cœurs, ou réglage système « réduire les animations ». */
function isModestDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return !!reduced || (nav.deviceMemory ?? 4) <= 2 || (nav.hardwareConcurrency ?? 4) <= 2;
}

export function loadDisplayPrefs(): DisplayPrefs {
    const defaults: DisplayPrefs = { theme: 'dark', size: 'normal', subtitles: true, reduceMotion: isModestDevice() };
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<DisplayPrefs> | null;
        // Ancien réglage des sous-titres (lot 1)
        const oldSubs = localStorage.getItem('tm_board_subtitles');
        if (!saved && oldSubs !== null) defaults.subtitles = oldSubs === '1';
        return { ...defaults, ...(saved ?? {}) };
    } catch {
        return defaults;
    }
}

export function saveDisplayPrefs(p: DisplayPrefs) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/**
 * Taille du texte : tout l'écran du tableau est en « rem », on agrandit donc
 * la taille de base de la page pendant qu'il est ouvert, puis on la rétablit.
 */
export function useBoardTextSize(size: TextSize) {
    useEffect(() => {
        const root = document.documentElement;
        const previous = root.style.fontSize;
        root.style.fontSize = SIZE_PERCENT[size];
        return () => { root.style.fontSize = previous; };
    }, [size]);
}
