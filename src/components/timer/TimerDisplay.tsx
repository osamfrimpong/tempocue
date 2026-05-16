import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { formatTimer, getRemainingMs, getTimerColor, TIMER_COLORS } from "../../lib/timer";
import { useTempoCueStore } from "../../stores/useTempoCueStore";
import type { TimerState } from "../../types/timer";

type TimerDisplayProps = {
  timer: TimerState;
  nowMs: number;
  className?: string;
  compact?: boolean;
  onRemainingChange?: (remainingMs: number) => void;
};

type DraftProgress = {
  elapsedMs: number;
  nowMs: number;
};

export function TimerDisplay({ timer, nowMs, className, compact = false, onRemainingChange }: TimerDisplayProps) {
  const timerColorSettings = useTempoCueStore((state) => state.timerColorSettings);
  const remainingMs = getRemainingMs(timer, nowMs);
  const showsProgress = timer.mode === "countdown" || timer.mode === "end-at-time";
  const canDragProgress = showsProgress && Boolean(onRemainingChange) && timer.durationMs > 0;
  const liveElapsedMs = Math.min(timer.durationMs, Math.max(0, timer.durationMs - remainingMs));
  const [draftProgress, setDraftProgress] = useState<DraftProgress | null>(null);
  const isScrubbingRef = useRef(false);
  const latestDraftProgressRef = useRef<DraftProgress | null>(null);
  const displayedElapsedMs = draftProgress ? getDraftElapsedMs(draftProgress, timer, nowMs) : liveElapsedMs;
  const displayedRemainingMs = draftProgress === null ? remainingMs : timer.durationMs - displayedElapsedMs;
  const timerColor = getTimerColor(displayedRemainingMs, timer.mode, timerColorSettings);
  const progress = getTimerProgress(timer.durationMs, displayedRemainingMs);
  const colorStops = getTimerProgressColorStops(timer.durationMs, timerColorSettings);

  useEffect(() => {
    if (!isScrubbingRef.current) {
      latestDraftProgressRef.current = null;
      setDraftProgress(null);
    }
  }, [liveElapsedMs, timer.durationMs]);

  const commitProgress = (elapsedMs?: number) => {
    const nextDraftProgress = elapsedMs === undefined ? latestDraftProgressRef.current : { elapsedMs, nowMs };
    if (nextDraftProgress === null) return;
    isScrubbingRef.current = false;
    latestDraftProgressRef.current = null;
    setDraftProgress(null);
    onRemainingChange?.(timer.durationMs - getDraftElapsedMs(nextDraftProgress, timer, nowMs));
  };

  const updateDraftProgress = (elapsedMs: number, syncOutput = false) => {
    const nextDraftProgress = { elapsedMs, nowMs };
    isScrubbingRef.current = true;
    latestDraftProgressRef.current = nextDraftProgress;
    setDraftProgress(nextDraftProgress);
    if (syncOutput) onRemainingChange?.(timer.durationMs - elapsedMs);
  };

  useEffect(() => {
    if (!canDragProgress || !isScrubbingRef.current) return;

    const handlePointerRelease = () => {
      commitProgress();
    };

    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("pointercancel", handlePointerRelease);
    return () => {
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("pointercancel", handlePointerRelease);
    };
  }, [canDragProgress, timer.durationMs]);

  return (
    <div className={cn("grid min-w-0 justify-items-center [container-type:inline-size]", compact ? "gap-3" : "w-full gap-6", className)}>
      <div
        className={cn(
          "max-w-full overflow-hidden text-center font-mono font-semibold tabular-nums leading-none tracking-normal",
          compact ? "text-6xl" : "text-[clamp(4rem,20cqw,15rem)]",
          !timerColor && "text-foreground",
        )}
        style={timerColor ? { color: timerColor } : undefined}
      >
        {formatTimer(displayedRemainingMs, timer.mode)}
      </div>

      {showsProgress && (
        <div
          className={cn(
            "relative overflow-hidden bg-white/12 shadow-inner shadow-black/20",
            compact ? "h-4 w-72" : "h-8 w-full max-w-[72rem]",
            canDragProgress && "cursor-ew-resize",
          )}
          role="progressbar"
          aria-label="Timer progress"
          aria-valuemin={0}
          aria-valuemax={timer.durationMs}
          aria-valuenow={displayedElapsedMs}
        >
          <div className="absolute inset-0" style={{ background: colorStops }} />
          <div className="absolute inset-y-0 left-0 bg-black/45 transition-[width] duration-100" style={{ width: `${progress}%` }} />
          <div
            className={cn(
              "absolute top-1/2 border border-white/80 bg-white shadow-[0_0_10px_rgba(255,255,255,0.75)] transition-[left] duration-100",
              compact ? "h-6 w-2 -translate-x-1 -translate-y-3" : "h-12 w-3 -translate-x-1.5 -translate-y-6",
            )}
            style={{ left: `${progress}%` }}
          />
          {canDragProgress && (
            <input
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
              type="range"
              min={0}
              max={timer.durationMs}
              step={1000}
              value={displayedElapsedMs}
              aria-label="Adjust remaining time"
              onPointerDown={(event) => {
                updateDraftProgress(Number(event.currentTarget.value));
              }}
              onBlur={(event) => {
                if (isScrubbingRef.current) commitProgress(Number(event.currentTarget.value));
              }}
              onKeyUp={(event) => {
                if (isScrubbingRef.current) commitProgress(Number(event.currentTarget.value));
              }}
              onChange={(event) => {
                updateDraftProgress(Number(event.currentTarget.value), true);
              }}
              onInvalid={() => {
                isScrubbingRef.current = false;
                latestDraftProgressRef.current = null;
                setDraftProgress(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function getDraftElapsedMs(draftProgress: DraftProgress, timer: TimerState, nowMs: number) {
  const runningDeltaMs = timer.status === "running" ? nowMs - draftProgress.nowMs : 0;
  return Math.min(timer.durationMs, Math.max(0, draftProgress.elapsedMs + runningDeltaMs));
}

function getTimerProgress(durationMs: number, remainingMs: number) {
  if (durationMs <= 0) return 100;
  return Math.min(100, Math.max(0, ((durationMs - remainingMs) / durationMs) * 100));
}

function getTimerProgressColorStops(
  durationMs: number,
  settings: { yellowThresholdMs: number; redThresholdMs: number },
) {
  if (durationMs <= 0) return TIMER_COLORS.red;

  const redThreshold = Math.min(durationMs, Math.max(0, settings.redThresholdMs));
  const yellowThreshold = Math.min(durationMs, Math.max(redThreshold, settings.yellowThresholdMs));
  const greenEnd = ((durationMs - yellowThreshold) / durationMs) * 100;
  const yellowEnd = ((durationMs - redThreshold) / durationMs) * 100;

  return `linear-gradient(to right, ${TIMER_COLORS.green} 0%, ${TIMER_COLORS.green} ${greenEnd}%, ${TIMER_COLORS.yellow} ${greenEnd}%, ${TIMER_COLORS.yellow} ${yellowEnd}%, ${TIMER_COLORS.red} ${yellowEnd}%, ${TIMER_COLORS.red} 100%)`;
}
