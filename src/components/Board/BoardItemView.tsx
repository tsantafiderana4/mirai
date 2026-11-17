import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, Lightbulb, AlertTriangle, CheckCircle2, XCircle, HelpCircle, Mic, Loader2, RotateCcw } from 'lucide-react';
import type { BoardItem, MgMode } from './types';
import { pronounce, langToBcp47 } from '../../services/boardService';
import { useTranslation } from '../../contexts/LanguageContext';
import { bestScore, type SpeechScore } from './speechScore';

interface Props {
    item: BoardItem;
    language: string;
    mgMode: MgMode;
    /** Animation « écriture à la craie » à l'apparition. */
    animate?: boolean;
    onQuizAnswered?: (correct: boolean) => void;
    /** Appelé quand l'élève s'entraîne à prononcer (on met le prof en pause). */
    onPracticeStart?: () => void;
}

/** Effet d'écriture : le contenu se dévoile de gauche à droite. */
const Write: React.FC<{ children: React.ReactNode; animate?: boolean; delay?: number; className?: string }> = ({ children, animate = true, delay = 0, className }) => (
    <motion.div
        className={className}
        initial={animate ? { clipPath: 'inset(0 100% 0 0)', opacity: 0.4 } : false}
        animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
        transition={{ duration: 0.9, delay, ease: [0.25, 0.8, 0.3, 1] }}
    >
        {children}
    </motion.div>
);

