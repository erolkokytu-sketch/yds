import { validateExamPack, type ValidationError } from "./exam-pack-validator.mjs";
import type { ExamPack } from "./types";
import type { ExamPackRepositoryContract } from "./exam-pack-repository";

export const MAX_EXAM_PACK_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_EXAM_PACK_SCHEMA_VERSION = 1;

export type ExamPackImportErrorCode =
  | "file-type"
  | "too-large"
  | "unreadable"
  | "invalid-json"
  | "invalid-pack"
  | "unsupported-version"
  | "duplicate"
  | "conflict";

export interface ExamPackImportError {
  code: ExamPackImportErrorCode;
  message: string;
  details: string[];
  validationErrors?: ValidationError[];
}

export interface PreparedExamPack {
  examPack: ExamPack;
  fingerprint: string;
  originalFileName: string;
}

export type PrepareExamPackResult =
  | { ok: true; candidate: PreparedExamPack }
  | { ok: false; error: ExamPackImportError };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function canonicalExamPackJson(examPack: ExamPack): string {
  return JSON.stringify(canonicalize(examPack));
}

export async function fingerprintExamPack(examPack: ExamPack): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalExamPackJson(examPack));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function error(
  code: ExamPackImportErrorCode,
  message: string,
  details: string[] = [],
  validationErrors?: ValidationError[],
): PrepareExamPackResult {
  return { ok: false, error: { code, message, details, validationErrors } };
}

function friendlyValidationErrors(errors: ValidationError[]): string[] {
  return errors.slice(0, 4).map((item) => `${item.path}: ${item.message}`);
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

export async function prepareExamPackImport(
  file: File,
  repository: ExamPackRepositoryContract,
  builtInExams: ExamPack[] = [],
): Promise<PrepareExamPackResult> {
  if (!/\.(ydspack|json)$/i.test(file.name)) {
    return error("file-type", "Yalnızca .ydspack dosyaları destekleniyor.");
  }
  if (file.size > MAX_EXAM_PACK_BYTES) {
    return error("too-large", "Sınav paketi 10 MB sınırını aşıyor.");
  }

  let text: string;
  try {
    const bytes = await readFileBytes(file);
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return error("unreadable", "Bu sınav paketi okunamadı.", [
      "Dosya geçerli UTF-8 metin içermiyor.",
    ]);
  }
  if (!text.trim()) {
    return error("unreadable", "Bu sınav paketi okunamadı.", [
      "Dosya boş veya desteklenen formatta değil.",
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return error("invalid-json", "Bu sınav paketi okunamadı.", [
      "Dosya bozuk veya desteklenen JSON formatında değil.",
    ]);
  }

  const schemaVersion = parsed && typeof parsed === "object"
    ? (parsed as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  if (typeof schemaVersion === "number" && schemaVersion !== SUPPORTED_EXAM_PACK_SCHEMA_VERSION) {
    return error(
      "unsupported-version",
      "Bu sınav paketi uygulamanın desteklemediği daha yeni bir format kullanıyor.",
    );
  }

  const validation = validateExamPack(parsed);
  if (!validation.valid) {
    console.error("[exam-pack-import] validation failed", validation.errors);
    return error(
      "invalid-pack",
      "Sınav paketi geçersiz.",
      friendlyValidationErrors(validation.errors),
      validation.errors,
    );
  }

  const examPack = structuredClone(parsed) as ExamPack;
  const fingerprint = await fingerprintExamPack(examPack);
  const builtIn = builtInExams.find(({ id }) => id === examPack.id);
  if (builtIn) {
    const existingFingerprint = await fingerprintExamPack(builtIn);
    return existingFingerprint === fingerprint
      ? error("duplicate", "Bu sınav zaten yüklü.")
      : error("conflict", "Bu kimliğe sahip farklı bir sınav paketi zaten yüklü.", [
        "Güvenlik nedeniyle mevcut sınav değiştirilmedi.",
      ]);
  }

  const installed = await repository.getInstalled(examPack.id);
  if (installed) {
    return installed.fingerprint === fingerprint
      ? error("duplicate", "Bu sınav zaten yüklü.")
      : error("conflict", "Bu kimliğe sahip farklı bir sınav paketi zaten yüklü.", [
        `Mevcut: ${installed.title}`,
        `Yeni dosya: ${examPack.title}`,
        "Güvenlik nedeniyle mevcut sınav değiştirilmedi.",
      ]);
  }

  return {
    ok: true,
    candidate: { examPack, fingerprint, originalFileName: file.name },
  };
}

export function serializeExamPack(examPack: ExamPack): string {
  return `${JSON.stringify(examPack, null, 2)}\n`;
}

export function safeExamPackFileName(examPack: ExamPack): string {
  const normalized = examPack.title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || examPack.id}.ydspack`;
}
