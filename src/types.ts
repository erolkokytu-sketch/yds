export type ChoiceKey = "A" | "B" | "C" | "D" | "E";
export type ExamStatus = "NOT_STARTED" | "RUNNING" | "PAUSED" | "COMPLETED" | "EXPIRED";
export type CompletionReason = "manual" | "expired";

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
  scoring: {
    type: "correct-count" | "scaled-correct-count";
    wrongAnswerPenalty: 0;
    maximumScore: number;
    status: "verified" | "unverified";
  };
  contentBlocks: ContentBlock[];
  questionCount: number;
  questions: ExamQuestion[];
  answerKey: {
    revision: string;
    status: "verified" | "unverified";
    verifiedAt?: string;
    answers: Record<string, ChoiceKey>;
  };
}

export interface ExamResult {
  totalQuestions: number;
  answered: number;
  correct: number;
  incorrect: number;
  blank: number;
  score: number | null;
  completedAt: number;
  completionReason: CompletionReason;
}

export interface ExamSession {
  schemaVersion: 1;
  id: string;
  examId: string;
  examPackSchemaVersion: 1;
  currentQuestionId: string;
  answers: Record<string, ChoiceKey>;
  flaggedQuestionIds: string[];
  state: ExamStatus;
  startedAt: number | null;
  completedAt: number | null;
  completionReason?: CompletionReason | null;
  expiredAt: number | null;
  timer: ExamTimerState;
  result: ExamResult | null;
}

export interface StoredExamSession extends ExamSession {
  storageVersion: 1;
  updatedAt: number;
}

export interface InstalledExamPack {
  id: string;
  schemaVersion: 1;
  title: string;
  installedAt: number;
  fingerprint: string;
  examPack: ExamPack;
}
