import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
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
  const displayedElapsedMs = draftProgress ? draftProgress.elapsedMs : liveElapsedMs;
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
    const nextDraftProgress = elapsedMs === undefined ? latestDraftProgressRef.current : { elapsedMs };
    if (nextDraftProgress === null) return;
    isScrubbingRef.current = false;
    latestDraftProgressRef.current = null;
    setDraftProgress(null);
    onRemainingChange?.(timer.durationMs - nextDraftProgress.elapsedMs);
  };

  const updateDraftProgress = (elapsedMs: number) => {
    const nextDraftProgress = { elapsedMs };
    isScrubbingRef.current = true;
    latestDraftProgressRef.current = nextDraftProgress;
    setDraftProgress(nextDraftProgress);
  };

  const getElapsedMsFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const elapsedMs = Math.min(timer.durationMs, Math.max(0, ratio * timer.durationMs));
    return Math.round(elapsedMs / 1000) * 1000;
  };

  const nudgeProgress = (deltaMs: number) => {
    const nextElapsedMs = Math.min(timer.durationMs, Math.max(0, displayedElapsedMs + deltaMs));
    updateDraftProgress(nextElapsedMs);
    commitProgress(nextElapsedMs);
  };

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
          role={canDragProgress ? undefined : "progressbar"}
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
            <div
              className="absolute inset-0 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              role="slider"
              tabIndex={0}
              aria-label="Adjust remaining time"
              aria-valuemin={0}
              aria-valuemax={timer.durationMs}
              aria-valuenow={displayedElapsedMs}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                updateDraftProgress(getElapsedMsFromPointer(event));
              }}
              onPointerMove={(event) => {
                if (!isScrubbingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                updateDraftProgress(getElapsedMsFromPointer(event));
              }}
              onPointerUp={(event) => {
                if (!isScrubbingRef.current) return;
                const elapsedMs = getElapsedMsFromPointer(event);
                commitProgress(elapsedMs);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={(event) => {
                if (!isScrubbingRef.current) return;
                commitProgress();
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                if (isScrubbingRef.current) commitProgress();
              }}
              onBlur={() => {
                if (isScrubbingRef.current) commitProgress();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                  event.preventDefault();
                  nudgeProgress(-1000);
                }
                if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                  event.preventDefault();
                  nudgeProgress(1000);
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  updateDraftProgress(0);
                  commitProgress(0);
                }
                if (event.key === "End") {
                  event.preventDefault();
                  updateDraftProgress(timer.durationMs);
                  commitProgress(timer.durationMs);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
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
