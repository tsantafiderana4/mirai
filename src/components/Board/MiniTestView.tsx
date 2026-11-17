import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle, ChevronRight, RotateCcw, BookOpen, Trophy, Target } from 'lucide-react';
import type { BoardLesson, MgMode } from './types';
import { buildMiniTest, checkOrder, checkTyped, scorePercent, type TestQuestion } from './miniTest';
import { Bilingual, Chalk, SpeakButton } from './BoardItemView';
import { Slate } from './Slate';
import { boardService, languageName } from '../../services/boardService';
import { useTranslation } from '../../contexts/LanguageContext';

interface Props {
    lesson: BoardLesson;
    mgMode: MgMode;
    hasNext: boolean;
    onNext: () => void;
    onReviewLesson: () => void;
    onList: () => void;
}

type Verdict = 'correct' | 'close' | 'wrong';

/** Texte de la bonne réponse, affiché après une erreur. */
function answerText(q: TestQuestion): string {
    switch (q.kind) {
        case 'meaning': case 'translate': case 'quiz': return q.options[q.correct].text;
        case 'order': return q.answer.join(' ');
        case 'type': return q.answer;
    }
}

const Question: React.FC<{
    q: TestQuestion; language: string; mgMode: MgMode; verdict: Verdict | null;
    onAnswer: (v: Verdict) => void;
}> = ({ q, language, mgMode, verdict, onAnswer }) => {
    const { t } = useTranslation();
    const [picked, setPicked] = useState<number | null>(null);
    const [typed, setTyped] = useState('');
    const [order, setOrder] = useState<number[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const done = verdict !== null;

    const instruction = {
        meaning: t('board.test_meaning'),
        translate: t('board.test_translate'),
        order: t('board.test_order'),
        type: t('board.test_type', { lang: languageName(language) }),
        quiz: t('board.test_quiz'),
    }[q.kind];

    const choose = (i: number) => {
        if (done || !('options' in q)) return;
        setPicked(i);
        onAnswer(i === q.correct ? 'correct' : 'wrong');
    };

    return (
        <div>
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">{instruction}</p>

            {/* Énoncé */}
            {q.kind === 'meaning' && (
                <div className="mb-5 flex flex-wrap items-center gap-x-2">
                    <Chalk className="text-4xl sm:text-5xl">{q.target}</Chalk>
                    <SpeakButton text={q.target} language={language} />
                    {q.phonetic && <p className="w-full font-mono text-sm text-emerald-200/80">/{q.phonetic}/</p>}
                </div>
            )}
            {(q.kind === 'translate' || q.kind === 'type' || q.kind === 'order') && (q.fr || q.mg) && (
                <div className="mb-5 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
                    <Bilingual fr={q.fr} mg={q.mg} mode={mgMode} />
                </div>
            )}
            {q.kind === 'quiz' && <p className="mb-5 text-lg font-semibold leading-snug text-white">{q.question}</p>}

            {/* Réponse */}
            {'options' in q && (
                <div className="grid gap-2.5">
                    {q.options.map((o, i) => {
                        const isRight = done && i === q.correct;
                        const isWrongPick = done && i === picked && i !== q.correct;
                        return (
                            <button
                                key={i} type="button" onClick={() => choose(i)} disabled={done}
                                className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left ring-1 transition active:scale-[0.99] ${isRight ? 'bg-emerald-400/20 ring-emerald-300' : isWrongPick ? 'bg-rose-400/15 ring-rose-300/70' : 'bg-white/[0.05] ring-white/10 hover:bg-white/[0.1]'}`}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className={`block ${q.kind === 'translate' ? 'font-chalk text-2xl text-white' : 'text-base font-semibold text-slate-100'}`}>{o.text}</span>
                                    {o.mg && mgMode !== 'off' && <span className="block text-sm italic text-amber-200/90" lang="mg">{o.mg}</span>}
                                </span>
                                {isRight && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />}
                                {isWrongPick && <XCircle className="h-5 w-5 shrink-0 text-rose-300" />}
                            </button>
                        );
                    })}
                </div>
            )}

            {q.kind === 'order' && (
                <div>
                    <div className="mb-3 flex min-h-[3.5rem] flex-wrap gap-2 rounded-2xl border-2 border-dashed border-white/15 p-2.5" aria-live="polite">
                        {order.map((ti, k) => (
                            <button key={k} type="button" disabled={done} onClick={() => setOrder(o => o.filter((_, x) => x !== k))}
                                className={`rounded-xl px-3 py-2 font-chalk text-xl ring-1 ${done ? (verdict === 'wrong' ? 'bg-rose-400/15 text-rose-100 ring-rose-300/50' : 'bg-emerald-400/20 text-white ring-emerald-300/60') : 'bg-white/10 text-white ring-white/20'}`}>
                                {q.tokens[ti]}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {q.tokens.map((tok, ti) => order.includes(ti) ? (
                            <span key={ti} className="rounded-xl px-3 py-2 font-chalk text-xl text-transparent ring-1 ring-white/5">{tok}</span>
                        ) : (
                            <button key={ti} type="button" disabled={done} onClick={() => setOrder(o => [...o, ti])}
                                className="rounded-xl bg-white/[0.07] px-3 py-2 font-chalk text-xl text-white ring-1 ring-white/15 transition hover:bg-white/[0.14] active:scale-95">
                                {tok}
                            </button>
                        ))}
                    </div>
                    {!done && (
                        <div className="mt-4 flex gap-2">
                            <button type="button" onClick={() => setOrder([])} disabled={!order.length} className="flex items-center gap-1.5 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-bold text-slate-200 ring-1 ring-white/10 disabled:opacity-40">
                                <RotateCcw className="h-4 w-4" /> {t('board.test_order_reset')}
                            </button>
                            <button type="button" disabled={order.length !== q.tokens.length}
                                onClick={() => onAnswer(checkOrder(order.map(i => q.tokens[i]), q.answer) ? 'correct' : 'wrong')}
                                className="flex-1 rounded-2xl bg-emerald-400 py-3 font-extrabold text-emerald-950 disabled:opacity-40">
                                {t('board.test_check')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {q.kind === 'type' && (
                <form onSubmit={e => {
                    e.preventDefault();
                    if (done || !typed.trim()) return;
                    const r = checkTyped(typed, q.answer);
                    onAnswer(r === 'exact' ? 'correct' : r);
                    inputRef.current?.blur();
                }} className="flex gap-2">
                    <input
                        ref={inputRef} value={typed} onChange={e => setTyped(e.target.value)} disabled={done} autoFocus
                        autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={60}
                        placeholder={t('board.test_type_placeholder')} lang={language}
                        className="min-w-0 flex-1 rounded-2xl bg-white/[0.06] px-4 py-3 font-chalk text-2xl text-white placeholder:font-sans placeholder:text-base placeholder:text-slate-500 ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                    />
                    {!done && <button type="submit" disabled={!typed.trim()} className="rounded-2xl bg-emerald-400 px-5 font-extrabold text-emerald-950 disabled:opacity-40">{t('board.test_check')}</button>}
                </form>
            )}

            {/* Correction */}
            <AnimatePresence>
                {done && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        className={`mt-5 rounded-2xl p-4 text-sm ring-1 ${verdict === 'wrong' ? 'bg-rose-400/10 text-rose-100 ring-rose-300/30' : 'bg-emerald-400/10 text-emerald-100 ring-emerald-300/30'}`}
                        role="status">
                        <p className="font-bold">
                            {verdict === 'correct' ? t('board.test_correct')
                                : verdict === 'close' ? t('board.test_close', { answer: answerText(q) })
                                    : t('board.test_wrong', { answer: answerText(q) })}
                        </p>
                        {q.kind === 'quiz' && (q.explanation || q.explanationMg) && (
                            <div className="mt-2"><Bilingual fr={q.explanation} mg={q.explanationMg} mode={mgMode} frClassName="text-sm text-slate-200" mgFirstClassName="text-sm text-amber-50" /></div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const MiniTestView: React.FC<Props> = ({ lesson, mgMode, hasNext, onNext, onReviewLesson, onList }) => {
    const { t } = useTranslation();
    const [run, setRun] = useState(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const questions = useMemo(() => buildMiniTest(lesson), [lesson, run]);
    const [index, setIndex] = useState(0);
    const [verdicts, setVerdicts] = useState<Verdict[]>([]);
    const [best, setBest] = useState<number | null>(null);
    const finished = index >= questions.length;
    const correct = verdicts.filter(v => v !== 'wrong').length;
    const score = scorePercent(correct, questions.length);
    const current = questions[index];
    const verdict = verdicts[index] ?? null;

    const answer = (v: Verdict) => setVerdicts(prev => { const n = [...prev]; n[index] = v; return n; });

    const next = () => {
        const nextIndex = index + 1;
        setIndex(nextIndex);
        if (nextIndex >= questions.length) {
            const finalScore = scorePercent(verdicts.filter(v => v !== 'wrong').length, questions.length);
            boardService.saveTestScore(lesson.id, finalScore).then(b => setBest(b)).catch(() => setBest(null));
        }
    };

    const retry = () => { setRun(r => r + 1); setIndex(0); setVerdicts([]); setBest(null); };

    if (finished) {
        const message = score >= 80 ? t('board.test_score_great') : score >= 50 ? t('board.test_score_ok') : t('board.test_score_low');
        return (
            <Slate>
                <div className="p-6 sm:p-10">
                    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-300 text-amber-950">
                        <Trophy className="h-8 w-8" />
                    </motion.div>
                    <p className="text-sm font-bold uppercase tracking-widest text-emerald-200">{t('board.test_score_title')}</p>
                    <p className="mt-1 font-chalk text-6xl text-white">{score} %</p>
                    <p className="mt-1 text-slate-300">{correct} / {questions.length} · {message}</p>
                    {best !== null && best > score && <p className="mt-2 text-sm text-amber-200">{t('board.test_best', { score: best })}</p>}
                    <div className="mt-6 flex gap-1.5" aria-hidden="true">
                        {verdicts.map((v, i) => <span key={i} className={`h-2 flex-1 rounded-full ${v === 'wrong' ? 'bg-rose-400/70' : 'bg-emerald-300'}`} />)}
                    </div>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        {hasNext && score >= 50 && (
                            <button onClick={onNext} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-400 py-3.5 text-base font-extrabold text-emerald-950 active:scale-[0.99]">
                                {t('board.next_lesson')} <ChevronRight className="h-5 w-5" />
                            </button>
                        )}
                        {score < 50 && (
                            <button onClick={onReviewLesson} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-400 py-3.5 text-base font-extrabold text-emerald-950">
                                <RotateCcw className="h-4 w-4" /> {t('board.test_review_lesson')}
                            </button>
                        )}
                        <button onClick={retry} className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-3.5 font-bold text-white ring-1 ring-white/10"><Target className="h-4 w-4" /> {t('board.test_retry')}</button>
                        <button onClick={onList} className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-3.5 font-bold text-white ring-1 ring-white/10"><BookOpen className="h-4 w-4" /> {t('board.back_to_list')}</button>
                    </div>
                </div>
            </Slate>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center gap-3">
                <p className="text-sm font-bold text-emerald-200">{t('board.test_progress', { n: index + 1, total: questions.length })}</p>
                <div className="flex flex-1 gap-1.5" aria-hidden="true">
                    {questions.map((_, i) => (
                        <span key={i} className={`h-2 flex-1 rounded-full ${i < index ? (verdicts[i] === 'wrong' ? 'bg-rose-400/70' : 'bg-emerald-300') : i === index ? 'bg-white/40' : 'bg-white/10'}`} />
                    ))}
                </div>
            </div>
            <Slate className="flex-1">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8">
                    <AnimatePresence mode="wait">
                        <motion.div key={`${run}-${index}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                            <Question q={current} language={lesson.language} mgMode={mgMode} verdict={verdict} onAnswer={answer} />
                        </motion.div>
                    </AnimatePresence>
                </div>
            </Slate>
            <button
                onClick={next} disabled={verdict === null}
                className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-base font-extrabold text-slate-900 transition disabled:opacity-0"
            >
                {index + 1 >= questions.length ? t('board.test_see_result') : t('board.test_next')} <ChevronRight className="h-5 w-5" />
            </button>
        </div>
    );
};

export default MiniTestView;
