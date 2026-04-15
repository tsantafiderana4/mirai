
export type ExamType = 'diagnostic' | 'certification';
export type QuestionType = 'qcm' | 'true_false_not_given' | 'fill_in_the_blanks' | 'open';

export interface ExamQuestion {
    id: string;
    type?: QuestionType;
    question: string;
    options?: string[]; // For QCM and true_false_not_given
}

export interface ExamSection {
    id: string;
    type: 'qcm' | 'writing' | 'listening' | 'speaking';
    instruction?: string; // Clear instruction in explanation language
    context?: string; // Text to read or listen to
    audioUrl?: string; // For listening
    weight: number; // 1-10
    
    // Legacy support (single question)
    question?: string;
    options?: string[]; // For QCM
    
    // New support (grouped questions)
    questions?: ExamQuestion[];
}

export interface SmartExam {
    id: string;
    type: ExamType;
    targetLevel: string;
    language: string;
    sections: ExamSection[];
    totalQuestions: number;
    createdAt: number;
}

export interface ExamResultDetailed {
    examId: string;
    userId: string;
    userName: string;
    userFullName?: string; // Added for certificate
    language?: string;
    date: number;
    globalScore: number; // 0-100
    skillScores: {
        reading: number;
        writing: number;
        listening: number;
        speaking: number;
    };
    criteriaScores?: {
        grammar: number;
        vocabulary: number;
        comprehension: number;
        fluency: number;
        pronunciation: number;
    };
    criteriaFeedback?: {
        grammar: string;
        vocabulary: string;
        comprehension: string;
        fluency: string;
        pronunciation: string;
    };
    detectedLevel: string;
    passed: boolean;
    certificateId?: string;
    feedback: string;
    confidenceScore: number; // 0-100
}

export interface CertificateMetadata {
    id: string;
    userId: string;
    userName: string;
    userFullName?: string; // Added for certificate
    level: string;
    language: string;
    issueDate: number;
    validationHash: string;
    qrCodeData: string;
    score: number;
    globalScore?: number;
    skillScores?: {
        reading: number;
        writing: number;
        listening: number;
        speaking: number;
    };
}
