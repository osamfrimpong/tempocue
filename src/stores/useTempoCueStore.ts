import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  OutputMessage,
  OutputState,
  RealtimeEvent,
  RundownTimingMode,
  RundownItem,
  ServerUrls,
  Snapshot,
  TimerState,
  TimerColorSettings,
} from "../types/timer";
import { createIdleTimer, DEFAULT_DURATION_MS, DEFAULT_TIMER_COLOR_SETTINGS, formatTimeInput, targetTimeToMs } from "../lib/timer";

const fallbackHost = window.location.hostname || "localhost";
const fallbackLocalUrls = {
  control: "http://localhost:4310/control",
  viewer: "http://localhost:4310/viewer",
  obs: "http://localhost:4310/obs?transparent=true",
  lowerThird: "http://localhost:4310/lower-third",
  agenda: "http://localhost:4310/agenda",
};
const fallbackUrls: ServerUrls = {
  port: 4310,
  local: fallbackLocalUrls,
  network: fallbackHost === "localhost" || fallbackHost === "127.0.0.1" ? null : {
    control: `http://${fallbackHost}:4310/control`,
    viewer: `http://${fallbackHost}:4310/viewer`,
    obs: `http://${fallbackHost}:4310/obs?transparent=true`,
    lowerThird: `http://${fallbackHost}:4310/lower-third`,
    agenda: `http://${fallbackHost}:4310/agenda`,
  },
  networkHost: fallbackHost === "localhost" || fallbackHost === "127.0.0.1" ? null : fallbackHost,
  control: `http://${fallbackHost}:4310/control`,
  viewer: `http://${fallbackHost}:4310/viewer`,
  obs: `http://${fallbackHost}:4310/obs?transparent=true`,
  lowerThird: `http://${fallbackHost}:4310/lower-third`,
  agenda: `http://${fallbackHost}:4310/agenda`,
};

const fallbackRundown: RundownItem[] = [
  {
    id: "opening",
    title: "Opening Countdown",
    speaker: "Production",
    notes: "Confirm stream is live before zero.",
    supportingFiles: [],
    durationMs: DEFAULT_DURATION_MS,
    timingMode: "duration",
    endTime: null,
    color: "#3ddc97",
    completed: false,
  },
  {
    id: "welcome",
    title: "Welcome",
    speaker: "Host",
    notes: "Lower-third name graphic on cue.",
    supportingFiles: [],
    durationMs: 5 * 60 * 1000,
    timingMode: "duration",
    endTime: null,
    color: "#f5c542",
    completed: false,
  },
  {
    id: "main",
    title: "Main Segment",
    speaker: "Speaker",
    notes: "Warn at five minutes remaining.",
    supportingFiles: [],
    durationMs: 25 * 60 * 1000,
    timingMode: "duration",
    endTime: null,
    color: "#5cc8ff",
    completed: false,
  },
];

const fallbackOutput: OutputState = {
  blackout: false,
  hideTimer: false,
  message: null,
  activeItemId: "opening",
};

const timerColorSettingsKey = "tempocue.timerColorSettings";

type StoreState = Snapshot & {
  connected: boolean;
  clockOffsetMs: number;
  timersByItem: Record<string, TimerState>;
  timerColorSettings: TimerColorSettings;
  initialize: () => Promise<void>;
  createRundownItem: (item: { title: string; speaker: string; durationMs: number; timingMode: RundownTimingMode; endTime: string | null; notes: string; supportingFiles: string[] }) => Promise<void>;
  updateRundownItem: (item: { id: string; title: string; speaker: string; durationMs: number; timingMode: RundownTimingMode; endTime: string | null; notes: string; supportingFiles: string[] }) => Promise<void>;
  deleteRundownItem: (itemId: string) => Promise<void>;
  startTimer: () => Promise<void>;
  pauseTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  addTime: (deltaMs: number) => Promise<void>;
  setDuration: (durationMs: number) => Promise<void>;
  setRemaining: (remainingMs: number) => Promise<void>;
  setEndAtTime: (targetTime: string) => Promise<void>;
  selectRundownItem: (itemId: string) => Promise<void>;
  skipTimer: () => Promise<void>;
  setBlackout: (enabled: boolean) => Promise<void>;
  setHideTimer: (enabled: boolean) => Promise<void>;
  setTimerColorSettings: (settings: TimerColorSettings) => void;
  showMessage: (message: OutputMessage) => Promise<void>;
  hideMessage: () => Promise<void>;
};

