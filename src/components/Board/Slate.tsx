import React from 'react';

/** Fond « ardoise » réutilisé par toutes les vues. */
export const Slate: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`board-slate relative flex flex-col overflow-hidden rounded-[1.75rem] bg-[#0f1d18] shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10 ${className}`}>
        <div className="slate-dots pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(rgba(255,255,255,0.9)_0.6px,transparent_0.6px)] [background-size:3px_3px]" />
        <div className="slate-glow pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(52,211,153,0.10),transparent_60%)]" />
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
);
