import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardLesson, BoardVoiceMode } from './types';
import { boardService, canUseDeviceSpeech, pickVoice } from '../../services/boardService';

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'stepDone' | 'finished';

interface Options {
    lesson: BoardLesson;
    voiceMode: BoardVoiceMode;
    voiceName?: string;
    /** Prévenu une seule fois si la voix premium échoue (repli sur le téléphone). */
    onVoiceFallback?: () => void;
}

const WORDS_PER_SECOND = 2.6;

/** Durée estimée d'une narration (secondes) quand on n'a pas l'audio. */
export const estimateDuration = (text: string, items: number) =>
    Math.max(4, text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND) + items * 0.6;

/** Moment (en secondes) où chaque élément apparaît au tableau pendant la narration. */
export const revealSchedule = (count: number, duration: number) =>
    Array.from({ length: count }, (_, k) => (count <= 1 ? 0 : (duration * 0.8 * k) / (count - 1)));

export function useBoardPlayer({ lesson, voiceMode, voiceName, onVoiceFallback }: Options) {
    const [stepIndex, setStepIndex] = useState(0);
    const [phase, setPhase] = useState<PlayerPhase>('idle');
    const [clock, setClock] = useState(0);
    const [duration, setDuration] = useState(1);
    const [autoAdvance, setAutoAdvance] = useState(true);
    const [answeredQuiz, setAnsweredQuiz] = useState<Record<number, boolean>>({});
    // L'élève s'entraîne (ex. « Répète après moi ») : pas d'enchaînement automatique
    const [held, setHeld] = useState(false);
    const [effectiveMode, setEffectiveMode] = useState<BoardVoiceMode>(voiceMode);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioUrls = useRef(new Map<number, Promise<string>>());
    const rafRef = useRef<number | null>(null);
    const runToken = useRef(0);
    // Horloge manuelle (voix du téléphone ou sans voix)
    const manualStart = useRef(0);
    const manualElapsed = useRef(0);
    const fallbackNotified = useRef(false);

    const step = lesson.steps[stepIndex];
    const isLast = stepIndex === lesson.steps.length - 1;

    useEffect(() => { setEffectiveMode(voiceMode); }, [voiceMode]);

    const stopLoop = () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
    };

    const stopAllSound = useCallback(() => {
        stopLoop();
        const a = audioRef.current;
        if (a) { a.onended = null; a.pause(); }
        if (canUseDeviceSpeech()) window.speechSynthesis.cancel();
    }, []);

    /** Audio premium d'une étape, mis en cache (et préchargé pour l'étape suivante). */
    const fetchAudio = useCallback((i: number) => {
        let p = audioUrls.current.get(i);
        if (!p) {
            p = boardService.getStepAudio(lesson.id, i, voiceName, lesson.steps[i]?.say ?? '');
            p.catch(() => audioUrls.current.delete(i));
            audioUrls.current.set(i, p);
        }
        return p;
    }, [lesson.id, lesson.steps, voiceName]);

    const finishStep = useCallback((token: number) => {
        if (token !== runToken.current) return;
        stopLoop();
        setClock(Number.MAX_SAFE_INTEGER); // tout est révélé
        setPhase('stepDone');
    }, []);

    /** Boucle d'horloge : avance le temps de l'étape pour révéler les éléments. */
    const runManualClock = useCallback((token: number, total: number, endOnTime: boolean) => {
        const tick = () => {
            if (token !== runToken.current) return;
            const t = manualElapsed.current + (performance.now() - manualStart.current) / 1000;
            setClock(t);
            if (endOnTime && t >= total) { finishStep(token); return; }
            rafRef.current = requestAnimationFrame(tick);
        };
        manualStart.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
    }, [finishStep]);

    const playDevice = useCallback((token: number, text: string, total: number) => {
        manualElapsed.current = 0;
        if (!canUseDeviceSpeech()) {
            runManualClock(token, total, true);
            return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'fr-FR';
        u.rate = 0.95;
        const v = pickVoice('fr-FR');
        if (v) u.voice = v;
        u.onend = () => finishStep(token);
        u.onerror = () => finishStep(token);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        // Filet de sécurité : certains navigateurs ne déclenchent jamais onend
        runManualClock(token, total * 1.8 + 3, true);
    }, [finishStep, runManualClock]);

    const startStep = useCallback(async (i: number) => {
        const s = lesson.steps[i];
        if (!s) return;
        stopAllSound();
        const token = ++runToken.current;
        setHeld(false);
        setStepIndex(i);
        setClock(0);
        const estimate = estimateDuration(s.say, s.items.length);
        setDuration(estimate);

        if (effectiveMode === 'off') {
            setPhase('playing');
            manualElapsed.current = 0;
            runManualClock(token, estimate + 1.5, true);
            return;
        }

        if (effectiveMode === 'device') {
            setPhase('playing');
            playDevice(token, s.say, estimate);
            return;
        }

        // Voix premium (Gemini), avec repli automatique sur le téléphone
        setPhase('loading');
        try {
            const url = await fetchAudio(i);
            if (token !== runToken.current) return;
            if (i + 1 < lesson.steps.length) fetchAudio(i + 1).catch(() => {});

            const audio = audioRef.current ?? new Audio();
            audioRef.current = audio;
            audio.src = url;
            audio.onloadedmetadata = () => {
                if (token === runToken.current && Number.isFinite(audio.duration)) setDuration(audio.duration);
            };
            audio.onended = () => finishStep(token);
            await audio.play();
            if (token !== runToken.current) return;
            setPhase('playing');
            const tick = () => {
                if (token !== runToken.current) return;
                setClock(audio.currentTime);
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        } catch (e) {
            if (token !== runToken.current) return;
            console.warn('[Board] Voix premium indisponible, repli sur la voix du téléphone', e);
            if (!fallbackNotified.current) { fallbackNotified.current = true; onVoiceFallback?.(); }
            setEffectiveMode(canUseDeviceSpeech() ? 'device' : 'off');
            setPhase('playing');
            playDevice(token, s.say, estimate);
        }
    }, [lesson.steps, effectiveMode, stopAllSound, fetchAudio, finishStep, playDevice, runManualClock, onVoiceFallback]);

    const pause = useCallback(() => {
        if (phase !== 'playing') return;
        stopLoop();
        if (effectiveMode === 'premium' && audioRef.current) {
            audioRef.current.pause();
        } else {
            manualElapsed.current += (performance.now() - manualStart.current) / 1000;
            if (canUseDeviceSpeech()) window.speechSynthesis.pause();
        }
        setPhase('paused');
    }, [phase, effectiveMode]);

    const resume = useCallback(() => {
        if (phase !== 'paused') return;
        const token = runToken.current;
        setPhase('playing');
        if (effectiveMode === 'premium' && audioRef.current) {
            const audio = audioRef.current;
            audio.play().catch(() => {});
            const tick = () => {
                if (token !== runToken.current) return;
                setClock(audio.currentTime);
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        } else {
            if (canUseDeviceSpeech() && effectiveMode === 'device') {
                // Android ignore souvent pause/resume : on relance la phrase si rien ne parle
                window.speechSynthesis.resume();
                if (!window.speechSynthesis.speaking) {
                    playDevice(token, step.say, estimateDuration(step.say, step.items.length));
                    return;
                }
            }
            runManualClock(token, effectiveMode === 'off' ? duration + 1.5 : duration * 1.8 + 3, true);
        }
    }, [phase, effectiveMode, step, duration, playDevice, runManualClock]);

    const goTo = useCallback((i: number) => {
        if (i < 0 || i >= lesson.steps.length) return;
        startStep(i);
    }, [lesson.steps.length, startStep]);

    const next = useCallback(() => {
        if (isLast) { stopAllSound(); runToken.current++; setPhase('finished'); return; }
        goTo(stepIndex + 1);
    }, [isLast, stepIndex, goTo, stopAllSound]);

    const replay = useCallback(() => goTo(stepIndex), [goTo, stepIndex]);

    const markQuizAnswered = useCallback((i: number) => {
        setAnsweredQuiz(prev => ({ ...prev, [i]: true }));
    }, []);

    // Enchaînement automatique, sauf si un quiz de l'étape attend une réponse
    const stepHasQuiz = !!step?.items.some(it => it.kind === 'quiz');
    const waitingForQuiz = stepHasQuiz && !answeredQuiz[stepIndex];
    useEffect(() => {
        if (phase !== 'stepDone' || !autoAdvance || waitingForQuiz || isLast || held) return;
        const t = setTimeout(() => next(), 1600);
        return () => clearTimeout(t);
    }, [phase, autoAdvance, waitingForQuiz, isLast, held, next]);

    /** L'élève s'entraîne : on met le prof en pause et on reste sur l'étape. */
    const holdForPractice = useCallback(() => {
        setHeld(true);
        pause();
    }, [pause]);

    // Changement de mode de voix en cours de leçon : on reprend l'étape
    const firstRender = useRef(true);
    useEffect(() => {
        if (firstRender.current) { firstRender.current = false; return; }
        if (phase === 'playing' || phase === 'loading') startStep(stepIndex);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveMode]);

    // Nettoyage
    useEffect(() => () => {
        runToken.current++;
        stopAllSound();
        audioUrls.current.forEach(p => p.then(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); }).catch(() => {}));
    }, [stopAllSound]);

    const schedule = useMemo(() => revealSchedule(step?.items.length ?? 0, duration), [step, duration]);
    const revealedCount = schedule.filter(t => t <= clock).length;
    const stepProgress = phase === 'stepDone' || phase === 'finished' ? 1 : Math.min(1, clock / Math.max(duration, 0.1));

    return {
        stepIndex, step, isLast, phase, revealedCount, stepProgress,
        effectiveMode, autoAdvance, setAutoAdvance, waitingForQuiz,
        start: () => startStep(stepIndex), pause, resume, next, prev: () => goTo(stepIndex - 1),
        goTo, replay, markQuizAnswered, stopAllSound, holdForPractice, held,
    };
}
