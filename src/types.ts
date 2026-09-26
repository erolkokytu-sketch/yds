export type ChoiceKey = "A" | "B" | "C" | "D" | "E";

export interface ContentBlock {
  id: string;
  type: "passage" | "dialogue" | "paragraph" | "instructions" | "other";
  order: number;
  content: string;
}

export interface ExamQuestion {
  id: string;
  number: number;
  type: string;
  prompt: string;
  contentBlockIds: string[];
  groupId?: string;
  choices: Record<ChoiceKey, string>;
  metadata?: {
    section?: string;
    translationDirection?: "en-to-tr" | "tr-to-en";
  };
}

export interface ExamPack {
  schemaVersion: 1;
  id: string;
  title: string;
  year: number;
  term: string;
  language: string;
  durationMinutes: number;
  kind: "official" | "practice";
  contentBlocks: ContentBlock[];
  questionCount: number;
  questions: ExamQuestion[];
}

export interface ExamSession {
  examId: string;
  currentQuestionIndex: number;
  answers: Record<string, ChoiceKey>;
  flaggedQuestions: string[];
  state: "RUNNING";
  timer: {
    durationSeconds: number;
    phase: "PHASE_4_PLACEHOLDER";
  };
}
