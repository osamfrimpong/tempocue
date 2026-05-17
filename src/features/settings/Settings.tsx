import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, RotateCcw, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { DEFAULT_TIMER_COLOR_SETTINGS, TIMER_COLORS, formatDurationInput, parseDuration } from "../../lib/timer";
import { useTempoCueStore } from "../../stores/useTempoCueStore";

export function Settings() {
  const timerColorSettings = useTempoCueStore((state) => state.timerColorSettings);
  const setTimerColorSettings = useTempoCueStore((state) => state.setTimerColorSettings);
  const [yellowInput, setYellowInput] = useState(formatDurationInput(timerColorSettings.yellowThresholdMs));
  const [redInput, setRedInput] = useState(formatDurationInput(timerColorSettings.redThresholdMs));
  const [saveToastVisible, setSaveToastVisible] = useState(false);

  useEffect(() => {
    setYellowInput(formatDurationInput(timerColorSettings.yellowThresholdMs));
    setRedInput(formatDurationInput(timerColorSettings.redThresholdMs));
  }, [timerColorSettings.redThresholdMs, timerColorSettings.yellowThresholdMs]);

  const parsed = useMemo(
    () => ({
      yellow: parseDuration(yellowInput),
      red: parseDuration(redInput),
    }),
    [redInput, yellowInput],
  );

  const error =
    parsed.yellow === null || parsed.red === null
      ? "Enter durations like 5:00, 1:30, or 30s."
      : parsed.red > parsed.yellow
        ? "Red must start at or below the yellow threshold."
        : null;

  const saveSettings = () => {
    if (parsed.yellow === null || parsed.red === null || parsed.red > parsed.yellow) return;
    setTimerColorSettings({
      yellowThresholdMs: parsed.yellow,
      redThresholdMs: parsed.red,
    });
    setSaveToastVisible(true);
  };

  const resetSettings = () => {
    setTimerColorSettings(DEFAULT_TIMER_COLOR_SETTINGS);
  };

  useEffect(() => {
    if (!saveToastVisible) return;

    const timeoutId = window.setTimeout(() => {
      setSaveToastVisible(false);
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [saveToastVisible]);

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/control"
          className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        <div className="mt-6">
          <h1 className="text-3xl font-semibold">Settings</h1>
          <p className="mt-2 text-muted-foreground">
            Configure when the countdown changes from green to yellow to red.
          </p>
        </div>

        <section className="mt-6 rounded-md border border-border bg-card p-5">
          <div className="mb-5">
            <div className="text-sm font-semibold uppercase text-muted-foreground">Timer colours</div>
            <div className="mt-1 text-xl font-semibold">Countdown thresholds</div>
          </div>

          <div className="grid gap-4">
            <ThresholdRow
              color={TIMER_COLORS.green}
              title="Green"
              description={`More than ${yellowInput} remaining`}
            />
            <ThresholdInput
              color={TIMER_COLORS.yellow}
              label="Yellow starts at"
              value={yellowInput}
              onChange={setYellowInput}
            />
            <ThresholdInput
              color={TIMER_COLORS.red}
              label="Red starts at"
              value={redInput}
              onChange={setRedInput}
            />
          </div>

          {error && <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="mt-5 flex gap-2">
            <Button onClick={saveSettings} disabled={Boolean(error)}>
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button variant="secondary" onClick={resetSettings}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </section>
      </div>

      {saveToastVisible && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 flex max-w-sm items-center gap-3 rounded-md border border-primary/40 bg-card px-4 py-3 text-sm font-medium text-card-foreground shadow-lg shadow-black/30"
        >
          <CheckCircle2 className="h-5 w-5 text-primary" />
          Settings saved.
        </div>
      )}
    </main>
  );
}

function ThresholdInput({
  color,
  label,
  value,
  onChange,
}: {
  color: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_180px] items-center gap-4 rounded-md border border-border bg-background p-4">
      <ThresholdRow color={color} title={label} description="Use minutes, seconds, or mm:ss." />
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ThresholdRow({ color, title, description }: { color: string; title: string; description: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </div>
  );
}
