import { describe, expect, test } from "vitest";
import {
  formatDuration,
  getRemainingMs,
  pauseTimer,
  resumeTimer,
  startTimer,
  synchronizeTimer,
} from "../../src/timer";

const MINUTE = 60_000;
const DURATION = 180 * MINUTE;

describe("timestamp timer engine", () => {
  test("Timer 1 — starts a 180-minute exam at 03:00:00", () => {
    const snapshot = startTimer(DURATION, 1_000);
    expect(snapshot.status).toBe("RUNNING");
    expect(formatDuration(getRemainingMs(snapshot.timer, snapshot.status, 1_000))).toBe("03:00:00");
  });

  test("Timer 2 — one minute passes", () => {
    const snapshot = startTimer(DURATION, 0);
    expect(formatDuration(getRemainingMs(snapshot.timer, snapshot.status, MINUTE))).toBe("02:59:00");
  });

  test("Timer 3 — direct ten-minute clock jump proves background drift protection", () => {
    const snapshot = startTimer(DURATION, 0);
    expect(formatDuration(getRemainingMs(snapshot.timer, snapshot.status, 10 * MINUTE))).toBe("02:50:00");
  });

  test("Timer 4 — pause freezes the real remaining time", () => {
    const running = startTimer(DURATION, 0);
    const paused = pauseTimer(running.timer, running.status, 10 * MINUTE);
    expect(paused.status).toBe("PAUSED");
    expect(formatDuration(getRemainingMs(paused.timer, paused.status, 10 * MINUTE))).toBe("02:50:00");
  });

  test("Timer 5 — paused wall time does not count", () => {
    const running = startTimer(DURATION, 0);
    const paused = pauseTimer(running.timer, running.status, 10 * MINUTE);
    expect(formatDuration(getRemainingMs(paused.timer, paused.status, 40 * MINUTE))).toBe("02:50:00");
  });

  test("Timer 6 — resume preserves frozen remaining time", () => {
    const running = startTimer(DURATION, 0);
    const paused = pauseTimer(running.timer, running.status, 10 * MINUTE);
    const resumed = resumeTimer(paused.timer, paused.status, 40 * MINUTE);
    expect(resumed.status).toBe("RUNNING");
    expect(formatDuration(getRemainingMs(resumed.timer, resumed.status, 40 * MINUTE))).toBe("02:50:00");
  });

  test("Timer 7 — countdown continues after resume", () => {
    const running = startTimer(DURATION, 0);
    const paused = pauseTimer(running.timer, running.status, 10 * MINUTE);
    const resumed = resumeTimer(paused.timer, paused.status, 40 * MINUTE);
    expect(formatDuration(getRemainingMs(resumed.timer, resumed.status, 45 * MINUTE))).toBe("02:45:00");
  });

  test("Timer 8 — three pause/resume cycles have no drift", () => {
    let snapshot = startTimer(DURATION, 0);
    snapshot = pauseTimer(snapshot.timer, snapshot.status, 10 * MINUTE);
    snapshot = resumeTimer(snapshot.timer, snapshot.status, 15 * MINUTE);
    snapshot = pauseTimer(snapshot.timer, snapshot.status, 35 * MINUTE);
    snapshot = resumeTimer(snapshot.timer, snapshot.status, 40 * MINUTE);
    snapshot = pauseTimer(snapshot.timer, snapshot.status, 70 * MINUTE);
    snapshot = resumeTimer(snapshot.timer, snapshot.status, 100 * MINUTE);
    expect(formatDuration(getRemainingMs(snapshot.timer, snapshot.status, 100 * MINUTE))).toBe("02:00:00");
  });

  test("Timer 9 — reaching duration expires at 00:00:00", () => {
    const running = startTimer(DURATION, 0);
    const expired = synchronizeTimer(running.timer, running.status, DURATION);
    expect(expired.status).toBe("EXPIRED");
    expect(formatDuration(getRemainingMs(expired.timer, expired.status, DURATION))).toBe("00:00:00");
  });

  test("Timer 10 — remaining time never becomes negative", () => {
    const running = startTimer(DURATION, 0);
    const expired = synchronizeTimer(running.timer, running.status, DURATION * 50);
    expect(getRemainingMs(expired.timer, expired.status, DURATION * 50)).toBe(0);
    expect(formatDuration(-5_000)).toBe("00:00:00");
  });
});
