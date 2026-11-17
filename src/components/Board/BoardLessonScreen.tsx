import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    X, Play, Pause, SkipBack, SkipForward, RotateCcw, MessageCircleQuestion, Lock, CheckCircle2,
    Loader2, Send, Volume2, VolumeX, Smartphone, Sparkles, ChevronRight, Subtitles, MessageSquareOff, Trophy, BookOpen,
} from 'lucide-react';
import type { BoardAnswer, BoardLesson, BoardSyllabus, BoardVoiceMode, MgMode, SyllabusLesson } from './types';
import { BoardItemView, MgLine, Bilingual } from './BoardItemView';
import { useBoardPlayer } from './useBoardPlayer';
import { boardService, loadVoiceMode, saveVoiceMode, languageName } from '../../services/boardService';
import { AIError } from '../../services/aiClient';
import { useTranslation } from '../../contexts/LanguageContext';
import { useAppStore } from '../../store/useAppStore';
import { getFlagUrl } from '../../constants';

interface Props {
    language: string;
    level: string;
    onClose: () => void;
    onShowPayment: () => void;
    notify: (m: string, t?: string) => void;
}

const MG_MODE_KEY = 'tm_board_mg_mode';
const readMgMode = (fallback: MgMode): MgMode => {
    try { const v = localStorage.getItem(MG_MODE_KEY); if (v === 'off' || v === 'with' || v === 'first') return v; } catch { /* ignore */ }
    return fallback;
};
const writeMgMode = (m: MgMode) => { try { localStorage.setItem(MG_MODE_KEY, m); } catch { /* ignore */ } };
const NEXT_MG_MODE: Record<MgMode, MgMode> = { with: 'first', first: 'off', off: 'with' };
const SUB_KEY = 'tm_board_subtitles';
const readFlag = (k: string, def: boolean) => { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch { return def; } };
const writeFlag = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } };

/** Fond « ardoise » réutilisé par toutes les vues. */
const Slate: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`relative flex flex-col overflow-hidden rounded-[1.75rem] bg-[#0f1d18] shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(rgba(255,255,255,0.9)_0.6px,transparent_0.6px)] [background-size:3px_3px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(52,211,153,0.10),transparent_60%)]" />
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
);

const TeacherAvatar: React.FC<{ speaking: boolean }> = ({ speaking }) => (
    <div className="relative h-11 w-11 shrink-0">
        <div className={`absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 ${speaking ? 'animate-pulse' : ''}`} />
        <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-[#0b1512] font-chalk text-lg text-emerald-200">T</div>
        {speaking && (
            <div className="absolute -bottom-1 -right-1 flex h-4 items-end gap-[2px] rounded-full bg-emerald-500 px-1 py-[3px]">
                {[0, 1, 2].map(i => (
                    <motion.span key={i} className="w-[2px] rounded-full bg-white" animate={{ height: [3, 8, 4, 7, 3] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                ))}
            </div>
        )}
    </div>
);

// ---------------------------------------------------------------------
// Vue 1 : programme des 20 leçons
// ---------------------------------------------------------------------
const SyllabusView: React.FC<{
    syllabus: BoardSyllabus | null; error: string | null; mgMode: MgMode;
    onOpen: (l: SyllabusLesson) => void; onRetry: () => void;
}> = ({ syllabus, error, mgMode, onOpen, onRetry }) => {
    const { t } = useTranslation();
    if (error) {
        return (
            <div className="flex flex-col items-center gap-4 py-16 text-center text-slate-200">
                <p>{error}</p>
                <button onClick={onRetry} className="rounded-full bg-emerald-500 px-5 py-2.5 font-bold text-emerald-950">{t('board.retry')}</button>
            </div>
        );
    }
    if (!syllabus) {
        return (
            <div className="space-y-3 py-2" aria-busy="true">
                <p className="text-center text-sm text-emerald-200/80">{t('board.loading_program')}</p>
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.05]" />)}
            </div>
        );
    }
    const nextNumber = syllabus.lessons.find(l => !l.completed)?.number;
    return (
        <ol className="space-y-2.5">
            {syllabus.lessons.map(l => {
                const isNext = l.number === nextNumber;
                return (
                    <li key={l.number}>
                        <button
                            onClick={() => onOpen(l)}
                            className={`group flex w-full items-center gap-4 rounded-2xl p-4 text-left ring-1 transition active:scale-[0.99] ${isNext ? 'bg-emerald-400/10 ring-emerald-300/40 hover:bg-emerald-400/15' : 'bg-white/[0.04] ring-white/10 hover:bg-white/[0.08]'}`}
                        >
                            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-chalk text-xl ${l.completed ? 'bg-emerald-500 text-emerald-950' : 'bg-white/10 text-white'}`}>
                                {l.completed ? <CheckCircle2 className="h-6 w-6" /> : l.number}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block font-semibold leading-snug text-white">{l.title}</span>
                                {mgMode !== 'off' && l.titleMg && <span className="block text-sm italic text-amber-200/90" lang="mg">{l.titleMg}</span>}
                                {isNext && <span className="mt-1 inline-block rounded-full bg-emerald-400/20 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider text-emerald-200">{t('board.up_next')}</span>}
                            </span>
                            {l.unlocked
                                ? <ChevronRight className="h-5 w-5 text-white/50 transition group-hover:translate-x-0.5" />
                                : <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-slate-200"><Lock className="h-3.5 w-3.5" /> {t('board.price', { price: syllabus.price })}</span>}
                        </button>
                    </li>
                );
            })}
        </ol>
    );
};

