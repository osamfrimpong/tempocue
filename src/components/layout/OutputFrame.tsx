import { useEffect } from "react";
import { TimerDisplay } from "../timer/TimerDisplay";
import { FormattedMessage } from "./FormattedMessage";
import { useTicker } from "../../hooks/useTicker";
import { useTempoCueStore } from "../../stores/useTempoCueStore";
import { cn } from "../../lib/utils";

type OutputFrameProps = {
  mode: "viewer" | "obs" | "lower-third" | "agenda";
};

export function OutputFrame({ mode }: OutputFrameProps) {
  const initialize = useTempoCueStore((state) => state.initialize);
  const timer = useTempoCueStore((state) => state.timer);
  const clockOffsetMs = useTempoCueStore((state) => state.clockOffsetMs);
  const output = useTempoCueStore((state) => state.output);
  const rundown = useTempoCueStore((state) => state.rundown);
  const now = useTicker(100) + clockOffsetMs;
  const activeIndex = rundown.findIndex((item) => item.id === output.activeItemId);
  const active = rundown[activeIndex] ?? rundown[0];
  const targetedMessage =
    output.message &&
    (output.message.target === mode || output.message.target === "all" || mode === "viewer" || mode === "lower-third")
      ? output.message
      : null;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (output.blackout) {
    return <main className={cn("min-h-screen", mode === "obs" ? "bg-transparent" : "bg-black")} />;
  }

  if (mode === "agenda") {
    return (
      <main className="min-h-screen bg-[#0c0f12] p-12 text-white">
        <div className="mb-8 text-3xl font-semibold">Agenda</div>
        <div className="grid gap-3">
          {rundown.map((item) => (
            <div
              key={item.id}
              className={cn(
                "grid grid-cols-[8px_1fr_auto] items-center gap-5 rounded-md bg-white/8 p-5",
                item.id === active?.id && "bg-white/16",
              )}
            >
              <div className="h-full rounded-full" style={{ backgroundColor: item.color }} />
              <div>
                <div className="text-2xl font-semibold">{item.title}</div>
                <div className="text-lg text-white/65">{item.speaker}</div>
              </div>
              <div className="font-mono text-2xl tabular-nums">{Math.round(item.durationMs / 60000)}m</div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (mode === "lower-third") {
    return (
      <main className="flex min-h-screen items-end bg-transparent p-12 text-white">
        {targetedMessage ? (
          <section className="grid w-[70vw] grid-cols-[minmax(0,1fr)_auto] items-center gap-8 rounded-md bg-black/82 px-8 py-6">
            <FormattedMessage
              message={targetedMessage}
              className={targetedMessage.flashing ? "message-flash" : undefined}
              titleClassName="text-xl uppercase text-white/70"
              bodyClassName="text-5xl font-semibold"
            />
            {!output.hideTimer && <TimerDisplay timer={timer} nowMs={now} compact className="text-white" />}
          </section>
        ) : (
          <section className="grid w-[70vw] grid-cols-[1fr_auto] items-center rounded-md bg-black/82 px-8 py-6">
            <div>
              <div className="text-xl uppercase text-white/70">{active?.speaker}</div>
              <div className="mt-2 text-5xl font-semibold">{active?.title}</div>
            </div>
            {!output.hideTimer && <TimerDisplay timer={timer} nowMs={now} compact className="text-white" />}
          </section>
        )}
      </main>
    );
  }

  const transparent = mode === "obs";

  if (mode === "viewer") {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#080b0f] p-10 text-white">
        <header className="absolute left-10 top-8 max-w-[70vw]">
          <div className="truncate text-[clamp(1.75rem,3vw,3.75rem)] font-semibold">{active?.title}</div>
          <div className="mt-2 text-[clamp(1rem,1.5vw,1.75rem)] font-medium uppercase text-white/55">
            Time Remaining
          </div>
        </header>
        <section className="grid w-full max-w-[92vw] justify-items-center gap-10 text-center">
          {targetedMessage && (
            <FormattedMessage
              message={targetedMessage}
              className={targetedMessage.flashing ? "message-flash" : undefined}
              titleClassName="text-[clamp(1.5rem,4vw,4.5rem)] font-semibold"
              bodyClassName="text-[clamp(2rem,6vw,6.5rem)] font-bold"
            />
          )}
          {!output.hideTimer && <TimerDisplay timer={timer} nowMs={now} />}
        </section>
      </main>
    );
  }

  return (
    <main
      className={cn(
        "grid min-h-screen place-items-center overflow-hidden p-10 text-white",
        transparent ? "bg-transparent" : "bg-[#080b0f]",
      )}
    >
      <section className={cn("w-full text-center", transparent && "drop-shadow-[0_4px_22px_rgba(0,0,0,0.8)]")}>
        <div className="grid justify-items-center gap-8">
          {targetedMessage && (
            <FormattedMessage
              message={targetedMessage}
              className={targetedMessage.flashing ? "message-flash" : undefined}
              titleClassName="text-[clamp(2rem,5vw,5rem)] font-semibold"
              bodyClassName="text-[clamp(3rem,8vw,8rem)] font-bold"
            />
          )}
          {!output.hideTimer && <TimerDisplay timer={timer} nowMs={now} />}
          {!targetedMessage && <div className="text-[clamp(2rem,5vw,5rem)] font-semibold">{active?.title}</div>}
        </div>
      </section>
    </main>
  );
}
