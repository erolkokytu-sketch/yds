import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import { AUTO_ADVANCE_DELAY_MS } from "../../src/config";
import { sampleExam } from "../../src/exam";
import { ExamPackRepository } from "../../src/exam-pack-repository";
import { SessionRepository } from "../../src/session-repository";
import type { ExamPack } from "../../src/types";

const NOW = Date.UTC(2026, 0, 1, 12);
let counter = 0;

function repositories() {
  counter += 1;
  const name = `yds-pack-ui-${counter}`;
  return {
    packs: new ExamPackRepository(name),
    sessions: new SessionRepository(name),
  };
}

function importedExam(overrides: Partial<ExamPack> = {}): ExamPack {
  return structuredClone({
    ...sampleExam,
    id: "ui-imported-exam",
    title: "UI Imported Exam",
    durationMinutes: 30,
    ...overrides,
  });
}

function file(exam: unknown) {
  return new File([JSON.stringify(exam)], "ui-test.ydspack", { type: "application/json" });
}

async function upload(exam: ExamPack, packs: ExamPackRepository, sessions: SessionRepository) {
  window.history.replaceState({}, "", "/");
  const view = render(
    <App
      repository={sessions}
      examPackRepository={packs}
      clock={{ now: () => NOW }}
    />,
  );
  await screen.findByRole("button", { name: "+ Sınav Paketi Ekle" });
  fireEvent.change(screen.getByTestId("exam-pack-input"), { target: { files: [file(exam)] } });
  await screen.findByRole("dialog", { name: exam.title });
  fireEvent.click(screen.getByRole("button", { name: "Sınavı Ekle" }));
  await screen.findByText("Sınav eklendi");
  return view;
}

describe("installed exam UI", () => {
  test("Import 2–3 and player integration — installed exam runs the full lifecycle", async () => {
    const { packs, sessions } = repositories();
    const exam = importedExam();
    const firstView = await upload(exam, packs, sessions);
    expect(screen.getByRole("heading", { name: exam.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sınava Git" }));
    expect(await screen.findByText("Soru 1 / 12")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, AUTO_ADVANCE_DELAY_MS + 20)));
    expect(screen.getByText("Soru 2 / 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    await sessions.flush();
    firstView.unmount();

    window.history.replaceState({}, "", `/exam/${exam.id}`);
    render(<App repository={sessions} examPackRepository={packs} clock={{ now: () => NOW }} />);
    expect(await screen.findByRole("heading", { name: "Sınav Duraklatıldı" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "▶ Devam Et" }));
    fireEvent.click(screen.getByRole("button", { name: "Sınavı Bitir" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Sınavı Bitir" }).at(-1)!);
    expect(await screen.findByRole("heading", { name: "Sınav Tamamlandı" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Soruları İncele" }));
    expect(await screen.findByRole("heading", { name: "Soruları İncele" })).toBeInTheDocument();
    expect(screen.getByText("Doğru cevapladın")).toBeInTheDocument();
  });

  test("invalid upload reports an error and keeps the library unchanged", async () => {
    const { packs, sessions } = repositories();
    window.history.replaceState({}, "", "/");
    render(<App repository={sessions} examPackRepository={packs} />);
    await screen.findByRole("button", { name: "+ Sınav Paketi Ekle" });
    fireEvent.change(screen.getByTestId("exam-pack-input"), {
      target: { files: [new File(["broken"], "broken.ydspack")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Bu sınav paketi okunamadı.");
    expect(screen.getByRole("heading", { name: sampleExam.title })).toBeInTheDocument();
    expect(await packs.listInstalled()).toEqual([]);
  });

  test("XSS-like prompt renders as text and never executes", async () => {
    const { packs, sessions } = repositories();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const exam = importedExam({ id: "xss-plain-text-exam", title: "Plain Text Security Exam" });
    exam.questions[0].prompt = "<script>alert('x')</script>";
    await upload(exam, packs, sessions);
    fireEvent.click(screen.getByRole("button", { name: "Sınava Git" }));
    expect(await screen.findByText("<script>alert('x')</script>")).toBeInTheDocument();
    expect(alert).not.toHaveBeenCalled();
    expect(document.querySelector("script")).toBeNull();
    alert.mockRestore();
  });
});
