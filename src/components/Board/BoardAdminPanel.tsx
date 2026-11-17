import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Flag, CheckCircle, Loader2, Save, Sparkles, ArrowLeft, Trash2, Search, BookOpen, RefreshCw } from 'lucide-react';
import type { BoardItem, BoardLesson, BoardLessonReport, BoardStep } from './types';
import { boardService } from '../../services/boardService';

type Notify = (message: string, type: 'success' | 'error' | 'info') => void;
type LessonRow = Awaited<ReturnType<typeof boardService.admin.listLessons>>[number];

const KIND_LABELS: Record<BoardItem['kind'], string> = {
    title: 'Titre', explain: 'Explication', vocab: 'Vocabulaire', sentence: 'Phrase', table: 'Tableau',
    tip: 'Astuce', warning: 'Erreur fréquente', quiz: 'Quiz',
};

const lines = (v?: string[]) => (v ?? []).join('\n');
const fromLines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const cells = (v?: string[]) => (v ?? []).join(' | ');
const fromCells = (s: string) => s.split('|').map(x => x.trim());

const inputCls = 'w-full rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm outline-none ring-1 ring-slate-200 dark:ring-white/10 focus:ring-2 focus:ring-indigo-500';

const Field: React.FC<{ label: string; value?: string; onChange: (v: string) => void; multiline?: boolean; mg?: boolean; hint?: string }> = ({ label, value, onChange, multiline, mg, hint }) => (
    <label className="block">
        <span className={`mb-1 block text-[0.7rem] font-bold uppercase tracking-wider ${mg ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>{label}{hint && <span className="ml-1 normal-case tracking-normal text-slate-400">({hint})</span>}</span>
        {multiline
            ? <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={3} className={inputCls} lang={mg ? 'mg' : undefined} />
            : <input value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputCls} lang={mg ? 'mg' : undefined} />}
    </label>
);

/** Champs modifiables d'un élément du tableau, selon son type. */
const ItemEditor: React.FC<{ item: BoardItem; onChange: (it: BoardItem) => void; onDelete: () => void }> = ({ item, onChange, onDelete }) => {
    const set = (patch: Partial<BoardItem>) => onChange({ ...item, ...patch });
    const k = item.kind;
    return (
        <div className="rounded-2xl border border-slate-200 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-black text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{KIND_LABELS[k]}</span>
                <button onClick={onDelete} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10" title="Supprimer l'élément"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                {(k === 'vocab' || k === 'sentence') && <Field label="Langue étudiée" value={item.target} onChange={v => set({ target: v })} />}
                {k === 'vocab' && <Field label="Prononciation" value={item.phonetic} onChange={v => set({ phonetic: v })} />}
                {(k === 'vocab' || k === 'sentence') && <Field label="Français" value={item.fr} onChange={v => set({ fr: v })} />}
                {(k === 'title' || k === 'explain' || k === 'tip' || k === 'warning' || k === 'table') && <Field label={k === 'table' ? 'Titre du tableau (fr)' : 'Texte (fr)'} value={item.text} onChange={v => set({ text: v })} multiline={k !== 'title' && k !== 'table'} />}
                {k === 'quiz' && <Field label="Question (fr)" value={item.question} onChange={v => set({ question: v })} multiline />}
                <Field label="Malagasy" mg value={item.mg} onChange={v => set({ mg: v })} multiline={k !== 'title'} />
                {k === 'vocab' && <>
                    <Field label="Exemple (langue étudiée)" value={item.example} onChange={v => set({ example: v })} />
                    <Field label="Exemple (fr)" value={item.exampleFr} onChange={v => set({ exampleFr: v })} />
                    <Field label="Exemple (malagasy)" mg value={item.exampleMg} onChange={v => set({ exampleMg: v })} />
                </>}
                {k === 'sentence' && (
                    <div className="sm:col-span-2">
                        <Field label="Mot à mot" hint="une ligne par mot : mot | français | malagasy" multiline
                            value={(item.breakdown ?? []).map(b => `${b.part} | ${b.fr} | ${b.mg}`).join('\n')}
                            onChange={v => set({ breakdown: fromLines(v).map(l => { const [part = '', fr = '', mg = ''] = fromCells(l); return { part, fr, mg }; }) })} />
                    </div>
                )}
                {k === 'table' && <>
                    <Field label="En-têtes" hint="séparés par |" value={cells(item.headers)} onChange={v => set({ headers: fromCells(v) })} />
                    <div className="sm:col-span-2">
                        <Field label="Lignes" hint="une ligne par rangée, cellules séparées par |" multiline
                            value={(item.rows ?? []).map(cells).join('\n')} onChange={v => set({ rows: fromLines(v).map(fromCells) })} />
                    </div>
                </>}
                {k === 'quiz' && <>
                    <Field label="Choix" hint="un par ligne" multiline value={lines(item.options)} onChange={v => set({ options: fromLines(v) })} />
                    <Field label="Bonne réponse" hint="copie exacte d'un choix" value={item.answer} onChange={v => set({ answer: v })} />
                    <div className="sm:col-span-2"><Field label="Explication (fr)" value={item.explanation} onChange={v => set({ explanation: v })} multiline /></div>
                </>}
            </div>
        </div>
    );
};

/** Éditeur complet d'une leçon. */
const LessonEditor: React.FC<{ lessonId: string; focusStep: number | null; notify: Notify; onBack: () => void }> = ({ lessonId, focusStep, notify, onBack }) => {
    const [draft, setDraft] = useState<BoardLesson | null>(null);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState<'save' | 'regen' | null>(null);

    useEffect(() => {
        let cancelled = false;
        boardService.admin.loadLesson(lessonId)
            .then(l => { if (!cancelled) setDraft(l); })
            .catch(e => notify(`Leçon introuvable : ${(e as Error).message}`, 'error'));
        return () => { cancelled = true; };
    }, [lessonId, notify]);

    useEffect(() => {
        if (draft && focusStep !== null) document.getElementById(`board-step-${focusStep}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [draft, focusStep]);

    if (!draft) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>;

    const patch = (p: Partial<BoardLesson>) => { setDraft({ ...draft, ...p }); setDirty(true); };
    const patchStep = (i: number, s: BoardStep | null) => {
        const steps = [...draft.steps];
        if (s) steps[i] = s; else steps.splice(i, 1);
        patch({ steps });
    };

    const save = async () => {
        setBusy('save');
        try {
            const res = await boardService.admin.save(draft);
            setDraft(res.lesson);
            setDirty(false);
            notify(`Leçon enregistrée pour tous les élèves${res.removedAudio ? ` · ${res.removedAudio} voix à refaire` : ''}.`, 'success');
        } catch (e) {
            notify((e as Error).message || 'Enregistrement impossible.', 'error');
        } finally { setBusy(null); }
    };

    const regenerate = async () => {
        if (!window.confirm("Réécrire toute la leçon avec Gemini ? Le contenu actuel et ses voix seront remplacés (quota Gemini, aucun crédit).")) return;
        setBusy('regen');
        try {
            const res = await boardService.admin.regenerate(draft.id);
            setDraft(res.lesson);
            setDirty(false);
            notify('Leçon régénérée.', 'success');
        } catch (e) {
            notify((e as Error).message || 'Régénération impossible.', 'error');
        } finally { setBusy(null); }
    };

    return (
        <div className="space-y-4">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-3xl border border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-white/5 dark:bg-slate-900/95">
                <button onClick={() => { if (!dirty || window.confirm('Quitter sans enregistrer ?')) onBack(); }} className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold dark:bg-slate-800"><ArrowLeft className="h-4 w-4" /> Retour</button>
                <div className="min-w-0 flex-1 px-1">
                    <p className="truncate text-xs font-bold uppercase tracking-widest text-slate-400">{draft.language} · {draft.level} · Leçon {draft.number}</p>
                    <p className="truncate font-black">{draft.title}</p>
                </div>
                <button onClick={regenerate} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800 disabled:opacity-50 dark:bg-amber-500/15 dark:text-amber-300">
                    {busy === 'regen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Régénérer
                </button>
                <button onClick={save} disabled={!dirty || !!busy} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                    {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
                </button>
            </div>

            <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/5 dark:bg-slate-900 sm:grid-cols-2">
                <Field label="Titre (fr)" value={draft.title} onChange={v => patch({ title: v })} />
                <Field label="Titre (malagasy)" mg value={draft.titleMg} onChange={v => patch({ titleMg: v })} />
                <Field label="Objectif (fr)" value={draft.objective} onChange={v => patch({ objective: v })} multiline />
                <Field label="Objectif (malagasy)" mg value={draft.objectiveMg} onChange={v => patch({ objectiveMg: v })} multiline />
                <Field label="À retenir (fr)" hint="un point par ligne" value={lines(draft.summary)} onChange={v => patch({ summary: fromLines(v) })} multiline />
                <Field label="À retenir (malagasy)" hint="mêmes points, même ordre" mg value={lines(draft.summaryMg)} onChange={v => patch({ summaryMg: fromLines(v) })} multiline />
            </div>

            {draft.steps.map((step, i) => (
                <div key={i} id={`board-step-${i}`} className={`space-y-3 rounded-3xl border bg-white p-4 dark:bg-slate-900 ${focusStep === i ? 'border-rose-400 ring-2 ring-rose-400/30' : 'border-slate-200 dark:border-white/5'}`}>
                    <div className="flex items-center justify-between">
                        <p className="font-black">Étape {i + 1}{focusStep === i && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">signalée</span>}</p>
                        <button onClick={() => window.confirm(`Supprimer l'étape ${i + 1} ?`) && patchStep(i, null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10" title="Supprimer l'étape"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <Field label="Ce que dit le professeur (fr)" hint="modifier ce texte refait la voix de l'étape" value={step.say} onChange={v => patchStep(i, { ...step, say: v })} multiline />
                    {step.items.map((it, j) => (
                        <ItemEditor key={j} item={it}
                            onChange={nv => patchStep(i, { ...step, items: step.items.map((x, y) => (y === j ? nv : x)) })}
                            onDelete={() => patchStep(i, { ...step, items: step.items.filter((_, y) => y !== j) })} />
                    ))}
                </div>
            ))}
        </div>
    );
};

/** Onglet « Leçons » de la console admin : signalements, liste, correction. */
const BoardAdminPanel: React.FC<{ notify: Notify }> = ({ notify }) => {
    const [reports, setReports] = useState<BoardLessonReport[] | null>(null);
    const [lessons, setLessons] = useState<LessonRow[] | null>(null);
    const [editing, setEditing] = useState<{ id: string; step: number | null } | null>(null);
    const [query, setQuery] = useState('');

    const load = useCallback(() => {
        boardService.admin.listReports('open').then(setReports).catch(() => setReports([]));
        boardService.admin.listLessons().then(setLessons).catch(e => { setLessons([]); notify(`Leçons indisponibles : ${(e as Error).message}`, 'error'); });
    }, [notify]);
    useEffect(() => { load(); }, [load]);

    const reportCount = useMemo(() => {
        const m = new Map<string, number>();
        for (const r of reports ?? []) m.set(r.lesson_id, (m.get(r.lesson_id) ?? 0) + 1);
        return m;
    }, [reports]);

    const filtered = (lessons ?? []).filter(l => `${l.language} ${l.level} ${l.lesson_number} ${l.title}`.toLowerCase().includes(query.toLowerCase()));

    const resolve = async (id: string) => {
        try {
            await boardService.admin.resolveReport(id);
            setReports(rs => (rs ?? []).filter(r => r.id !== id));
        } catch (e) { notify((e as Error).message, 'error'); }
    };

    if (editing) {
        return <LessonEditor lessonId={editing.id} focusStep={editing.step} notify={notify} onBack={() => { setEditing(null); load(); }} />;
    }

    return (
        <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-white/5 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-black"><Flag className="h-5 w-5 text-rose-500" /> Signalements des élèves</h2>
                    <button onClick={load} className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800" title="Actualiser"><RefreshCw className="h-4 w-4 text-indigo-500" /></button>
                </div>
                {!reports ? <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                    : reports.length === 0 ? <p className="text-sm text-slate-500">Aucun signalement en attente.</p>
                        : (
                            <ul className="space-y-2">
                                {reports.map(r => (
                                    <li key={r.id} className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60 sm:flex-row sm:items-center">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                                {r.board_lessons ? `${r.board_lessons.language} · ${r.board_lessons.level} · Leçon ${r.board_lessons.lesson_number}` : 'Leçon'}
                                                {r.step_index !== null && ` · Étape ${r.step_index + 1}`} · {new Date(r.created_at).toLocaleDateString('fr-FR')}
                                            </p>
                                            <p className="truncate text-sm font-bold">{r.board_lessons?.title}</p>
                                            <p className="text-sm text-slate-600 dark:text-slate-300">« {r.message} »</p>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <button onClick={() => setEditing({ id: r.lesson_id, step: r.step_index })} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white">Corriger</button>
                                            <button onClick={() => resolve(r.id)} className="flex items-center gap-1 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle className="h-4 w-4" /> Résolu</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-white/5 dark:bg-slate-900">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-black"><BookOpen className="h-5 w-5 text-indigo-500" /> Leçons au tableau générées</h2>
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer : Anglais A1, verbe…" className={`${inputCls} pl-9`} />
                </div>
                {!lessons ? <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                    : filtered.length === 0 ? <p className="text-sm text-slate-500">Aucune leçon.</p>
                        : (
                            <ul className="divide-y divide-slate-100 dark:divide-white/5">
                                {filtered.map(l => (
                                    <li key={l.id}>
                                        <button onClick={() => setEditing({ id: l.id, step: null })} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <span className="w-24 shrink-0 text-xs font-bold uppercase text-slate-400">{l.language} {l.level}</span>
                                            <span className="w-8 shrink-0 text-center font-black text-indigo-500">{l.lesson_number}</span>
                                            <span className="min-w-0 flex-1 truncate font-semibold">{l.title}</span>
                                            {reportCount.get(l.id) ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">{reportCount.get(l.id)} signalement(s)</span> : null}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
            </section>
        </div>
    );
};

export default BoardAdminPanel;