// ---------------------------------------------------------------------
// Vue 2 : préparation (première génération ≈ 30-60 s)
// ---------------------------------------------------------------------
const PreparingView: React.FC = () => {
    const { t } = useTranslation();
    const messages: string[] = [t('board.prep_1'), t('board.prep_2'), t('board.prep_3'), t('board.prep_4')];
    const [i, setI] = useState(0);
    useEffect(() => { const id = setInterval(() => setI(x => (x + 1) % messages.length), 3500); return () => clearInterval(id); }, [messages.length]);
    return (
        <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
            <div className="relative">
                <motion.div className="h-20 w-20 rounded-full border-4 border-emerald-300/20 border-t-emerald-300" animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
                <Sparkles className="absolute inset-0 m-auto h-7 w-7 text-amber-200" />
            </div>
            <AnimatePresence mode="wait">
                <motion.p key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="max-w-xs font-chalk text-2xl text-white">
                    {messages[i]}
                </motion.p>
            </AnimatePresence>
            <p className="max-w-xs text-sm text-slate-400">{t('board.prep_hint')}</p>
        </div>
    );
};

// ---------------------------------------------------------------------
// Feuille « Poser une question »
// ---------------------------------------------------------------------
const AskSheet: React.FC<{
    language: string; mgMode: MgMode; busy: boolean; answer: BoardAnswer | null; answerSpeaking: boolean;
    onSend: (q: string) => void; onClose: () => void; onReplayAnswer: () => void;
}> = ({ language, mgMode, busy, answer, answerSpeaking, onSend, onClose, onReplayAnswer }) => {
    const { t } = useTranslation();
    const [q, setQ] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { if (!answer && !busy) inputRef.current?.focus(); }, [answer, busy]);
    const suggestions: string[] = [t('board.suggest_repeat'), t('board.suggest_other'), t('board.suggest_example')];

    return (
        <motion.div className="fixed inset-0 z-[320] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
            <motion.div
                role="dialog" aria-modal="true" aria-label={t('board.ask')}
                className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-[1.75rem] bg-[#0f1d18] p-5 ring-1 ring-white/10 sm:rounded-[1.75rem]"
                initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={e => e.stopPropagation()}
            >
                {!answer ? (
                    <>
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-white"><MessageCircleQuestion className="h-5 w-5 text-emerald-300" /> {t('board.ask')}</h3>
                            <button onClick={onClose} disabled={busy} className="rounded-full p-2 text-slate-300 hover:bg-white/10" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-2">
                            {suggestions.map(s => (
                                <button key={s} disabled={busy} onClick={() => onSend(s)} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 hover:bg-white/[0.12] disabled:opacity-50">{s}</button>
                            ))}
                        </div>
                        <form onSubmit={e => { e.preventDefault(); if (q.trim().length >= 2) onSend(q.trim()); }} className="flex items-end gap-2">
                            <textarea
                                ref={inputRef} value={q} onChange={e => setQ(e.target.value)} rows={2} maxLength={500} disabled={busy}
                                placeholder={t('board.ask_placeholder')}
                                className="min-h-[3.25rem] flex-1 resize-none rounded-2xl bg-white/[0.06] px-4 py-3 text-base text-white placeholder:text-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                            />
                            <button type="submit" disabled={busy || q.trim().length < 2} className="flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950 transition disabled:opacity-40" aria-label={t('board.send')}>
                                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                            </button>
                        </form>
                        <p className="mt-2 text-xs text-slate-500">{busy ? t('board.thinking') : t('board.ask_cost')}</p>
                    </>
                ) : (
                    <>
                        <div className="mb-4 flex items-center gap-3">
                            <TeacherAvatar speaking={answerSpeaking} />
                            <h3 className="flex-1 text-lg font-bold text-white">{t('board.answer_title')}</h3>
                            <button onClick={onReplayAnswer} className="rounded-full p-2 text-emerald-200 hover:bg-white/10" aria-label={t('board.replay')}><RotateCcw className="h-5 w-5" /></button>
                        </div>
                        {answer.say && <p className="mb-4 rounded-2xl bg-white/[0.05] p-4 text-base leading-relaxed text-slate-100">{answer.say}</p>}
                        <div className="space-y-4">
                            {answer.items.map((it, i) => <BoardItemView key={i} item={it} language={language} mgMode={mgMode} />)}
                        </div>
                        <button onClick={onClose} className="mt-6 w-full rounded-2xl bg-emerald-400 py-3.5 text-base font-extrabold text-emerald-950 active:scale-[0.99]">{t('board.resume')}</button>
                    </>
                )}
            </motion.div>
        </motion.div>
    );
};

