import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { Link } from "react-router-dom";
import { TimePicker } from "@asphalt-react/time-picker";
import {
  Ban,
  Bold,
  ChevronDown,
  Clock,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  FileText,
  Heart,
  Image,
  Italic,
  MessageSquare,
  Minus,
  Palette,
  Paperclip,
  Pencil,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings,
  SkipForward,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import { TimerDisplay } from "../../components/timer/TimerDisplay";
import { FormattedMessage } from "../../components/layout/FormattedMessage";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useTicker } from "../../hooks/useTicker";
import { useTempoCueStore } from "../../stores/useTempoCueStore";
import { formatDurationInput, formatTimeInput, parseDuration, targetTimeToMs } from "../../lib/timer";
import type { OutputMessage, OutputMessageTextStyle, RundownItem } from "../../types/timer";

type ItemDialogMode = "create" | "edit";
type ItemTimingMode = "duration" | "end-time";

export function Controller() {
  const initialize = useTempoCueStore((state) => state.initialize);
  const timer = useTempoCueStore((state) => state.timer);
  const rundown = useTempoCueStore((state) => state.rundown);
  const output = useTempoCueStore((state) => state.output);
  const messageDraft = useTempoCueStore((state) => state.messageDraft);
  const urls = useTempoCueStore((state) => state.urls);
  const connected = useTempoCueStore((state) => state.connected);
  const clockOffsetMs = useTempoCueStore((state) => state.clockOffsetMs);
  const startTimer = useTempoCueStore((state) => state.startTimer);
  const pauseTimer = useTempoCueStore((state) => state.pauseTimer);
  const resetTimer = useTempoCueStore((state) => state.resetTimer);
  const addTime = useTempoCueStore((state) => state.addTime);
  const setRemaining = useTempoCueStore((state) => state.setRemaining);
  const skipTimer = useTempoCueStore((state) => state.skipTimer);
  const selectRundownItem = useTempoCueStore((state) => state.selectRundownItem);
  const createRundownItem = useTempoCueStore((state) => state.createRundownItem);
  const updateRundownItem = useTempoCueStore((state) => state.updateRundownItem);
  const deleteRundownItem = useTempoCueStore((state) => state.deleteRundownItem);
  const setBlackout = useTempoCueStore((state) => state.setBlackout);
  const setHideTimer = useTempoCueStore((state) => state.setHideTimer);
  const setLive = useTempoCueStore((state) => state.setLive);
  const updateMessageDraft = useTempoCueStore((state) => state.updateMessageDraft);
  const showMessage = useTempoCueStore((state) => state.showMessage);
  const hideMessage = useTempoCueStore((state) => state.hideMessage);
  const now = useTicker(100) + clockOffsetMs;
  const [newTitle, setNewTitle] = useState("");
  const [newDuration, setNewDuration] = useState("10:00");
  const [newEndTime, setNewEndTime] = useState(formatTimeInput(now));
  const [itemTimingMode, setItemTimingMode] = useState<ItemTimingMode>("duration");
  const [newNotes, setNewNotes] = useState("");
  const [itemDialogMode, setItemDialogMode] = useState<ItemDialogMode | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<RundownItem | null>(null);
  const [localUrlsExpanded, setLocalUrlsExpanded] = useState(false);
  const previousNetworkHost = useRef<string | null>(null);
  const [networkChanged, setNetworkChanged] = useState(false);

  useKeyboardShortcuts();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (previousNetworkHost.current !== null && previousNetworkHost.current !== urls.networkHost) {
      setNetworkChanged(true);
      const timeout = window.setTimeout(() => setNetworkChanged(false), 5000);
      previousNetworkHost.current = urls.networkHost;
      return () => window.clearTimeout(timeout);
    }

    previousNetworkHost.current = urls.networkHost;
  }, [urls.networkHost]);

  const activeIndex = useMemo(
    () => rundown.findIndex((item) => item.id === output.activeItemId),
    [output.activeItemId, rundown],
  );
  const active = rundown[activeIndex] ?? rundown[0];
  const next = rundown[activeIndex + 1];
  const timerIsRunning = timer.status === "running";
  const isLive = output.live;
  const outputStatusLabel = !isLive ? "Output inactive" : output.blackout ? "Blackout" : "Output active";
  const controllerTimerLabel = active?.timingMode === "end-time" ? "End at" : "Duration";
  const controllerTimerValue =
    active?.timingMode === "end-time" && active.endTime
      ? formatDisplayTime(timeInputToDate(active.endTime, now).getTime())
      : formatDurationInput(timer.durationMs);
  const itemDurationMs =
    itemTimingMode === "duration"
      ? parseDuration(newDuration)
      : newEndTime
        ? (() => {
            const targetMs = targetTimeToMs(newEndTime, now);
            return targetMs === null ? null : Math.max(0, targetMs - now);
          })()
        : null;
  const itemCanSave = Boolean(newTitle.trim()) && itemDurationMs !== null;
  const networkStatusLabel = networkChanged
    ? "Network changed: URLs updated"
    : urls.network
      ? `Network available: ${urls.networkHost}`
      : "Offline: local-only URLs active";

  const sendMessage = () => {
    const message: OutputMessage = {
      id: createMessageId(),
      type: "lower-third",
      body: messageDraft.body,
      formatting: messageDraft.formatting,
      flashing: false,
      visible: true,
      target: "all",
    };
    void showMessage(message);
  };

  const toggleMessageFlash = () => {
    if (!output.message) return;
    void showMessage({ ...output.message, flashing: !output.message.flashing });
  };

  const updateMessageStyle = (updater: (style: OutputMessageTextStyle) => OutputMessageTextStyle) => {
    void updateMessageDraft({
      ...messageDraft,
      formatting: { ...messageDraft.formatting, body: updater(messageDraft.formatting.body) },
    });
  };

  const closeItemDialog = () => {
    setItemDialogMode(null);
    setEditingItemId(null);
    setNewTitle("");
    setNewDuration("10:00");
    setNewEndTime(formatTimeInput(now));
    setItemTimingMode("duration");
    setNewNotes("");
  };

  const openCreateDialog = () => {
    setNewTitle("");
    setNewDuration("10:00");
    setNewEndTime(formatTimeInput(now));
    setItemTimingMode("duration");
    setNewNotes("");
    setEditingItemId(null);
    setItemDialogMode("create");
  };

  const openEditDialog = (item: RundownItem) => {
    setNewTitle(item.title);
    setNewDuration(formatDurationInput(item.durationMs));
    setNewEndTime(item.endTime ?? formatTimeInput(now));
    setItemTimingMode(item.timingMode);
    setNewNotes(item.notes);
    setEditingItemId(item.id);
    setItemDialogMode("edit");
  };

  const saveRundownItem = () => {
    const title = newTitle.trim();
    if (!title || itemDurationMs === null) return;
    const existingItem = editingItemId ? rundown.find((item) => item.id === editingItemId) : null;

    if (itemDialogMode === "edit" && editingItemId) {
      void updateRundownItem({
        id: editingItemId,
        title,
        speaker: existingItem?.speaker ?? "",
        durationMs: itemDurationMs,
        timingMode: itemTimingMode,
        endTime: itemTimingMode === "end-time" ? newEndTime : null,
        notes: newNotes.trim(),
        supportingFiles: existingItem?.supportingFiles ?? [],
      });
    } else {
      void createRundownItem({
        title,
        speaker: "",
        durationMs: itemDurationMs,
        timingMode: itemTimingMode,
        endTime: itemTimingMode === "end-time" ? newEndTime : null,
        notes: newNotes.trim(),
        supportingFiles: [],
      });
    }
    closeItemDialog();
  };

  const confirmDeleteRundownItem = () => {
    if (!deleteCandidate) return;
    void deleteRundownItem(deleteCandidate.id);
    setDeleteCandidate(null);
  };

  const openTimePickerFromField = (event: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const button = event.currentTarget.querySelector<HTMLButtonElement>('[data-testid="time-button"]');
    button?.click();
  };

  return (
    <main className="flex h-dvh w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5 lg:h-16 lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">TempoCue</div>
            <div className="truncate text-xs text-muted-foreground">Offline production timer</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:gap-3 lg:flex-none">
          <Button className="min-w-0" disabled={isLive} onClick={() => void setLive(true)}>
            <Radio className="h-4 w-4" />
            Go Live
          </Button>
          {isLive && (
            <Button className="min-w-0" variant="destructive" onClick={() => void setLive(false)}>
              <Square className="h-4 w-4" />
              End Live
            </Button>
          )}
          <Badge variant={connected ? "default" : "outline"}>{connected ? "WebSocket live" : "Local preview"}</Badge>
          <Badge variant={isLive && output.blackout ? "danger" : isLive ? "default" : "outline"}>{outputStatusLabel}</Badge>
          <Link
            to="/settings"
            className="grid h-10 w-10 place-items-center rounded-md hover:bg-accent"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(18rem,22rem)] lg:gap-4 lg:overflow-hidden lg:p-4">
        <section className="flex min-w-0 flex-col rounded-md border border-border bg-card lg:min-h-0 lg:overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="text-sm font-semibold uppercase text-muted-foreground">Rundown</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className="text-xl font-semibold">Main Show</div>
              <Button variant="secondary" size="icon" aria-label="Add item" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid max-h-80 min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3 lg:max-h-none">
            {rundown.map((item, index) => {
              const isActiveItem = item.id === output.activeItemId;
              const itemSelectionDisabled = timerIsRunning && !isActiveItem;
              const activeItemActionDisabled = timerIsRunning && isActiveItem;

              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-[6px_1fr_auto] items-center gap-3 rounded-md border p-3 transition-colors ${
                    isActiveItem ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent"
                  }`}
                >
                  <span className="h-full min-h-14 rounded-full" style={{ backgroundColor: item.color }} />
                  <button
                    className={`min-w-0 text-left ${
                      itemSelectionDisabled ? "cursor-not-allowed text-muted-foreground/70" : ""
                    }`}
                    disabled={itemSelectionDisabled}
                    onClick={() => void selectRundownItem(item.id)}
                  >
                    <span className="block text-sm text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block truncate text-sm text-muted-foreground">{item.speaker}</span>
                  </button>
                  <div className="grid justify-items-end gap-2">
                    <span className="font-mono text-sm tabular-nums">{Math.round(item.durationMs / 60000)}m</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${item.title}`}
                        disabled={activeItemActionDisabled}
                        onClick={() => openEditDialog(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${item.title}`}
                        disabled={activeItemActionDisabled || rundown.length === 1}
                        onClick={() => setDeleteCandidate(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid min-w-0 gap-3 lg:gap-4 lg:overflow-hidden">
          <div className="min-w-0 rounded-md border border-border bg-card p-4 lg:overflow-y-auto lg:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <div className="text-sm uppercase text-muted-foreground">Active item</div>
                <h1 className="mt-1 break-words text-2xl font-semibold sm:text-3xl">{active?.title}</h1>
                <div className="mt-1 text-muted-foreground">{active?.speaker}</div>
              </div>
              {next && (
                <Badge className="max-w-full" variant="outline">
                  Next: {next.title}
                </Badge>
              )}
            </div>
            {active?.supportingFiles?.length ? (
              <div className="mt-4 grid gap-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Paperclip className="h-4 w-4" />
                  Supporting files
                </div>
                <div className="flex flex-wrap gap-2">
                  {active.supportingFiles.map((file, index) => (
                    <SupportingFileLink
                      key={`${file}-${index}`}
                      file={file}
                      itemId={active.id}
                      index={index}
                      serverBaseUrl={urls.control}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid min-h-52 min-w-0 place-items-center gap-5 py-5 text-center sm:min-h-64 lg:min-h-80">
              {output.message && (
                <FormattedMessage
                  message={output.message}
                  className={output.message.flashing ? "message-flash" : undefined}
                  bodyClassName="text-3xl font-bold sm:text-4xl"
                />
              )}
              <TimerDisplay timer={timer} nowMs={now} onRemainingChange={(remainingMs) => void setRemaining(remainingMs)} />
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid min-w-0 gap-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">{controllerTimerLabel}</div>
                <div
                  className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground tabular-nums"
                  aria-label={controllerTimerLabel}
                >
                  {controllerTimerValue}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-0 sm:flex sm:flex-wrap xl:flex-nowrap xl:pt-6">
                <Button
                  className="min-w-0 px-3 sm:px-4"
                  onClick={() => void (timer.status === "running" ? pauseTimer() : startTimer())}
                >
                  {timer.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {timer.status === "running" ? "Pause" : "Start"}
                </Button>
                <Button className="min-w-0 px-3 sm:px-4" variant="secondary" onClick={() => void resetTimer()}>
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                <Button
                  className="min-w-0 px-3 sm:px-4"
                  variant="secondary"
                  disabled={timerIsRunning}
                  onClick={() => void skipTimer()}
                >
                  <SkipForward className="h-4 w-4" />
                  Next
                </Button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button className="min-w-0 px-3 sm:px-4" variant="outline" onClick={() => void addTime(60_000)}>
                <Plus className="h-4 w-4" />
                1 min
              </Button>
              <Button className="min-w-0 px-3 sm:px-4" variant="outline" onClick={() => void addTime(-60_000)}>
                <Minus className="h-4 w-4" />
                1 min
              </Button>
              <Button
                className="min-w-0 px-3 sm:px-4"
                variant={output.blackout ? "destructive" : "outline"}
                onClick={() => void setBlackout(!output.blackout)}
              >
                <Ban className="h-4 w-4" />
                Blackout
              </Button>
              <Button
                className="min-w-0 px-3 sm:px-4"
                variant={output.hideTimer ? "destructive" : "outline"}
                onClick={() => void setHideTimer(!output.hideTimer)}
              >
                <EyeOff className="h-4 w-4" />
                Hide timer
              </Button>
            </div>
          </div>
        </section>

        <section className="grid min-w-0 content-start gap-3 lg:gap-4 lg:overflow-y-auto">
          <div className="min-w-0 rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
              <MessageSquare className="h-4 w-4" />
              Messages
            </div>
            <div className="grid gap-3">
              <Textarea
                aria-label="Message body"
                value={messageDraft.body}
                onChange={(event) => void updateMessageDraft({ ...messageDraft, body: event.target.value })}
              />
              <MessageFormatControls
                label="Body style"
                style={messageDraft.formatting.body}
                onChange={updateMessageStyle}
              />
              <div className="grid grid-cols-3 gap-2 sm:flex">
                <Button className="min-w-0 px-3 sm:px-4" onClick={sendMessage} disabled={Boolean(output.message)}>
                  Show
                </Button>
                {output.message && (
                  <Button
                    className="min-w-0 px-3 sm:px-4"
                    variant={output.message.flashing ? "default" : "outline"}
                    onClick={toggleMessageFlash}
                  >
                    <Zap className="h-4 w-4" />
                    {output.message.flashing ? "Stop flash" : "Flash"}
                  </Button>
                )}
                <Button className="min-w-0 px-3 sm:px-4" variant="secondary" onClick={() => void hideMessage()}>
                  Hide
                </Button>
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-md border border-border bg-card p-4">
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              aria-expanded={localUrlsExpanded}
              onClick={() => setLocalUrlsExpanded((expanded) => !expanded)}
            >
              <span className="flex items-center gap-2">
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${localUrlsExpanded ? "" : "-rotate-90"}`}
                />
                <span className="text-sm font-semibold uppercase text-muted-foreground">Local URLs</span>
              </span>
              <Badge variant={urls.network ? "default" : "outline"}>{networkStatusLabel}</Badge>
            </button>
            {localUrlsExpanded && (
              <div className="mt-3">
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">This computer</div>
                <UrlRow label="Controller" value={urls.local.control} disabled={!isLive} />
                <UrlRow label="Viewer" value={urls.local.viewer} disabled={!isLive} />
                <UrlRow label="OBS" value={urls.local.obs} disabled={!isLive} />
                <UrlRow label="Lower third" value={urls.local.lowerThird} disabled={!isLive} />
                <UrlRow label="Agenda" value={urls.local.agenda} disabled={!isLive} />
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Network devices</div>
                  {urls.network ? (
                    <>
                      <UrlRow label="Controller" value={urls.network.control} disabled={!isLive} />
                      <UrlRow label="Viewer" value={urls.network.viewer} disabled={!isLive} />
                      <UrlRow label="OBS" value={urls.network.obs} disabled={!isLive} />
                      <UrlRow label="Lower third" value={urls.network.lowerThird} disabled={!isLive} />
                      <UrlRow label="Agenda" value={urls.network.agenda} disabled={!isLive} />
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      Network unavailable
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3 text-sm text-muted-foreground sm:px-5 lg:h-14 lg:flex-nowrap lg:py-0">
        <span className="min-w-0 truncate">Space start/pause · R reset · N next · B blackout · +/- adjust time · Esc clear message</span>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          Made with <Heart className="h-3.5 w-3.5 fill-current text-destructive" aria-label="love" /> by Schandorf
          Osam-Frimpong
        </span>
        <span className="shrink-0">Server port {urls.port}</span>
      </footer>

      {itemDialogMode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold uppercase text-muted-foreground">Rundown item</div>
                <div className="mt-1 text-2xl font-semibold">{itemDialogMode === "edit" ? "Edit item" : "Add item"}</div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={closeItemDialog}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3">
              <Input
                autoFocus
                aria-label="Item title"
                placeholder="Item title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
              />
              <div className="flex rounded-md border border-border bg-background p-1">
                <button
                  type="button"
                  className={`h-9 flex-1 rounded px-3 text-sm font-medium ${
                    itemTimingMode === "duration" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  }`}
                  onClick={() => setItemTimingMode("duration")}
                >
                  Duration
                </button>
                <button
                  type="button"
                  className={`h-9 flex-1 rounded px-3 text-sm font-medium ${
                    itemTimingMode === "end-time" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  }`}
                  onClick={() => {
                    setNewEndTime(formatTimeInput(now));
                    setItemTimingMode("end-time");
                  }}
                >
                  End time
                </button>
              </div>
              {itemTimingMode === "duration" ? (
                <Input
                  aria-label="Duration"
                  placeholder="Duration"
                  value={newDuration}
                  onChange={(event) => setNewDuration(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveRundownItem();
                  }}
                />
              ) : (
                <div onMouseDown={openTimePickerFromField} onTouchStart={openTimePickerFromField}>
                  <TimePicker
                    aria-label="End time"
                    value={[timeInputToDate(newEndTime, now)]}
                    onChange={(time) => {
                      const selected = time[0];
                      if (selected instanceof Date) setNewEndTime(formatTimeInput(selected.getTime()));
                    }}
                    onError={() => false}
                    minuteStep={1}
                    native={false}
                    stretch
                    timeIconLabel="Select end time"
                  />
                </div>
              )}
              <Textarea
                aria-label="Notes"
                placeholder="Notes"
                value={newNotes}
                onChange={(event) => setNewNotes(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.metaKey) saveRundownItem();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeItemDialog}>
                  Cancel
                </Button>
                <Button onClick={saveRundownItem} disabled={!itemCanSave}>
                  {itemDialogMode === "edit" ? "Save changes" : "Add item"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-rundown-item-title"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 shadow-2xl">
            <div className="text-sm font-semibold uppercase text-muted-foreground">Delete item</div>
            <div id="delete-rundown-item-title" className="mt-1 text-xl font-semibold">
              Delete {deleteCandidate.title}?
            </div>
            <p className="mt-3 text-sm text-muted-foreground">This removes the rundown item and its timer state.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteCandidate(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDeleteRundownItem}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function MessageFormatControls({
  label,
  style,
  onChange,
}: {
  label: string;
  style: OutputMessageTextStyle;
  onChange: (updater: (style: OutputMessageTextStyle) => OutputMessageTextStyle) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={style.bold ? "default" : "outline"}
          size="icon"
          aria-label={`${label} bold`}
          title="Bold"
          onClick={() => onChange((current) => ({ ...current, bold: !current.bold }))}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant={style.italic ? "default" : "outline"}
          size="icon"
          aria-label={`${label} italic`}
          title="Italic"
          onClick={() => onChange((current) => ({ ...current, italic: !current.italic }))}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <label className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors hover:bg-accent">
          <Palette className="h-4 w-4 shrink-0" />
          <span className="shrink-0">Colour</span>
          <Input
            aria-label={`${label} colour`}
            type="color"
            className="h-7 w-8 shrink-0 rounded border-0 bg-transparent p-0"
            value={style.color}
            onChange={(event) => onChange((current) => ({ ...current, color: event.target.value }))}
          />
          <span className="min-w-0 font-mono text-xs uppercase text-muted-foreground">{style.color}</span>
        </label>
      </div>
    </div>
  );
}

function SupportingFileLink({
  file,
  itemId,
  index,
  serverBaseUrl,
}: {
  file: string;
  itemId: string;
  index: number;
  serverBaseUrl: string;
}) {
  const href = getSupportingFileHref(file, itemId, index, serverBaseUrl);
  const label = getSupportingFileLabel(file);
  const browserViewable = isBrowserViewableFile(file);
  const Icon = browserViewable === "image" ? Image : browserViewable === "pdf" ? FileText : ExternalLink;

  return (
    <a
      className="inline-flex h-9 max-w-full items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors hover:bg-accent"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={file}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}

function getSupportingFileHref(file: string, itemId: string, index: number, serverBaseUrl: string) {
  if (/^https?:\/\//i.test(file)) return file;
  const base = serverBaseUrl.replace(/\/control\/?$/, "");
  return `${base}/supporting-file/${encodeURIComponent(itemId)}/${index}/${encodeURIComponent(getSupportingFileLabel(file))}`;
}

function getSupportingFileLabel(file: string) {
  const normalized = file.replace(/^file:\/\//i, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? file;
}

function isBrowserViewableFile(file: string): "image" | "pdf" | null {
  const path = file.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(path)) return "image";
  if (/\.pdf$/.test(path)) return "pdf";
  return null;
}

function formatDisplayTime(ms: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function timeInputToDate(value: string, nowMs: number) {
  const [hours = "0", minutes = "0"] = value.split(":");
  const date = new Date(nowMs);
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date;
}

function UrlRow({ label, value, disabled }: { label: string; value: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    if (disabled) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div
          className={`overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm ${
            disabled ? "select-none text-muted-foreground/60" : "select-all"
          }`}
          aria-disabled={disabled}
        >
          {value}
        </div>
      </div>
      <Button variant="ghost" size="icon" aria-label={`Copy ${label} URL`} disabled={disabled} onClick={() => void copyUrl()}>
        {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
