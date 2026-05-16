import { useEffect } from "react";
import { useTempoCueStore } from "../stores/useTempoCueStore";

export function useKeyboardShortcuts() {
  const startTimer = useTempoCueStore((state) => state.startTimer);
  const pauseTimer = useTempoCueStore((state) => state.pauseTimer);
  const resetTimer = useTempoCueStore((state) => state.resetTimer);
  const skipTimer = useTempoCueStore((state) => state.skipTimer);
  const addTime = useTempoCueStore((state) => state.addTime);
  const timerStatus = useTempoCueStore((state) => state.timer.status);
  const output = useTempoCueStore((state) => state.output);
  const setBlackout = useTempoCueStore((state) => state.setBlackout);
  const hideMessage = useTempoCueStore((state) => state.hideMessage);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === " ") {
        event.preventDefault();
        void (timerStatus === "running" ? pauseTimer() : startTimer());
      }
      if (event.key.toLowerCase() === "r") void resetTimer();
      if (event.key.toLowerCase() === "n") void skipTimer();
      if (event.key.toLowerCase() === "b") void setBlackout(!output.blackout);
      if (event.key === "+") void addTime(60_000);
      if (event.key === "-") void addTime(-60_000);
      if (event.key === "Escape") void hideMessage();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTime, hideMessage, output.blackout, pauseTimer, resetTimer, setBlackout, skipTimer, startTimer, timerStatus]);
}
