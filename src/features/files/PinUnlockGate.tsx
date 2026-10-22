import { useState } from "react";
import { Lock, ArrowRight, ShieldCheck, AlertCircle, RefreshCw, Eye, EyeOff } from "lucide-react";
import { verifyPin } from "./filesApi";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type PinUnlockGateProps = {
  onUnlocked: () => void;
};

export function PinUnlockGate({ onUnlocked }: PinUnlockGateProps) {
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;

    setVerifying(true);
    setError(null);
    try {
      const isValid = await verifyPin(pin.trim());
      if (isValid) {
        onUnlocked();
      } else {
        setError("Invalid PIN. Please check the PIN displayed on the TempoCue host screen.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to verify PIN");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 sm:p-6 shadow-2xl space-y-5 sm:space-y-6 text-foreground">
        {/* Header Icon */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="h-16 w-16 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-lg shadow-primary/5">
            <Lock className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">TempoCue Shared Files</h1>
            <p className="text-xs text-muted-foreground mt-1">
              This session is protected. Enter the host PIN to access files and uploads.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="relative">
            <Input
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="h-12 text-center text-lg font-mono tracking-widest pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
              title={showPin ? "Hide PIN" : "Show PIN"}
            >
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <Button
            type="submit"
            disabled={!pin.trim() || verifying}
            className="w-full h-11 text-sm font-semibold"
          >
            {verifying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <span>Unlock Files</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground text-center">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          <span>Local network file synchronization</span>
        </div>
      </div>
    </div>
  );
}
