import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { X, Copy, Check, Smartphone, Wifi, KeyRound } from "lucide-react";
import { useTempoCueStore } from "../../stores/useTempoCueStore";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type QrCodeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  pin?: string | null;
};

export function QrCodeModal({ isOpen, onClose, pin }: QrCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [includePinInQr, setIncludePinInQr] = useState(false);
  const urls = useTempoCueStore((s) => s.urls);

  // Base network URL
  const baseShareUrl = urls.network?.files || urls.files || `${window.location.origin}/files`;
  const shareUrl = pin && includePinInQr ? `${baseShareUrl}?pin=${encodeURIComponent(pin)}` : baseShareUrl;

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      const qrWidth = typeof window !== "undefined" && window.innerWidth < 360 ? 190 : 220;
      QRCode.toCanvas(canvasRef.current, shareUrl, {
        width: qrWidth,
        margin: 2,
        color: {
          dark: "#090d16",
          light: "#ffffff",
        },
      }).catch((err) => {
        console.error("Failed to render QR Code:", err);
      });
    }
  }, [isOpen, shareUrl]);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      console.error("Failed copying to clipboard:", err);
    }
  };

  const handleCopyPin = async () => {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    } catch (err) {
      console.error("Failed copying PIN:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-md border border-border bg-card shadow-2xl p-4 sm:p-6 text-foreground max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-foreground">Network File Share</h3>
              <p className="text-[11px] sm:text-xs text-muted-foreground">Share files with phones & laptops</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center py-6">
          <div className="p-3 bg-white rounded-md shadow-inner border border-border">
            <canvas ref={canvasRef} className="block" />
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Smartphone className="h-4 w-4 text-primary" />
            <span>Scan with phone camera or mobile browser</span>
          </div>

          {pin && (
            <label className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includePinInQr}
                onChange={(e) => setIncludePinInQr(e.target.checked)}
                className="rounded border-input bg-background text-primary accent-primary"
              />
              <span>Include PIN in QR code (bypass PIN prompt on scan)</span>
            </label>
          )}
        </div>

        {/* PIN Badge (if active) */}
        {pin && (
          <div className="mb-3.5 flex items-center justify-between rounded-md border border-primary/20 bg-primary/10 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <span className="text-xs text-foreground font-medium">Access PIN:</span>
              <span className="font-mono text-sm font-bold tracking-widest text-primary">{pin}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyPin}
              className="h-7 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
            >
              {copiedPin ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedPin ? "Copied" : "Copy"}</span>
            </Button>
          </div>
        )}

        <div className="space-y-3 bg-background p-3.5 rounded-md border border-border">
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Direct Network Link
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              readOnly
              value={shareUrl}
              className="h-8 flex-1 bg-card px-3 py-1.5 text-xs text-primary font-mono select-all"
            />
            <Button
              size="sm"
              className="h-8"
              onClick={handleCopyUrl}
            >
              {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedUrl ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Devices must be connected to the same local Wi-Fi or venue network. No internet connection is required.
          </p>
        </div>
      </div>
    </div>
  );
}