const LangPill: React.FC<{ lang: 'MG' | 'FR' }> = ({ lang }) => (
    <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-px text-[0.65rem] font-extrabold tracking-wider ring-1 ${lang === 'MG' ? 'bg-amber-300/15 text-amber-300 ring-amber-300/30' : 'bg-white/10 text-slate-300 ring-white/20'}`}>
        {lang}
    </span>
);

/** Ligne de traduction / aide en malagasy (affichage secondaire). */
export const MgLine: React.FC<{ text?: string; show: boolean; className?: string }> = ({ text, show, className = '' }) => {
    if (!text || !show) return null;
    return (
        <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            className={`mt-1.5 flex items-start gap-2 text-[0.95rem] leading-snug text-amber-200/95 ${className}`}
            lang="mg"
        >
            <LangPill lang="MG" />
            <span className="italic">{text}</span>
        </motion.p>
    );
};

/**
 * Texte bilingue français / malagasy selon le mode choisi par l'élève :
 * - « off »   : français seul ;
 * - « with »  : français, puis malagasy en dessous ;
 * - « first » : malagasy en grand, français en petit (pour les élèves plus
 *               à l'aise en malagasy qu'en français).
 */
export const Bilingual: React.FC<{
    fr?: string; mg?: string; mode: MgMode;
    frClassName?: string; mgFirstClassName?: string;
}> = ({ fr, mg, mode, frClassName = 'text-[1.05rem] leading-relaxed text-slate-100 sm:text-lg', mgFirstClassName = 'text-[1.05rem] leading-relaxed text-amber-50 sm:text-lg' }) => {
    if (mode === 'first' && mg) {
        return (
            <div>
                <p className={`flex items-start gap-2 ${mgFirstClassName}`} lang="mg">
                    <LangPill lang="MG" /><span>{mg}</span>
                </p>
                {fr && (
                    <p className="mt-1.5 flex items-start gap-2 text-sm leading-snug text-slate-400">
                        <LangPill lang="FR" /><span>{fr}</span>
                    </p>
                )}
            </div>
        );
    }
    return (
        <div>
            {fr && <p className={frClassName}>{fr}</p>}
            <MgLine text={mg} show={mode !== 'off'} />
        </div>
    );
};

export const Chalk: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <span className={`font-chalk text-white [text-shadow:0_0_1px_rgba(255,255,255,0.35)] ${className}`}>{children}</span>
);

export const SpeakButton: React.FC<{ text: string; language: string }> = ({ text, language }) => {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={() => pronounce(text, language)}
            className="ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-emerald-200 ring-1 ring-white/15 transition hover:bg-white/20 active:scale-95"
            aria-label={t('board.listen')}
            title={t('board.listen')}
        >
            <Volume2 className="h-4 w-4" />
        </button>
    );
};

// ---------------------------------------------------------------------
// « Répète après moi » : reconnaissance vocale intégrée au navigateur
// (gratuite, sans Gemini). Masqué si le navigateur ne la propose pas.
// ---------------------------------------------------------------------
type SpeechRecognitionCtor = new () => {
    lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void; stop(): void; abort(): void;
};

const getRecognition = (): SpeechRecognitionCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

const RepeatAfterMe: React.FC<{ text: string; language: string; onStart?: () => void }> = ({ text, language, onStart }) => {
    const { t } = useTranslation();
    const Recognition = getRecognition();
    const [state, setState] = useState<'idle' | 'listening' | 'done' | 'error'>('idle');
    const [result, setResult] = useState<(SpeechScore & { heard: string }) | null>(null);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
    const timeoutRef = useRef<number | null>(null);

    const clearTimer = () => { if (timeoutRef.current !== null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; } };
    useEffect(() => () => { clearTimer(); recRef.current?.abort(); }, []);
    if (!Recognition) return null;

    const listen = () => {
        onStart?.();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        recRef.current?.abort();
        const rec = new Recognition();
        rec.lang = langToBcp47(language);
        rec.interimResults = false;
        rec.maxAlternatives = 3;
        rec.continuous = false;
        let gotResult = false;
        rec.onresult = e => {
            gotResult = true;
            clearTimer();
            const alts = Array.from(e.results[0] ?? []).map(a => a.transcript);
            setResult(bestScore(text, alts, language));
            setState('done');
        };
        rec.onerror = e => {
            gotResult = true;
            clearTimer();
            setErrorKey(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'board.mic_denied' : 'board.mic_nothing');
            setState('error');
        };
        rec.onend = () => { clearTimer(); if (!gotResult) { setErrorKey('board.mic_nothing'); setState('error'); } };
        recRef.current = rec;
        setResult(null);
        setErrorKey(null);
        setState('listening');
        try { rec.start(); } catch { setErrorKey('board.mic_nothing'); setState('error'); return; }
        // Filet de sécurité : certains téléphones ne renvoient jamais de résultat
        clearTimer();
        timeoutRef.current = window.setTimeout(() => {
            if (gotResult) return;
            gotResult = true;
            rec.abort();
            setErrorKey('board.mic_nothing');
            setState('error');
        }, 10_000);
    };

    const tone = result?.level === 'great' ? 'text-emerald-300' : result?.level === 'close' ? 'text-amber-200' : 'text-rose-200';

    return (
        <div className="mt-3">
            <button
                type="button"
                onClick={state === 'listening' ? () => recRef.current?.stop() : listen}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold ring-1 transition active:scale-95 ${state === 'listening' ? 'bg-rose-400/20 text-rose-100 ring-rose-300/50' : 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/30 hover:bg-emerald-400/20'}`}
                aria-label={t('board.repeat')}
            >
                {state === 'listening'
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('board.repeat_listening')}</>
                    : state === 'done' || state === 'error'
                        ? <><RotateCcw className="h-4 w-4" /> {t('board.repeat')}</>
                        : <><Mic className="h-4 w-4" /> {t('board.repeat')}</>}
            </button>
            {state === 'done' && result && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-xl bg-black/25 p-3" aria-live="polite">
                    <p className={`text-sm font-bold ${tone}`}>
                        {t(result.level === 'great' ? 'board.repeat_great' : result.level === 'close' ? 'board.repeat_close' : 'board.repeat_retry')}
                        <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">{Math.round(result.score * 100)} %</span>
                    </p>
                    <p className="mt-1.5 flex flex-wrap gap-x-1.5 font-chalk text-lg">
                        {result.words.map((w, i) => (
                            <span key={i} className={w.ok ? 'text-emerald-200' : 'text-rose-200 underline decoration-rose-300 decoration-wavy underline-offset-4'}>{w.text}</span>
                        ))}
                    </p>
                    {result.heard && <p className="mt-1 text-xs text-slate-400">{t('board.repeat_heard')} « {result.heard} »</p>}
                </motion.div>
            )}
            {state === 'error' && errorKey && <p className="mt-2 text-sm text-rose-200" aria-live="polite">{t(errorKey)}</p>}
        </div>
    );
};

