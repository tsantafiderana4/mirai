import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Eye, Check, RotateCcw, BookOpen, Sparkles, CalendarClock } from 'lucide-react';
import type { MgMode, ReviewWord } from './types';
import { Bilingual, Chalk, SpeakButton } from './BoardItemView';
import { Slate } from './Slate';
import { boardService } from '../../services/boardService';
import { useTranslation } from '../../contexts/LanguageContext';

interface Props {
    language: string;
    mgMode: MgMode;
    onBack: () => void;
    /** Prévenu après chaque mot révisé (pour mettre à jour le compteur). */
    onReviewed?: () => void;
}

/**
 * « Mes mots » : cartes de révision espacée. L'élève voit le mot, essaie de
 * se rappeler le sens, puis se note honnêtement. Un mot oublié revient à la
 * fin de la séance (une fois) et le lendemain.
 */
const ReviewView: React.FC<Props> = ({ language, mgMode, onBack, onReviewed }) => {
    const { t, language: uiLanguage } = useTranslation();
    const [queue, setQueue] = useState<ReviewWord[] | null>(null);
    const [error, setError] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const [done, setDone] = useState(0);
    const [requeued, setRequeued] = useState<Set<string>>(new Set());
    const [nextDue, setNextDue] = useState<string | null>(null);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        let cancelled = false;
        boardService.dueWords(language, 20)
            .then(words => {
                if (cancelled) return;
                setQueue(words);
                setTotal(words.length);
                if (!words.length) boardService.nextDueAt(language).then(d => !cancelled && setNextDue(d)).catch(() => {});
            })
            .catch(() => !cancelled && setError(true));
        return () => { cancelled = true; };
    }, [language]);

    const current = queue?.[0];

    const grade = (known: boolean) => {
        if (!current || !queue) return;
        boardService.reviewWord(current.id, known).then(() => onReviewed?.()).catch(() => {});
        const rest = queue.slice(1);
        // Mot oublié : il revient une fois en fin de séance
        if (!known && !requeued.has(current.id)) {
            setRequeued(s => new Set(s).add(current.id));
            rest.push(current);
        } else {
            setDone(d => d + 1);
        }
        setRevealed(false);
        setQueue(rest);
        if (!rest.length) boardService.nextDueAt(language).then(setNextDue).catch(() => {});
    };

    const formatDate = (iso: string) => {
        try {
            return new Date(iso).toLocaleDateString(uiLanguage === 'mg' ? ['mg-MG', 'fr-FR'] : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        } catch { return iso.slice(0, 10); }
    };

    if (error) {
        return <p className="py-16 text-center text-slate-300">{t('board.words_error')}</p>;
    }
    if (!queue) {
        return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-emerald-300" /></div>;
    }

    if (!current) {
        return (
            <Slate>
                <div className="p-6 sm:p-10">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950">
                        {done > 0 ? <Sparkles className="h-8 w-8" /> : <CalendarClock className="h-8 w-8" />}
                    </div>
                    <h2 className="font-chalk text-4xl text-white">{done > 0 ? t('board.words_done_title') : t('board.words_none_due')}</h2>
                    {done > 0 && <p className="mt-2 text-slate-300">{t('board.words_done', { n: done })}</p>}
                    {nextDue && <p className="mt-2 text-sm text-emerald-200">{t('board.words_next_due', { date: formatDate(nextDue) })}</p>}
                    <p className="mt-6 rounded-2xl bg-white/[0.05] p-4 text-sm text-slate-300 ring-1 ring-white/10">{t('board.words_how')}</p>
                    <button onClick={onBack} className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 py-3.5 font-extrabold text-emerald-950 sm:w-auto sm:px-8">
                        <BookOpen className="h-4 w-4" /> {t('board.words_back')}
                    </button>
                </div>
            </Slate>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center gap-3">
                <p className="text-sm font-bold text-emerald-200">{t('board.words_progress', { n: Math.min(done + 1, total), total })}</p>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-300 transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </div>
            </div>

            <Slate className="flex-1">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={`${current.id}-${done}-${queue.length}`}
                        initial={{ opacity: 0, rotateY: -12 }} animate={{ opacity: 1, rotateY: 0 }} exit={{ opacity: 0, x: -30 }}
                        transition={{ duration: 0.3 }}
                        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center sm:p-10"
                    >
                        <span className="rounded-full bg-white/10 px-3 py-1 text-[0.7rem] font-bold uppercase tracking-widest text-emerald-200">
                            {'●'.repeat(current.box)}{'○'.repeat(Math.max(0, 5 - current.box))}
                        </span>
                        <div className="flex items-center">
                            <Chalk className="text-5xl leading-tight sm:text-6xl">{current.target}</Chalk>
                            <SpeakButton text={current.target} language={current.language} />
                        </div>
                        {current.phonetic && <p className="font-mono text-sm text-emerald-200/80">/{current.phonetic}/</p>}
                        {revealed ? (
                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 w-full max-w-sm rounded-2xl bg-white/[0.06] p-4 text-left ring-1 ring-white/10">
                                <Bilingual fr={current.fr ?? undefined} mg={current.mg ?? undefined} mode={mgMode} />
                            </motion.div>
                        ) : (
                            <div className="mt-4 h-24 w-full max-w-sm rounded-2xl border-2 border-dashed border-white/10" aria-hidden="true" />
                        )}
                    </motion.div>
                </AnimatePresence>
            </Slate>

            <div className="mt-3">
                {!revealed ? (
                    <button onClick={() => setRevealed(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-4 text-base font-extrabold text-slate-900 active:scale-[0.99]">
                        <Eye className="h-5 w-5" /> {t('board.words_show')}
                    </button>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => grade(false)} className="flex items-center justify-center gap-1.5 rounded-2xl bg-rose-400/15 px-2 py-4 text-[0.95rem] font-extrabold leading-tight text-rose-100 ring-1 ring-rose-300/40 active:scale-[0.99]">
                            <RotateCcw className="h-4 w-4 shrink-0" /> {t('board.words_again')}
                        </button>
                        <button onClick={() => grade(true)} className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-400 px-2 py-4 text-[0.95rem] font-extrabold leading-tight text-emerald-950 active:scale-[0.99]">
                            <Check className="h-4 w-4 shrink-0" /> {t('board.words_knew')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReviewView;
