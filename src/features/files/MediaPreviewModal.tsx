import { useState, useEffect } from "react";
import { X, Download, Plus, Music, Film, FileText, Image as ImageIcon, Volume2, Check, AlertCircle, RefreshCw } from "lucide-react";
import type { FileEntry } from "../../types/timer";
import { getFileRawUrl } from "./filesApi";
import { useTempoCueStore } from "../../stores/useTempoCueStore";
import { Button } from "../../components/ui/button";

type MediaPreviewModalProps = {
  entry: FileEntry | null;
  onClose: () => void;
  pin?: string | null;
};

export function MediaPreviewModal({ entry, onClose, pin }: MediaPreviewModalProps) {
  const [attachedSuccess, setAttachedSuccess] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const rundown = useTempoCueStore((s) => s.rundown);
  const activeItemId = useTempoCueStore((s) => s.output.activeItemId);
  const attachFileToRundown = useTempoCueStore((s) => s.attachFileToRundown);

  useEffect(() => {
    setImageError(false);
    setImageLoading(true);
    setRetryCount(0);
  }, [entry?.path]);

  if (!entry || entry.isDir) return null;

  const effectivePin = pin || undefined;
  const baseUrl = getFileRawUrl(entry.path, effectivePin);
  const retryParam = retryCount > 0 ? (baseUrl.includes("?") ? `&_r=${retryCount}` : `?_r=${retryCount}`) : "";
  const rawUrl = `${baseUrl}${retryParam}`;
  const ext = entry.extension?.toLowerCase() || "";
  const isAudio = ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext);
  const isVideo = ["mp4", "webm", "mov", "mkv"].includes(ext);
  const isImage = ["png", "jpg", "jpeg", "webp", "svg", "gif", "bmp"].includes(ext);
  const isPdf = ext === "pdf";

  const activeItem = rundown.find((i) => i.id === activeItemId) || rundown[0];

  const handleAttach = async (itemId: string) => {
    try {
      await attachFileToRundown(itemId, rawUrl);
      setAttachedSuccess(true);
      setTimeout(() => setAttachedSuccess(false), 2000);
    } catch (err) {
      console.error("Failed attaching file to rundown:", err);
    }
  };

  const handleRetry = () => {
    setImageError(false);
    setImageLoading(true);
    setRetryCount((c) => c + 1);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl rounded-md border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh] text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4 bg-card">
          <div className="flex items-center gap-2.5 sm:gap-3 overflow-hidden min-w-0">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20">
              {isAudio && <Music className="h-4 w-4 sm:h-5 sm:w-5" />}
              {isVideo && <Film className="h-4 w-4 sm:h-5 sm:w-5" />}
              {isImage && <ImageIcon className="h-4 w-4 sm:h-5 sm:w-5" />}
              {!isAudio && !isVideo && !isImage && <FileText className="h-4 w-4 sm:h-5 sm:w-5" />}
            </div>
            <div className="truncate min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-foreground truncate">{entry.name}</h2>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                {entry.path} &bull; {(entry.sizeBytes / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 ml-2"
            title="Close preview"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content Viewer */}
        <div className="flex-1 overflow-auto p-3 sm:p-6 flex flex-col items-center justify-center bg-background min-h-[220px] sm:min-h-[300px]">
          {isAudio && (
            <div className="w-full max-w-md flex flex-col items-center gap-6 py-8">
              <div className="h-28 w-28 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-lg shadow-primary/5">
                <Volume2 className="h-12 w-12 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{entry.name}</p>
                <p className="text-xs text-muted-foreground mt-1">Audio Track Preview</p>
              </div>
              <audio controls autoPlay className="w-full rounded-md" src={rawUrl}>
                Your browser does not support audio playback.
              </audio>
            </div>
          )}

          {isVideo && (
            <div className="w-full flex items-center justify-center">
              <video
                controls
                autoPlay
                className="max-h-[60vh] max-w-full rounded-md border border-border shadow-md"
                src={rawUrl}
              >
                Your browser does not support video playback.
              </video>
            </div>
          )}

          {isImage && (
            <div className="max-h-[65vh] flex items-center justify-center overflow-hidden relative min-h-[160px] w-full">
              {imageError ? (
                <div className="text-center py-12 flex flex-col items-center gap-3">
                  <div className="h-16 w-16 rounded-md bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
                    <AlertCircle className="h-8 w-8" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Unable to load image preview</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      The file could not be rendered. It may be an incomplete upload, corrupted file, or unsupported format.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleRetry}
                    className="mt-2"
                  >
                    Retry Preview
                  </Button>
                </div>
              ) : (
                <>
                  {imageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <img
                    src={rawUrl}
                    alt={entry.name}
                    onLoad={() => setImageLoading(false)}
                    onError={() => {
                      setImageLoading(false);
                      setImageError(true);
                    }}
                    className={`max-h-[60vh] max-w-full object-contain rounded-md border border-border shadow-md transition-opacity duration-200 ${
                      imageLoading ? "opacity-0" : "opacity-100"
                    }`}
                  />
                </>
              )}
            </div>
          )}

          {isPdf && (
            <iframe
              src={rawUrl}
              title={entry.name}
              className="w-full h-[60vh] rounded-md border border-border bg-white"
            />
          )}

          {!isAudio && !isVideo && !isImage && !isPdf && (
            <div className="text-center py-12 flex flex-col items-center gap-4">
              <div className="h-20 w-20 rounded-md bg-secondary flex items-center justify-center text-muted-foreground border border-border">
                <FileText className="h-10 w-10" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{entry.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Preview not available for this file type ({entry.extension || "unknown"}).
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6 sm:py-4 bg-card">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {activeItem && (
              <>
                <span className="text-xs text-muted-foreground shrink-0">Cue:</span>
                <Button
                  variant={attachedSuccess ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => handleAttach(activeItem.id)}
                  disabled={attachedSuccess}
                  className={`text-xs h-8 truncate max-w-full ${attachedSuccess ? "border-primary/40 bg-primary/10 text-primary" : ""}`}
                >
                  {attachedSuccess ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{attachedSuccess ? "Attached!" : `Active: ${activeItem.title}`}</span>
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <a
              href={rawUrl}
              download={entry.name}
              className="inline-flex h-9 sm:h-8 flex-1 sm:flex-initial items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shadow-sm"
            >
              <Download className="h-4 w-4" />
              <span>Download File</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
