// Types de la « Leçon au tableau ».
// Miroir de supabase/functions/gemini-api/boardLesson.ts : garder alignés.

export type BoardItemKind =
  | 'title' | 'explain' | 'vocab' | 'sentence' | 'table' | 'tip' | 'warning' | 'quiz';

export interface BreakdownPart { part: string; fr: string; mg: string }

export interface BoardItem {
  kind: BoardItemKind;
  text?: string;
  mg?: string;
  target?: string;
  phonetic?: string;
  fr?: string;
  example?: string;
  exampleFr?: string;
  exampleMg?: string;
  breakdown?: BreakdownPart[];
  headers?: string[];
  rows?: string[][];
  question?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

export interface BoardStep {
  say: string;
  items: BoardItem[];
}

export interface BoardLesson {
  id: string;
  language: string;
  level: string;
  number: number;
  title: string;
  titleMg: string;
  objective: string;
  objectiveMg: string;
  steps: BoardStep[];
  summary: string[];
  summaryMg: string[];
}

export interface SyllabusLesson {
  number: number;
  title: string;
  titleMg: string;
  objective: string;
  unlocked: boolean;
  completed: boolean;
}

export interface BoardSyllabus {
  language: string;
  level: string;
  price: number;
  lessons: SyllabusLesson[];
}

export interface BoardAnswer {
  say: string;
  items: BoardItem[];
}

/** Voix du professeur : Gemini (qualité), voix du téléphone (économise la data) ou muet. */
export type BoardVoiceMode = 'premium' | 'device' | 'off';

/**
 * Affichage du malagasy : « off » (français seul), « with » (français puis
 * malagasy), « first » (malagasy en grand, français en petit).
 */
export type MgMode = 'off' | 'with' | 'first';

/** Mot de « Mes mots » (révision espacée, boîtes de Leitner 1 à 5). */
export interface ReviewWord {
  id: string;
  language: string;
  target: string;
  phonetic?: string | null;
  fr?: string | null;
  mg?: string | null;
  box: number;
  due_at: string;
}

/** Signalement d'erreur envoyé par un élève (vu par l'admin). */
export interface BoardLessonReport {
  id: string;
  lesson_id: string;
  step_index: number | null;
  message: string;
  status: 'open' | 'resolved';
  created_at: string;
  board_lessons?: { title: string; language: string; level: string; lesson_number: number } | null;
}