const canInvoke = "__TAURI_INTERNALS__" in window;
let activeSocket: WebSocket | null = null;

export const useTempoCueStore = create<StoreState>((set, get) => ({
  timer: createIdleTimer(),
  rundown: fallbackRundown,
  output: fallbackOutput,
  urls: fallbackUrls,
  connected: false,
  clockOffsetMs: 0,
  timerColorSettings: readTimerColorSettings(),
  timersByItem: {
    opening: createIdleTimer(DEFAULT_DURATION_MS),
    welcome: createIdleTimer(5 * 60 * 1000),
    main: createIdleTimer(25 * 60 * 1000),
  },

  initialize: async () => {
    registerTimerColorStorageListener(set);

    if (!canInvoke) {
      connectWebSocket(resolveRealtimePort(), set);
      return;
    }

    const snapshot = await invoke<Snapshot>("get_snapshot");
    applySnapshot(snapshot, set);
    connectWebSocket(snapshot.urls.port, set);
  },

  createRundownItem: async (item) => {
    if (canInvoke) {
      await invoke<RundownItem>("create_rundown_item", {
        title: item.title,
        speaker: item.speaker,
        durationMs: item.durationMs,
        timingMode: item.timingMode,
        endTime: item.endTime,
        notes: item.notes,
        supportingFiles: item.supportingFiles,
      });
      return;
    }

    const newItem: RundownItem = {
      id: crypto.randomUUID(),
      title: item.title,
      speaker: item.speaker,
      notes: item.notes,
      supportingFiles: item.supportingFiles,
      durationMs: item.durationMs,
      timingMode: item.timingMode,
      endTime: item.endTime,
      color: nextItemColor(get().rundown.length),
      completed: false,
    };
    set((state) => ({
      rundown: [...state.rundown, newItem],
      timersByItem: {
        ...state.timersByItem,
        [state.output.activeItemId]: state.timer,
      },
    }));
  },

  updateRundownItem: async (item) => {
    if (canInvoke) {
      await invoke<RundownItem>("update_rundown_item", {
        itemId: item.id,
        title: item.title,
        speaker: item.speaker,
        durationMs: item.durationMs,
        timingMode: item.timingMode,
        endTime: item.endTime,
        notes: item.notes,
        supportingFiles: item.supportingFiles,
      });
      return;
    }

    set((state) => {
      const nextItem = {
        id: item.id,
        title: item.title,
        speaker: item.speaker,
        durationMs: item.durationMs,
        timingMode: item.timingMode,
        endTime: item.endTime,
        notes: item.notes,
        supportingFiles: item.supportingFiles,
      };
      const nextTimer = createTimerForRundownItem(nextItem, Date.now() + state.clockOffsetMs);
      const timer = item.id === state.output.activeItemId ? nextTimer : state.timer;
      return {
        rundown: state.rundown.map((rundownItem) =>
          rundownItem.id === item.id
            ? {
                ...rundownItem,
                title: item.title,
                speaker: item.speaker,
                durationMs: item.durationMs,
                timingMode: item.timingMode,
                endTime: item.endTime,
                notes: item.notes,
                supportingFiles: item.supportingFiles,
              }
            : rundownItem,
        ),
        timer,
        timersByItem: {
          ...state.timersByItem,
          [item.id]: nextTimer,
          ...(item.id === state.output.activeItemId ? { [item.id]: timer } : {}),
        },
      };
    });
  },

  deleteRundownItem: async (itemId: string) => {
    if (canInvoke) return invoke("delete_rundown_item", { itemId });
    set((state) => {
      if (state.rundown.length === 1) return {};

      const index = state.rundown.findIndex((item) => item.id === itemId);
      if (index === -1) return {};

      const rundown = state.rundown.filter((item) => item.id !== itemId);
      const timersByItem = { ...state.timersByItem };
      delete timersByItem[itemId];

      if (state.output.activeItemId !== itemId) {
        return { rundown, timersByItem };
      }

      const next = rundown[Math.min(index, rundown.length - 1)];
      const timer = timersByItem[next.id] ?? createTimerForRundownItem(next, Date.now() + state.clockOffsetMs);
      return {
        rundown,
        output: { ...state.output, activeItemId: next.id },
        timer,
        timersByItem: { ...timersByItem, [next.id]: timer },
      };
    });
  },

  startTimer: async () => {
    if (canInvoke) return invoke("start_timer");
    mutateLocalTimer(set, (timer) => {
      const now = Date.now();
      if (timer.status === "running") return timer;
      if (timer.status === "paused" && timer.pausedAtMs) {
        return {
          ...timer,
          status: "running",
          mode: timer.mode === "end-at-time" ? "end-at-time" : timer.mode,
          accumulatedPauseMs: timer.accumulatedPauseMs + now - timer.pausedAtMs,
          pausedAtMs: null,
          remainingAtPauseMs: null,
          serverNowMs: now,
        };
      }
      return {
        ...timer,
        status: "running",
        mode: timer.mode === "end-at-time" ? "end-at-time" : timer.mode,
        startedAtMs: now,
        pausedAtMs: null,
        accumulatedPauseMs: 0,
        remainingAtPauseMs: null,
        serverNowMs: now,
      };
    });
  },

  pauseTimer: async () => {
    if (canInvoke) return invoke("pause_timer");
    mutateLocalTimer(set, (timer) => {
      if (timer.status !== "running") return timer;
      const now = Date.now();
      const elapsed = now - (timer.startedAtMs ?? now) - timer.accumulatedPauseMs;
      const remaining =
        timer.mode === "end-at-time" && timer.targetEndAtMs !== null
          ? timer.targetEndAtMs - now
          : timer.mode === "countup"
            ? elapsed
            : timer.durationMs - elapsed;
      return {
        ...timer,
        status: "paused",
        pausedAtMs: now,
        remainingAtPauseMs: remaining,
        serverNowMs: now,
      };
    });
  },

  resetTimer: async () => {
    if (canInvoke) return invoke("reset_timer");
    const active = get().rundown.find((item) => item.id === get().output.activeItemId);
    const timer = active ? createTimerForRundownItem(active, Date.now() + get().clockOffsetMs) : createIdleTimer(DEFAULT_DURATION_MS);
    set((state) => ({
      timer,
      timersByItem: {
        ...state.timersByItem,
        [state.output.activeItemId]: timer,
      },
    }));
  },

  addTime: async (deltaMs: number) => {
    if (canInvoke) return invoke("add_time", { deltaMs });
    set((state) => {
      const timer = {
        ...state.timer,
        durationMs: Math.max(0, state.timer.durationMs + deltaMs),
        targetEndAtMs: state.timer.targetEndAtMs === null ? null : state.timer.targetEndAtMs + deltaMs,
      };
      const activeItem = state.rundown.find((item) => item.id === state.output.activeItemId);
      const shouldUpdateEndTime =
        activeItem?.timingMode === "end-time" &&
        timer.mode === "end-at-time" &&
        timer.targetEndAtMs !== null;

      return {
        timer,
        rundown: shouldUpdateEndTime
          ? state.rundown.map((item) =>
              item.id === state.output.activeItemId
                ? {
                    ...item,
                    durationMs: timer.durationMs,
                    endTime: formatTimeInput(timer.targetEndAtMs ?? Date.now()),
                  }
                : item,
            )
          : state.rundown,
        timersByItem: {
          ...state.timersByItem,
          [state.output.activeItemId]: timer,
        },
      };
    });
  },

  setDuration: async (durationMs: number) => {
    if (canInvoke) return invoke("set_timer_duration", { durationMs });
    mutateLocalTimer(set, (timer) => ({
      ...timer,
      mode: "countdown",
      durationMs,
      remainingAtPauseMs: durationMs,
      targetEndAtMs: null,
    }));
  },

  setRemaining: async (remainingMs: number) => {
    mutateLocalTimer(set, (timer) => setTimerRemaining(timer, remainingMs, Date.now() + get().clockOffsetMs));
    if (canInvoke) return invoke("set_timer_remaining", { remainingMs });
  },

  setEndAtTime: async (targetTime: string) => {
    if (canInvoke) return invoke("set_timer_end_time", { targetTime });
    mutateLocalTimer(set, (timer) => {
      const now = Date.now() + get().clockOffsetMs;
      const targetEndAtMs = targetTimeToMs(targetTime, now);
      if (targetEndAtMs === null) return timer;
      const durationMs = Math.max(0, targetEndAtMs - now);
      return {
        ...timer,
        mode: "end-at-time",
        status: "running",
        durationMs,
        startedAtMs: now,
        pausedAtMs: null,
        accumulatedPauseMs: 0,
        remainingAtPauseMs: null,
        targetEndAtMs,
        serverNowMs: now,
      };
    });
  },

  selectRundownItem: async (itemId: string) => {
    if (canInvoke) return invoke("select_rundown_item", { itemId });
    const active = get().rundown.find((item) => item.id === itemId);
    set((state) => ({
      output: { ...state.output, activeItemId: itemId },
      timer: state.timersByItem[itemId] ?? (active ? createTimerForRundownItem(active, Date.now() + state.clockOffsetMs) : createIdleTimer(DEFAULT_DURATION_MS)),
      timersByItem: {
        ...state.timersByItem,
        [state.output.activeItemId]: state.timer,
      },
    }));
  },

  skipTimer: async () => {
    if (canInvoke) return invoke("skip_timer");
    const { rundown, output } = get();
    const index = rundown.findIndex((item) => item.id === output.activeItemId);
    const next = rundown[Math.min(index + 1, rundown.length - 1)];
    if (next) await get().selectRundownItem(next.id);
  },

  setBlackout: async (enabled: boolean) => {
    if (canInvoke) return invoke("set_blackout", { enabled });
    set((state) => ({ output: { ...state.output, blackout: enabled } }));
  },

  setHideTimer: async (enabled: boolean) => {
    if (canInvoke) return invoke("set_hide_timer", { enabled });
    set((state) => ({ output: { ...state.output, hideTimer: enabled } }));
  },

  setTimerColorSettings: (settings) => {
    const timerColorSettings = normalizeTimerColorSettings(settings);
    window.localStorage.setItem(timerColorSettingsKey, JSON.stringify(timerColorSettings));
    set({ timerColorSettings });
  },

  showMessage: async (message: OutputMessage) => {
    if (canInvoke) return invoke("show_message", { message });
    set((state) => ({ output: { ...state.output, message } }));
  },

  hideMessage: async () => {
    if (canInvoke) return invoke("hide_message");
    set((state) => ({ output: { ...state.output, message: null } }));
  },
}));

