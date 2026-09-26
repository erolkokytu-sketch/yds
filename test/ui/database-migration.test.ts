import { openDB } from "idb";
import { describe, expect, test } from "vitest";
import { sampleExam } from "../../src/exam";
import { fingerprintExamPack } from "../../src/exam-pack-file";
import { ExamPackRepository } from "../../src/exam-pack-repository";
import { finalizeExamSession } from "../../src/result";
import { DB_VERSION, SessionRepository } from "../../src/session-repository";
import { startTimer } from "../../src/timer";
import type { ExamSession, StoredExamSession } from "../../src/types";

const NOW = Date.UTC(2026, 0, 1, 12);
let counter = 0;

function activeSession(): ExamSession {
  const timer = startTimer(sampleExam.durationMinutes * 60_000, NOW);
  return {
    schemaVersion: 1,
    id: `migration-session-${counter}`,
    examId: sampleExam.id,
    examPackSchemaVersion: 1,
    currentQuestionId: sampleExam.questions[0].id,
    answers: { "q-01": "A" },
    flaggedQuestionIds: [],
    state: "RUNNING",
    startedAt: NOW,
    completedAt: null,
    completionReason: null,
    expiredAt: null,
    timer: timer.timer,
    result: null,
  };
}

async function createV1Database(session: ExamSession) {
  counter += 1;
  const name = `yds-migration-${counter}`;
  const database = await openDB(name, 1, {
    upgrade(db) {
      const store = db.createObjectStore("examSessions", { keyPath: "id" });
      store.createIndex("by-exam-id", "examId");
      store.createIndex("by-updated-at", "updatedAt");
    },
  });
  await database.put("examSessions", {
    ...session,
    storageVersion: 1,
    updatedAt: NOW,
  } as StoredExamSession);
  database.close();
  return name;
}

describe("IndexedDB v1 to v2 migration", () => {
  test("Migration 1 — v1 active session survives", async () => {
    const session = activeSession();
    const name = await createV1Database(session);
    expect(DB_VERSION).toBe(2);
    expect(await new SessionRepository(name).loadSession(session.id)).toEqual(session);
  });

  test("Migration 2 — v1 completed result survives", async () => {
    const completed = finalizeExamSession(sampleExam, activeSession(), "manual", NOW + 1);
    const name = await createV1Database(completed);
    const restored = await new SessionRepository(name).loadSession(completed.id);
    expect(restored?.state).toBe("COMPLETED");
    expect(restored?.result).toEqual(completed.result);
  });

  test("Migration 3 — upgrade creates the examPacks store", async () => {
    const name = await createV1Database(activeSession());
    const packs = new ExamPackRepository(name);
    const fingerprint = await fingerprintExamPack(sampleExam);
    expect((await packs.install(sampleExam, fingerprint)).status).toBe("installed");
    expect((await packs.getInstalled(sampleExam.id))?.fingerprint).toBe(fingerprint);
  });
});
