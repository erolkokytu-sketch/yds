import type { Clock, ExamStatus, ExamTimerState } from "./types";

export const TIMER_UI_TICK_MS = 250;

export const systemClock: Clock = {
  now: () => Date.now(),
};

export interface TimerSnapshot {
  status: ExamStatus;
  timer: ExamTimerState;
}

function clampRemaining(remainingMs: number, durationMs: number) {
  return Math.min(durationMs, Math.max(0, remainingMs));
}

export function startTimer(durationMs: number, nowMs: number): TimerSnapshot {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError("durationMs must be a positive finite number");
  }
  return {
    status: "RUNNING",
    timer: {
      model: "expected-end-v1",
      durationMs,
      expectedEndAt: nowMs + durationMs,
      pausedAt: null,
      remainingMsWhenPaused: null,
    },
  };
}

export function getRemainingMs(timer: ExamTimerState, status: ExamStatus, nowMs: number): number {
  if (status === "EXPIRED") return 0;
  if (status === "PAUSED" || status === "COMPLETED") {
    return clampRemaining(timer.remainingMsWhenPaused ?? 0, timer.durationMs);
  }
  if (status === "RUNNING" && timer.expectedEndAt !== null) {
    return clampRemaining(timer.expectedEndAt - nowMs, timer.durationMs);
  }
  return timer.durationMs;
}

export function synchronizeTimer(
  timer: ExamTimerState,
  status: ExamStatus,
  nowMs: number,
): TimerSnapshot {
  if (status !== "RUNNING" || getRemainingMs(timer, status, nowMs) > 0) {
    return { status, timer };
  }
  return {
    status: "EXPIRED",
    timer: {
      ...timer,
      expectedEndAt: null,
      pausedAt: null,
      remainingMsWhenPaused: 0,
    },
  };
}

export function pauseTimer(
  timer: ExamTimerState,
  status: ExamStatus,
  nowMs: number,
): TimerSnapshot {
  const synchronized = synchronizeTimer(timer, status, nowMs);
  if (synchronized.status !== "RUNNING") return synchronized;

  return {
    status: "PAUSED",
    timer: {
      ...timer,
      expectedEndAt: null,
      pausedAt: nowMs,
      remainingMsWhenPaused: getRemainingMs(timer, status, nowMs),
    },
  };
}

export function resumeTimer(
  timer: ExamTimerState,
  status: ExamStatus,
  nowMs: number,
): TimerSnapshot {
  if (status !== "PAUSED" || timer.remainingMsWhenPaused === null) {
    return { status, timer };
  }
  if (timer.remainingMsWhenPaused <= 0) {
    return synchronizeTimer(
      { ...timer, expectedEndAt: nowMs, pausedAt: null, remainingMsWhenPaused: null },
      "RUNNING",
      nowMs,
    );
  }

  return {
    status: "RUNNING",
    timer: {
      ...timer,
      expectedEndAt: nowMs + timer.remainingMsWhenPaused,
      pausedAt: null,
      remainingMsWhenPaused: null,
    },
  };
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, durationMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
