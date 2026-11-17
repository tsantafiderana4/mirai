import React from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';
import type { BoardTheme, DisplayPrefs, TextSize } from './displayPrefs';


const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="flex w-full items-center justify-between gap-4 rounded-2xl bg-white/[0.05] px-4 py-3.5 text-left ring-1 ring-white/10">
        <span className="text-[0.95rem] font-semibold text-slate-100">{label}</span>
        <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-emerald-400' : 'bg-white/10'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
        </span>
    </button>
);

export const DisplaySheet: React.FC<{ prefs: DisplayPrefs; onChange: (p: DisplayPrefs) => void; onClose: () => void }> = ({ prefs, onChange, onClose }) => {
    const { t } = useTranslation();
    const set = (patch: Partial<DisplayPrefs>) => onChange({ ...prefs, ...patch });
    const themes: { id: BoardTheme; label: string; swatch: string; ink: string }[] = [
        { id: 'dark', label: t('board.theme_dark'), swatch: 'bg-[#0f1d18]', ink: 'text-white' },
        { id: 'light', label: t('board.theme_light'), swatch: 'bg-[#fdfdfb]', ink: 'text-[#1e3a8a]' },
    ];
    const sizes: { id: TextSize; label: string; cls: string }[] = [
        { id: 'normal', label: t('board.size_normal'), cls: 'text-base' },
        { id: 'large', label: t('board.size_large'), cls: 'text-lg' },
        { id: 'xl', label: t('board.size_xl'), cls: 'text-xl' },
    ];

    return (
        <motion.div className="fixed inset-0 z-[330] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
            <motion.div role="dialog" aria-modal="true" aria-label={t('board.display')}
                className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[1.75rem] bg-[#0f1d18] p-5 ring-1 ring-white/10 sm:rounded-[1.75rem]"
                initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={e => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">{t('board.display')}</h3>
                    <button onClick={onClose} className="rounded-full p-2 text-slate-300 hover:bg-white/10" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
                </div>

                <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">{t('board.theme')}</p>
                <div className="mb-5 grid grid-cols-2 gap-3">
                    {themes.map(th => (
                        <button key={th.id} type="button" onClick={() => set({ theme: th.id })} aria-pressed={prefs.theme === th.id}
                            className={`rounded-2xl p-2 text-left ring-2 transition ${prefs.theme === th.id ? 'ring-emerald-400' : 'ring-white/10'}`}>
                            <span className={`flex h-16 items-center justify-center rounded-xl ring-1 ring-black/10 ${th.swatch}`}>
                                <span className={`font-chalk text-2xl ${th.ink}`}>Hello</span>
                            </span>
                            <span className="mt-2 flex items-center gap-1.5 px-1 text-sm font-semibold text-slate-100">
                                {prefs.theme === th.id && <Check className="h-4 w-4 text-emerald-300" />} {th.label}
                            </span>
                        </button>
                    ))}
                </div>

                <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-200/90">{t('board.text_size')}</p>
                <div className="mb-5 grid grid-cols-3 gap-2">
                    {sizes.map(sz => (
                        <button key={sz.id} type="button" onClick={() => set({ size: sz.id })} aria-pressed={prefs.size === sz.id}
                            className={`flex flex-col items-center gap-0.5 rounded-2xl py-3 ring-2 transition ${prefs.size === sz.id ? 'bg-emerald-400/10 ring-emerald-400' : 'bg-white/[0.04] ring-white/10'}`}>
                            <span className={`font-bold text-white ${sz.cls}`}>Aa</span>
                            <span className="text-xs text-slate-300">{sz.label}</span>
                        </button>
                    ))}
                </div>

                <div className="space-y-2.5">
                    <Toggle label={t('board.subtitles')} checked={prefs.subtitles} onChange={v => set({ subtitles: v })} />
                    <Toggle label={t('board.reduce_motion')} checked={prefs.reduceMotion} onChange={v => set({ reduceMotion: v })} />
                </div>
            </motion.div>
        </motion.div>
    );
};
