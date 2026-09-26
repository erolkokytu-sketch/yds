import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import { sampleExam } from "../../src/exam";
import { SessionRepository } from "../../src/session-repository";
import type { StoredExamSession } from "../../src/types";

const START = Date.UTC(2026, 0, 1, 12);
let repositoryCounter = 0;

function testRepository() {
  repositoryCounter += 1;
  return new SessionRepository(`yds-study-ui-${repositoryCounter}`);
}

async function start(repository: SessionRepository, clock: { now: () => number }) {
  window.history.replaceState({}, "", "/");
  const view = render(<App repository={repository} clock={clock} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sınava Başla" }));
  await screen.findByText("Soru 1 / 12");
  return view;
}

describe("session hydration", () => {
  test("Home offers Devam Et with the restored question summary", async () => {
    const repository = testRepository();
    const clock = { now: () => START };
    const firstView = await start(repository, clock);
    fireEvent.click(screen.getByRole("button", { name: "Sonraki →" }));
    await repository.flush();
    firstView.unmount();

    window.history.replaceState({}, "", "/");
    render(<App repository={repository} clock={clock} />);
    expect(await screen.findByText("Sınav devam ediyor")).toBeInTheDocument();
    expect(screen.getByText("Soru 2 / 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Devam Et" }));
    expect(await screen.findByText("Soru 2 / 12")).toBeInTheDocument();
  });

  test("answer, current question and flag survive a fresh mount", async () => {
    const repository = testRepository();
    const clock = { now: () => START };
    const firstView = await start(repository, clock);
    fireEvent.click(screen.getAllByTestId("answer-choice")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Sorular" }));
    fireEvent.click(screen.getByRole("button", { name: /^Soru 8,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sonra Bak" }));
    await repository.flush();
    firstView.unmount();

    window.history.replaceState({}, "", `/exam/${sampleExam.id}`);
    render(<App repository={repository} clock={clock} />);
    expect(await screen.findByText("Soru 8 / 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İşaretlendi" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sorular" }));
    fireEvent.click(screen.getByRole("button", { name: /Soru 1, cevaplandı/ }));
    expect(screen.getAllByTestId("answer-choice")[0]).toHaveAttribute("aria-pressed", "true");
  });

  test("paused session stays frozen after a three-hour closure", async () => {
    const repository = testRepository();
    let now = START;
    const clock = { now: () => now };
    const firstView = await start(repository, clock);
    now += 60_000;
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    const frozen = screen.getByLabelText("Duraklatılmış kalan süre").textContent;
    await repository.flush();
    firstView.unmount();

    now += 3 * 60 * 60_000;
    window.history.replaceState({}, "", `/exam/${sampleExam.id}`);
    render(<App repository={repository} clock={clock} />);
    expect(await screen.findByRole("heading", { name: "Sınav Duraklatıldı" })).toBeInTheDocument();
    expect(screen.getByLabelText("Duraklatılmış kalan süre")).toHaveTextContent(frozen ?? "");
  });

  test("running session subtracts ten closed minutes on a fresh mount", async () => {
    const repository = testRepository();
    let now = START;
    const clock = { now: () => now };
    const firstView = await start(repository, clock);
    await repository.flush();
    firstView.unmount();

    now += 10 * 60_000;
    window.history.replaceState({}, "", `/exam/${sampleExam.id}`);
    render(<App repository={repository} clock={clock} />);
    expect(await screen.findByText("02:50:00")).toBeInTheDocument();
  });

  test("running session expired while closed is reconciled and persisted", async () => {
    const repository = testRepository();
    let now = START;
    const clock = { now: () => now };
    const firstView = await start(repository, clock);
    await repository.flush();
    firstView.unmount();

    now += sampleExam.durationMinutes * 60_000 + 1;
    window.history.replaceState({}, "", `/exam/${sampleExam.id}`);
    render(<App repository={repository} clock={clock} />);
    expect(await screen.findByRole("heading", { name: "Süre Doldu" })).toBeInTheDocument();
    await act(async () => repository.flush());
    expect((await repository.findLatestSessionForExam(sampleExam.id))?.state).toBe("EXPIRED");
  });

  test("corrupt stored session is ignored without crashing startup", async () => {
    const repository = testRepository();
    const clock = { now: () => START };
    const firstView = await start(repository, clock);
    await repository.flush();
    const session = (await repository.findLatestSessionForExam(sampleExam.id))!;
    firstView.unmount();
    await repository.putRawForTests({
      ...session,
      answers: { "q-01": "invalid" },
      storageVersion: 1,
      updatedAt: START + 1,
    } as unknown as StoredExamSession);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    window.history.replaceState({}, "", "/");
    render(<App repository={repository} clock={clock} />);
    expect(await screen.findByRole("button", { name: "Sınava Başla" })).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ignored invalid session"));
    error.mockRestore();
  });
});
