import { afterEach, describe, expect, test, vi } from "vitest";
import { SessionRepository } from "../../src/session-repository";
import { sampleExam } from "../../src/exam";
import { finalizeExamSession } from "../../src/result";
import { getRemainingMs, pauseTimer, resumeTimer, startTimer, synchronizeTimer } from "../../src/timer";
import type { ExamSession, StoredExamSession } from "../../src/types";

const START = Date.UTC(2026, 0, 1, 12);
const DURATION = 180 * 60_000;
let databaseCounter = 0;

function repository() {
  databaseCounter += 1;
  return new SessionRepository(`yds-study-test-${databaseCounter}`);
}

function runningSession(overrides: Partial<ExamSession> = {}): ExamSession {
  const started = startTimer(DURATION, START);
  return {
    schemaVersion: 1,
    id: "session-1",
    examId: "exam-1",
    examPackSchemaVersion: 1,
    currentQuestionId: "q-01",
    answers: {},
    flaggedQuestionIds: [],
    state: started.status,
    startedAt: START,
    completedAt: null,
    expiredAt: null,
    timer: started.timer,
    result: null,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("IndexedDB session repository", () => {
  test("1 — start snapshot is saved and loaded", async () => {
    const repo = repository();
    const session = runningSession();
    await repo.saveSession(session, START);
    expect(await repo.loadSession(session.id)).toEqual(session);
  });

  test("2 — selected answer survives reload", async () => {
    const repo = repository();
    await repo.saveSession(runningSession({ answers: { "q-01": "A" } }));
    expect((await repo.loadSession("session-1"))?.answers).toEqual({ "q-01": "A" });
  });

  test("3 — changing A to C keeps the last write", async () => {
    const repo = repository();
    const session = runningSession({ answers: { "q-01": "A" } });
    void repo.saveSession(session, START + 1);
    void repo.saveSession({ ...session, answers: { "q-01": "C" } }, START + 2);
    expect((await repo.loadSession(session.id))?.answers["q-01"]).toBe("C");
  });

  test("4 — currentQuestionId is restored", async () => {
    const repo = repository();
    await repo.saveSession(runningSession({ currentQuestionId: "q-08" }));
    expect((await repo.loadSession("session-1"))?.currentQuestionId).toBe("q-08");
  });

  test("5 — flag state is restored", async () => {
    const repo = repository();
    await repo.saveSession(runningSession({ flaggedQuestionIds: ["q-08"] }));
    expect((await repo.loadSession("session-1"))?.flaggedQuestionIds).toEqual(["q-08"]);
  });

  test("6 — running timer reflects ten closed minutes", async () => {
    const repo = repository();
    await repo.saveSession(runningSession());
    const restored = await repo.loadSession("session-1");
    expect(getRemainingMs(restored!.timer, restored!.state, START + 10 * 60_000))
      .toBe(DURATION - 10 * 60_000);
  });

  test("7 — expected end timestamp survives a thirty-minute closure", async () => {
    const repo = repository();
    await repo.saveSession(runningSession());
    const restored = await repo.loadSession("session-1");
    expect(restored?.timer.expectedEndAt).toBe(START + DURATION);
    expect(getRemainingMs(restored!.timer, restored!.state, START + 30 * 60_000))
      .toBe(DURATION - 30 * 60_000);
  });

  test("8 — paused timer remains frozen after three hours", async () => {
    const repo = repository();
    const session = runningSession();
    const paused = pauseTimer(session.timer, session.state, START + 60_000);
    await repo.saveSession({ ...session, state: paused.status, timer: paused.timer });
    const restored = await repo.loadSession("session-1");
    expect(getRemainingMs(restored!.timer, restored!.state, START + 3 * 60 * 60_000))
      .toBe(DURATION - 60_000);
  });

  test("9 — expiration while closed is reconciled and written back", async () => {
    const repo = repository();
    const session = runningSession();
    await repo.saveSession(session);
    const restored = (await repo.loadSession(session.id))!;
    const now = START + DURATION + 1;
    const expired = synchronizeTimer(restored.timer, restored.state, now);
    await repo.saveSession({
      ...restored,
      state: expired.status,
      timer: expired.timer,
      expiredAt: now,
    }, now);
    const writtenBack = await repo.loadSession(session.id);
    expect(writtenBack?.state).toBe("EXPIRED");
    expect(writtenBack?.timer.remainingMsWhenPaused).toBe(0);
  });

  test("10 — two pause/resume cycles preserve timer math", async () => {
    const repo = repository();
    let session = runningSession();
    const firstPause = pauseTimer(session.timer, session.state, START + 60_000);
    session = { ...session, state: firstPause.status, timer: firstPause.timer };
    const firstResume = resumeTimer(session.timer, session.state, START + 11 * 60_000);
    session = { ...session, state: firstResume.status, timer: firstResume.timer };
    const secondPause = pauseTimer(session.timer, session.state, START + 12 * 60_000);
    session = { ...session, state: secondPause.status, timer: secondPause.timer };
    const secondResume = resumeTimer(session.timer, session.state, START + 42 * 60_000);
    session = { ...session, state: secondResume.status, timer: secondResume.timer };
    await repo.saveSession(session);
    const restored = await repo.loadSession(session.id);
    expect(getRemainingMs(restored!.timer, restored!.state, START + 43 * 60_000))
      .toBe(DURATION - 3 * 60_000);
  });

  test("11 — corrupt record is ignored and logged", async () => {
    const repo = repository();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await repo.putRawForTests({
      ...runningSession(),
      answers: { "q-01": "Z" },
      storageVersion: 1,
      updatedAt: START,
    } as unknown as StoredExamSession);
    expect(await repo.loadSession("session-1")).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ignored invalid session"));
  });

  test("12 — unsupported storage version is ignored and logged", async () => {
    const repo = repository();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await repo.putRawForTests({
      ...runningSession(),
      storageVersion: 99,
      updatedAt: START,
    } as unknown as StoredExamSession);
    expect(await repo.loadSession("session-1")).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("unsupported storage version"));
  });

  test("13 — multiple exams keep separate active sessions", async () => {
    const repo = repository();
    const first = runningSession();
    const second = runningSession({ id: "session-2", examId: "exam-2", currentQuestionId: "q-04" });
    await repo.saveSession(first, START);
    await repo.saveSession(second, START + 1);
    expect((await repo.findActiveSessionForExam("exam-1"))?.id).toBe("session-1");
    expect((await repo.findActiveSessionForExam("exam-2"))?.id).toBe("session-2");
    expect(await repo.listActiveSessions()).toHaveLength(2);
  });

  test("14 — rapid answer, navigation, flag and pause writes keep final state", async () => {
    const repo = repository();
    const initial = runningSession();
    const answered = { ...initial, answers: { "q-01": "B" as const } };
    const navigated = { ...answered, currentQuestionId: "q-02" };
    const flagged = { ...navigated, flaggedQuestionIds: ["q-02"] };
    const pausedTimer = pauseTimer(flagged.timer, flagged.state, START + 5_000);
    const paused = { ...flagged, state: pausedTimer.status, timer: pausedTimer.timer };
    void repo.saveSession(answered, START + 1);
    void repo.saveSession(navigated, START + 2);
    void repo.saveSession(flagged, START + 3);
    void repo.saveSession(paused, START + 4);
    expect(await repo.loadSession(initial.id)).toEqual(paused);
  });

  test("Storage 1 — completed attempt survives reload", async () => {
    const repo = repository();
    const completed = finalizeExamSession(sampleExam, runningSession({ examId: sampleExam.id }), "manual", START + 10);
    await repo.saveSession(completed, START + 10);
    expect(await repo.loadSession(completed.id)).toEqual(completed);
  });

  test("Storage 2 — completed attempt is not an active session", async () => {
    const repo = repository();
    const completed = finalizeExamSession(sampleExam, runningSession({ examId: sampleExam.id }), "manual", START + 10);
    await repo.saveSession(completed, START + 10);
    expect(await repo.findActiveSessionForExam(sampleExam.id)).toBeNull();
    expect((await repo.findLatestCompletedAttemptForExam(sampleExam.id))?.id).toBe(completed.id);
  });

  test("Storage 3 — a new attempt does not delete the old result", async () => {
    const repo = repository();
    const completed = finalizeExamSession(sampleExam, runningSession({ examId: sampleExam.id }), "manual", START + 10);
    const retake = runningSession({ id: "session-retake", examId: sampleExam.id });
    await repo.saveSession(completed, START + 10);
    await repo.saveSession(retake, START + 20);
    expect((await repo.findActiveSessionForExam(sampleExam.id))?.id).toBe(retake.id);
    expect((await repo.findLatestCompletedAttemptForExam(sampleExam.id))?.id).toBe(completed.id);
  });

  test("Storage 4 — two attempts for one exam remain distinguishable", async () => {
    const repo = repository();
    const first = finalizeExamSession(
      sampleExam,
      runningSession({ id: "attempt-1", examId: sampleExam.id, answers: { "q-01": "A" } }),
      "manual",
      START + 10,
    );
    const second = finalizeExamSession(
      sampleExam,
      runningSession({ id: "attempt-2", examId: sampleExam.id, answers: { "q-01": "B" } }),
      "manual",
      START + 20,
    );
    await repo.saveSession(first, START + 10);
    await repo.saveSession(second, START + 20);
    const attempts = await repo.listSessionsForExam(sampleExam.id);
    expect(attempts.map(({ id }) => id)).toEqual(["attempt-2", "attempt-1"]);
    expect(attempts[0].result?.correct).not.toBe(attempts[1].result?.correct);
  });
});
