import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { App } from "../../src/App";
import { AUTO_ADVANCE_DELAY_MS } from "../../src/config";

const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);
const EXAM_DURATION_MS = 180 * 60_000;

let nowMs = BASE_TIME;
const clock = { now: () => nowMs };

async function startExam() {
  window.history.replaceState({}, "", "/");
  render(<App clock={clock} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sınava Başla" }));
  await screen.findByText("Soru 1 / 12");
}

async function jumpClockTo(timestamp: number) {
  nowMs = timestamp;
  await act(async () => window.dispatchEvent(new FocusEvent("focus")));
}

describe("timer UI", () => {
  beforeEach(() => {
    nowMs = BASE_TIME;
  });

  test("UI 1 — Start shows 03:00:00 with Pause enabled", async () => {
    await startExam();
    expect(screen.getByText("03:00:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duraklat" })).toBeEnabled();
  });

  test("UI 2 — Pause shows privacy screen and hides question content", async () => {
    await startExam();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    expect(screen.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeInTheDocument();
    expect(screen.queryByText(/The team kept a detailed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sorular" })).not.toBeInTheDocument();
  });

  test("UI 3 — paused display stays frozen while clock advances", async () => {
    await startExam();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    const frozen = screen.getByLabelText("Duraklatılmış kalan süre").textContent;
    await jumpClockTo(BASE_TIME + 10_000);
    expect(screen.getByLabelText("Duraklatılmış kalan süre")).toHaveTextContent(frozen ?? "");
  });

  test("UI 4 — Resume restores question and correct remaining time", async () => {
    await startExam();
    await jumpClockTo(BASE_TIME + 60_000);
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    nowMs = BASE_TIME + 31 * 60_000;
    fireEvent.click(screen.getByRole("button", { name: "▶ Devam Et" }));
    expect(screen.getByText("02:59:00")).toBeInTheDocument();
    expect(screen.getByText(/The team kept a detailed/)).toBeInTheDocument();
  });

  test("UI 5 — expiration replaces player with terminal screen", async () => {
    await startExam();
    await jumpClockTo(BASE_TIME + EXAM_DURATION_MS);
    expect(screen.getByRole("heading", { name: "Süre Doldu" })).toBeInTheDocument();
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-choice")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sorular" })).not.toBeInTheDocument();
  });

  test("UI 6 — answer options are absent and cannot be used while paused", async () => {
    await startExam();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    expect(screen.queryAllByTestId("answer-choice")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "← Önceki" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sonraki →" })).not.toBeInTheDocument();
  });

  test("UI 7 — Pause cancels pending auto-advance and resumes on the same question", async () => {
    await startExam();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, AUTO_ADVANCE_DELAY_MS * 2)));
    fireEvent.click(screen.getByRole("button", { name: "▶ Devam Et" }));
    expect(screen.getByText("Soru 1 / 12")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-choice")[0]).toHaveAttribute("aria-pressed", "true");
  });
});
