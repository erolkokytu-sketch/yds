import { describe, expect, test } from "vitest";
import { sampleExam } from "../../src/exam";
import { calculateExamResult, finalizeExamSession } from "../../src/result";
import { answerSession, navigateSession, toggleFlagSession } from "../../src/session-actions";
import { resumeTimer, startTimer } from "../../src/timer";
import type { ChoiceKey, ExamSession } from "../../src/types";

const NOW = Date.UTC(2026, 0, 1, 12);
const KEYS: ChoiceKey[] = ["A", "B", "C", "D", "E"];

function wrongAnswer(correct: ChoiceKey) {
  return KEYS.find((key) => key !== correct)!;
}

function answers(correct: number, incorrect: number) {
  return Object.fromEntries(sampleExam.questions.slice(0, correct + incorrect).map((question, index) => [
    question.id,
    index < correct
      ? sampleExam.answerKey.answers[question.id]
      : wrongAnswer(sampleExam.answerKey.answers[question.id]),
  ]));
}

function runningSession(sessionAnswers: ExamSession["answers"] = {}): ExamSession {
  const started = startTimer(sampleExam.durationMinutes * 60_000, NOW);
  return {
    schemaVersion: 1,
    id: "result-session",
    examId: sampleExam.id,
    examPackSchemaVersion: 1,
    currentQuestionId: sampleExam.questions[0].id,
    answers: sessionAnswers,
    flaggedQuestionIds: [],
    state: "RUNNING",
    startedAt: NOW,
    completedAt: null,
    completionReason: null,
    expiredAt: null,
    timer: started.timer,
    result: null,
  };
}

describe("result engine", () => {
  test("Result 1 — 8 correct, 2 incorrect and 2 blank", () => {
    const result = calculateExamResult(sampleExam, runningSession(answers(8, 2)), NOW, "manual");
    expect(result).toMatchObject({
      totalQuestions: 12,
      answered: 10,
      correct: 8,
      incorrect: 2,
      blank: 2,
    });
    expect(result.score).toBe(66.67);
  });

  test("Result 2 — all correct", () => {
    expect(calculateExamResult(sampleExam, runningSession(answers(12, 0)), NOW, "manual"))
      .toMatchObject({ correct: 12, incorrect: 0, blank: 0, answered: 12, score: 100 });
  });

  test("Result 3 — all blank", () => {
    expect(calculateExamResult(sampleExam, runningSession(), NOW, "manual"))
      .toMatchObject({ correct: 0, incorrect: 0, blank: 12, answered: 0 });
  });

  test("Result 4 — all wrong", () => {
    expect(calculateExamResult(sampleExam, runningSession(answers(0, 12)), NOW, "manual"))
      .toMatchObject({ correct: 0, incorrect: 12, blank: 0, answered: 12 });
  });

  test("Result 5 — flags do not affect scoring", () => {
    const session = runningSession(answers(3, 2));
    const plain = calculateExamResult(sampleExam, session, NOW, "manual");
    const flaggedSession = {
      ...session,
      flaggedQuestionIds: sampleExam.questions.map(({ id }) => id),
    };
    const flagged = calculateExamResult(sampleExam, flaggedSession, NOW, "manual");
    expect(flagged).toEqual(plain);
  });

  test("Result 6 — count invariants always hold", () => {
    for (const [correct, incorrect] of [[0, 0], [1, 3], [6, 6], [12, 0]]) {
      const result = calculateExamResult(sampleExam, runningSession(answers(correct, incorrect)), NOW, "manual");
      expect(result.correct + result.incorrect + result.blank).toBe(result.totalQuestions);
      expect(result.answered).toBe(result.correct + result.incorrect);
    }
  });

  test("unverified scoring never exposes a numeric score", () => {
    const unverified = {
      ...sampleExam,
      scoring: { ...sampleExam.scoring, status: "unverified" as const },
    };
    expect(calculateExamResult(unverified, runningSession(answers(12, 0)), NOW, "manual").score)
      .toBeNull();
  });
});

describe("completion engine", () => {
  test("Completion 1 — manual finish creates a terminal result", () => {
    const completed = finalizeExamSession(sampleExam, runningSession(answers(2, 1)), "manual", NOW + 1_000);
    expect(completed).toMatchObject({
      state: "COMPLETED",
      completedAt: NOW + 1_000,
      completionReason: "manual",
    });
    expect(completed.result).not.toBeNull();
    expect(completed.timer.expectedEndAt).toBeNull();
  });

  test("Completion 2 — expiration creates an EXPIRED result", () => {
    const expired = finalizeExamSession(sampleExam, runningSession(), "expired", NOW + 180 * 60_000);
    expect(expired).toMatchObject({
      state: "EXPIRED",
      completedAt: NOW + 180 * 60_000,
      completionReason: "expired",
      expiredAt: NOW + 180 * 60_000,
    });
    expect(expired.result?.blank).toBe(12);
  });

  test("Completion 3 — terminal result generation is idempotent", () => {
    const expired = finalizeExamSession(sampleExam, runningSession(), "expired", NOW + 1);
    expect(finalizeExamSession(sampleExam, expired, "expired", NOW + 2)).toBe(expired);
  });

  test("Completion 4 — completed session cannot resume", () => {
    const completed = finalizeExamSession(sampleExam, runningSession(), "manual", NOW + 1);
    expect(resumeTimer(completed.timer, completed.state, NOW + 2)).toEqual({
      status: "COMPLETED",
      timer: completed.timer,
    });
  });

  test("Completion 5 — re-finalizing cannot change completed answers", () => {
    const completed = finalizeExamSession(sampleExam, runningSession({ "q-01": "A" }), "manual", NOW + 1);
    expect(answerSession(completed, "q-01", "C")).toBe(completed);
    expect(navigateSession(completed, "q-02")).toBe(completed);
    expect(toggleFlagSession(completed, "q-01")).toBe(completed);
  });
});
