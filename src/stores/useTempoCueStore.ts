import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  OutputMessage,
  OutputMessageDraft,
  OutputState,
  RealtimeEvent,
  RundownTimingMode,
  RundownItem,
  ServerUrls,
  Snapshot,
  TimerState,
  TimerColorSettings,
} from "../types/timer";
import { createIdleTimer, DEFAULT_DURATION_MS, DEFAULT_TIMER_COLOR_SETTINGS, formatTimeInput } from "../lib/timer";

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
];

const fallbackOutput: OutputState = {
  live: false,
  blackout: false,
  hideTimer: false,
  message: null,
  activeItemId: "opening",
};

const fallbackMessageDraft: OutputMessageDraft = {
  title: "Next",
  body: "Please welcome the next speaker",
  formatting: {
    title: { bold: false, italic: false, color: "#ffffff" },
    body: { bold: true, italic: false, color: "#ffffff" },
  },
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
  setLive: (enabled: boolean) => Promise<void>;
  setTimerColorSettings: (settings: TimerColorSettings) => void;
  updateMessageDraft: (draft: OutputMessageDraft) => Promise<void>;
  showMessage: (message: OutputMessage) => Promise<void>;
  hideMessage: () => Promise<void>;
};

const canInvoke = "__TAURI_INTERNALS__" in window;
let activeSocket: WebSocket | null = null;
let pendingCommands: ClientCommand[] = [];

type ClientCommand =
  | { type: "timer/start" }
  | { type: "timer/pause" }
  | { type: "timer/reset" }
  | { type: "timer/add-time"; payload: { deltaMs: number } }
  | { type: "timer/set-duration"; payload: { durationMs: number } }
  | { type: "timer/set-remaining"; payload: { remainingMs: number } }
  | { type: "timer/set-end-time"; payload: { targetTime: string } }
  | { type: "rundown/select-item"; payload: { itemId: string } }
  | { type: "rundown/skip" }
  | {
      type: "rundown/create-item";
      payload: {
        title: string;
        speaker: string;
        durationMs: number;
        timingMode: RundownTimingMode;
        endTime: string | null;
        notes: string;
        supportingFiles: string[];
      };
    }
  | {
      type: "rundown/update-item";
      payload: {
        itemId: string;
        title: string;
        speaker: string;
        durationMs: number;
        timingMode: RundownTimingMode;
        endTime: string | null;
        notes: string;
        supportingFiles: string[];
      };
    }
  | { type: "rundown/delete-item"; payload: { itemId: string } }
  | { type: "output/blackout"; payload: { enabled: boolean } }
  | { type: "output/hide-timer"; payload: { enabled: boolean } }
  | { type: "output/live"; payload: { enabled: boolean } }
  | { type: "message/draft"; payload: OutputMessageDraft }
  | { type: "message/show"; payload: OutputMessage }
  | { type: "message/hide" };

