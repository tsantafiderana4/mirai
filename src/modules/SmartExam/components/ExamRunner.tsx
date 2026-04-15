
import React, { useState, useEffect, useRef } from 'react';
import { SmartExam } from '../types';
import { Clock, ArrowRight, CheckCircle, AlertCircle, Volume2, Loader2, Mic, MicOff } from 'lucide-react';
import { generateSpeech } from '../../../services/geminiService';
import { toast } from '../../../components/Toaster';
import { useTranslation } from '../../../contexts/LanguageContext';

function pcmToAudioBuffer(data: Uint8Array, ctx: AudioContext, sampleRate: number = 24000) {
    const pcm16 = new Int16Array(data.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0; 
    }
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    return buffer;
}

interface Props {
    exam: SmartExam;
    onFinish: (answers: Record<string, string>) => void;
    onCancel: () => void;
}

const ExamRunner: React.FC<Props> = ({ exam, onFinish, onCancel }) => {
    const { t } = useTranslation();
    const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem(`exam_answers_${exam.id}`);
        return saved ? JSON.parse(saved) : {};
    });
    
    // Ref to track latest answers for timer closure
    const answersRef = useRef(answers);
    useEffect(() => {
        answersRef.current = answers;
    }, [answers]);

    const [timeLeft, setTimeLeft] = useState(() => {
        const savedTime = localStorage.getItem(`exam_time_${exam.id}`);
        return savedTime ? parseInt(savedTime, 10) : 15 * 60;
    });
    const [warnings, setWarnings] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
        const savedCounts = localStorage.getItem(`exam_plays_${exam.id}`);
        return savedCounts ? JSON.parse(savedCounts) : {};
    });
    const [isListening, setIsListening] = useState(false);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const [history, setHistory] = useState<string[]>([]);
    const [isRecordingAudio, setIsRecordingAudio] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const recordingTimerRef = useRef<number | null>(null);
    
    // Prevent double submission
    const isSubmittingRef = useRef(false);

    const [hasStarted, setHasStarted] = useState(() => {
        return !!localStorage.getItem(`exam_started_${exam.id}`);
    });

    useEffect(() => {
        return () => {
            if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
                audioCtxRef.current.close().catch(() => {});
            }
        };
    }, []);

    const currentSection = exam.sections[currentSectionIndex];
    const progress = ((currentSectionIndex + 1) / exam.sections.length) * 100;

    const handleStart = () => {
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen().catch(() => {});
        }
        localStorage.setItem(`exam_started_${exam.id}`, 'true');
        setHasStarted(true);
        toast.success(t('exam_runner.start_message'));
    };

    // Speech Recognition Effect
    useEffect(() => {
        if (!hasStarted) return;

        // Anti-cheat: Tab switching detection
        const handleVisibilityChange = () => {
            if (document.hidden && !isSubmittingRef.current) {
                setWarnings(prev => {
                    const newWarnings = prev + 1;
                    if (newWarnings >= 3) {
                        toast.error(t('exam_runner.exam_failed_cheat'));
                        handleSubmit();
                    } else {
                        toast.error(t('exam_runner.tab_switch_warning', { count: newWarnings }));
                    }
                    return newWarnings;
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            
            if (exam.language.toLowerCase().includes('anglais') || exam.language.toLowerCase().includes('english')) {
                recognition.lang = 'en-US';
            } else if (exam.language.toLowerCase().includes('espagnol') || exam.language.toLowerCase().includes('spanish')) {
                recognition.lang = 'es-ES';
            } else {
                recognition.lang = 'fr-FR';
            }

            recognition.onresult = (event: any) => {
                let final = '';
                let interim = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                if (final || interim) {
                    setAnswers(prev => {
                        const currentText = prev[currentSection.id] || '';
                        // If we have final text, append it permanently
                        // If we have interim, we append it for display but it might change
                        // To handle this correctly with React state, we need to be careful not to double-append final text
                        // The safest way with 'continuous' is to rely on the fact that we are appending to the *existing* state
                        // BUT 'resultIndex' tells us what is NEW.
                        
                        // Actually, a better way for a text editor feel is:
                        // 1. Store the 'committed' text in a ref or state that doesn't change during the recognition event loop
                        // 2. Display 'committed' + 'interim'
                        // But here we are using a single textarea.
                        
                        // Let's try a simpler approach: 
                        // When isFinal is true, we update the history and the answer.
                        // When isFinal is false, we just update the answer (preview).
                        
                        // Problem: 'resultIndex' increments.
                        // If we use setAnswers(prev => prev + final), we are fine.
                        
                        if (final) {
                             return {
                                ...prev,
                                [activeQuestionId]: (currentText + ' ' + final).replace(/\s+/g, ' ').trim()
                            };
                        }
                        return prev;
                    });
                }
            };

            recognition.onend = () => {
                setIsListening(false);
            };
            
            recognition.onerror = (event: any) => {
                console.error("Speech recognition error", event.error);
                if (event.error !== 'no-speech') {
                    setIsListening(false);
                    if (event.error === 'not-allowed') {
                        toast.error(t('exam_runner.mic_access_denied'));
                    }
                }
            };
            
            recognitionRef.current = recognition;
        }
        
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [currentSection.id, exam.language, hasStarted]);

    const toggleListening = async (questionId: string) => {
        if (currentSection.type === 'speaking') {
            if (isRecordingAudio) {
                stopAudioRecording();
            } else {
                startAudioRecording(questionId);
            }
            return;
        }

        if (!recognitionRef.current) {
            toast.error(t('exam_runner.dictation_not_supported'));
            return;
        }
        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        } else {
            try {
                // Request microphone permission explicitly first to avoid 'not-allowed' error in some browsers/iframes
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());

                recognitionRef.current.start();
                setIsListening(true);
                // Save current state to history before starting new dictation
                setHistory(prev => [...prev, answers[questionId] || '']);
            } catch (e: any) {
                console.error("Microphone permission error:", e);
                const isIframe = window.self !== window.top;
                
                if (e.name === 'NotAllowedError' || e.message?.includes('denied')) {
                    const msg = isIframe 
                        ? "L'accès au micro est bloqué par l'aperçu. Cliquez sur le bouton 'Ouvrir dans un nouvel onglet' en haut à droite pour corriger cela."
                        : t('exam_runner.mic_access_denied');
                    toast.error(msg);
                } else {
                    toast.error(t('exam_runner.mic_permission_error'));
                }
            }
        }
    };

    const startAudioRecording = async (questionId: string) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64data = reader.result as string;
                    setAnswers(prev => ({ ...prev, [questionId]: base64data }));
                };
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecordingAudio(true);
            setRecordingTime(0);
            recordingTimerRef.current = window.setInterval(() => {
                setRecordingTime(prev => {
                    if (prev >= 59) {
                        stopAudioRecording();
                        return 60;
                    }
                    return prev + 1;
                });
            }, 1000);
        } catch (err) {
            console.error("Error accessing microphone", err);
            toast.error(t('exam_runner.mic_permission_error'));
        }
    };

    const stopAudioRecording = () => {
        if (mediaRecorderRef.current && isRecordingAudio) {
            mediaRecorderRef.current.stop();
            setIsRecordingAudio(false);
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
            }
        }
    };

    const handleUndo = (questionId: string) => {
        setHistory(prev => {
            if (prev.length === 0) return prev;
            const newHistory = [...prev];
            const lastState = newHistory.pop();
            setAnswers(a => ({ ...a, [questionId]: lastState || '' }));
            return newHistory;
        });
    };

    const handleRetrySpeaking = (questionId: string) => {
        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
        setHistory(prev => [...prev, answers[questionId] || '']);
        setAnswers(prev => ({ ...prev, [questionId]: '' }));
        toast.info(t('exam_runner.confirm_reset') || "Réponse réinitialisée.");
    };

    const handleManualChange = (questionId: string, val: string) => {
        // Only save to history on debounce or significant change? 
        // For now, let's just update state. Undo is mainly for "bulk" actions like dictation.
        setAnswers(prev => ({ ...prev, [questionId]: val }));
    };

    useEffect(() => {
        localStorage.setItem(`exam_answers_${exam.id}`, JSON.stringify(answers));
    }, [answers, exam.id]);

    useEffect(() => {
        localStorage.setItem(`exam_plays_${exam.id}`, JSON.stringify(playCounts));
    }, [playCounts, exam.id]);

    const playAudio = async (text: string) => {
        const currentPlays = playCounts[currentSection.id] || 0;
        if (isPlaying || !text || currentPlays >= 2) return;
        
        setIsPlaying(true);
        setPlayCounts(prev => ({ ...prev, [currentSection.id]: currentPlays + 1 }));
        
        try {
            // Race between Gemini TTS and 30s timeout
            const TIMEOUT_MS = 30000;
            const pcmBuffer = await Promise.race([
                generateSpeech(text),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))
            ]);

            if (pcmBuffer) {
                if (!audioCtxRef.current) {
                    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
                }
                const ctx = audioCtxRef.current;
                if (ctx.state === 'closed') return;
                if (ctx.state === 'suspended') await ctx.resume();

                const audioBuffer = pcmToAudioBuffer(new Uint8Array(pcmBuffer), ctx, 24000);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.onended = () => setIsPlaying(false);
                source.start(0);
            } else {
                throw new Error("TTS Timeout or Failure");
            }
        } catch (e) {
            console.warn("Gemini TTS failed or timed out, falling back to browser TTS", e);
            // Fallback to browser TTS
            const utterance = new SpeechSynthesisUtterance(text);
            
            // Set language based on exam language if possible
            if (exam.language.toLowerCase().includes('anglais') || exam.language.toLowerCase().includes('english')) {
                utterance.lang = 'en-US';
            } else if (exam.language.toLowerCase().includes('espagnol') || exam.language.toLowerCase().includes('spanish')) {
                utterance.lang = 'es-ES';
            } else {
                utterance.lang = 'fr-FR';
            }
            
            utterance.onend = () => setIsPlaying(false);
            utterance.onerror = () => setIsPlaying(false);
            window.speechSynthesis.speak(utterance);
        }
    };

    useEffect(() => {
        if (!hasStarted) return;

        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen().catch(() => {});
        }

        const handleFullscreenChange = () => {
            if (!document.fullscreenElement) {
                setWarnings(w => w + 1);
                toast.error(t('exam_runner.fullscreen_warning'));
            }
        };

        const handleBlur = () => {
            setWarnings(w => w + 1);
            toast.error(t('exam_runner.tab_switch_warning'));
        };

        const handleContextMenu = (e: Event) => {
            e.preventDefault();
            toast.error(t('exam_runner.right_click_warning'));
        };

        window.addEventListener('blur', handleBlur);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('contextmenu', handleContextMenu);

        return () => {
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('contextmenu', handleContextMenu);
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        };
    }, [hasStarted]);

    useEffect(() => {
        if (warnings >= 3) {
            toast.error(t('exam_runner.cheat_cancel'));
            setTimeout(() => onCancel(), 0);
        }
    }, [warnings]);

    useEffect(() => {
        if (!hasStarted) return;

        const timer = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    setTimeout(() => handleSubmit(), 0); // Auto submit
                    return 0;
                }
                localStorage.setItem(`exam_time_${exam.id}`, (prev - 1).toString());
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [hasStarted]);

    const questionsToRender = currentSection.questions && currentSection.questions.length > 0 
        ? currentSection.questions.map((q, i) => ({ ...q, id: q.id || `${currentSection.id}_q${i}` }))
        : [{ id: currentSection.id, question: currentSection.question || '', options: currentSection.options }];

    const activeQuestionId = questionsToRender[0].id;

    const handleAnswer = (questionId: string, val: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: val }));
    };

    const handleNext = () => {
        // Check if all rendered questions have answers
        const allAnswered = questionsToRender.every(q => answers[q.id] && answers[q.id].trim() !== '');
        if (!allAnswered) {
            toast.error(t('exam_runner.answer_required'));
            return;
        }

        if (currentSectionIndex < exam.sections.length - 1) {
            setCurrentSectionIndex(prev => prev + 1);
            setHistory([]);
        } else {
            handleSubmit();
        }
    };

    const handleSubmit = () => {
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        
        localStorage.removeItem(`exam_answers_${exam.id}`);
        localStorage.removeItem(`exam_time_${exam.id}`);
        localStorage.removeItem(`exam_plays_${exam.id}`);
        setTimeout(() => onFinish(answersRef.current), 0);
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleCopyPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        toast.error(t('exam_runner.copy_paste_warning'));
    };

    if (!hasStarted) {
        return (
            <div className="fixed inset-0 z-[100] bg-slate-50 dark:bg-slate-950 overflow-y-auto font-sans">
                <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
                    <div className="max-w-2xl w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 my-auto">
                        <div className="text-center mb-8">
                            <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mb-2">{t('exam_runner.ready_title')}</h1>
                            <p className="text-slate-500 dark:text-slate-400">{t('exam_runner.read_rules')}</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-3 mb-2">
                                    <Clock className="w-5 h-5 text-indigo-500" />
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{t('exam_runner.time_limit_title')}</h3>
                                </div>
                                <p className="text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: t('exam_runner.time_limit_desc') }} />
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-3 mb-2">
                                    <AlertCircle className="w-5 h-5 text-amber-500" />
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{t('exam_runner.anti_cheat_title')}</h3>
                                </div>
                                <p className="text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: t('exam_runner.anti_cheat_desc') }} />
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-3 mb-2">
                                    <Volume2 className="w-5 h-5 text-emerald-500" />
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{t('exam_runner.audio_title')}</h3>
                                </div>
                                <p className="text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: t('exam_runner.audio_desc') }} />
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-3 mb-2">
                                    <Mic className="w-5 h-5 text-rose-500" />
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{t('exam_runner.mic_title')}</h3>
                                </div>
                                <p className="text-sm text-slate-500">{t('exam_runner.mic_instruction')}</p>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <button 
                                onClick={onCancel}
                                className="w-full sm:w-auto sm:flex-1 py-4 px-6 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
                            >
                                {t('exam_runner.cancel')}
                            </button>
                            <button 
                                onClick={handleStart}
                                className="w-full sm:w-auto sm:flex-[2] py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
                            >
                                {t('exam_runner.start_exam')} <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div 
            className="fixed inset-0 z-[90] bg-white dark:bg-slate-950 flex flex-col select-none"
            onCopy={handleCopyPaste}
            onPaste={handleCopyPaste}
            onCut={handleCopyPaste}
        >
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-50">
                {/* Top Progress Bar */}
                <div className="h-1 w-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                </div>

                <div className="px-4 py-3 relative flex items-center justify-between">
                    {/* Left: Question Count */}
                    <div className="z-10">
                        <span className="text-sm font-black text-slate-800 dark:text-white">
                            Q. {currentSectionIndex + 1} <span className="text-slate-400 font-normal">/ {exam.sections.length}</span>
                        </span>
                    </div>

                    {/* Center: Level/Language */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full max-w-[50%]">
                        <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full whitespace-nowrap truncate max-w-full">
                            {exam.targetLevel || t('exam_runner.unknown_level')} • {exam.language || t('exam_runner.unknown_lang')}
                        </span>
                    </div>

                    {/* Right: Controls */}
                    <div className="flex items-center gap-2 z-10">
                        {/* Warnings */}
                        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs font-bold transition-all ${
                            warnings > 0 ? 'bg-amber-100 text-amber-700 animate-pulse' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span className={`${warnings === 0 ? 'hidden sm:inline' : ''}`}>
                                {warnings}/3
                            </span>
                        </div>

                        {/* Timer */}
                        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full font-mono font-bold text-sm transition-colors ${
                            timeLeft <= 300 
                            ? 'bg-red-100 text-red-600 animate-pulse ring-2 ring-red-500/50' 
                            : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                        }`}>
                            <Clock className="w-4 h-4" />
                            {formatTime(timeLeft)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center max-w-3xl mx-auto w-full no-scrollbar">
                <style>{`
                    .no-scrollbar::-webkit-scrollbar {
                        display: none;
                    }
                    .no-scrollbar {
                        -ms-overflow-style: none;
                        scrollbar-width: none;
                    }
                `}</style>
                <div className="w-full animate-slide-up pb-20">
                    <div className="mb-8">
                        <span className="inline-block px-3 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold uppercase mb-4">
                            {currentSection.type === 'qcm' ? t('exam_runner.reading') : 
                             currentSection.type === 'listening' ? t('exam_runner.listening') :
                             currentSection.type === 'writing' ? t('exam_runner.writing') : t('exam_runner.speaking')}
                        </span>

                        {currentSection.type === 'listening' && currentSection.context && (
                            <div className="mb-8 p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800 flex flex-col items-center justify-center text-center relative overflow-hidden shadow-sm">
                                <div className="absolute top-4 right-4 bg-white dark:bg-slate-800 px-2 py-1 rounded-md text-xs font-bold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 shadow-sm">
                                    {t('exam_runner.listens_count', { count: playCounts[currentSection.id] || 0 })}
                                </div>
                                <button 
                                    onClick={() => playAudio(currentSection.context!)}
                                    disabled={isPlaying || (playCounts[currentSection.id] || 0) >= 2}
                                    className="w-20 h-20 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-indigo-700 hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100 disabled:bg-slate-400 mb-4"
                                >
                                    {isPlaying ? <Loader2 className="w-10 h-10 animate-spin" /> : <Volume2 className="w-10 h-10" />}
                                </button>
                                <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                                    {isPlaying ? t('exam_runner.listening_active') : (playCounts[currentSection.id] || 0) >= 2 ? t('exam_runner.listening_limit') : t('exam_runner.click_to_listen')}
                                </p>
                                <p className="text-xs text-slate-500 mt-2" dangerouslySetInnerHTML={{ __html: t('exam_runner.listening_max_note') }} />
                            </div>
                        )}

                        {currentSection.instruction && (
                            <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border-l-4 border-indigo-500 text-slate-700 dark:text-slate-300 text-sm font-medium">
                                {currentSection.instruction}
                            </div>
                        )}

                        {currentSection.type !== 'listening' && currentSection.context && (
                            <div className="mb-6 p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-slate-800 dark:text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                                {currentSection.context}
                            </div>
                        )}
                    </div>

                    <div className="space-y-12 w-full">
                        {questionsToRender.map((q, idx) => (
                            <div key={q.id} className="w-full">
                                <h2 className="text-xl font-black text-slate-900 dark:text-white leading-relaxed mb-6">
                                    {questionsToRender.length > 1 ? `${idx + 1}. ` : ''}{q.question}
                                </h2>

                                {(q.type === 'qcm' || q.type === 'true_false_not_given' || (!q.type && q.options && q.options.length > 0)) ? (
                                    <div className="space-y-3">
                                        {q.options?.map((opt, optIdx) => (
                                            <button
                                                key={optIdx}
                                                onClick={() => handleAnswer(q.id, opt)}
                                                className={`w-full p-5 text-left rounded-xl border-2 transition-all ${
                                                    answers[q.id] === opt
                                                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300 shadow-md'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                                                }`}
                                            >
                                                <span className="font-bold mr-3">{String.fromCharCode(65 + optIdx)}.</span> {opt}
                                            </button>
                                        ))}
                                    </div>
                                ) : q.type === 'fill_in_the_blanks' ? (
                                    <div className="w-full">
                                        <input
                                            type="text"
                                            value={answers[q.id] || ''}
                                            onChange={(e) => handleManualChange(q.id, e.target.value)}
                                            placeholder={t('exam_runner.fill_blank_placeholder')}
                                            className="w-full p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-indigo-500 outline-none text-slate-800 dark:text-white"
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="relative">
                                            {currentSection.type === 'speaking' ? (
                                                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                                                    {answers[q.id] && answers[q.id].startsWith('data:audio') ? (
                                                        <div className="flex flex-col items-center gap-4 w-full">
                                                            <audio src={answers[q.id]} controls className="w-full max-w-md" />
                                                            <button
                                                                onClick={() => setAnswers(prev => ({ ...prev, [q.id]: '' }))}
                                                                className="px-4 py-2 text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                            >
                                                                {t('exam_runner.retake_audio')}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-6">
                                                            <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${isRecordingAudio ? 'bg-red-100 dark:bg-red-900/30 animate-pulse' : 'bg-indigo-100 dark:bg-indigo-900/30'}`}>
                                                                <Mic className={`w-10 h-10 ${isRecordingAudio ? 'text-red-500' : 'text-indigo-500'}`} />
                                                            </div>
                                                            
                                                            {isRecordingAudio && (
                                                                <div className="text-2xl font-mono font-bold text-red-500">
                                                                    00:{recordingTime.toString().padStart(2, '0')} / 01:00
                                                                </div>
                                                            )}

                                                            <button
                                                                onClick={() => toggleListening(q.id)}
                                                                className={`px-8 py-4 rounded-full font-bold text-white shadow-lg transition-all transform hover:scale-105 ${
                                                                    isRecordingAudio 
                                                                    ? 'bg-red-500 hover:bg-red-600 ring-4 ring-red-200 dark:ring-red-900/50' 
                                                                    : 'bg-indigo-600 hover:bg-indigo-700'
                                                                }`}
                                                            >
                                                                {isRecordingAudio ? t('exam_runner.stop_recording') : t('exam_runner.start_recording')}
                                                            </button>
                                                            <p className="text-sm text-slate-500 max-w-xs text-center">
                                                                {t('exam_runner.speaking_instruction')}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <>
                                                    <textarea
                                                        value={answers[q.id] || ''}
                                                        onChange={(e) => handleManualChange(q.id, e.target.value)}
                                                        placeholder={t('exam_runner.writing_placeholder')}
                                                        className="w-full h-64 p-5 pb-16 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-indigo-500 outline-none resize-none text-slate-800 dark:text-white leading-relaxed"
                                                    />
                                                    <button
                                                        onClick={() => toggleListening(q.id)}
                                                        className={`absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg transition-all font-bold text-sm ${
                                                            isListening 
                                                            ? 'bg-red-500 text-white animate-pulse hover:bg-red-600 ring-4 ring-red-200 dark:ring-red-900/50' 
                                                            : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105'
                                                        }`}
                                                        title={isListening ? t('exam_runner.stop_dictation') : t('exam_runner.start_dictation')}
                                                    >
                                                        {isListening ? (
                                                            <>
                                                                <MicOff className="w-4 h-4" />
                                                                <span>{t('exam_runner.stop')}</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Mic className="w-4 h-4" />
                                                                <span>{t('exam_runner.dictate')}</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        {currentSection.type === 'speaking' && (
                                            <p className="text-xs text-slate-500 italic flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3"/> {t('exam_runner.speaking_mode_note')}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-end">
                <button
                    onClick={handleNext}
                    disabled={!questionsToRender.every(q => answers[q.id] && answers[q.id].trim() !== '')}
                    className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg flex items-center gap-2 transition-all"
                >
                    {currentSectionIndex < exam.sections.length - 1 ? t('exam_runner.next') : t('exam_runner.finish')}
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};

export default ExamRunner;
