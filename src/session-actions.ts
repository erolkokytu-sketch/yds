import type { ChoiceKey, ExamSession } from "./types";

export function answerSession(
  session: ExamSession,
  questionId: string,
  answer: ChoiceKey,
): ExamSession {
  if (session.state !== "RUNNING") return session;
  return { ...session, answers: { ...session.answers, [questionId]: answer } };
}

export function navigateSession(session: ExamSession, questionId: string): ExamSession {
  if (session.state !== "RUNNING") return session;
  return { ...session, currentQuestionId: questionId };
}

export function toggleFlagSession(session: ExamSession, questionId: string): ExamSession {
  if (session.state !== "RUNNING") return session;
  const flagged = session.flaggedQuestionIds.includes(questionId);
  return {
    ...session,
    flaggedQuestionIds: flagged
      ? session.flaggedQuestionIds.filter((id) => id !== questionId)
      : [...session.flaggedQuestionIds, questionId],
  };
}