const Quiz: React.FC<{ item: BoardItem; mgMode: MgMode; onAnswered?: (ok: boolean) => void }> = ({ item, mgMode, onAnswered }) => {
    const { t } = useTranslation();
    const [picked, setPicked] = useState<string | null>(null);
    const done = picked !== null;
    const correct = picked === item.answer;

    return (
        <div className="rounded-2xl border border-sky-300/25 bg-sky-400/[0.07] p-4 sm:p-5">
            <p className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-sky-200">
                <HelpCircle className="h-4 w-4" /> {t('board.quiz_title')}
            </p>
            <p className="mb-4 text-lg font-semibold text-white">{item.question}</p>
            <div className="grid gap-2 sm:grid-cols-2">
                {item.options?.map(opt => {
                    const isAnswer = opt === item.answer;
                    const isPicked = opt === picked;
                    const state = !done ? 'idle' : isAnswer ? 'right' : isPicked ? 'wrong' : 'dim';
                    return (
                        <button
                            key={opt}
                            type="button"
                            disabled={done}
                            onClick={() => { setPicked(opt); onAnswered?.(opt === item.answer); }}
                            className={[
                                'flex min-h-[3rem] items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-left text-base font-semibold transition',
                                state === 'idle' && 'bg-white/[0.06] text-white ring-1 ring-white/15 hover:bg-white/[0.12] active:scale-[0.99]',
                                state === 'right' && 'bg-emerald-400/20 text-emerald-100 ring-2 ring-emerald-300/70',
                                state === 'wrong' && 'animate-shake bg-rose-400/15 text-rose-100 ring-2 ring-rose-300/60',
                                state === 'dim' && 'bg-white/[0.03] text-white/40 ring-1 ring-white/10',
                            ].filter(Boolean).join(' ')}
                        >
                            <span className="font-chalk text-lg">{opt}</span>
                            {state === 'right' && <CheckCircle2 className="h-5 w-5 shrink-0" />}
                            {state === 'wrong' && <XCircle className="h-5 w-5 shrink-0" />}
                        </button>
                    );
                })}
            </div>
            {done && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-xl bg-black/20 p-3">
                    <p className={`mb-1 font-bold ${correct ? 'text-emerald-300' : 'text-rose-200'}`}>
                        {correct ? t('board.correct') : t('board.wrong')}
                        {!correct && <Chalk className="ml-1 text-lg">{item.answer}</Chalk>}
                    </p>
                    <Bilingual fr={item.explanation} mg={item.mg} mode={mgMode} frClassName="text-slate-200" mgFirstClassName="text-amber-50" />
                </motion.div>
            )}
        </div>
    );
};

