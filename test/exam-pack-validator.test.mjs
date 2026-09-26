import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateExamPack, validateExamSession } from "../src/exam-pack-validator.mjs";

const sample = JSON.parse(
  await readFile(new URL("../fixtures/sample-exam.json", import.meta.url), "utf8"),
);

function copySample() {
  return structuredClone(sample);
}

function hasError(result, code) {
  return result.errors.some((error) => error.code === code);
}

test("valid sample exam passes", () => {
  assert.deepEqual(validateExamPack(copySample()), { valid: true, errors: [] });
});

test("missing option fails", () => {
  const exam = copySample();
  delete exam.questions[0].choices.E;
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "schema.required"), true);
});

test("invalid answer fails", () => {
  const exam = copySample();
  exam.answerKey.answers["q-01"] = "F";
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "schema.enum"), true);
});

test("duplicate question ID fails", () => {
  const exam = copySample();
  exam.questions[1].id = exam.questions[0].id;
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "duplicate_question_id"), true);
});

test("duplicate question number fails", () => {
  const exam = copySample();
  exam.questions[1].number = exam.questions[0].number;
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "duplicate_question_number"), true);
});

test("missing contentBlock reference fails", () => {
  const exam = copySample();
  exam.questions[0].contentBlockIds = ["missing-passage"];
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "missing_content_block_reference"), true);
});

test("unsupported schemaVersion fails", () => {
  const exam = copySample();
  exam.schemaVersion = 2;
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "schema.const"), true);
});

test("official exam without adequate source metadata fails", () => {
  const exam = copySample();
  exam.kind = "official";
  const result = validateExamPack(exam);
  assert.equal(result.valid, false);
  assert.equal(hasError(result, "schema.required"), true);
});

test("practice exam validates without an ÖSYM source", () => {
  const exam = copySample();
  assert.equal(exam.kind, "practice");
  assert.equal(exam.source.publisher, undefined);
  assert.deepEqual(validateExamPack(exam), { valid: true, errors: [] });
});

test("exam and session data structures remain separate", () => {
  const exam = copySample();
  exam.userAnswers = { "q-01": "A" };
  assert.equal(validateExamPack(exam).valid, false);

  const session = {
    schemaVersion: 1,
    id: "session-01",
    examId: sample.id,
    examPackSchemaVersion: 1,
    state: "NOT_STARTED",
    currentQuestionNumber: 1,
    answers: {},
    flaggedQuestionIds: [],
    startedAt: null,
    completedAt: null,
    expiredAt: null,
    timer: {
      durationSeconds: 1800,
      accumulatedElapsedSeconds: 0,
      runStartedAt: null,
      pausedAt: null
    },
    result: null
  };
  assert.deepEqual(validateExamSession(session), { valid: true, errors: [] });

  session.questions = sample.questions;
  assert.equal(validateExamSession(session).valid, false);
});

test("expected-end timer session is schema-valid and JSON-serializable", () => {
  const session = {
    schemaVersion: 1,
    id: "session-timer-01",
    examId: sample.id,
    examPackSchemaVersion: 1,
    state: "RUNNING",
    currentQuestionId: "q-01",
    answers: {},
    flaggedQuestionIds: [],
    startedAt: 1_000,
    completedAt: null,
    expiredAt: null,
    timer: {
      model: "expected-end-v1",
      durationMs: 10_800_000,
      expectedEndAt: 10_801_000,
      pausedAt: null,
      remainingMsWhenPaused: null,
    },
    result: null,
  };

  const roundTripped = JSON.parse(JSON.stringify(session));
  assert.deepEqual(validateExamSession(roundTripped), { valid: true, errors: [] });
});

test("committed invalid fixture corpus fails validation", async () => {
  const fixtureUrls = [
    new URL("../fixtures/invalid/missing-option.json", import.meta.url),
    new URL("../fixtures/invalid/unsupported-version.json", import.meta.url),
  ];

  for (const fixtureUrl of fixtureUrls) {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
    assert.equal(validateExamPack(fixture).valid, false);
  }
});