function applySnapshot(snapshot: Snapshot, set: (state: Partial<StoreState>) => void) {
  set({
    ...snapshot,
    connected: true,
    clockOffsetMs: snapshot.timer.serverNowMs - Date.now(),
  });
}

function applyRealtimeEvent(event: RealtimeEvent, set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void) {
  if (event.type === "snapshot") {
    applySnapshot(event.payload, set);
    return;
  }

  if (event.type === "timer/state") {
    set({ timer: event.payload, clockOffsetMs: event.payload.serverNowMs - Date.now() });
    return;
  }

  if (event.type === "rundown/items") set({ rundown: event.payload });
  if (event.type === "rundown/active-item") {
    set((state) => ({ output: { ...state.output, activeItemId: event.payload.itemId } }));
  }
  if (event.type === "message/show") set((state) => ({ output: { ...state.output, message: event.payload } }));
  if (event.type === "message/hide") set((state) => ({ output: { ...state.output, message: null } }));
  if (event.type === "output/blackout") set((state) => ({ output: { ...state.output, blackout: event.payload.enabled } }));
  if (event.type === "output/hide-timer") set((state) => ({ output: { ...state.output, hideTimer: event.payload.enabled } }));
}

function connectWebSocket(port: number, set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void) {
  if (activeSocket && activeSocket.readyState <= WebSocket.OPEN) return;

  const host = window.location.hostname || "127.0.0.1";
  const socket = new WebSocket(`ws://${host}:${port}/ws`);
  activeSocket = socket;
  socket.onopen = () => set({ connected: true });
  socket.onclose = () => {
    if (activeSocket === socket) activeSocket = null;
    set({ connected: false });
    window.setTimeout(() => connectWebSocket(port, set), 1000);
  };
  socket.onmessage = (event) => {
    applyRealtimeEvent(JSON.parse(event.data) as RealtimeEvent, set);
  };
}