// ---------------------------------------------------------------------
// Vue 3 : la leçon au tableau
// ---------------------------------------------------------------------
const LessonView: React.FC<{
    lesson: BoardLesson; mgMode: MgMode; subtitles: boolean; voiceMode: BoardVoiceMode;
    onFinished: () => void; notify: (m: string, t?: string) => void; onShowPayment: () => void;
}> = ({ lesson, mgMode, subtitles, voiceMode, onFinished, notify, onShowPayment }) => {
    const { t } = useTranslation();
    const voiceName = useAppStore(s => s.user?.preferences?.voiceName);
    const [started, setStarted] = useState(false);
    const player = useBoardPlayer({
        lesson, voiceMode, voiceName,
        onVoiceFallback: () => notify(t('board.voice_fallback'), 'info'),
    });

    // Questions
    const [asking, setAsking] = useState(false);
    const [askBusy, setAskBusy] = useState(false);
    const [answer, setAnswer] = useState<BoardAnswer | null>(null);
    const [answerSpeaking, setAnswerSpeaking] = useState(false);
    const answerAudio = useRef<HTMLAudioElement | null>(null);
    const answerUrl = useRef<string | undefined>(undefined);
    const resumeAfterAsk = useRef(false);

    useEffect(() => { if (player.phase === 'finished') onFinished(); }, [player.phase, onFinished]);

    const playAnswer = useCallback(() => {
        if (!answerUrl.current) return;
        const a = answerAudio.current ?? new Audio();
        answerAudio.current = a;
        a.src = answerUrl.current;
        a.onplay = () => setAnswerSpeaking(true);
        a.onended = () => setAnswerSpeaking(false);
        a.onpause = () => setAnswerSpeaking(false);
        a.play().catch(() => setAnswerSpeaking(false));
    }, []);

    const openAsk = () => {
        resumeAfterAsk.current = player.phase === 'playing';
        player.pause();
        setAnswer(null);
        setAsking(true);
    };

    const closeAsk = () => {
        answerAudio.current?.pause();
        if (answerUrl.current) URL.revokeObjectURL(answerUrl.current);
        answerUrl.current = undefined;
        setAsking(false);
        setAnswer(null);
        if (resumeAfterAsk.current) player.resume();
    };

    const send = async (q: string) => {
        setAskBusy(true);
        try {
            const res = await boardService.ask(lesson.id, player.stepIndex, q, voiceName);
            answerUrl.current = res.audioUrl;
            setAnswer(res.answer);
            if (res.audioUrl && voiceMode !== 'off') setTimeout(playAnswer, 200);
        } catch (e) {
            if (e instanceof AIError && e.status === 402) { notify(t('board.insufficient'), 'error'); onShowPayment(); }
            else notify(e instanceof AIError && e.status === 429 ? e.message : t('board.ask_error'), 'error');
        } finally {
            setAskBusy(false);
        }
    };

    const step = player.step;
    const speaking = player.phase === 'playing';
    const total = lesson.steps.length;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Progression par étapes */}
            <div className="mb-3 flex gap-1.5" role="tablist" aria-label={t('board.steps')}>
                {lesson.steps.map((_, i) => (
                    <button
                        key={i} onClick={() => { setStarted(true); player.goTo(i); }}
                        className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-label={t('board.step', { n: i + 1, total })}
                        aria-current={i === player.stepIndex ? 'step' : undefined}
                    >
                        <span
                            className="block h-full rounded-full bg-emerald-300 transition-[width] duration-200"
                            style={{ width: i < player.stepIndex ? '100%' : i === player.stepIndex ? `${started ? player.stepProgress * 100 : 0}%` : '0%' }}
                        />
                    </button>
                ))}
            </div>

            {/* Le tableau */}
            <Slate className="min-h-[18rem] flex-1">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8">
                    {!started ? (
                        <div className="flex flex-col items-start gap-4 py-6">
                            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-emerald-200">{t('board.lesson_n', { n: lesson.number })} · {lesson.level}</span>
                            <h2 className="font-chalk text-4xl leading-tight text-white sm:text-5xl">{lesson.title}</h2>
                            <MgLine text={lesson.titleMg} show={mgMode !== 'off'} className="text-lg" />
                            <div className="mt-2 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
                                <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">{t('board.objective')}</p>
                                <div className="mt-1">
                                    <Bilingual fr={lesson.objective} mg={lesson.objectiveMg} mode={mgMode} frClassName="text-base text-slate-100" mgFirstClassName="text-base text-amber-50" />
                                </div>
                            </div>
                            <button
                                onClick={() => { setStarted(true); player.start(); }}
                                className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-400 px-7 py-3.5 text-lg font-extrabold text-emerald-950 shadow-[0_10px_30px_-10px_rgba(52,211,153,0.8)] transition active:scale-95"
                            >
                                <Play className="h-5 w-5 fill-current" /> {t('board.start')}
                            </button>
                        </div>
                    ) : (
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={player.stepIndex}
                                className="space-y-6"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, filter: 'blur(6px)', transition: { duration: 0.35 } }}
                            >
                                {step.items.slice(0, Math.max(player.revealedCount, 0)).map((item, i) => (
                                    <BoardItemView
                                        key={i} item={item} language={lesson.language} mgMode={mgMode}
                                        onPracticeStart={player.holdForPractice}
                                        onQuizAnswered={() => player.markQuizAnswered(player.stepIndex)}
                                    />
                                ))}
                                {player.phase === 'loading' && (
                                    <div className="flex items-center gap-2 text-sm text-emerald-200/80"><Loader2 className="h-4 w-4 animate-spin" /> {t('board.loading_voice')}</div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    )}
                </div>
            </Slate>

            {/* Le professeur parle (sous-titres) */}
            {started && subtitles && step && (
                <div className="mt-3 flex items-start gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                    <TeacherAvatar speaking={speaking} />
                    <p className="line-clamp-3 flex-1 text-[0.95rem] leading-snug text-slate-200">{step.say}</p>
                </div>
            )}

            {/* Commandes */}
            {started && (
                <div className="mt-3 flex items-center justify-between gap-2">
                    <button onClick={player.prev} disabled={player.stepIndex === 0} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/10 disabled:opacity-30" aria-label={t('board.prev')}>
                        <SkipBack className="h-5 w-5" />
                    </button>

                    <button
                        onClick={() => {
                            if (player.phase === 'playing') player.pause();
                            else if (player.phase === 'paused') player.resume();
                            else player.replay();
                        }}
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg transition active:scale-95"
                        aria-label={player.phase === 'playing' ? t('board.pause') : t('board.play')}
                    >
                        {player.phase === 'loading' ? <Loader2 className="h-6 w-6 animate-spin" />
                            : player.phase === 'playing' ? <Pause className="h-6 w-6 fill-current" />
                                : player.phase === 'stepDone' ? <RotateCcw className="h-6 w-6" />
                                    : <Play className="h-6 w-6 fill-current" />}
                    </button>

                    <button onClick={player.next} className={`flex h-12 min-w-[3rem] shrink-0 items-center justify-center gap-1.5 rounded-full px-3 font-bold ring-1 transition sm:px-4 ${player.phase === 'stepDone' && !player.waitingForQuiz ? 'bg-white text-slate-900 ring-white' : 'bg-white/[0.06] text-white ring-white/10'}`} aria-label={player.isLast ? t('board.finish') : t('board.next')}>
                        <span className={player.isLast ? '' : 'hidden sm:inline'}>{player.isLast ? t('board.finish') : t('board.next')}</span> <SkipForward className="h-4 w-4" />
                    </button>

                    <button onClick={openAsk} className="ml-auto flex h-12 shrink-0 items-center gap-2 rounded-full bg-amber-300 px-4 font-extrabold text-amber-950 shadow-[0_8px_24px_-10px_rgba(252,211,77,0.9)] transition active:scale-95">
                        <MessageCircleQuestion className="h-5 w-5" /> <span>{t('board.ask')}</span>
                    </button>
                </div>
            )}
            {started && player.phase === 'stepDone' && player.waitingForQuiz && (
                <p className="mt-2 text-center text-sm text-sky-200">{t('board.answer_quiz_first')}</p>
            )}

            <AnimatePresence>
                {asking && (
                    <AskSheet
                        language={lesson.language} mgMode={mgMode} busy={askBusy} answer={answer}
                        answerSpeaking={answerSpeaking} onSend={send} onClose={closeAsk} onReplayAnswer={playAnswer}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

// ---------------------------------------------------------------------
// Vue 4 : résumé de fin de leçon
// ---------------------------------------------------------------------
const SummaryView: React.FC<{ lesson: BoardLesson; mgMode: MgMode; hasNext: boolean; onNext: () => void; onList: () => void; onReplay: () => void }> = ({ lesson, mgMode, hasNext, onNext, onList, onReplay }) => {
    const { t } = useTranslation();
    return (
        <Slate>
            <div className="p-6 sm:p-10">
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-300 text-amber-950">
                    <Trophy className="h-8 w-8" />
                </motion.div>
                <p className="text-sm font-bold uppercase tracking-widest text-emerald-200">{t('board.lesson_done')}</p>
                <h2 className="mt-1 font-chalk text-4xl text-white">{lesson.title}</h2>
                <MgLine text={lesson.titleMg} show={mgMode !== 'off'} />
                {lesson.summary.length > 0 && (
                    <div className="mt-6">
                        <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">{t('board.summary_title')}</p>
                        <ul className="space-y-3">
                            {lesson.summary.map((s, i) => (
                                <li key={i} className="flex gap-3">
                                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                                    <div>
                                        <Bilingual fr={s} mg={lesson.summaryMg[i]} mode={mgMode} frClassName="text-slate-100" mgFirstClassName="text-amber-50" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    {hasNext && (
                        <button onClick={onNext} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-400 py-3.5 text-base font-extrabold text-emerald-950 active:scale-[0.99]">
                            {t('board.next_lesson')} <ChevronRight className="h-5 w-5" />
                        </button>
                    )}
                    <button onClick={onReplay} className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-3.5 font-bold text-white ring-1 ring-white/10"><RotateCcw className="h-4 w-4" /> {t('board.replay_lesson')}</button>
                    <button onClick={onList} className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-3.5 font-bold text-white ring-1 ring-white/10"><BookOpen className="h-4 w-4" /> {t('board.back_to_list')}</button>
                </div>
            </div>
        </Slate>
    );
};

// ---------------------------------------------------------------------
// Écran complet
// ---------------------------------------------------------------------
type View = 'syllabus' | 'preparing' | 'lesson' | 'summary';

const BoardLessonScreen: React.FC<Props> = ({ language, level, onClose, onShowPayment, notify }) => {
    const { t } = useTranslation();
    const user = useAppStore(s => s.user);
    const [view, setView] = useState<View>('syllabus');
    const [syllabus, setSyllabus] = useState<BoardSyllabus | null>(null);
    const [syllabusError, setSyllabusError] = useState<string | null>(null);
    const [lesson, setLesson] = useState<BoardLesson | null>(null);
    const [lessonRun, setLessonRun] = useState(0);
    const [confirm, setConfirm] = useState<SyllabusLesson | null>(null);
    // Par défaut : malagasy d'abord pour les élèves qui ont choisi le malagasy comme langue d'explication
    const prefersMg = (user?.preferences?.explanationLanguage || '').includes('Malagasy');
    const [mgMode, setMgMode] = useState<MgMode>(() => readMgMode(prefersMg ? 'first' : 'with'));
    const [subtitles, setSubtitles] = useState(() => readFlag(SUB_KEY, true));
    const [voiceMode, setVoiceMode] = useState<BoardVoiceMode>(loadVoiceMode);

    // Chargement du programme. NB : `t` n'est pas mémorisé par LanguageContext,
    // il ne doit donc pas figurer dans les dépendances (sinon boucle infinie).
    const [syllabusReload, setSyllabusReload] = useState(0);
    useEffect(() => {
        let cancelled = false;
        boardService.getSyllabus(language, level)
            .then(s => { if (!cancelled) { setSyllabus(s); setSyllabusError(null); } })
            .catch(e => {
                if (!cancelled) setSyllabusError(e instanceof AIError && e.status === 429 ? e.message : 'board.error_program');
            });
        return () => { cancelled = true; };
    }, [language, level, syllabusReload]);
    const loadSyllabus = () => { setSyllabusError(null); setSyllabus(null); setSyllabusReload(n => n + 1); };

    const open = async (l: SyllabusLesson) => {
        setConfirm(null);
        setView('preparing');
        try {
            const { lesson: opened } = await boardService.openLesson(language, level, l.number);
            setLesson(opened);
            setLessonRun(r => r + 1);
            setView('lesson');
            setSyllabus(s => s && { ...s, lessons: s.lessons.map(x => x.number === l.number ? { ...x, unlocked: true } : x) });
        } catch (e) {
            setView('syllabus');
            if (e instanceof AIError && e.status === 402) { notify(t('board.insufficient'), 'error'); onShowPayment(); }
            else notify(e instanceof AIError && e.status === 429 ? e.message : t('board.error_lesson'), 'error');
        }
    };

    const requestOpen = (l: SyllabusLesson) => (l.unlocked ? open(l) : setConfirm(l));

    const onFinished = useCallback(() => {
        if (!lesson) return;
        setView('summary');
        if (user) boardService.markCompleted(lesson.id, user.id).catch(() => {});
        setSyllabus(s => s && { ...s, lessons: s.lessons.map(x => x.number === lesson.number ? { ...x, completed: true, unlocked: true } : x) });
    }, [lesson, user]);

    const nextEntry = useMemo(() => lesson && syllabus?.lessons.find(l => l.number === lesson.number + 1), [lesson, syllabus]);

    const cycleMg = () => setMgMode(m => {
        const next = NEXT_MG_MODE[m];
        writeMgMode(next);
        notify(t(`board.mg_mode_${next}_hint`), 'info');
        return next;
    });
    const toggleSubs = () => setSubtitles(v => { writeFlag(SUB_KEY, !v); return !v; });
    const cycleVoice = () => setVoiceMode(v => {
        const nextMode: BoardVoiceMode = v === 'premium' ? 'device' : v === 'device' ? 'off' : 'premium';
        saveVoiceMode(nextMode);
        notify(t(`board.voice_${nextMode}`), 'info');
        return nextMode;
    });

    const VoiceIcon = voiceMode === 'premium' ? Volume2 : voiceMode === 'device' ? Smartphone : VolumeX;

    return (
        <div className="fixed inset-0 z-[300] flex flex-col bg-gradient-to-b from-[#07110e] to-[#0b1512] text-white">
            {/* Barre du haut */}
            <header className="flex items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
                <button onClick={view === 'lesson' || view === 'summary' ? () => setView('syllabus') : onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/10" aria-label={t('common.close')}>
                    <X className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate whitespace-nowrap text-[0.7rem] font-bold uppercase tracking-[0.18em] text-emerald-300">
                        <img src={getFlagUrl(language)} alt="" className="h-3 w-4 rounded-sm object-cover" /> {languageName(language)} · {level}
                    </p>
                    <h1 className="truncate text-base font-bold sm:text-lg">{view === 'lesson' && lesson ? lesson.title : t('board.title')}</h1>
                </div>
                <button
                    onClick={cycleMg}
                    className={`h-10 shrink-0 rounded-full px-3 text-xs font-extrabold ring-1 transition ${mgMode === 'off' ? 'bg-white/[0.06] text-slate-300 ring-white/10' : 'bg-amber-300 text-amber-950 ring-amber-300'}`}
                    title={t('board.mg_mode_title')}
                    aria-label={`${t('board.mg_mode_title')} : ${t(`board.mg_mode_${mgMode}`)}`}
                >
                    {t(`board.mg_mode_${mgMode}`)}
                </button>
                {view === 'lesson' && (
                    <>
                        <button onClick={toggleSubs} aria-pressed={subtitles} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/10" title={t('board.subtitles')}>
                            {subtitles ? <Subtitles className="h-5 w-5" /> : <MessageSquareOff className="h-5 w-5 text-slate-400" />}
                        </button>
                        <button onClick={cycleVoice} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/10" title={t(`board.voice_${voiceMode}`)} aria-label={t(`board.voice_${voiceMode}`)}>
                            <VoiceIcon className="h-5 w-5" />
                        </button>
                    </>
                )}
            </header>

            <main className={`mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 ${view === 'lesson' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                {view === 'syllabus' && (
                    <>
                        <div className="mb-5 mt-1">
                            <h2 className="font-chalk text-3xl text-white">{t('board.program_title')}</h2>
                            <p className="mt-1 text-sm text-slate-400">{t('board.program_subtitle')}</p>
                        </div>
                        <SyllabusView syllabus={syllabus} error={syllabusError?.startsWith('board.') ? t(syllabusError) : syllabusError} mgMode={mgMode} onOpen={requestOpen} onRetry={loadSyllabus} />
                    </>
                )}
                {view === 'preparing' && <PreparingView />}
                {view === 'lesson' && lesson && (
                    <LessonView
                        key={`${lesson.id}-${lessonRun}`}
                        lesson={lesson} mgMode={mgMode} subtitles={subtitles} voiceMode={voiceMode}
                        onFinished={onFinished} notify={notify} onShowPayment={onShowPayment}
                    />
                )}
                {view === 'summary' && lesson && (
                    <SummaryView
                        lesson={lesson} mgMode={mgMode} hasNext={!!nextEntry}
                        onNext={() => nextEntry && requestOpen(nextEntry)}
                        onList={() => setView('syllabus')}
                        onReplay={() => { setLessonRun(r => r + 1); setView('lesson'); }}
                    />
                )}
            </main>

            {/* Confirmation de déblocage */}
            <AnimatePresence>
                {confirm && syllabus && (
                    <motion.div className="fixed inset-0 z-[320] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirm(null)}>
                        <motion.div role="dialog" aria-modal="true" className="w-full max-w-md rounded-[1.75rem] bg-[#0f1d18] p-6 ring-1 ring-white/10" initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }} onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">{t('board.lesson_n', { n: confirm.number })}</p>
                            <h3 className="mt-1 font-chalk text-3xl text-white">{confirm.title}</h3>
                            <MgLine text={confirm.titleMg} show={mgMode !== 'off'} />
                            <p className="mt-3 text-sm text-slate-300">{confirm.objective}</p>
                            <p className="mt-5 rounded-2xl bg-white/[0.05] p-3 text-sm text-slate-200">{t('board.unlock_confirm', { price: syllabus.price, credits: user?.credits ?? 0 })}</p>
                            <div className="mt-5 flex gap-3">
                                <button onClick={() => setConfirm(null)} className="flex-1 rounded-2xl bg-white/[0.06] py-3 font-bold text-white ring-1 ring-white/10">{t('common.cancel')}</button>
                                <button onClick={() => open(confirm)} className="flex-1 rounded-2xl bg-emerald-400 py-3 font-extrabold text-emerald-950">{t('board.unlock', { price: syllabus.price })}</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default BoardLessonScreen;
