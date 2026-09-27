#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { validateExamPack } from "../src/exam-pack-validator.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function safeName(value) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ı/g, "i");
  return `${normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "exam"}.ydspack`;
}

function usage() {
  console.log("Usage: npm run finalize:exam -- <prepared-exam.json> [--output <dir|file>] [--reviewed]");
}

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  usage();
  process.exit(args.includes("--help") ? 0 : 2);
}
const input = resolve(args[0]);
const outputIndex = args.indexOf("--output");
const outputArg = outputIndex >= 0 ? args[outputIndex + 1] : "exam-packs";
const reviewed = args.includes("--reviewed");

try {
  const prepared = JSON.parse(await readFile(input, "utf8"));
  const pack = structuredClone(prepared.examPack);
  if (!pack || !prepared._preparation) throw new Error("not a prepared-exam document");
  if (prepared._preparation.errors?.length) {
    throw new Error(`critical extraction errors remain: ${prepared._preparation.errors.join(", ")}`);
  }
  const expectedQuestions = prepared._preparation.expectedQuestions;
  if (Number.isInteger(expectedQuestions) && pack.questions?.length !== expectedQuestions) {
    throw new Error(`question count incomplete: ${pack.questions?.length ?? 0}/${expectedQuestions}`);
  }
  const unknown = Object.entries(pack.answerKey?.answers ?? {}).filter(([, answer]) => !["A", "B", "C", "D", "E"].includes(answer));
  if (unknown.length) throw new Error(`answers incomplete: ${unknown.map(([id]) => id).join(", ")}`);
  const incomplete = (pack.questions ?? []).filter((question) => !question.prompt || ["A", "B", "C", "D", "E"].some((key) => !question.choices?.[key]));
  if (incomplete.length) throw new Error(`questions incomplete: ${incomplete.map(({ id }) => id).join(", ")}`);
  if (prepared._preparation.warnings?.length && !reviewed && !prepared._preparation.reviewApproved) {
    throw new Error("review warnings remain; inspect review.html, then pass --reviewed or set reviewApproved=true");
  }
  const validation = validateExamPack(pack);
  if (!validation.valid) {
    throw new Error(validation.errors.map((error) => `[${error.code}] ${error.path}: ${error.message}`).join("\n"));
  }
  const serialized = `${JSON.stringify(pack, null, 2)}\n`;
  const targetBase = resolve(outputArg);
  const target = /\.ydspack$/i.test(outputArg) ? targetBase : resolve(targetBase, safeName(pack.title));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized, { encoding: "utf8", flag: "w" });
  const fingerprint = createHash("sha256").update(JSON.stringify(canonicalize(pack))).digest("hex");
  console.log(`VALIDATION PASS\nFingerprint: ${fingerprint}\nCreated: ${target}`);
} catch (error) {
  console.error(`FINALIZATION FAILED: ${error.message}`);
  process.exitCode = 1;
}
