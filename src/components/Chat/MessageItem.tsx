import React, { useRef, useState } from 'react';
import { ChatMessage } from '../../types';
import MarkdownRenderer from '../MarkdownRenderer';
import { Volume2, Loader2, StopCircle, Download, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';
import { CREDIT_COSTS } from '../../services/creditService';
import { useAppStore } from '../../store/useAppStore';

interface Props {
    msg: ChatMessage;
    speakingMessageId: string | null;
    isLoadingAudio: boolean;
    onPlayAudio: (text: string, id: string, cost: number) => void;
    onStopAudio: () => void;
    onExit: () => void;
}

const TEACHER_AVATAR = "https://i.ibb.co/B2XmRwmJ/logo.png";

export const MessageItem: React.FC<Props> = ({ msg, speakingMessageId, isLoadingAudio, onPlayAudio, onStopAudio, onExit }) => {
    const { t, language } = useTranslation();
    const { currentSession, user } = useAppStore();
    const exportRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [exportMode, setExportMode] = useState<'single' | 'full'>('single');
    
    const handleDownloadPDF = async (mode: 'single' | 'full') => {
        setExportMode(mode);
        setShowExportMenu(false);
        
        // Wait a tick for React to render the full/single view in the hidden div
        await new Promise(resolve => setTimeout(resolve, 50));
        
        if (!exportRef.current) return;
        try {
            setIsExporting(true);
            
            // Give time for font rendering inside the hidden perfectly styled container
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const { toJpeg } = await import('html-to-image');
            const dataUrl = await toJpeg(exportRef.current, { 
                cacheBust: true,
                pixelRatio: 1.5,
                quality: 0.85,
                backgroundColor: '#ffffff'
            });

            const { jsPDF } = await import('jspdf');
            
            // Get exact dimensions of the generated image
            const img = new Image();
            img.src = dataUrl;
            await new Promise(resolve => { img.onload = resolve; });
            
            const pdfWidth = 210; // A4 width in mm
            const pdfHeight = (img.height * pdfWidth) / img.width; 
            
            // Generates a perfectly fitted PDF page with robust resolution
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [pdfWidth, pdfHeight]
            });
            
            doc.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');

            // Extract lesson number from text if present, like [Leçon 12] or just default to 1
            const lessonMatch = msg.text.match(/\[Leçon\s+(\d+)\]/i);
            const lessonNum = lessonMatch ? lessonMatch[1] : '1';
            
            // Get target language for the file name
            const targetLang = currentSession?.language || user?.preferences?.targetLanguage || 'fr';
            const cleanLang = targetLang.split(' ')[0].toLowerCase();

            const fileName = mode === 'full' ? `lecon_complet_${cleanLang}_teachermada.pdf` : `lecon${lessonNum}_${cleanLang}_teachermada.pdf`;
            doc.save(fileName);
        } catch (error) {
            console.error("Export error :", error);
        } finally {
            setIsExporting(false);
            setExportMode('single'); // Reset
        }
    };

    return (
        <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up group relative`}>
            
            {/* Hidden Elegant Export Wrapper */}
            {msg.role === 'model' && (
                <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', pointerEvents: 'none', opacity: 0, zIndex: -50 }}>
                    <div ref={exportRef} className="w-[800px] bg-white text-slate-800 p-12 shadow-sm font-sans">
                        <div className="flex items-center gap-5 border-b-2 border-slate-100 pb-8 mb-8">
                            <div className="w-20 h-20 bg-slate-50 border-2 border-slate-100 rounded-2xl flex items-center justify-center p-2">
                                <img src={TEACHER_AVATAR} className="w-full h-full object-contain" alt="Logo" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-black text-indigo-600 tracking-tight leading-none mb-2">TeacherMada</h1>
                                <p className="text-slate-500 font-bold text-lg">{language === 'mg' ? "Lesona" : "Leçon"} - {new Date().toLocaleDateString(language === 'mg' ? 'fr-FR' : 'fr-FR')}</p>
                            </div>
                        </div>
                        <div className="prose prose-slate prose-lg max-w-none prose-headings:text-indigo-900 prose-a:text-indigo-600 prose-strong:text-slate-900">
                            {exportMode === 'full' && currentSession?.messages ? (
                                currentSession.messages
                                    .filter(m => !(m.role === 'model' && (m.text.startsWith('✅') || m.text.startsWith('❌') || m.text.startsWith('🏆'))))
                                    .map(m => (
                                        <div key={m.id} className="mb-6">
                                            <strong className="text-indigo-600 block mb-1">{m.role === 'user' ? (user?.username || 'Vous') : 'TeacherMada'}</strong>
                                            <MarkdownRenderer content={m.text.replace(/\[Leçon\s+\d+\]/g, '')} onPlayAudio={() => {}} />
                                        </div>
                                    ))
                            ) : (
                                <MarkdownRenderer content={msg.text.replace(/\[Leçon\s+\d+\]/g, '')} onPlayAudio={() => {}} />
                            )}
                        </div>
                        <div className="mt-16 pt-8 border-t-2 border-slate-100 flex justify-between items-center text-slate-400 font-bold text-sm uppercase tracking-widest">
                            <span>© TeacherMada</span>
                            <span>{window.location.hostname}</span>
                        </div>
                    </div>
                </div>
            )}

            {msg.role === 'model' && (
                <div 
                    onClick={onExit}
                    title="Retour à l'accueil"
                    className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mr-3 mt-1 shrink-0 overflow-hidden shadow-sm cursor-pointer hover:scale-110 transition-transform"
                >
                    <img src={TEACHER_AVATAR} className="w-full h-full object-cover p-1" alt="Avatar" />
                </div>
            )}
            <div className={`max-w-[90%] md:max-w-[80%] p-5 rounded-2xl text-sm leading-relaxed shadow-sm transition-all duration-200 ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm shadow-indigo-500/20 [&_*]:text-white' : 'bg-white dark:bg-[#131825] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-tl-sm'}`}>
                <MarkdownRenderer content={msg.text.replace(/\[Leçon\s+\d+\]/g, '')} onPlayAudio={(text) => onPlayAudio(text, msg.id + text, CREDIT_COSTS.AUDIO_PRONUNCIATION)} />
                {msg.role === 'model' && (
                    <div className="mt-3 pt-2 flex justify-end gap-2 relative">
                        <div className="relative flex flex-col items-end z-10">
                            <button 
                                onClick={() => setShowExportMenu(!showExportMenu)} 
                                disabled={isExporting}
                                className={`p-2 rounded-full transition-all flex items-center justify-center font-bold text-xs ${isExporting ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                                title="Télécharger"
                            >
                                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            </button>
                            
                            {showExportMenu && (
                                <>
                                    <div className="fixed inset-0" onClick={() => setShowExportMenu(false)}></div>
                                    <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1.5 w-48 z-20 overflow-hidden animate-slide-up origin-bottom text-xs font-bold text-slate-700 dark:text-slate-200">
                                        <button onClick={() => handleDownloadPDF('single')} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between">
                                            <span>Leçon {msg.text.match(/\[Leçon\s+(\d+)\]/i)?.[1] || '1'}</span>
                                        </button>
                                        <button onClick={() => handleDownloadPDF('full')} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between text-indigo-600 dark:text-indigo-400">
                                            <span>Leçon complet (Tout)</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                        
                        <button 
                            onClick={() => speakingMessageId === msg.id ? onStopAudio() : onPlayAudio(msg.text, msg.id, CREDIT_COSTS.AUDIO_MESSAGE)} 
                            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-2 ${speakingMessageId === msg.id ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                            title="Écouter tout le message"
                        >
                            <span className="text-xs font-bold">{t('common.listen')}</span>
                            {isLoadingAudio && speakingMessageId === msg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : speakingMessageId === msg.id ? <StopCircle className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
