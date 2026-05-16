import type { TimerColorSettings, TimerState } from "../types/timer";

export const DEFAULT_DURATION_MS = 10 * 60 * 1000;
export const DEFAULT_TIMER_COLOR_SETTINGS: TimerColorSettings = {
  yellowThresholdMs: 5 * 60 * 1000,
  redThresholdMs: 60 * 1000,
};

export const TIMER_COLORS = {
  green: "#22c55e",
  yellow: "#facc15",
  red: "#f87171",
} as const;

export function createIdleTimer(durationMs = DEFAULT_DURATION_MS): TimerState {
  return {
    id: "active",
    mode: "countdown",
    status: "idle",
    durationMs,
    startedAtMs: null,
    pausedAtMs: null,
    accumulatedPauseMs: 0,
    remainingAtPauseMs: null,
    targetEndAtMs: null,
    serverNowMs: Date.now(),
    overtimeBehavior: "continue",
  };
}

export function getRemainingMs(state: TimerState, nowMs: number) {
  if (state.mode === "clock") return 0;
  if (state.mode === "end-at-time" && state.status !== "paused" && state.targetEndAtMs !== null) {
    return state.targetEndAtMs - nowMs;
  }
  if (state.status === "idle") return state.durationMs;
  if (state.status === "paused") return state.remainingAtPauseMs ?? state.durationMs;
  if (state.status === "finished") return 0;
  if (!state.startedAtMs) return state.durationMs;

  const elapsed = nowMs - state.startedAtMs - state.accumulatedPauseMs;
  if (state.mode === "countup") return elapsed;
  return state.durationMs - elapsed;
}

export function formatTimer(ms: number, mode: TimerState["mode"] = "countdown") {
  if (mode === "clock") {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
  }

  const negative = ms < 0;
  const absoluteMs = Math.abs(ms);
  const totalSeconds = Math.floor(absoluteMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const value =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;

  return negative ? `+${value}` : value;
}

export function getTimerColor(
  remainingMs: number,
  mode: TimerState["mode"],
  settings: TimerColorSettings = DEFAULT_TIMER_COLOR_SETTINGS,
) {
  const showsCountdown = mode === "countdown" || mode === "end-at-time";
  if (!showsCountdown) return undefined;
  if (remainingMs <= settings.redThresholdMs) return TIMER_COLORS.red;
  if (remainingMs <= settings.yellowThresholdMs) return TIMER_COLORS.yellow;
  return TIMER_COLORS.green;
}

export function formatDurationInput(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:00` : `${minutes}:00`;
}

export function parseDuration(input: string) {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const textMatch = value.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/);
  if (textMatch && (textMatch[1] || textMatch[2] || textMatch[3])) {
    const hours = Number(textMatch[1] ?? 0);
    const minutes = Number(textMatch[2] ?? 0);
    const seconds = Number(textMatch[3] ?? 0);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  const parts = value.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000;
  if (parts.length === 1) return parts[0] * 60 * 1000;
  return null;
}

export function targetTimeToMs(input: string, nowMs: number) {
  const match = input.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const target = new Date(nowMs);
  target.setHours(hours, minutes, seconds, 0);
  if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
  return target.getTime();
}

export function formatTimeInput(ms: number) {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}
