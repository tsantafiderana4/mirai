import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Flag, Loader2, X } from 'lucide-react';
import { boardService } from '../../services/boardService';
import { useTranslation } from '../../contexts/LanguageContext';

interface Props {
    lessonId: string;
    /** Étape concernée (null : la leçon en général). */
    stepIndex: number | null;
    onClose: () => void;
    notify: (m: string, t?: string) => void;
}

/** « Signaler une erreur » : gratuit, l'admin corrige la leçon pour tout le monde. */
const ReportSheet: React.FC<Props> = ({ lessonId, stepIndex, onClose, notify }) => {
    const { t } = useTranslation();
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    const send = async (e: React.FormEvent) => {
        e.preventDefault();
        if (message.trim().length < 3 || busy) return;
        setBusy(true);
        try {
            await boardService.report(lessonId, stepIndex, message.trim());
            notify(t('board.report_sent'), 'success');
            onClose();
        } catch {
            notify(t('board.report_error'), 'error');
            setBusy(false);
        }
    };

    return (
        <motion.div className="fixed inset-0 z-[330] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
            <motion.form
                role="dialog" aria-modal="true" aria-label={t('board.report_title')} onSubmit={send}
                className="w-full max-w-lg rounded-t-[1.75rem] bg-[#0f1d18] p-5 ring-1 ring-white/10 sm:rounded-[1.75rem]"
                initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={e => e.stopPropagation()}
            >
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-white"><Flag className="h-5 w-5 text-rose-300" /> {t('board.report_title')}</h3>
                    <button type="button" onClick={onClose} disabled={busy} className="rounded-full p-2 text-slate-300 hover:bg-white/10" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
                </div>
                {stepIndex !== null && <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-200/80">{t('board.report_step', { n: stepIndex + 1 })}</p>}
                <textarea
                    value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={500} autoFocus disabled={busy}
                    placeholder={t('board.report_placeholder')}
                    className="w-full resize-none rounded-2xl bg-white/[0.06] px-4 py-3 text-base text-white placeholder:text-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                />
                <p className="mt-2 text-xs text-slate-400">{t('board.report_hint')}</p>
                <button type="submit" disabled={busy || message.trim().length < 3} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 py-3.5 font-extrabold text-emerald-950 disabled:opacity-40">
                    {busy && <Loader2 className="h-5 w-5 animate-spin" />} {t('board.report_send')}
                </button>
            </motion.form>
        </motion.div>
    );
};

export default ReportSheet;
