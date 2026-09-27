import { describe, expect, test } from "vitest";
import { sampleExam } from "../../src/exam";
import {
  canonicalExamPackJson,
  fingerprintExamPack,
  MAX_EXAM_PACK_BYTES,
  prepareExamPackImport,
  safeExamPackFileName,
  serializeExamPack,
} from "../../src/exam-pack-file";
import { ExamPackRepository } from "../../src/exam-pack-repository";
import { validateExamPack } from "../../src/exam-pack-validator.mjs";
import type { ExamPack } from "../../src/types";

let databaseCounter = 0;

function repository() {
  databaseCounter += 1;
  return new ExamPackRepository(`yds-pack-file-${databaseCounter}`);
}

function syntheticPack(overrides: Partial<ExamPack> = {}): ExamPack {
  return structuredClone({
    ...sampleExam,
    id: "imported-synthetic-exam",
    title: "Imported Synthetic Exam",
    ...overrides,
  });
}

function packFile(value: unknown, name = "valid.ydspack") {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}

describe("exam pack import", () => {
  test("legacy and current exam years use the same import validator", async () => {
    const repo = repository();
    for (const year of [2006, 2007, 2008, 2009, 2013, 2026]) {
      const prepared = await prepareExamPackImport(
        packFile(syntheticPack({ year, id: `year-${year}` }), `year-${year}.ydspack`),
        repo,
      );
      expect(prepared.ok, `year ${year}`).toBe(true);
    }
    const rejected = await prepareExamPackImport(
      packFile(syntheticPack({ year: 2005, id: "year-2005" }), "year-2005.ydspack"),
      repo,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.details.join(" ")).toContain("must be >= 2006");
      expect(rejected.error.details.join(" ")).not.toContain("2013");
    }
  });

  test("Import 1 — valid .ydspack previews and installs", async () => {
    const repo = repository();
    const prepared = await prepareExamPackImport(packFile(syntheticPack()), repo);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((await repo.install(prepared.candidate.examPack, prepared.candidate.fingerprint)).status)
      .toBe("installed");
    expect((await repo.listInstalled())[0].examPack).toEqual(syntheticPack());
  });

  test("Import 4 — invalid JSON is rejected", async () => {
    const result = await prepareExamPackImport(
      new File(["{not-json"], "broken.ydspack"),
      repository(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-json" } });
  });

  test("empty and invalid UTF-8 files are rejected without throwing", async () => {
    const repo = repository();
    expect(await prepareExamPackImport(new File([], "empty.ydspack"), repo))
      .toMatchObject({ ok: false, error: { code: "unreadable" } });
    const invalidUtf8 = new File([new Uint8Array([0xc3, 0x28])], "utf8.ydspack");
    expect(await prepareExamPackImport(invalidUtf8, repo))
      .toMatchObject({ ok: false, error: { code: "unreadable" } });
  });

  test("huge file is rejected before parsing", async () => {
    const file = packFile({});
    Object.defineProperty(file, "size", { value: MAX_EXAM_PACK_BYTES + 1 });
    expect(await prepareExamPackImport(file, repository()))
      .toMatchObject({ ok: false, error: { code: "too-large" } });
  });

  test("Import 5 — schema-invalid pack is rejected", async () => {
    const result = await prepareExamPackImport(packFile({ schemaVersion: 1, id: "invalid" }), repository());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-pack" } });
  });

  test("Import 6 — semantically invalid duplicate question ID is rejected", async () => {
    const exam = syntheticPack();
    exam.questions[1].id = exam.questions[0].id;
    const result = await prepareExamPackImport(packFile(exam), repository());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-pack" } });
    if (!result.ok) {
      expect(result.error.validationErrors?.some(({ code }) => code === "duplicate_question_id")).toBe(true);
    }
  });

  test("Import 7 — unsupported schema version is rejected before validation", async () => {
    const result = await prepareExamPackImport(
      packFile({ schemaVersion: 99, id: "future" }),
      repository(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported-version" } });
  });

  test("Import 8 — exact duplicate does not insert another record", async () => {
    const repo = repository();
    const exam = syntheticPack();
    const fingerprint = await fingerprintExamPack(exam);
    await repo.install(exam, fingerprint);
    expect(await prepareExamPackImport(packFile(exam), repo))
      .toMatchObject({ ok: false, error: { code: "duplicate" } });
    expect(await repo.listInstalled()).toHaveLength(1);
  });

  test("Import 9 — same ID with different content is a conflict", async () => {
    const repo = repository();
    const exam = syntheticPack();
    await repo.install(exam, await fingerprintExamPack(exam));
    const conflict = syntheticPack({ title: "Different Content" });
    expect(await prepareExamPackImport(packFile(conflict), repo))
      .toMatchObject({ ok: false, error: { code: "conflict" } });
    expect((await repo.getInstalled(exam.id))?.title).toBe(exam.title);
  });

  test("Import 10 — validation failure leaves storage unchanged", async () => {
    const repo = repository();
    await prepareExamPackImport(packFile({ schemaVersion: 1 }), repo);
    expect(await repo.listInstalled()).toEqual([]);
  });

  test("script-like question text remains inert plain data", async () => {
    const exam = syntheticPack();
    exam.questions[0].prompt = "<script>alert('x')</script>";
    const prepared = await prepareExamPackImport(packFile(exam), repository());
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.candidate.examPack.questions[0].prompt).toBe("<script>alert('x')</script>");
    }
  });
});

describe("exam pack export", () => {
  test("Export 1–2 — exported pack parses and validates", () => {
    const parsed = JSON.parse(serializeExamPack(syntheticPack()));
    expect(validateExamPack(parsed)).toEqual({ valid: true, errors: [] });
  });

  test("Export 3 — export contains no session data", () => {
    const exported = serializeExamPack(syntheticPack());
    for (const field of ["flaggedQuestionIds", "startedAt", "completedAt", "sessionId", "timer"]) {
      expect(exported).not.toContain(`\"${field}\"`);
    }
  });

  test("Export 4 — import/export/re-import round trip preserves semantics", async () => {
    const firstRepo = repository();
    const first = await prepareExamPackImport(packFile(syntheticPack()), firstRepo);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await firstRepo.install(first.candidate.examPack, first.candidate.fingerprint);

    const secondRepo = repository();
    const exportedFile = new File(
      [serializeExamPack(first.candidate.examPack)],
      safeExamPackFileName(first.candidate.examPack),
    );
    const second = await prepareExamPackImport(exportedFile, secondRepo);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.candidate.examPack).toEqual(first.candidate.examPack);
    expect(second.candidate.fingerprint).toBe(first.candidate.fingerprint);
  });

  test("Export 5 — fingerprint ignores object key insertion order", async () => {
    const exam = syntheticPack();
    const reordered = Object.fromEntries(Object.entries(exam).reverse()) as unknown as ExamPack;
    expect(canonicalExamPackJson(reordered)).toBe(canonicalExamPackJson(exam));
    expect(await fingerprintExamPack(reordered)).toBe(await fingerprintExamPack(exam));
  });

  test("export filename is cross-platform safe", () => {
    expect(safeExamPackFileName(syntheticPack({ title: "2026 YDS: İlkbahar / Deneme" })))
      .toBe("2026-yds-ilkbahar-deneme.ydspack");
  });
});
