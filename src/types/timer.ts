export type TimerStatus = "idle" | "running" | "paused" | "finished";
export type TimerMode = "countdown" | "countup" | "clock" | "end-at-time";
export type RundownTimingMode = "duration" | "end-time";

export type OvertimeBehavior = "continue" | "stop" | "hide" | "auto-next";

export type TimerColorSettings = {
  yellowThresholdMs: number;
  redThresholdMs: number;
};

export type TimerState = {
  id: string;
  mode: TimerMode;
  status: TimerStatus;
  durationMs: number;
  startedAtMs: number | null;
  pausedAtMs: number | null;
  accumulatedPauseMs: number;
  remainingAtPauseMs: number | null;
  targetEndAtMs: number | null;
  serverNowMs: number;
  overtimeBehavior: OvertimeBehavior;
};

export type RundownItem = {
  id: string;
  title: string;
  speaker: string;
  notes: string;
  supportingFiles: string[];
  durationMs: number;
  timingMode: RundownTimingMode;
  endTime: string | null;
  color: string;
  completed: boolean;
};

export type OutputMessage = {
  id: string;
  type: "fullscreen" | "lower-third" | "emergency" | "announcement";
  body: string;
  formatting?: OutputMessageFormatting | null;
  flashing?: boolean;
  visible: boolean;
  target: "viewer" | "obs" | "all";
};

export type OutputMessageFormatting = {
  body: OutputMessageTextStyle;
};

export type OutputMessageDraft = {
  body: string;
  formatting: OutputMessageFormatting;
};

export type OutputMessageTextStyle = {
  bold: boolean;
  italic: boolean;
  color: string;
};

export type OutputState = {
  live: boolean;
  blackout: boolean;
  hideTimer: boolean;
  message: OutputMessage | null;
  activeItemId: string;
};

export type UrlSet = {
  control: string;
  viewer: string;
  obs: string;
  lowerThird: string;
  agenda: string;
};

export type ServerUrls = UrlSet & {
  port: number;
  local: UrlSet;
  network: UrlSet | null;
  networkHost: string | null;
};

export type Snapshot = {
  timer: TimerState;
  rundown: RundownItem[];
  output: OutputState;
  messageDraft: OutputMessageDraft;
  urls: ServerUrls;
};

export type RealtimeEvent =
  | { type: "snapshot"; payload: Snapshot }
  | { type: "timer/state"; payload: TimerState }
  | { type: "rundown/items"; payload: RundownItem[] }
  | { type: "rundown/active-item"; payload: { itemId: string } }
  | { type: "message/show"; payload: OutputMessage }
  | { type: "message/draft"; payload: OutputMessageDraft }
  | { type: "message/hide"; payload: { id: string } }
  | { type: "output/blackout"; payload: { enabled: boolean } }
  | { type: "output/hide-timer"; payload: { enabled: boolean } }
  | { type: "output/live"; payload: { enabled: boolean } };
