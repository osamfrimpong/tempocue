import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { Link } from "react-router-dom";
import { TimePicker } from "@asphalt-react/time-picker";
import {
  Ban,
  Bold,
  ChevronDown,
  Clock,
  Check,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  FileText,
  GripVertical,
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
  Upload,
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
type PendingRundownDrag = {
  itemId: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};
type RundownDragState = PendingRundownDrag & { x: number; y: number };

export function Controller() {
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
  const reorderRundown = useTempoCueStore((state) => state.reorderRundown);
  const exportScheduleFile = useTempoCueStore((state) => state.exportScheduleFile);
  const importScheduleFile = useTempoCueStore((state) => state.importScheduleFile);
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
  const [activationCandidate, setActivationCandidate] = useState<RundownItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<RundownItem | null>(null);
  const [localUrlsExpanded, setLocalUrlsExpanded] = useState(false);
  const [timeAdjustmentMinutes, setTimeAdjustmentMinutes] = useState("1");
  const previousNetworkHost = useRef<string | null>(null);
  const [networkChanged, setNetworkChanged] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<RundownDragState | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  const [justDroppedItemId, setJustDroppedItemId] = useState<string | null>(null);
  const rundownListRef = useRef<HTMLDivElement | null>(null);
  const pendingDragRef = useRef<PendingRundownDrag | null>(null);
  const dragStateRef = useRef<RundownDragState | null>(null);
  const draggedItemIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const dropAnimationTimeoutRef = useRef<number | null>(null);
  const cancelRundownDragRef = useRef<() => void>(() => undefined);

  useKeyboardShortcuts();

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
  const displayedRundown = useMemo(
    () => (draggedItemId ? rundown.filter((item) => item.id !== draggedItemId) : rundown),
    [draggedItemId, rundown],
  );
  const draggedItem = draggedItemId ? rundown.find((item) => item.id === draggedItemId) ?? null : null;
  const originalDragIndex = draggedItemId ? rundown.findIndex((item) => item.id === draggedItemId) : null;
  const visibleDropIndex = dropIndex ?? originalDragIndex;
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
  const timeAdjustmentMs = parseMinuteAdjustment(timeAdjustmentMinutes);
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

  const adjustTimer = (direction: 1 | -1) => {
    if (timeAdjustmentMs === null) return;
    void addTime(direction * timeAdjustmentMs);
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

  const confirmActivateRundownItem = () => {
    if (!activationCandidate) return;
    void selectRundownItem(activationCandidate.id);
    setActivationCandidate(null);
  };

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const setRundownDropIndex = (nextIndex: number | null) => {
    if (dropIndexRef.current === nextIndex) return;
    dropIndexRef.current = nextIndex;
    setDropIndex(nextIndex);

    const item = draggedItemIdRef.current
      ? rundown.find((rundownItem) => rundownItem.id === draggedItemIdRef.current)
      : null;
    if (item && nextIndex !== null) {
      setDragAnnouncement(`${item.title}, position ${nextIndex + 1} of ${rundown.length}`);
    }
  };

  const clearRundownDrag = () => {
    stopAutoScroll();
    pendingDragRef.current = null;
    dragStateRef.current = null;
    draggedItemIdRef.current = null;
    dropIndexRef.current = null;
    lastPointerRef.current = null;
    setDragState(null);
    setDraggedItemId(null);
    setDropIndex(null);
  };

  const cancelRundownDrag = () => {
    const item = draggedItemIdRef.current
      ? rundown.find((rundownItem) => rundownItem.id === draggedItemIdRef.current)
      : null;
    if (item) setDragAnnouncement(`Reordering ${item.title} cancelled`);
    clearRundownDrag();
  };
  cancelRundownDragRef.current = cancelRundownDrag;

  const markRundownItemDropped = (itemId: string) => {
    if (dropAnimationTimeoutRef.current !== null) {
      window.clearTimeout(dropAnimationTimeoutRef.current);
    }
    setJustDroppedItemId(itemId);
    dropAnimationTimeoutRef.current = window.setTimeout(() => {
      setJustDroppedItemId(null);
      dropAnimationTimeoutRef.current = null;
    }, 260);
  };

  const updateDropIndex = (clientX: number, clientY: number) => {
    const listElement = rundownListRef.current;
    if (!draggedItemIdRef.current || !listElement) return;

    const listRect = listElement.getBoundingClientRect();
    const outsideHorizontalBounds = clientX < listRect.left - 48 || clientX > listRect.right + 48;
    const outsideVerticalBounds = clientY < listRect.top - 72 || clientY > listRect.bottom + 72;
    if (outsideHorizontalBounds || outsideVerticalBounds) {
      setRundownDropIndex(null);
      return;
    }

    const rows = Array.from(listElement.querySelectorAll<HTMLElement>("[data-rundown-item-id]"));
    const nextRowIndex = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    setRundownDropIndex(nextRowIndex === -1 ? rows.length : nextRowIndex);
  };

  const runAutoScroll = () => {
    autoScrollFrameRef.current = null;
    const listElement = rundownListRef.current;
    const pointer = lastPointerRef.current;
    if (!listElement || !pointer || !draggedItemIdRef.current) return;

    const rect = listElement.getBoundingClientRect();
    if (
      pointer.x < rect.left - 48 ||
      pointer.x > rect.right + 48 ||
      pointer.y < rect.top - 72 ||
      pointer.y > rect.bottom + 72
    ) {
      return;
    }
    const edgeSize = Math.min(56, rect.height / 4);
    let scrollDelta = 0;
    if (pointer.y < rect.top + edgeSize) {
      scrollDelta = -Math.ceil(((rect.top + edgeSize - pointer.y) / edgeSize) * 12);
    } else if (pointer.y > rect.bottom - edgeSize) {
      scrollDelta = Math.ceil(((pointer.y - (rect.bottom - edgeSize)) / edgeSize) * 12);
    }
    scrollDelta = Math.max(-16, Math.min(16, scrollDelta));

    if (scrollDelta !== 0) {
      const previousScrollTop = listElement.scrollTop;
      listElement.scrollTop += scrollDelta;
      if (listElement.scrollTop !== previousScrollTop) {
        updateDropIndex(pointer.x, pointer.y);
        autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
      }
    }
  };

  const beginAutoScroll = () => {
    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }
  };

  const commitRundownDrop = () => {
    const sourceId = draggedItemIdRef.current;
    const targetIndex = dropIndexRef.current;
    if (!sourceId || targetIndex === null) return;
    const newIds = moveRundownItemToIndex(rundown, sourceId, targetIndex);
    const item = rundown.find((rundownItem) => rundownItem.id === sourceId);
    if (newIds) {
      void reorderRundown(newIds);
      markRundownItemDropped(sourceId);
      if (item) setDragAnnouncement(`${item.title} moved to position ${targetIndex + 1} of ${rundown.length}`);
    } else if (item) {
      setDragAnnouncement(`${item.title} remains at position ${targetIndex + 1} of ${rundown.length}`);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, itemId: string) => {
    if (rundown.length <= 1 || event.button !== 0 || pendingDragRef.current) return;
    const rowElement = event.currentTarget.closest<HTMLElement>("[data-rundown-item-id]");
    const listElement = rundownListRef.current;
    if (!rowElement || !listElement) return;

    event.preventDefault();
    event.currentTarget.focus();
    const rect = rowElement.getBoundingClientRect();
    pendingDragRef.current = {
      itemId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    listElement.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pendingDrag = pendingDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) return;
    if (event.cancelable) event.preventDefault();
    lastPointerRef.current = { x: event.clientX, y: event.clientY };

    if (!draggedItemIdRef.current) {
      const activationDistance = pendingDrag.pointerType === "touch" ? 7 : 4;
      if (Math.hypot(event.clientX - pendingDrag.startX, event.clientY - pendingDrag.startY) < activationDistance) {
        return;
      }

      const initialIndex = rundown.findIndex((item) => item.id === pendingDrag.itemId);
      const activeDrag = {
        ...pendingDrag,
        x: event.clientX - pendingDrag.offsetX,
        y: event.clientY - pendingDrag.offsetY,
      };
      draggedItemIdRef.current = pendingDrag.itemId;
      dragStateRef.current = activeDrag;
      setDraggedItemId(pendingDrag.itemId);
      setDragState(activeDrag);
      setRundownDropIndex(initialIndex);
      const item = rundown[initialIndex];
      if (item) setDragAnnouncement(`${item.title} picked up, position ${initialIndex + 1} of ${rundown.length}`);
      beginAutoScroll();
      return;
    } else {
      const activeDrag = dragStateRef.current;
      if (activeDrag) {
        const nextDrag = {
          ...activeDrag,
          x: event.clientX - activeDrag.offsetX,
          y: event.clientY - activeDrag.offsetY,
        };
        dragStateRef.current = nextDrag;
        setDragState(nextDrag);
      }
    }

    updateDropIndex(event.clientX, event.clientY);
    beginAutoScroll();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pendingDrag = pendingDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) return;
    if (draggedItemIdRef.current) {
      updateDropIndex(event.clientX, event.clientY);
      commitRundownDrop();
    }
    clearRundownDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDownReorder = (e: React.KeyboardEvent, currentIndex: number) => {
    if (rundown.length <= 1) return;
    const currentItem = rundown[currentIndex];
    if (!currentItem) return;
    let targetIndex: number | null = null;
    if (e.key === "ArrowUp" && currentIndex > 0) {
      e.preventDefault();
      targetIndex = currentIndex - 1;
    } else if (e.key === "ArrowDown" && currentIndex < rundown.length - 1) {
      e.preventDefault();
      targetIndex = currentIndex + 1;
    } else if (e.key === "Home" && currentIndex > 0) {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === "End" && currentIndex < rundown.length - 1) {
      e.preventDefault();
      targetIndex = rundown.length - 1;
    }

    if (targetIndex !== null) {
      const newIds = moveRundownItemToIndex(rundown, currentItem.id, targetIndex);
      if (newIds) {
        void reorderRundown(newIds);
        markRundownItemDropped(currentItem.id);
        setDragAnnouncement(`${currentItem.title} moved to position ${targetIndex + 1} of ${rundown.length}`);
      }
    }
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && draggedItemIdRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelRundownDragRef.current();
      }
    };
    const handleWindowBlur = () => {
      if (pendingDragRef.current) cancelRundownDragRef.current();
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (draggedItemId && !rundown.some((item) => item.id === draggedItemId)) {
      cancelRundownDragRef.current();
    }
  }, [draggedItemId, rundown]);

  useEffect(() => {
    return () => {
      stopAutoScroll();
      if (dropAnimationTimeoutRef.current !== null) {
        window.clearTimeout(dropAnimationTimeoutRef.current);
      }
    };
  }, []);

  const openTimePickerFromField = (event: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const button = event.currentTarget.querySelector<HTMLButtonElement>('[data-testid="time-button"]');
    button?.click();
  };

  const exportSchedule = async () => {
    try {
      const fileName = await exportScheduleFile();
      if (fileName) setScheduleNotice(`Exported ${fileName}`);
    } catch (error) {
      setScheduleNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const importSchedule = async () => {
    try {
      const fileName = await importScheduleFile();
      if (fileName) setScheduleNotice(`Imported ${fileName}`);
    } catch (error) {
      setScheduleNotice(error instanceof Error ? error.message : String(error));
    }
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
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => void importSchedule()}>
                <Upload className="h-4 w-4" />
                Import
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportSchedule()}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>
            {rundown.length > 1 && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <GripVertical className="h-3.5 w-3.5" />
                <span>Drag the grip to reorder · Arrow keys also work</span>
              </div>
            )}
         
          </div>
          <div
            ref={rundownListRef}
            data-rundown-list
            className={`grid max-h-80 min-h-0 flex-1 content-start overflow-y-auto p-3 lg:max-h-none ${
              draggedItemId ? "gap-0" : "gap-2"
            }`}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelRundownDrag}
            onLostPointerCapture={() => {
              if (pendingDragRef.current) cancelRundownDrag();
            }}
          >
            {displayedRundown.map((item, index) => {
              const isActiveItem = item.id === output.activeItemId;
              const activeItemActionDisabled = timerIsRunning && isActiveItem;
              const isJustDropped = justDroppedItemId === item.id;
              const orderIndex = rundown.findIndex((rundownItem) => rundownItem.id === item.id);
              const gapIsPlaceholder = draggedItemId !== null && visibleDropIndex === index;
              const gapIsActive = draggedItemId !== null && dropIndex === index;

              return (
                <Fragment key={item.id}>
                  {draggedItemId && dragState && (
                    <div
                      className={`rundown-drop-gap ${gapIsActive ? "rundown-drop-gap--active" : ""}`}
                      style={{ height: gapIsPlaceholder ? dragState.height : 0 }}
                      aria-hidden="true"
                    >
                      <div className="rundown-drop-line">
                        <span>Position {index + 1}</span>
                      </div>
                    </div>
                  )}
                  <div
                    data-rundown-item-id={item.id}
                    className={`group relative grid grid-cols-[2rem_6px_1fr_auto] items-center gap-2.5 rounded-md border p-3 transition-[border-color,background-color,box-shadow,transform] duration-150 ${
                      draggedItemId ? "mb-2" : ""
                    } ${isJustDropped ? "rundown-item--dropped" : ""} ${
                      isActiveItem ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent"
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={rundown.length > 1 ? 0 : -1}
                      aria-label={`Reorder ${item.title}. Use up and down arrow keys, Home, or End to change its position.`}
                      aria-roledescription="sortable item handle"
                      aria-keyshortcuts="ArrowUp ArrowDown Home End"
                      title={rundown.length > 1 ? "Drag to reorder (or use arrow keys)" : undefined}
                      className={`flex h-full min-h-14 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors touch-none select-none ${
                        rundown.length > 1
                          ? "cursor-grab hover:border-border hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing"
                          : "cursor-default opacity-40"
                      }`}
                      onKeyDown={(e) => handleKeyDownReorder(e, orderIndex)}
                      onPointerDown={(e) => handlePointerDown(e, item.id)}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <span className="h-full min-h-14 rounded-full" style={{ backgroundColor: item.color }} />
                    <div className="min-w-0 text-left">
                      <span className="block text-sm text-muted-foreground">{String(orderIndex + 1).padStart(2, "0")}</span>
                      <span className="block truncate font-medium">{item.title}</span>
                      <span className="block truncate text-sm text-muted-foreground">{item.speaker}</span>
                    </div>
                    <div className="grid justify-items-end gap-2">
                      <span className="font-mono text-sm tabular-nums">{Math.round(item.durationMs / 60000)}m</span>
                      <div className="flex gap-1">
                        {!isActiveItem && (
                          <Button
                            variant="secondary"
                            size="icon"
                            aria-label={`Activate ${item.title}`}
                            title="Activate timer"
                            onClick={() => setActivationCandidate(item)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label={`Edit ${item.title}`}
                          title="Edit item"
                          disabled={activeItemActionDisabled}
                          onClick={() => openEditDialog(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label={`Delete ${item.title}`}
                          title="Delete item"
                          disabled={activeItemActionDisabled || rundown.length === 1}
                          onClick={() => setDeleteCandidate(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {draggedItemId && dragState && (
              <div
                className={`rundown-drop-gap ${dropIndex === displayedRundown.length ? "rundown-drop-gap--active" : ""}`}
                style={{ height: visibleDropIndex === displayedRundown.length ? dragState.height : 0 }}
                aria-hidden="true"
              >
                <div className="rundown-drop-line">
                  <span>Position {rundown.length}</span>
                </div>
              </div>
            )}
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
              <div className="col-span-2 grid min-w-36 grid-cols-[minmax(0,1fr)_auto] items-center rounded-md border border-input bg-background sm:col-span-1 sm:w-40">
                <Input
                  aria-label="Adjustment minutes"
                  className="h-10 border-0 bg-transparent font-mono tabular-nums focus-visible:ring-0"
                  inputMode="decimal"
                  min="0.1"
                  step="0.5"
                  type="number"
                  value={timeAdjustmentMinutes}
                  onChange={(event) => setTimeAdjustmentMinutes(event.target.value)}
                />
                <span className="pr-3 text-xs font-medium uppercase text-muted-foreground">min</span>
              </div>
              <Button
                className="min-w-0 px-3 sm:px-4"
                variant="outline"
                disabled={timeAdjustmentMs === null}
                onClick={() => adjustTimer(1)}
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
              <Button
                className="min-w-0 px-3 sm:px-4"
                variant="outline"
                disabled={timeAdjustmentMs === null}
                onClick={() => adjustTimer(-1)}
              >
                <Minus className="h-4 w-4" />
                Subtract
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

      {draggedItem && dragState && (
        <div
          className={`rundown-drag-preview grid grid-cols-[2rem_6px_1fr_auto] items-center gap-2.5 rounded-md border p-3 ${
            dropIndex === null ? "rundown-drag-preview--invalid" : ""
          }`}
          style={{
            width: dragState.width,
            height: dragState.height,
            transform: `translate3d(${dragState.x}px, ${dragState.y}px, 0) rotate(0.6deg)`,
          }}
          aria-hidden="true"
        >
          <div className="flex h-full min-h-14 w-8 items-center justify-center text-primary">
            <GripVertical className="h-4 w-4" />
          </div>
          <span className="h-full min-h-14 rounded-full" style={{ backgroundColor: draggedItem.color }} />
          <div className="min-w-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-primary">
              {dropIndex === null ? "Release to cancel" : `Move to position ${dropIndex + 1}`}
            </span>
            <span className="block truncate font-medium">{draggedItem.title}</span>
            <span className="block truncate text-sm text-muted-foreground">{draggedItem.speaker}</span>
          </div>
          <span className="font-mono text-sm tabular-nums">{Math.round(draggedItem.durationMs / 60000)}m</span>
        </div>
      )}

      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {dragAnnouncement}
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

      {activationCandidate && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activate-rundown-item-title"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 shadow-2xl">
            <div className="text-sm font-semibold uppercase text-muted-foreground">Activate timer</div>
            <div id="activate-rundown-item-title" className="mt-1 text-xl font-semibold">
              Make {activationCandidate.title} active?
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This switches the active timer without starting it. Any running timer will be paused.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActivationCandidate(null)}>
                Cancel
              </Button>
              <Button onClick={confirmActivateRundownItem}>
                <Check className="h-4 w-4" />
                Make active
              </Button>
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

function parseMinuteAdjustment(value: string) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 60_000);
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

function moveRundownItemToIndex(rundown: RundownItem[], sourceId: string, targetIndex: number): string[] | null {
  const sourceIndex = rundown.findIndex((i) => i.id === sourceId);
  if (sourceIndex === -1) return null;

  const newRundown = [...rundown];
  const [moved] = newRundown.splice(sourceIndex, 1);
  const insertionIndex = Math.max(0, Math.min(targetIndex, newRundown.length));
  newRundown.splice(insertionIndex, 0, moved);

  const newIds = newRundown.map((i) => i.id);
  return newIds.every((id, index) => id === rundown[index]?.id) ? null : newIds;
}
