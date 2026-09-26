import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import { AUTO_ADVANCE_DELAY_MS } from "../../src/config";

function renderHome() {
  window.history.replaceState({}, "", "/");
  return render(<App />);
}

function startExam() {
  renderHome();
  fireEvent.click(screen.getByRole("button", { name: "Sınava Başla" }));
}

function openNavigator() {
  fireEvent.click(screen.getByRole("button", { name: "Sorular" }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Player MVP", () => {
  test("Home shows the sample exam metadata and Start button", () => {
    renderHome();
    expect(screen.getByRole("heading", { name: "Sample YDS Exam" })).toBeInTheDocument();
    expect(screen.getByText("12", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("180 dakika")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sınava Başla" })).toBeInTheDocument();
  });

  test("Start opens Question 1 with five choices", () => {
    startExam();
    expect(screen.getByText("Soru 1 / 12")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-choice")).toHaveLength(5);
  });

  test("selecting an answer marks it selected", () => {
    startExam();
    const choiceA = screen.getAllByTestId("answer-choice")[0];
    fireEvent.click(choiceA);
    expect(choiceA).toHaveAttribute("aria-pressed", "true");
  });

  test("answer selection auto-advances after the configured delay", () => {
    vi.useFakeTimers();
    startExam();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    expect(screen.getByText("Soru 1 / 12")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_DELAY_MS));
    expect(screen.getByText("Soru 2 / 12")).toBeInTheDocument();
  });

  test("Previous restores the earlier answer", () => {
    vi.useFakeTimers();
    startExam();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_DELAY_MS));
    fireEvent.click(screen.getByRole("button", { name: "← Önceki" }));
    expect(screen.getByText("Soru 1 / 12")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-choice")[0]).toHaveAttribute("aria-pressed", "true");
  });

  test("an existing answer can change from A to C", () => {
    startExam();
    const choices = screen.getAllByTestId("answer-choice");
    fireEvent.click(choices[0]);
    fireEvent.click(choices[2]);
    expect(choices[0]).toHaveAttribute("aria-pressed", "false");
    expect(choices[2]).toHaveAttribute("aria-pressed", "true");
  });

  test("Next allows unanswered navigation", () => {
    startExam();
    fireEvent.click(screen.getByRole("button", { name: "Sonraki →" }));
    expect(screen.getByText("Soru 2 / 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Önceki" }));
    for (const choice of screen.getAllByTestId("answer-choice")) {
      expect(choice).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("Navigator shows all questions with current and answered states", () => {
    vi.useFakeTimers();
    startExam();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    openNavigator();
    expect(screen.getByRole("dialog", { name: "Sorular" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Soru \d+/ })).toHaveLength(12);
    expect(screen.getByRole("button", { name: /Soru 1, mevcut, cevaplandı/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  test("Navigator jumps directly to Question 8", () => {
    startExam();
    openNavigator();
    fireEvent.click(screen.getByRole("button", { name: /^Soru 8,/ }));
    expect(screen.getByText("Soru 8 / 12")).toBeInTheDocument();
  });

  test("flagging updates the navigator state", () => {
    startExam();
    fireEvent.click(screen.getByRole("button", { name: "Sonra Bak" }));
    expect(screen.getByRole("button", { name: "İşaretlendi" })).toHaveAttribute("aria-pressed", "true");
    openNavigator();
    expect(screen.getByRole("button", { name: /Soru 1, mevcut, cevaplanmadı, sonra bak işaretli/ }))
      .toHaveAttribute("data-flagged", "true");
  });

  test("shared passage and matching Question 7 render together", () => {
    startExam();
    openNavigator();
    fireEvent.click(screen.getByRole("button", { name: /^Soru 7,/ }));
    expect(screen.getByText(/A trial night train links two imaginary coastal towns/)).toBeInTheDocument();
    expect(screen.getByText("What can passengers carry without an extra fee?")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-choice")).toHaveLength(5);
  });

  test("answering the last question stays in range", () => {
    vi.useFakeTimers();
    startExam();
    openNavigator();
    fireEvent.click(screen.getByRole("button", { name: /^Soru 12,/ }));
    fireEvent.click(screen.getAllByTestId("answer-choice")[3]);
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_DELAY_MS * 2));
    expect(screen.getByText("Soru 12 / 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sonraki →" })).toBeDisabled();
  });
});
