export type ChoiceKey = "A" | "B" | "C" | "D" | "E";
export type ExamStatus = "NOT_STARTED" | "RUNNING" | "PAUSED" | "COMPLETED" | "EXPIRED";

export interface ExamTimerState {
  model: "expected-end-v1";
  durationMs: number;
  expectedEndAt: number | null;
  pausedAt: number | null;
  remainingMsWhenPaused: number | null;
}

export interface Clock {
  now: () => number;
}

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
  schemaVersion: 1;
  id: string;
  examId: string;
  examPackSchemaVersion: 1;
  currentQuestionIndex: number;
  answers: Record<string, ChoiceKey>;
  flaggedQuestionIds: string[];
  state: ExamStatus;
  startedAt: number | null;
  completedAt: number | null;
  expiredAt: number | null;
  timer: ExamTimerState;
  result: null;
}
