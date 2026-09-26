import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import sessionSchema from "../schemas/exam-session.schema.json" with { type: "json" };
import type { ExamSession } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(sessionSchema);

export interface SessionValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSessionForRestore(value: unknown): SessionValidationResult {
  if (!validateSchema(value)) {
    return {
      valid: false,
      errors: (validateSchema.errors ?? []).map((error) =>
        `${error.instancePath || "/"} ${error.message ?? "schema validation failed"}`),
    };
  }

  const session = value as unknown as ExamSession;
  if (session.result) {
    const { result } = session;
    const invariantValid = result.correct + result.incorrect + result.blank === result.totalQuestions
      && result.answered === result.correct + result.incorrect
      && result.completedAt === session.completedAt
      && result.completionReason === session.completionReason;
    if (!invariantValid) {
      return { valid: false, errors: ["result fields violate completion invariants"] };
    }
  }
  if (session.state === "COMPLETED"
    && (!session.result || session.completionReason !== "manual")) {
    return { valid: false, errors: ["completed session requires a manual result"] };
  }
  if (session.state === "EXPIRED" && session.result
    && session.completionReason !== "expired") {
    return { valid: false, errors: ["expired result requires expired completion metadata"] };
  }
  if (!["COMPLETED", "EXPIRED"].includes(session.state) && session.result) {
    return { valid: false, errors: ["non-terminal session cannot contain a result"] };
  }
  if (session.timer.model !== "expected-end-v1") {
    return { valid: true, errors: [] };
  }

  const { state, startedAt, completedAt, expiredAt, timer } = session;
  const validState = {
    NOT_STARTED: startedAt === null && timer.expectedEndAt === null,
    RUNNING: startedAt !== null
      && timer.expectedEndAt !== null
      && timer.pausedAt === null
      && timer.remainingMsWhenPaused === null,
    PAUSED: startedAt !== null
      && timer.expectedEndAt === null
      && timer.pausedAt !== null
      && timer.remainingMsWhenPaused !== null,
    COMPLETED: completedAt !== null && timer.expectedEndAt === null,
    EXPIRED: expiredAt !== null
      && timer.expectedEndAt === null
      && timer.remainingMsWhenPaused === 0,
  }[state];

  return validState
    ? { valid: true, errors: [] }
    : { valid: false, errors: [`timer fields are inconsistent with state ${state}`] };
}
