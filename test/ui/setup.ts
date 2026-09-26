import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(async () => {
  cleanup();
  const { defaultSessionRepository } = await import("../../src/session-repository");
  const { defaultExamPackRepository } = await import("../../src/exam-pack-repository");
  await defaultSessionRepository.clearAllForTests();
  await defaultExamPackRepository.clearAllForTests();
  window.history.replaceState({}, "", "/");
});