function resolveRealtimePort() {
  const port = Number(window.location.port);
  if (!Number.isFinite(port) || port === 0 || port === 1420) return 4310;
  return port;
}

function mutateLocalTimer(set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void, updater: (timer: TimerState) => TimerState) {
  set((state) => {
    const timer = updater(state.timer);
    return {
      timer,
      timersByItem: {
        ...state.timersByItem,
        [state.output.activeItemId]: timer,
      },
    };
  });
}

function setTimerRemaining(timer: TimerState, remainingMs: number, now: number): TimerState {
  const remaining = Math.min(timer.durationMs, Math.max(0, Math.round(remainingMs)));

  if (timer.mode === "end-at-time") {
    return {
      ...timer,
      durationMs: Math.max(timer.durationMs, remaining),
      targetEndAtMs: now + remaining,
      remainingAtPauseMs: timer.status === "paused" ? remaining : null,
      serverNowMs: now,
    };
  }

  if (timer.mode !== "countdown") return timer;

  if (timer.status === "running") {
    return {
      ...timer,
      startedAtMs: now - (timer.durationMs - remaining),
      accumulatedPauseMs: 0,
      pausedAtMs: null,
      remainingAtPauseMs: null,
      serverNowMs: now,
    };
  }

  return {
    ...timer,
    status: timer.status === "idle" ? "paused" : timer.status,
    startedAtMs: timer.status === "idle" ? now - (timer.durationMs - remaining) : timer.startedAtMs,
    pausedAtMs: timer.status === "idle" ? now : timer.pausedAtMs,
    accumulatedPauseMs: timer.status === "idle" ? 0 : timer.accumulatedPauseMs,
    remainingAtPauseMs: remaining,
    serverNowMs: now,
  };
}

