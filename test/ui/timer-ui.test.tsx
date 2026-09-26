import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import { AUTO_ADVANCE_DELAY_MS } from "../../src/config";
import { TIMER_UI_TICK_MS } from "../../src/timer";

const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);
const EXAM_DURATION_MS = 180 * 60_000;

function startExam() {
  window.history.replaceState({}, "", "/");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Sınava Başla" }));
}

function jumpClockTo(timestamp: number) {
  vi.setSystemTime(timestamp);
  act(() => vi.advanceTimersByTime(TIMER_UI_TICK_MS));
}

describe("timer UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("UI 1 — Start shows 03:00:00 with Pause enabled", () => {
    startExam();
    expect(screen.getByText("03:00:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duraklat" })).toBeEnabled();
  });

  test("UI 2 — Pause shows privacy screen and hides question content", () => {
    startExam();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    expect(screen.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeInTheDocument();
    expect(screen.queryByText(/The team kept a detailed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sorular" })).not.toBeInTheDocument();
  });

  test("UI 3 — paused display stays frozen while clock advances", () => {
    startExam();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    const frozen = screen.getByLabelText("Duraklatılmış kalan süre").textContent;
    jumpClockTo(BASE_TIME + 10_000);
    expect(screen.getByLabelText("Duraklatılmış kalan süre")).toHaveTextContent(frozen ?? "");
  });

  test("UI 4 — Resume restores question and correct remaining time", () => {
    startExam();
    jumpClockTo(BASE_TIME + 60_000);
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    vi.setSystemTime(BASE_TIME + 31 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "▶ Devam Et" }));
    expect(screen.getByText("02:59:00")).toBeInTheDocument();
    expect(screen.getByText(/The team kept a detailed/)).toBeInTheDocument();
  });

  test("UI 5 — expiration replaces player with terminal screen", () => {
    startExam();
    jumpClockTo(BASE_TIME + EXAM_DURATION_MS);
    expect(screen.getByRole("heading", { name: "Süre Doldu" })).toBeInTheDocument();
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-choice")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sorular" })).not.toBeInTheDocument();
  });

  test("UI 6 — answer options are absent and cannot be used while paused", () => {
    startExam();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    expect(screen.queryAllByTestId("answer-choice")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "← Önceki" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sonraki →" })).not.toBeInTheDocument();
  });

  test("UI 7 — Pause cancels pending auto-advance and resumes on the same question", () => {
    startExam();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_DELAY_MS * 2));
    fireEvent.click(screen.getByRole("button", { name: "▶ Devam Et" }));
    expect(screen.getByText("Soru 1 / 12")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-choice")[0]).toHaveAttribute("aria-pressed", "true");
  });
});