export const useTempoCueStore = create<StoreState>((set) => ({
  timer: createIdleTimer(),
  rundown: fallbackRundown,
  output: fallbackOutput,
  messageDraft: fallbackMessageDraft,
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

    return sendRemoteCommand({ type: "rundown/create-item", payload: item });
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

    return sendRemoteCommand({ type: "rundown/update-item", payload: { ...item, itemId: item.id } });
  },

  deleteRundownItem: async (itemId: string) => {
    if (canInvoke) return invoke("delete_rundown_item", { itemId });
    return sendRemoteCommand({ type: "rundown/delete-item", payload: { itemId } });
  },

  startTimer: async () => {
    if (canInvoke) return invoke("start_timer");
    return sendRemoteCommand({ type: "timer/start" });
  },

  pauseTimer: async () => {
    if (canInvoke) return invoke("pause_timer");
    return sendRemoteCommand({ type: "timer/pause" });
  },

  resetTimer: async () => {
    if (canInvoke) return invoke("reset_timer");
    return sendRemoteCommand({ type: "timer/reset" });
  },

  addTime: async (deltaMs: number) => {
    if (canInvoke) return invoke("add_time", { deltaMs });
    return sendRemoteCommand({ type: "timer/add-time", payload: { deltaMs } });
  },

  setDuration: async (durationMs: number) => {
    if (canInvoke) return invoke("set_timer_duration", { durationMs });
    return sendRemoteCommand({ type: "timer/set-duration", payload: { durationMs } });
  },

  setRemaining: async (remainingMs: number) => {
    if (!canInvoke) {
      return sendRemoteCommand({ type: "timer/set-remaining", payload: { remainingMs } });
    }

    set((state) => {
      const now = Date.now() + state.clockOffsetMs;
      const timer = setTimerRemaining(state.timer, remainingMs, now);
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
                    endTime: formatTimeInput(timer.targetEndAtMs ?? now),
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
    return invoke("set_timer_remaining", { remainingMs });
  },

  setEndAtTime: async (targetTime: string) => {
    if (canInvoke) return invoke("set_timer_end_time", { targetTime });
    return sendRemoteCommand({ type: "timer/set-end-time", payload: { targetTime } });
  },

  selectRundownItem: async (itemId: string) => {
    if (canInvoke) return invoke("select_rundown_item", { itemId });
    return sendRemoteCommand({ type: "rundown/select-item", payload: { itemId } });
  },

  skipTimer: async () => {
    if (canInvoke) return invoke("skip_timer");
    return sendRemoteCommand({ type: "rundown/skip" });
  },

  setBlackout: async (enabled: boolean) => {
    if (canInvoke) return invoke("set_blackout", { enabled });
    return sendRemoteCommand({ type: "output/blackout", payload: { enabled } });
  },

  setHideTimer: async (enabled: boolean) => {
    if (canInvoke) return invoke("set_hide_timer", { enabled });
    return sendRemoteCommand({ type: "output/hide-timer", payload: { enabled } });
  },

  setLive: async (enabled: boolean) => {
    if (canInvoke) return invoke("set_live", { enabled });
    return sendRemoteCommand({ type: "output/live", payload: { enabled } });
  },

  setTimerColorSettings: (settings) => {
    const timerColorSettings = normalizeTimerColorSettings(settings);
    window.localStorage.setItem(timerColorSettingsKey, JSON.stringify(timerColorSettings));
    set({ timerColorSettings });
  },

  updateMessageDraft: async (draft: OutputMessageDraft) => {
    const messageDraft = normalizeMessageDraft(draft);
    set({ messageDraft });
    if (canInvoke) return invoke("update_message_draft", { draft: messageDraft });
    return sendRemoteCommand({ type: "message/draft", payload: messageDraft });
  },

  showMessage: async (message: OutputMessage) => {
    set((state) => ({ output: { ...state.output, message } }));
    if (canInvoke) return invoke("show_message", { message });
    return sendRemoteCommand({ type: "message/show", payload: message });
  },

  hideMessage: async () => {
    set((state) => ({ output: { ...state.output, message: null } }));
    if (canInvoke) return invoke("hide_message");
    return sendRemoteCommand({ type: "message/hide" });
  },
}));

function applySnapshot(snapshot: Snapshot, set: (state: Partial<StoreState>) => void) {
  set({
    ...snapshot,
    messageDraft: normalizeMessageDraft(snapshot.messageDraft ?? fallbackMessageDraft),
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
    set((state) => ({
      timer: event.payload,
      clockOffsetMs: event.payload.serverNowMs - Date.now(),
      timersByItem: {
        ...state.timersByItem,
        [state.output.activeItemId]: event.payload,
      },
    }));
    return;
  }

  if (event.type === "rundown/items") set({ rundown: event.payload });
  if (event.type === "rundown/active-item") {
    set((state) => ({ output: { ...state.output, activeItemId: event.payload.itemId } }));
  }
  if (event.type === "message/show") set((state) => ({ output: { ...state.output, message: event.payload } }));
  if (event.type === "message/draft") set({ messageDraft: normalizeMessageDraft(event.payload) });
  if (event.type === "message/hide") set((state) => ({ output: { ...state.output, message: null } }));
  if (event.type === "output/blackout") set((state) => ({ output: { ...state.output, blackout: event.payload.enabled } }));
  if (event.type === "output/hide-timer") set((state) => ({ output: { ...state.output, hideTimer: event.payload.enabled } }));
  if (event.type === "output/live") set((state) => ({ output: { ...state.output, live: event.payload.enabled } }));
}

function connectWebSocket(port: number, set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void) {
  if (activeSocket && activeSocket.readyState <= WebSocket.OPEN) return;

  const host = window.location.hostname || "127.0.0.1";
  const socket = new WebSocket(`ws://${host}:${port}/ws`);
  activeSocket = socket;
  socket.onopen = () => {
    set({ connected: true });
    flushPendingCommands(socket);
  };
  socket.onclose = () => {
    if (activeSocket === socket) activeSocket = null;
    set({ connected: false });
    window.setTimeout(() => connectWebSocket(port, set), 1000);
  };
  socket.onmessage = (event) => {
    applyRealtimeEvent(JSON.parse(event.data) as RealtimeEvent, set);
  };
}

function sendRemoteCommand(command: ClientCommand) {
  if (activeSocket?.readyState === WebSocket.OPEN) {
    activeSocket.send(JSON.stringify(command));
    return Promise.resolve();
  }

  pendingCommands.push(command);
  return Promise.resolve();
}

function flushPendingCommands(socket: WebSocket) {
  if (socket.readyState !== WebSocket.OPEN || pendingCommands.length === 0) return;

  const commands = pendingCommands;
  pendingCommands = [];
  for (const command of commands) {
    socket.send(JSON.stringify(command));
  }
}

function resolveRealtimePort() {
  const port = Number(window.location.port);
  if (!Number.isFinite(port) || port === 0 || port === 1420) return 4310;
  return port;
}

function normalizeMessageDraft(draft: OutputMessageDraft): OutputMessageDraft {
  return {
    title: draft.title,
    body: draft.body,
    formatting: {
      title: normalizeMessageTextStyle(draft.formatting?.title, fallbackMessageDraft.formatting.title),
      body: normalizeMessageTextStyle(draft.formatting?.body, fallbackMessageDraft.formatting.body),
    },
  };
}

function normalizeMessageTextStyle(
  style: Partial<OutputMessageDraft["formatting"]["title"]> | undefined,
  fallback: OutputMessageDraft["formatting"]["title"],
) {
  return {
    bold: Boolean(style?.bold),
    italic: Boolean(style?.italic),
    color: typeof style?.color === "string" && style.color ? style.color : fallback.color,
  };
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