export const BoardItemView: React.FC<Props> = ({ item, language, mgMode, animate = true, onQuizAnswered, onPracticeStart }) => {
    const { t } = useTranslation();

    switch (item.kind) {
        case 'title':
            return (
                <Write animate={animate}>
                    {mgMode === 'first' && item.mg ? (
                        <>
                            <h3 className="font-chalk text-[1.9rem] leading-tight text-amber-50 sm:text-4xl" lang="mg">{item.mg}</h3>
                            <p className="mt-1 text-sm text-slate-400">{item.text}</p>
                        </>
                    ) : (
                        <h3 className="font-chalk text-[1.9rem] leading-tight text-white sm:text-4xl">{item.text}</h3>
                    )}
                    <svg className="mt-1 h-3 w-48 text-amber-300/80" viewBox="0 0 200 12" fill="none" aria-hidden="true">
                        <motion.path
                            d="M2 8 C 50 2, 110 12, 198 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                            initial={animate ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.6 }}
                        />
                    </svg>
                    {mgMode === 'with' && <MgLine text={item.mg} show />}
                </Write>
            );

        case 'explain':
            return (
                <Write animate={animate}>
                    <Bilingual fr={item.text} mg={item.mg} mode={mgMode} />
                </Write>
            );

        case 'vocab':
            return (
                <Write animate={animate} className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Chalk className="text-[1.75rem] leading-none sm:text-3xl">{item.target}</Chalk>
                        {item.target && <SpeakButton text={item.target} language={language} />}
                        {item.phonetic && <span className="font-mono text-sm text-emerald-200/80">/{item.phonetic}/</span>}
                    </div>
                    <div className="mt-2">
                        <Bilingual
                            fr={item.fr ? `= ${item.fr}` : undefined} mg={item.mg} mode={mgMode}
                            frClassName="text-base text-slate-200" mgFirstClassName="text-base text-amber-50"
                        />
                    </div>
                    {item.example && (
                        <div className="mt-3 border-l-2 border-white/20 pl-3">
                            <div className="flex items-center">
                                <Chalk className="text-xl">{item.example}</Chalk>
                                <SpeakButton text={item.example} language={language} />
                            </div>
                            <Bilingual fr={item.exampleFr} mg={item.exampleMg} mode={mgMode} frClassName="text-sm text-slate-300" mgFirstClassName="text-sm text-amber-50" />
                        </div>
                    )}
                    {item.target && <RepeatAfterMe text={item.target} language={language} onStart={onPracticeStart} />}
                </Write>
            );

        case 'sentence':
            return (
                <Write animate={animate}>
                    <div className="flex items-start">
                        <Chalk className="text-[1.6rem] leading-snug sm:text-3xl">{item.target}</Chalk>
                        {item.target && <SpeakButton text={item.target} language={language} />}
                    </div>
                    <div className="mt-1">
                        <Bilingual fr={item.fr} mg={item.mg} mode={mgMode} frClassName="text-base text-slate-200" mgFirstClassName="text-base text-amber-50" />
                    </div>
                    {item.breakdown && item.breakdown.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {item.breakdown.map((b, i) => (
                                <motion.div
                                    key={`${b.part}-${i}`}
                                    initial={animate ? { opacity: 0, y: 8 } : false}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.7 + i * 0.12 }}
                                    className="min-w-[4.5rem] rounded-xl bg-white/[0.06] px-3 py-2 text-center ring-1 ring-white/10"
                                >
                                    <Chalk className="block text-lg">{b.part}</Chalk>
                                    {mgMode === 'first' && b.mg ? (
                                        <>
                                            <span className="block text-xs text-amber-100" lang="mg">{b.mg}</span>
                                            <span className="block text-[0.7rem] text-slate-400">{b.fr}</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="block text-xs text-slate-300">{b.fr}</span>
                                            {mgMode === 'with' && b.mg && <span className="block text-xs italic text-amber-200/90" lang="mg">{b.mg}</span>}
                                        </>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    )}
                    {item.target && <RepeatAfterMe text={item.target} language={language} onStart={onPracticeStart} />}
                </Write>
            );

        case 'table':
            return (
                <Write animate={animate}>
                    {(item.text || (mgMode === 'first' && item.mg)) && (
                        <p className="mb-2 text-sm font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">
                            {mgMode === 'first' && item.mg ? item.mg : item.text}
                        </p>
                    )}
                    <div className="overflow-x-auto rounded-2xl ring-1 ring-white/15">
                        <table className="w-full min-w-[16rem] border-collapse text-left">
                            <thead>
                                <tr className="bg-white/[0.07]">
                                    {item.headers?.map(h => (
                                        <th key={h} className="border-b border-white/15 px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-slate-300">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {item.rows?.map((row, r) => (
                                    <tr key={r} className="odd:bg-white/[0.02]">
                                        {row.map((cell, c) => (
                                            <td key={c} className="border-b border-white/[0.07] px-3 py-2 align-top">
                                                {c === 0 ? <span className="text-slate-200">{cell}</span> : <Chalk className="text-lg">{cell}</Chalk>}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {mgMode === 'with' && <MgLine text={item.mg} show />}
                    {mgMode === 'first' && item.text && item.mg && <p className="mt-1.5 text-xs text-slate-400">{item.text}</p>}
                </Write>
            );

        case 'tip': {
            const primary = mgMode === 'first' && item.mg ? item.mg : item.text;
            const secondary = mgMode === 'first' && item.mg ? item.text : mgMode === 'with' ? item.mg : undefined;
            return (
                <Write animate={animate} className="rotate-[-0.4deg] rounded-2xl bg-amber-200 p-4 text-slate-900 shadow-[0_10px_30px_-12px_rgba(251,191,36,0.6)]">
                    <p className="mb-1 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-amber-800">
                        <Lightbulb className="h-4 w-4" /> {t('board.tip')}
                    </p>
                    <p className="text-base font-semibold leading-snug" lang={mgMode === 'first' && item.mg ? 'mg' : undefined}>{primary}</p>
                    {secondary && <p className="mt-1.5 text-sm italic text-amber-900">{mgMode === 'with' ? '🇲🇬 ' : 'FR · '}{secondary}</p>}
                </Write>
            );
        }

        case 'warning':
            return (
                <Write animate={animate} className="rounded-2xl border-2 border-dashed border-rose-300/50 bg-rose-400/[0.07] p-4">
                    <p className="mb-1 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-rose-200">
                        <AlertTriangle className="h-4 w-4" /> {t('board.warning')}
                    </p>
                    <Bilingual fr={item.text} mg={item.mg} mode={mgMode} frClassName="text-base text-rose-50" mgFirstClassName="text-base text-amber-50" />
                </Write>
            );

        case 'quiz':
            return (
                <Write animate={animate}>
                    <Quiz item={item} mgMode={mgMode} onAnswered={onQuizAnswered} />
                </Write>
            );

        default:
            return null;
    }
};
