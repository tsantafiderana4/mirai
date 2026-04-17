import React, { useState } from 'react';
import { ExerciseItem, UserProfile } from '../types';
import { Check, X, ArrowRight, Trophy, HelpCircle, Star, Zap, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MarkdownRenderer from './MarkdownRenderer';
import { useLearningSession } from '../hooks/queries/useLearningSession';

interface ExerciseSessionProps {
  user: UserProfile;
  exercises: ExerciseItem[];
  onClose: () => void;
  onComplete: (score: number, total: number) => void;
}

const ExerciseSession: React.FC<ExerciseSessionProps> = ({ user, exercises, onClose, onComplete }) => {
  const { session, updateSession } = useLearningSession(user.id, user.preferences, 'exercise');
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isChecked, setIsChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [showSummary, setShowSummary] = useState(false);

  const currentExercise = exercises[currentIndex];
  
  if (!currentExercise) {
      return <div className="text-center p-4">Chargement...</div>;
  }
  
  const progress = ((currentIndex) / exercises.length) * 100;

  const normalizeText = (text: string) => text.trim().toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");

  const handleCheck = () => {
    let correct = false;
    const answer = currentExercise.type === 'fill_blank' ? inputValue : selectedAnswer;

    if (!answer) return;

    const normUser = normalizeText(String(answer));
    const normCorrect = normalizeText(String(currentExercise.correctAnswer));

    if (currentExercise.type === 'true_false') {
        const trueVariants = ['vrai', 'true', 'yes', 'oui'];
        const falseVariants = ['faux', 'false', 'no', 'non'];

        const userIsTrue = trueVariants.includes(normUser);
        const correctIsTrue = trueVariants.includes(normCorrect);
        
        const userIsFalse = falseVariants.includes(normUser);
        const correctIsFalse = falseVariants.includes(normCorrect);

        if (userIsTrue && correctIsTrue) correct = true;
        else if (userIsFalse && correctIsFalse) correct = true;
        else correct = normUser === normCorrect;
    } else {
        correct = normUser === normCorrect;
    }

    setIsCorrect(correct);
    if (correct) {
        setScore(prev => prev + 1);
        setStreak(prev => prev + 1);
    } else {
        setStreak(0);
    }
    setIsChecked(true);

    if (session) {
        const userMsg = {
            id: Date.now().toString(),
            role: 'user' as const,
            text: `**Question:** ${currentExercise.question}\n**Ma réponse:** ${answer}`,
            timestamp: Date.now()
        };
        const modelMsg = {
            id: (Date.now() + 1).toString(),
            role: 'model' as const,
            text: correct ? '✅ Correct !' : `❌ Incorrect. La bonne réponse était : **${currentExercise.correctAnswer}**`,
            timestamp: Date.now() + 1
        };
        updateSession({
            ...session,
            messages: [...session.messages, userMsg, modelMsg]
        }).catch(console.error);
    }
  };

  const handleNext = () => {
    if (currentIndex < exercises.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setInputValue('');
      setIsChecked(false);
      setIsCorrect(false);
    } else {
      setShowSummary(true);
      if (session) {
          const summaryMsg = {
              id: Date.now().toString(),
              role: 'model' as const,
              text: `🏆 **Session d'exercices terminée !**\nScore final : **${score}/${exercises.length}**\nPrécision : **${Math.round((score / exercises.length) * 100)}%**`,
              timestamp: Date.now()
          };
          updateSession({
              ...session,
              messages: [...session.messages, summaryMsg]
          }).catch(console.error);
      }
    }
  };

  const handleFinish = () => {
    onComplete(score, exercises.length);
  };

  if (showSummary) {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[70] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4"
      >
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl p-8 text-center shadow-2xl border border-white/10 relative overflow-hidden"
        >
          <div className="mb-6 flex justify-center">
             <motion.div 
               initial={{ rotate: -20, scale: 0 }}
               animate={{ rotate: 0, scale: 1 }}
               transition={{ type: 'spring', damping: 12 }}
               className="w-24 h-24 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center border-4 border-yellow-200 dark:border-yellow-700"
             >
               <Trophy className="w-12 h-12 text-yellow-500" />
             </motion.div>
          </div>
          
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">Session Terminée !</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6">Excellent travail, continuez ainsi !</p>
          
          <div className="text-6xl font-black text-indigo-600 dark:text-indigo-400 mb-8">
            {score}/{exercises.length}
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                <div className="text-xs text-slate-400 font-bold uppercase mb-1">XP Gagnée</div>
                <div className="text-2xl font-bold text-emerald-500 flex items-center justify-center gap-1">
                    <Star className="w-5 h-5 fill-emerald-500" />
                    +{score * 10 + 20}
                </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                <div className="text-xs text-slate-400 font-bold uppercase mb-1">Précision</div>
                <div className="text-2xl font-bold text-indigo-500">{Math.round((score / exercises.length) * 100)}%</div>
            </div>
          </div>

          <button 
            onClick={handleFinish}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            Continuer l'apprentissage
            <ArrowRight className="w-5 h-5" />
          </button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-300">
      {/* Header */}
      <div className="h-16 px-4 flex items-center justify-between bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-500" />
        </button>
        <div className="flex-1 max-w-md mx-4">
            <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                    className="h-full bg-indigo-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                ></motion.div>
            </div>
        </div>
        <div className="flex items-center gap-3">
            {streak > 1 && (
                <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center gap-1 bg-orange-100 dark:bg-orange-900/30 px-2 py-1 rounded-full border border-orange-200 dark:border-orange-800"
                >
                    <Zap className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
                    <span className="text-xs font-bold text-orange-600 dark:text-orange-400">{streak}</span>
                </motion.div>
            )}
            <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full border border-indigo-100 dark:border-indigo-800">
                <Trophy className="w-4 h-4" />
                <span className="text-sm">{score}</span>
            </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 pb-40 flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
         <AnimatePresence mode="wait">
             <motion.div 
                key={currentIndex}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full"
             >
                <div className="flex justify-center mb-6">
                    <div className="px-4 py-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5" />
                        {currentExercise.type.replace('_', ' ')}
                    </div>
                </div>

                <h2 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white mb-8 text-center leading-relaxed">
                    {currentExercise.question}
                </h2>

                {/* Interactions based on Type */}
                <div className="space-y-4 w-full">
                    
                    {/* Multiple Choice */}
                    {currentExercise.type === 'multiple_choice' && (
                        <div className="grid grid-cols-1 gap-3">
                            {currentExercise.options?.map((opt, idx) => (
                                <motion.button
                                    key={idx}
                                    whileHover={!isChecked ? { scale: 1.01 } : {}}
                                    whileTap={!isChecked ? { scale: 0.98 } : {}}
                                    onClick={() => !isChecked && setSelectedAnswer(opt)}
                                    disabled={isChecked}
                                    className={`p-4 rounded-xl border-2 text-left text-lg font-medium transition-all ${
                                        isChecked 
                                            ? normalizeText(opt) === normalizeText(currentExercise.correctAnswer) 
                                                ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-500 text-emerald-800 dark:text-emerald-300'
                                                : opt === selectedAnswer 
                                                    ? 'bg-red-100 dark:bg-red-900/30 border-red-500 text-red-800 dark:text-red-300'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-50'
                                            : selectedAnswer === opt
                                                ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500 text-indigo-800 dark:text-indigo-300 shadow-md'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-slate-700 dark:text-slate-200'
                                    }`}
                                >
                                    <span className="inline-block w-8 font-bold opacity-50">{String.fromCharCode(65 + idx)}.</span> {opt}
                                </motion.button>
                            ))}
                        </div>
                    )}

                    {/* True / False */}
                    {currentExercise.type === 'true_false' && (
                        <div className="grid grid-cols-2 gap-4">
                            {['Vrai', 'Faux'].map((opt) => (
                                 <motion.button
                                    key={opt}
                                    whileHover={!isChecked ? { scale: 1.02 } : {}}
                                    whileTap={!isChecked ? { scale: 0.95 } : {}}
                                    onClick={() => !isChecked && setSelectedAnswer(opt)}
                                    disabled={isChecked}
                                    className={`p-8 rounded-2xl border-2 text-center text-xl font-bold transition-all ${
                                        isChecked 
                                            ? (() => {
                                                const normOpt = normalizeText(opt);
                                                const normCorrect = normalizeText(String(currentExercise.correctAnswer));
                                                const trueSet = ['vrai', 'true', 'yes'];
                                                const isOptTrue = trueSet.includes(normOpt);
                                                const isCorrectTrue = trueSet.includes(normCorrect);
                                                const isThisCorrect = (isOptTrue && isCorrectTrue) || (!isOptTrue && !isCorrectTrue);
                                                
                                                if (isThisCorrect) return 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-500 text-emerald-800 dark:text-emerald-300';
                                                if (opt === selectedAnswer) return 'bg-red-100 dark:bg-red-900/30 border-red-500 text-red-800 dark:text-red-300';
                                                return 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-50';
                                            })()
                                            : selectedAnswer === opt
                                                ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500 text-indigo-800 dark:text-indigo-300 shadow-lg'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                 >
                                    {opt}
                                 </motion.button>
                            ))}
                        </div>
                    )}

                    {/* Fill Blank */}
                    {currentExercise.type === 'fill_blank' && (
                        <div className="w-full">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                disabled={isChecked}
                                placeholder="Tapez votre réponse ici..."
                                className={`w-full p-5 text-xl rounded-xl border-2 outline-none transition-all ${
                                    isChecked
                                        ? isCorrect 
                                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                                            : 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:border-indigo-500'
                                }`}
                            />
                             {isChecked && !isCorrect && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mt-2 text-slate-500 text-sm"
                                >
                                    Réponse attendue : <span className="font-bold text-slate-700 dark:text-slate-300">{currentExercise.correctAnswer}</span>
                                </motion.div>
                            )}
                        </div>
                    )}
                </div>
             </motion.div>
         </AnimatePresence>
      </div>

      {/* Footer / Feedback Area */}
      <div className={`fixed bottom-0 w-full p-4 md:p-6 transition-all duration-300 border-t ${
          isChecked 
            ? isCorrect 
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900' 
                : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900'
            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
      }`}>
        <div className="max-w-2xl mx-auto">
            {isChecked ? (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="flex items-start gap-4 mb-4">
                        <div className={`p-2 rounded-full ${isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                            {isCorrect ? <Check className="w-6 h-6" /> : <X className="w-6 h-6" />}
                        </div>
                        <div className="flex-1">
                            <h3 className={`font-bold text-lg ${isCorrect ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                {isCorrect ? 'Excellent !' : 'Pas tout à fait...'}
                            </h3>
                            <div className="mt-2 text-slate-600 dark:text-slate-300 text-sm">
                                 <div className="font-semibold mb-1 flex items-center gap-1 text-indigo-500">
                                    <HelpCircle className="w-3.5 h-3.5" /> Explication :
                                 </div>
                                 <MarkdownRenderer content={currentExercise.explanation} />
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleNext}
                        className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2
                            ${isCorrect ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                    >
                        {currentIndex < exercises.length - 1 ? 'Continuer' : 'Voir le résultat'}
                        <ArrowRight className="w-5 h-5" />
                    </button>
                </motion.div>
            ) : (
                <button 
                    onClick={handleCheck}
                    disabled={(!selectedAnswer && !inputValue)}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
                >
                    Vérifier
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default ExerciseSession;