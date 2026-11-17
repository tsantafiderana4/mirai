import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, Lightbulb, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import type { BoardItem } from './types';
import { pronounce } from '../../services/boardService';
import { useTranslation } from '../../contexts/LanguageContext';

interface Props {
    item: BoardItem;
    language: string;
    showMg: boolean;
    /** Animation « écriture à la craie » à l'apparition. */
    animate?: boolean;
    onQuizAnswered?: (correct: boolean) => void;
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

/** Ligne de traduction / aide en malagasy. */
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
            <span className="mt-0.5 shrink-0 rounded-md bg-amber-300/15 px-1.5 py-px text-[0.65rem] font-extrabold tracking-wider text-amber-300 ring-1 ring-amber-300/30">MG</span>
            <span className="italic">{text}</span>
        </motion.p>
    );
};

const Chalk: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <span className={`font-chalk text-white [text-shadow:0_0_1px_rgba(255,255,255,0.35)] ${className}`}>{children}</span>
);

const SpeakButton: React.FC<{ text: string; language: string }> = ({ text, language }) => {
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

const Quiz: React.FC<{ item: BoardItem; showMg: boolean; onAnswered?: (ok: boolean) => void }> = ({ item, showMg, onAnswered }) => {
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
                    <p className={`font-bold ${correct ? 'text-emerald-300' : 'text-rose-200'}`}>
                        {correct ? t('board.correct') : t('board.wrong')}
                        {!correct && <Chalk className="ml-1 text-lg">{item.answer}</Chalk>}
                    </p>
                    {item.explanation && <p className="mt-1 text-slate-200">{item.explanation}</p>}
                    <MgLine text={item.mg} show={showMg} />
                </motion.div>
            )}
        </div>
    );
};

export const BoardItemView: React.FC<Props> = ({ item, language, showMg, animate = true, onQuizAnswered }) => {
    const { t } = useTranslation();

    switch (item.kind) {
        case 'title':
            return (
                <Write animate={animate}>
                    <h3 className="font-chalk text-[1.9rem] leading-tight text-white sm:text-4xl">{item.text}</h3>
                    <svg className="mt-1 h-3 w-48 text-amber-300/80" viewBox="0 0 200 12" fill="none" aria-hidden="true">
                        <motion.path
                            d="M2 8 C 50 2, 110 12, 198 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                            initial={animate ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.6 }}
                        />
                    </svg>
                    <MgLine text={item.mg} show={showMg} />
                </Write>
            );

        case 'explain':
            return (
                <Write animate={animate}>
                    <p className="text-[1.05rem] leading-relaxed text-slate-100 sm:text-lg">{item.text}</p>
                    <MgLine text={item.mg} show={showMg} />
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
                    {item.fr && <p className="mt-2 text-base text-slate-200"><span className="text-slate-400">=</span> {item.fr}</p>}
                    <MgLine text={item.mg} show={showMg} />
                    {item.example && (
                        <div className="mt-3 border-l-2 border-white/20 pl-3">
                            <div className="flex items-center">
                                <Chalk className="text-xl">{item.example}</Chalk>
                                <SpeakButton text={item.example} language={language} />
                            </div>
                            {item.exampleFr && <p className="text-sm text-slate-300">{item.exampleFr}</p>}
                            <MgLine text={item.exampleMg} show={showMg} className="text-sm" />
                        </div>
                    )}
                </Write>
            );

        case 'sentence':
            return (
                <Write animate={animate}>
                    <div className="flex items-start">
                        <Chalk className="text-[1.6rem] leading-snug sm:text-3xl">{item.target}</Chalk>
                        {item.target && <SpeakButton text={item.target} language={language} />}
                    </div>
                    {item.fr && <p className="mt-1 text-base text-slate-200">{item.fr}</p>}
                    <MgLine text={item.mg} show={showMg} />
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
                                    <span className="block text-xs text-slate-300">{b.fr}</span>
                                    {showMg && b.mg && <span className="block text-xs italic text-amber-200/90" lang="mg">{b.mg}</span>}
                                </motion.div>
                            ))}
                        </div>
                    )}
                </Write>
            );

        case 'table':
            return (
                <Write animate={animate}>
                    {item.text && <p className="mb-2 text-sm font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">{item.text}</p>}
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
                    <MgLine text={item.mg} show={showMg} />
                </Write>
            );

        case 'tip':
            return (
                <Write animate={animate} className="rotate-[-0.4deg] rounded-2xl bg-amber-200 p-4 text-slate-900 shadow-[0_10px_30px_-12px_rgba(251,191,36,0.6)]">
                    <p className="mb-1 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-amber-800">
                        <Lightbulb className="h-4 w-4" /> {t('board.tip')}
                    </p>
                    <p className="text-base font-semibold leading-snug">{item.text}</p>
                    {showMg && item.mg && <p className="mt-1.5 text-sm italic text-amber-900" lang="mg">🇲🇬 {item.mg}</p>}
                </Write>
            );

        case 'warning':
            return (
                <Write animate={animate} className="rounded-2xl border-2 border-dashed border-rose-300/50 bg-rose-400/[0.07] p-4">
                    <p className="mb-1 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-rose-200">
                        <AlertTriangle className="h-4 w-4" /> {t('board.warning')}
                    </p>
                    <p className="text-base text-rose-50">{item.text}</p>
                    <MgLine text={item.mg} show={showMg} />
                </Write>
            );

        case 'quiz':
            return (
                <Write animate={animate}>
                    <Quiz item={item} showMg={showMg} onAnswered={onQuizAnswered} />
                </Write>
            );

        default:
            return null;
    }
};
