import { useState } from "react";
import { X, Shield, HardDrive, KeyRound, Check, RefreshCw, AlertCircle } from "lucide-react";
import type { StorageInfo } from "../../types/timer";
import { updateStorageConfig } from "./filesApi";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type StorageSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  storageInfo: StorageInfo;
  onSettingsSaved: () => void;
};

const PRESET_SIZES_MB = [50, 100, 250, 500, 1024, 2048, 5120, 10240];

export function StorageSettingsModal({
  isOpen,
  onClose,
  storageInfo,
  onSettingsSaved,
}: StorageSettingsModalProps) {
  const [uploadsAllowed, setUploadsAllowed] = useState(storageInfo.uploadsAllowed);
  const [maxSizeMb, setMaxSizeMb] = useState<number>(storageInfo.maxUploadSizeMb || 1024);
  const [customSizeInput, setCustomSizeInput] = useState<string>(
    String(storageInfo.maxUploadSizeMb || 1024),
  );
  const [pinEnabled, setPinEnabled] = useState(Boolean(storageInfo.currentPin || storageInfo.pinRequired));
  const [pinValue, setPinValue] = useState(storageInfo.currentPin || "");
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (mb: number) => {
    setMaxSizeMb(mb);
    setCustomSizeInput(String(mb));
  };

  const handleCustomSizeChange = (val: string) => {
    setCustomSizeInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setMaxSizeMb(parsed);
    }
  };

  const handleGeneratePin = () => {
    // Generate random 4-digit PIN
    const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
    setPinValue(randomPin);
    setPinEnabled(true);
  };

  const handleSave = async () => {
    setError(null);
    if (pinEnabled && !pinValue.trim()) {
      setError("Please enter a PIN or disable PIN protection.");
      return;
    }

    if (maxSizeMb <= 0) {
      setError("Maximum upload size must be greater than 0 MB.");
      return;
    }

    setSaving(true);
    try {
      await updateStorageConfig({
        allowNetworkUploads: uploadsAllowed,
        maxUploadSizeMb: maxSizeMb,
        pin: pinEnabled ? pinValue.trim() : null,
      });
      setSavedSuccess(true);
      onSettingsSaved();
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error("Failed saving storage config:", err);
      setError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-md border border-border bg-card shadow-2xl overflow-hidden flex flex-col text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4 bg-card">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Storage & Access Settings</h2>
              <p className="text-xs text-muted-foreground">Configure upload limits and network security</p>
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

        {/* Form Body */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto max-h-[75vh]">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </div>
          )}

          {/* Uploads Permission Toggle */}
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">Network Uploads</label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Allow connected devices on Wi-Fi / LAN to upload and modify files
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploadsAllowed(!uploadsAllowed)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  uploadsAllowed ? "bg-primary" : "bg-secondary"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    uploadsAllowed ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Max Upload Size */}
          <div className="rounded-md border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                <label className="text-sm font-medium text-foreground">Max Upload File Size</label>
              </div>
              <span className="text-xs font-semibold text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                {maxSizeMb >= 1024 ? `${(maxSizeMb / 1024).toFixed(maxSizeMb % 1024 === 0 ? 0 : 1)} GB` : `${maxSizeMb} MB`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Files exceeding this limit will be blocked before and during transfer.
            </p>

            {/* Presets */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {PRESET_SIZES_MB.map((mb) => {
                const label = mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`;
                const isSelected = maxSizeMb === mb;
                return (
                  <button
                    key={mb}
                    type="button"
                    onClick={() => handleSelectPreset(mb)}
                    className={`rounded-md py-1.5 text-xs font-medium border transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-sm font-semibold"
                        : "bg-card text-foreground border-border hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Custom Input */}
            <div className="flex items-center gap-3 pt-2">
              <span className="text-xs text-muted-foreground shrink-0">Custom (MB):</span>
              <Input
                type="number"
                min="1"
                max="50000"
                value={customSizeInput}
                onChange={(e) => handleCustomSizeChange(e.target.value)}
                className="h-8 text-xs bg-card"
                placeholder="e.g. 1024"
              />
            </div>
          </div>

          {/* PIN Protection */}
          <div className="rounded-md border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <label className="text-sm font-medium text-foreground">Network PIN Protection</label>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !pinEnabled;
                  setPinEnabled(next);
                  if (next && !pinValue) {
                    handleGeneratePin();
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  pinEnabled ? "bg-primary" : "bg-secondary"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    pinEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Require devices connecting to <code className="text-primary bg-card px-1 py-0.5 rounded border border-border">/files</code> to enter a PIN code.
            </p>

            {pinEnabled && (
              <div className="space-y-3 pt-2 animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    maxLength={12}
                    value={pinValue}
                    onChange={(e) => setPinValue(e.target.value)}
                    placeholder="Enter 4-8 digit PIN"
                    className="h-9 font-mono tracking-wider bg-card text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGeneratePin}
                    className="h-9 shrink-0 gap-1.5"
                    title="Generate Random PIN"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Random</span>
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tip: When you share the QR code, presenters can scan to automatically authenticate without typing.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-6 sm:py-4 bg-card">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || savedSuccess}
            className="min-w-28"
          >
            {savedSuccess ? (
              <>
                <Check className="h-4 w-4" />
                <span>Saved!</span>
              </>
            ) : saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Settings</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
