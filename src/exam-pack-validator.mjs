import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import examPackSchema from "../schemas/exam-pack.schema.json" with { type: "json" };
import examSessionSchema from "../schemas/exam-session.schema.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validatePackSchema = ajv.compile(examPackSchema);
const validateSessionSchema = ajv.compile(examSessionSchema);

function schemaErrors(errors = []) {
  return errors.map((error) => ({
    code: `schema.${error.keyword}`,
    path: error.instancePath || "/",
    message: error.message ?? "schema validation failed",
  }));
}

function addDuplicateErrors(items, field, code, errors) {
  const seen = new Set();
  for (const item of items) {
    const value = item[field];
    if (seen.has(value)) {
      errors.push({ code, path: `/${field}`, message: `duplicate ${field}: ${value}` });
    }
    seen.add(value);
  }
}

export function validateExamPack(examPack) {
  if (!validatePackSchema(examPack)) {
    return { valid: false, errors: schemaErrors(validatePackSchema.errors) };
  }

  const errors = [];
  addDuplicateErrors(examPack.questions, "id", "duplicate_question_id", errors);
  addDuplicateErrors(examPack.questions, "number", "duplicate_question_number", errors);
  addDuplicateErrors(examPack.contentBlocks, "id", "duplicate_content_block_id", errors);
  addDuplicateErrors(examPack.questionGroups, "id", "duplicate_question_group_id", errors);

  if (examPack.questionCount !== examPack.questions.length) {
    errors.push({
      code: "question_count_mismatch",
      path: "/questionCount",
      message: `questionCount is ${examPack.questionCount}, but questions has ${examPack.questions.length} items`,
    });
  }

  const contentIds = new Set(examPack.contentBlocks.map(({ id }) => id));
  const questionIds = new Set(examPack.questions.map(({ id }) => id));
  const groupById = new Map(examPack.questionGroups.map((group) => [group.id, group]));

  for (const question of examPack.questions) {
    for (const contentBlockId of question.contentBlockIds) {
      if (!contentIds.has(contentBlockId)) {
        errors.push({
          code: "missing_content_block_reference",
          path: `/questions/${question.id}/contentBlockIds`,
          message: `unknown content block: ${contentBlockId}`,
        });
      }
    }

    if (question.groupId) {
      const group = groupById.get(question.groupId);
      if (!group) {
        errors.push({
          code: "missing_question_group_reference",
          path: `/questions/${question.id}/groupId`,
          message: `unknown question group: ${question.groupId}`,
        });
      } else if (!group.questionIds.includes(question.id)) {
        errors.push({
          code: "question_group_mismatch",
          path: `/questions/${question.id}/groupId`,
          message: `group ${question.groupId} does not include ${question.id}`,
        });
      }
    }

    const normalizedChoices = Object.values(question.choices).map((choice) => choice.trim());
    if (new Set(normalizedChoices).size !== 5) {
      errors.push({
        code: "duplicate_choice",
        path: `/questions/${question.id}/choices`,
        message: "choice text must be unique within a question",
      });
    }
  }

  const groupedQuestions = new Set();
  for (const group of examPack.questionGroups) {
    for (const questionId of group.questionIds) {
      if (!questionIds.has(questionId)) {
        errors.push({
          code: "missing_group_question_reference",
          path: `/questionGroups/${group.id}/questionIds`,
          message: `unknown question: ${questionId}`,
        });
      }
      if (groupedQuestions.has(questionId)) {
        errors.push({
          code: "question_in_multiple_groups",
          path: `/questionGroups/${group.id}/questionIds`,
          message: `question appears in multiple groups: ${questionId}`,
        });
      }
      groupedQuestions.add(questionId);
    }
  }

  const answerIds = Object.keys(examPack.answerKey.answers);
  for (const questionId of questionIds) {
    if (!(questionId in examPack.answerKey.answers)) {
      errors.push({
        code: "missing_answer",
        path: "/answerKey/answers",
        message: `answer missing for question: ${questionId}`,
      });
    }
  }
  for (const answerId of answerIds) {
    if (!questionIds.has(answerId)) {
      errors.push({
        code: "orphan_answer",
        path: `/answerKey/answers/${answerId}`,
        message: `answer references unknown question: ${answerId}`,
      });
    }
  }

  if (examPack.answerKey.status === "verified" && !examPack.answerKey.verifiedAt) {
    errors.push({
      code: "verified_answer_key_missing_timestamp",
      path: "/answerKey/verifiedAt",
      message: "a verified answer key requires verifiedAt",
    });
  }

  if (examPack.kind === "official" && examPack.source.completeness === "unknown") {
    errors.push({
      code: "official_source_completeness_unknown",
      path: "/source/completeness",
      message: "an official pack requires known source completeness",
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateExamSession(session) {
  if (!validateSessionSchema(session)) {
    return { valid: false, errors: schemaErrors(validateSessionSchema.errors) };
  }

  const errors = [];
  const { state, startedAt, completedAt, expiredAt, timer } = session;
  if (session.result) {
    const result = session.result;
    if (
      result.correct + result.incorrect + result.blank !== result.totalQuestions
      || result.answered !== result.correct + result.incorrect
      || result.completedAt !== completedAt
      || result.completionReason !== session.completionReason
    ) {
      errors.push({
        code: "invalid_result_invariant",
        path: "/result",
        message: "result counts or completion metadata are inconsistent",
      });
    }
  }
  if (state === "COMPLETED" && (!session.result || session.completionReason !== "manual")) {
    errors.push({
      code: "completed_result_missing",
      path: "/result",
      message: "completed session requires a manual result",
    });
  }
  if (state === "EXPIRED" && session.result && session.completionReason !== "expired") {
    errors.push({
      code: "expired_result_mismatch",
      path: "/result",
      message: "expired result requires expired completion metadata",
    });
  }
  if (!["COMPLETED", "EXPIRED"].includes(state) && session.result) {
    errors.push({
      code: "non_terminal_result",
      path: "/result",
      message: "non-terminal session cannot contain a result",
    });
  }
  const expectedEndModel = timer.model === "expected-end-v1";
  const stateRules = expectedEndModel
    ? {
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
      }
    : {
        NOT_STARTED: startedAt === null && timer.runStartedAt === null && timer.pausedAt === null,
        RUNNING: startedAt !== null && timer.runStartedAt !== null && timer.pausedAt === null,
        PAUSED: startedAt !== null && timer.runStartedAt === null && timer.pausedAt !== null,
        COMPLETED: completedAt !== null && timer.runStartedAt === null,
        EXPIRED: expiredAt !== null && timer.runStartedAt === null,
      };

  if (!stateRules[state]) {
    errors.push({
      code: "invalid_timer_state",
      path: "/state",
      message: `timestamps are inconsistent with state ${state}`,
    });
  }
  if (!expectedEndModel && timer.accumulatedElapsedSeconds > timer.durationSeconds) {
    errors.push({
      code: "elapsed_exceeds_duration",
      path: "/timer/accumulatedElapsedSeconds",
      message: "accumulated elapsed time cannot exceed duration",
    });
  }

  return { valid: errors.length === 0, errors };
}