function createTimerForRundownItem(
  item: Pick<RundownItem, "durationMs" | "timingMode" | "endTime">,
  now: number,
): TimerState {
  const timer = createIdleTimer(item.durationMs);
  if (item.timingMode !== "end-time" || !item.endTime) return timer;

  const targetEndAtMs = targetTimeToMs(item.endTime, now);
  if (targetEndAtMs === null) return timer;

  return {
    ...timer,
    mode: "end-at-time",
    status: "idle",
    durationMs: Math.max(0, targetEndAtMs - now),
    startedAtMs: null,
    pausedAtMs: null,
    accumulatedPauseMs: 0,
    remainingAtPauseMs: null,
    targetEndAtMs,
    serverNowMs: now,
  };
}

function nextItemColor(index: number) {
  const colors = ["#3ddc97", "#f5c542", "#5cc8ff", "#ff7a59", "#b48cff", "#f25f8c"];
  return colors[index % colors.length];
}

function readTimerColorSettings() {
  try {
    const raw = window.localStorage.getItem(timerColorSettingsKey);
    if (!raw) return DEFAULT_TIMER_COLOR_SETTINGS;
    return normalizeTimerColorSettings(JSON.parse(raw) as Partial<TimerColorSettings>);
  } catch {
    return DEFAULT_TIMER_COLOR_SETTINGS;
  }
}

function normalizeTimerColorSettings(settings: Partial<TimerColorSettings>) {
  const yellowThresholdMs = Number(settings.yellowThresholdMs);
  const redThresholdMs = Number(settings.redThresholdMs);

  return {
    yellowThresholdMs: Number.isFinite(yellowThresholdMs)
      ? Math.max(0, Math.round(yellowThresholdMs))
      : DEFAULT_TIMER_COLOR_SETTINGS.yellowThresholdMs,
    redThresholdMs: Number.isFinite(redThresholdMs)
      ? Math.max(0, Math.round(redThresholdMs))
      : DEFAULT_TIMER_COLOR_SETTINGS.redThresholdMs,
  };
}

let timerColorStorageListenerRegistered = false;

function registerTimerColorStorageListener(set: (state: Partial<StoreState>) => void) {
  if (timerColorStorageListenerRegistered) return;
  timerColorStorageListenerRegistered = true;

  window.addEventListener("storage", (event) => {
    if (event.key === timerColorSettingsKey) {
      set({ timerColorSettings: readTimerColorSettings() });
    }
  });
}
