import { getRemainingMs } from "./timer";
import type {
  ChoiceKey,
  CompletionReason,
  ExamPack,
  ExamResult,
  ExamSession,
} from "./types";

export type QuestionOutcome = "correct" | "incorrect" | "blank";

export function getQuestionOutcome(
  exam: ExamPack,
  answers: Record<string, ChoiceKey>,
  questionId: string,
): QuestionOutcome {
  const answer = answers[questionId];
  if (!answer) return "blank";
  return answer === exam.answerKey.answers[questionId] ? "correct" : "incorrect";
}

export function calculateExamResult(
  exam: ExamPack,
  session: Pick<ExamSession, "answers">,
  completedAt: number,
  completionReason: CompletionReason,
): ExamResult {
  let correct = 0;
  let incorrect = 0;
  let blank = 0;

  for (const question of exam.questions) {
    const outcome = getQuestionOutcome(exam, session.answers, question.id);
    if (outcome === "correct") correct += 1;
    else if (outcome === "incorrect") incorrect += 1;
    else blank += 1;
  }

  const answered = correct + incorrect;
  const scoringVerified = exam.scoring.status === "verified"
    && exam.answerKey.status === "verified";
  const rawScore = exam.scoring.type === "scaled-correct-count"
    ? correct * exam.scoring.maximumScore / exam.questionCount
    : correct;
  const score = scoringVerified ? Math.round(rawScore * 100) / 100 : null;

  return {
    totalQuestions: exam.questionCount,
    answered,
    correct,
    incorrect,
    blank,
    score,
    completedAt,
    completionReason,
  };
}

export function finalizeExamSession(
  exam: ExamPack,
  session: ExamSession,
  completionReason: CompletionReason,
  completedAt: number,
): ExamSession {
  if (["COMPLETED", "EXPIRED"].includes(session.state) && session.result) return session;
  if (!["RUNNING", "PAUSED", "EXPIRED", "COMPLETED"].includes(session.state)) return session;

  const expired = completionReason === "expired";
  const remainingMs = expired ? 0 : getRemainingMs(session.timer, session.state, completedAt);
  return {
    ...session,
    state: expired ? "EXPIRED" : "COMPLETED",
    completedAt,
    completionReason,
    expiredAt: expired ? (session.expiredAt ?? completedAt) : session.expiredAt,
    timer: {
      ...session.timer,
      expectedEndAt: null,
      pausedAt: null,
      remainingMsWhenPaused: remainingMs,
    },
    result: calculateExamResult(exam, session, completedAt, completionReason),
  };
}
