import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { App } from "../../src/App";
import { AUTO_ADVANCE_DELAY_MS } from "../../src/config";
import { sampleExam } from "../../src/exam";
import { finalizeExamSession } from "../../src/result";
import { SessionRepository } from "../../src/session-repository";
import { startTimer } from "../../src/timer";
import type { ChoiceKey, ExamSession } from "../../src/types";

const NOW = Date.UTC(2026, 0, 1, 12);
let databaseCounter = 0;

function repository() {
  databaseCounter += 1;
  return new SessionRepository(`yds-completion-ui-${databaseCounter}`);
}

function runningSession(answers: Record<string, ChoiceKey> = {}, flags: string[] = []): ExamSession {
  const timer = startTimer(sampleExam.durationMinutes * 60_000, NOW);
  return {
    schemaVersion: 1,
    id: `completed-${databaseCounter}`,
    examId: sampleExam.id,
    examPackSchemaVersion: 1,
    currentQuestionId: "q-01",
    answers,
    flaggedQuestionIds: flags,
    state: "RUNNING",
    startedAt: NOW,
    completedAt: null,
    completionReason: null,
    expiredAt: null,
    timer: timer.timer,
    result: null,
  };
}

async function startApp(repo = repository()) {
  window.history.replaceState({}, "", "/");
  render(<App repository={repo} clock={{ now: () => NOW }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sınava Başla" }));
  await screen.findByText("Soru 1 / 12");
  return repo;
}

async function renderReview(
  answers: Record<string, ChoiceKey>,
  flags: string[] = [],
) {
  const repo = repository();
  const completed = finalizeExamSession(sampleExam, runningSession(answers, flags), "manual", NOW + 1);
  await repo.saveSession(completed, NOW + 1);
  window.history.replaceState({}, "", `/exam/${sampleExam.id}/review`);
  render(<App repository={repo} clock={{ now: () => NOW + 1 }} />);
  await screen.findByRole("heading", { name: "Soruları İncele" });
  return { repo, completed };
}

describe("manual completion", () => {
  test("confirmation shows live counts and Escape cancels without mutation", async () => {
    const repo = await startApp();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Sonra Bak" }));
    fireEvent.click(screen.getByRole("button", { name: "Sınavı Bitir" }));
    const dialog = screen.getByRole("dialog", { name: "Sınavı bitirmek istediğine emin misin?" });
    expect(dialog).toHaveTextContent("Cevaplanan1");
    expect(dialog).toHaveTextContent("Boş11");
    expect(dialog).toHaveTextContent("Sonra Bak1");
    expect(screen.getByRole("button", { name: "Vazgeç" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getAllByRole("button", { name: "Sınavı Bitir" }).at(-1)).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Vazgeç" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await repo.flush();
    expect((await repo.findActiveSessionForExam(sampleExam.id))?.state).toBe("RUNNING");
  });

  test("manual finish persists COMPLETED metadata before showing results", async () => {
    const repo = await startApp();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Sınavı Bitir" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Sınavı Bitir" }).at(-1)!);
    expect(await screen.findByRole("heading", { name: "Sınav Tamamlandı" })).toBeInTheDocument();
    const completed = await repo.findLatestCompletedAttemptForExam(sampleExam.id);
    expect(completed).toMatchObject({
      state: "COMPLETED",
      completedAt: NOW,
      completionReason: "manual",
    });
    expect(completed?.result).toMatchObject({ correct: 1, incorrect: 0, blank: 11 });
  });

  test("paused exam can finish without exposing question content", async () => {
    await startApp();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    fireEvent.click(screen.getByRole("button", { name: "Sınavı Bitir" }));
    expect(screen.queryByText(/The team kept a detailed/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Sınavı Bitir" }).at(-1)!);
    expect(await screen.findByRole("heading", { name: "Sınav Tamamlandı" })).toBeInTheDocument();
  });

  test("pending auto-advance cannot mutate a completed attempt", async () => {
    const repo = await startApp();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Sınavı Bitir" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Sınavı Bitir" }).at(-1)!);
    await screen.findByRole("heading", { name: "Sınav Tamamlandı" });
    await act(async () => new Promise((resolve) => setTimeout(resolve, AUTO_ADVANCE_DELAY_MS * 2)));
    const completed = await repo.findLatestCompletedAttemptForExam(sampleExam.id);
    expect(completed?.currentQuestionId).toBe("q-01");
    expect(completed?.state).toBe("COMPLETED");
  });

  test("retake creates a new active session and preserves the completed attempt", async () => {
    const repo = repository();
    const completed = finalizeExamSession(sampleExam, runningSession({ "q-01": "A" }), "manual", NOW + 1);
    await repo.saveSession(completed, NOW + 1);
    window.history.replaceState({}, "", "/");
    render(<App repository={repo} clock={{ now: () => NOW + 2 }} />);
    expect(await screen.findByText("Son sonuç")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden Çöz" }));
    expect(screen.getByRole("dialog", { name: "Yeni bir sınav başlatılsın mı?" }))
      .toHaveTextContent("Önceki sonucun kaybolmayacak.");
    fireEvent.click(screen.getByRole("button", { name: "Yeni Sınav" }));
    expect(await screen.findByText("Soru 1 / 12")).toBeInTheDocument();
    await repo.flush();
    const attempts = await repo.listSessionsForExam(sampleExam.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.find(({ state }) => state === "COMPLETED")?.id).toBe(completed.id);
    expect(attempts.find(({ state }) => state === "RUNNING")?.id).not.toBe(completed.id);
  });
});

describe("read-only review", () => {
  test("Review 1 — wrong user answer and canonical correct answer are distinct", async () => {
    await renderReview({ "q-01": "B" });
    expect(screen.getByText("Yanlış cevapladın")).toBeInTheDocument();
    expect(screen.getByText(/Senin cevabın:/).parentElement).toHaveTextContent("B");
    expect(screen.getAllByTestId("review-choice")[0]).toHaveAttribute("data-answer-state", "correct");
    expect(screen.getAllByTestId("review-choice")[1]).toHaveAttribute("data-answer-state", "incorrect");
  });

  test("Review 2 — correct selection is labelled in text", async () => {
    await renderReview({ "q-01": "A" });
    expect(screen.getByText("Doğru cevapladın")).toBeInTheDocument();
    expect(screen.getByText("Senin cevabın · Doğru cevap")).toBeInTheDocument();
  });

  test("Review 3 — blank still reveals the canonical answer", async () => {
    await renderReview({});
    expect(screen.getByText("Boş bıraktın")).toBeInTheDocument();
    expect(screen.getByText(/Senin cevabın:/).parentElement).toHaveTextContent("Boş");
    expect(screen.getByText(/Doğru cevap:/).parentElement).toHaveTextContent("A");
  });

  test("Review 4 — Wrong filter contains only wrong questions", async () => {
    await renderReview({ "q-01": "B", "q-02": "B" });
    fireEvent.click(screen.getByRole("button", { name: "Yanlışlar" }));
    expect(screen.getByText("Yanlışlar 1 / 1")).toBeInTheDocument();
    expect(document.querySelector('[data-question-id="q-01"]')).toBeInTheDocument();
  });

  test("Review 5 — Blank filter contains only unanswered questions", async () => {
    await renderReview({ "q-01": "A" });
    fireEvent.click(screen.getByRole("button", { name: "Boşlar" }));
    expect(screen.getByText("Boşlar 1 / 11")).toBeInTheDocument();
    expect(document.querySelector('[data-question-id="q-02"]')).toBeInTheDocument();
  });

  test("Review 6 — Correct filter contains only correct questions", async () => {
    await renderReview({ "q-01": "A", "q-02": "A" });
    fireEvent.click(screen.getByRole("button", { name: "Doğrular" }));
    expect(screen.getByText("Doğrular 1 / 1")).toBeInTheDocument();
    expect(document.querySelector('[data-question-id="q-01"]')).toBeInTheDocument();
    expect(screen.queryAllByTestId("answer-choice")).toHaveLength(0);
  });
});
