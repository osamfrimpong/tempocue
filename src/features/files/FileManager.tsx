import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Folder,
  Upload,
  FolderPlus,
  QrCode,
  FolderArchive,
  Trash2,
  Edit2,
  Download,
  Eye,
  FileText,
  Music,
  Film,
  Image as ImageIcon,
  HardDrive,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
  Plus,
  Check,
  ArrowLeft,
  Lock,
  Unlock,
  AlertCircle,
  Settings,
  KeyRound,
  X,
} from "lucide-react";
import type { FileEntry, StorageInfo } from "../../types/timer";
import {
  listFiles,
  getStorageInfo,
  createFolder,
  deleteEntry,
  renameEntry,
  setUploadsAllowed,
  openFolderInDesktop,
  uploadFiles,
  getFolderArchiveUrl,
  getFileRawUrl,
  setSessionPin,
  type UploadItem,
} from "./filesApi";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { QrCodeModal } from "./QrCodeModal";
import { StorageSettingsModal } from "./StorageSettingsModal";
import { PinUnlockGate } from "./PinUnlockGate";
import { useTempoCueStore } from "../../stores/useTempoCueStore";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export function FileManager() {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "audio" | "video" | "image" | "doc">("all");

  // Modals & UI states
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState<{
    uploading: boolean;
    percent: number;
    loaded: number;
    total: number;
    statusText: string;
    error?: string;
  }>({
    uploading: false,
    percent: 0,
    loaded: 0,
    total: 0,
    statusText: "",
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const rundown = useTempoCueStore((s) => s.rundown);
  const activeItemId = useTempoCueStore((s) => s.output.activeItemId);
  const attachFileToRundown = useTempoCueStore((s) => s.attachFileToRundown);
  const urls = useTempoCueStore((s) => s.urls);
  const [attachedId, setAttachedId] = useState<string | null>(null);

  const activeItem = rundown.find((i) => i.id === activeItemId) || rundown[0];
  const canInvoke = "__TAURI_INTERNALS__" in window;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const storage = await getStorageInfo();
      setStorageInfo(storage);
      if (storage?.currentPin) {
        setSessionPin(storage.currentPin);
      }

      const fileList = await listFiles(currentPath);
      setEntries(fileList);
      setPinUnlocked(true);
    } catch (err: any) {
      console.error("Failed loading files or storage info:", err);
      if (err?.message?.includes("PIN")) {
        setSessionPin(null);
        setPinUnlocked(false);
      }
      try {
        const storage = await getStorageInfo();
        setStorageInfo(storage);
        if (storage?.currentPin) {
          setSessionPin(storage.currentPin);
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Listen to realtime WebSocket files/changed events
  useEffect(() => {
    const handleFilesChanged = () => {
      void loadData();
    };
    window.addEventListener("tempocue:files-changed", handleFilesChanged);
    return () => {
      window.removeEventListener("tempocue:files-changed", handleFilesChanged);
    };
  }, [loadData]);

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs = [{ name: "Shared Files", path: "" }];
    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      crumbs.push({ name: part, path: accumulated });
    }
    return crumbs;
  }, [currentPath]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (searchQuery) {
        if (!e.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
      }
      if (typeFilter === "all" || e.isDir) return true;
      const ext = e.extension?.toLowerCase() || "";
      if (typeFilter === "audio") return ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext);
      if (typeFilter === "video") return ["mp4", "webm", "mov", "mkv"].includes(ext);
      if (typeFilter === "image") return ["png", "jpg", "jpeg", "webp", "svg", "gif"].includes(ext);
      if (typeFilter === "doc") return ["pdf", "pptx", "docx", "txt", "md", "csv", "json"].includes(ext);
      return true;
    });
  }, [entries, searchQuery, typeFilter]);

  // Upload handlers
  const handleFileUpload = async (uploadItems: UploadItem[]) => {
    if (!uploadItems.length) return;
    setUploadProgress({
      uploading: true,
      percent: 0,
      loaded: 0,
      total: uploadItems.reduce((acc, i) => acc + i.file.size, 0),
      statusText: `Uploading ${uploadItems.length} file(s)...`,
    });

    try {
      const maxBytes = storageInfo?.maxUploadSizeMb ? storageInfo.maxUploadSizeMb * 1024 * 1024 : undefined;
      await uploadFiles(currentPath, uploadItems, maxBytes, (percent, loaded, total) => {
        setUploadProgress({
          uploading: true,
          percent,
          loaded,
          total,
          statusText: `Uploading ${uploadItems.length} item(s)... ${percent}%`,
        });
      });
      setUploadProgress({
        uploading: false,
        percent: 100,
        loaded: 0,
        total: 0,
        statusText: "Upload complete!",
      });
      setTimeout(() => setUploadProgress((p) => ({ ...p, statusText: "" })), 3000);
      await loadData();
    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadProgress({
        uploading: false,
        percent: 0,
        loaded: 0,
        total: 0,
        statusText: "Upload failed",
        error: err.message || "Failed to upload",
      });
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const items: UploadItem[] = Array.from(e.target.files).map((file) => ({ file }));
      void handleFileUpload(items);
    }
    e.target.value = "";
  };

  const onFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const items: UploadItem[] = Array.from(e.target.files).map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));
      void handleFileUpload(items);
    }
    e.target.value = "";
  };

  // Drag & drop handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items: UploadItem[] = [];
    const dt = e.dataTransfer;

    if (dt.items && dt.items.length > 0) {
      const entryList: any[] = [];
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) entryList.push(entry);
        else {
          const file = item.getAsFile();
          if (file) items.push({ file });
        }
      }

      const traverse = async (entry: any, pathPrefix: string) => {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
          items.push({ file, relativePath: `${pathPrefix}${file.name}` });
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readEntriesBatch = (): Promise<any[]> =>
            new Promise((resolve, reject) => reader.readEntries(resolve, reject));

          let batch = await readEntriesBatch();
          while (batch.length > 0) {
            for (const child of batch) {
              await traverse(child, `${pathPrefix}${entry.name}/`);
            }
            batch = await readEntriesBatch();
          }
        }
      };

      for (const entry of entryList) {
        if (entry.isDirectory) {
          await traverse(entry, "");
        } else if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
          items.push({ file });
        }
      }
    } else if (dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        items.push({ file: dt.files[i] });
      }
    }

    if (items.length > 0) {
      void handleFileUpload(items);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const path = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
    try {
      await createFolder(path);
      setNewFolderName("");
      setShowNewFolderModal(false);
      await loadData();
    } catch (err) {
      console.error("Create folder error:", err);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const parent = currentPath ? `${currentPath}/` : "";
    const to = `${parent}${renameValue.trim()}`;
    try {
      await renameEntry(renameTarget.path, to);
      setRenameTarget(null);
      setRenameValue("");
      await loadData();
    } catch (err) {
      console.error("Rename error:", err);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEntry(deleteTarget.path);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleAttachToActiveItem = async (entry: FileEntry) => {
    if (!activeItem) return;
    const rawUrl = getFileRawUrl(entry.path, storageInfo?.currentPin);
    try {
      await attachFileToRundown(activeItem.id, rawUrl);
      setAttachedId(entry.path);
      setTimeout(() => setAttachedId(null), 2000);
    } catch (err) {
      console.error("Failed to attach file to active rundown item:", err);
    }
  };

  const toggleUploads = async () => {
    if (!storageInfo) return;
    const next = !storageInfo.uploadsAllowed;
    await setUploadsAllowed(next);
    setStorageInfo({ ...storageInfo, uploadsAllowed: next });
  };

  const handleLockSession = () => {
    setSessionPin(null);
    setPinUnlocked(false);
  };

  if (!canInvoke && loading && !storageInfo) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <RefreshCw className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-xs text-muted-foreground">Connecting to shared files...</p>
      </div>
    );
  }

  if (!canInvoke && storageInfo?.pinRequired && !pinUnlocked) {
    return <PinUnlockGate onUnlocked={() => void loadData()} />;
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative min-h-screen bg-background text-foreground flex flex-col font-sans select-none"
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard in Chrome/Safari/Firefox
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={onFolderInputChange}
      />

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md border-4 border-dashed border-primary m-4 rounded-md pointer-events-none">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/20 text-primary border border-primary/30 animate-bounce">
              <Upload className="h-10 w-10" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">Drop files or folders here</p>
              <p className="text-sm text-muted-foreground mt-1">
                Folder hierarchies and media files will be saved in {currentPath || "root"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 flex h-14 sm:h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/95 backdrop-blur-md px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            to="/control"
            className="inline-flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-md border border-border bg-background px-2 sm:px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground shrink-0"
            title="Return to Controller"
          >
            <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Controller</span>
          </Link>
          <div className="h-4 w-[1px] bg-border shrink-0" />
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-7 w-7 sm:h-8 sm:w-8 place-items-center rounded-md bg-primary text-primary-foreground shrink-0">
              <HardDrive className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm sm:text-base font-semibold tracking-tight text-foreground">
                Network File Hub
              </div>
              <div className="truncate text-[10px] text-muted-foreground hidden sm:block">
                Local network asset sharing
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Storage stats badge (Desktop) */}
          {storageInfo && (
            <div className="hidden lg:flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <span>{storageInfo.totalFiles} files</span>
              <span>&bull;</span>
              <span>{(storageInfo.totalSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
              <span>&bull;</span>
              <span>
                Max: {storageInfo.maxUploadSizeMb >= 1024 ? `${(storageInfo.maxUploadSizeMb / 1024).toFixed(storageInfo.maxUploadSizeMb % 1024 === 0 ? 0 : 1)} GB` : `${storageInfo.maxUploadSizeMb} MB`}
              </span>
              {canInvoke && storageInfo.currentPin && (
                <>
                  <span>&bull;</span>
                  <span className="inline-flex items-center gap-1 font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                    <KeyRound className="h-3 w-3" />
                    PIN: {storageInfo.currentPin}
                  </span>
                </>
              )}
              {canInvoke && (
                <>
                  <span>&bull;</span>
                  <button
                    onClick={toggleUploads}
                    className="flex items-center gap-1 font-medium hover:text-foreground"
                    title={storageInfo.uploadsAllowed ? "Uploads allowed over network" : "Uploads locked (read-only)"}
                  >
                    {storageInfo.uploadsAllowed ? (
                      <>
                        <Unlock className="h-3 w-3 text-primary" />
                        <span className="text-primary font-medium">Uploads On</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3 w-3 text-amber-400" />
                        <span className="text-amber-400 font-medium">Read-Only</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Settings Button (Host only) */}
          {canInvoke && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsModalOpen(true)}
              className="h-8 px-2.5 sm:px-3 text-xs"
              title="Configure max upload size and PIN security"
            >
              <Settings className="h-3.5 w-3.5 text-primary" />
              <span className="hidden md:inline">Settings</span>
            </Button>
          )}

          {/* QR Share Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQrModalOpen(true)}
            className="h-8 px-2.5 sm:px-3 text-xs border-primary/30 text-primary hover:bg-primary/10"
            title="Show QR code for network sharing"
          >
            <QrCode className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Share QR</span>
            <span className="sm:hidden font-medium">QR</span>
          </Button>

          {/* Lock session (Network guest only) */}
          {!canInvoke && storageInfo?.pinRequired && pinUnlocked && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLockSession}
              className="h-8 px-2.5 sm:px-3 text-xs border-border text-muted-foreground hover:text-foreground"
              title="Lock session"
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Lock</span>
            </Button>
          )}

          {/* Open folder natively in Finder / Explorer */}
          {canInvoke && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openFolderInDesktop()}
              className="hidden xl:inline-flex h-8 text-xs"
              title="Open shared storage in Finder / Explorer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Reveal</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => void loadData()}
            className="h-8 w-8 sm:h-9 sm:w-9 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Refresh files"
          >
            <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 md:p-6 flex flex-col gap-3 sm:gap-4 md:gap-6">
        {/* Mobile Storage & Network Status Banner (Visible on mobile/tablet screens < lg) */}
        {storageInfo && (
          <div className="flex lg:hidden flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-muted-foreground text-[11px] sm:text-xs">
              <span className="font-semibold text-foreground">{storageInfo.totalFiles} {storageInfo.totalFiles === 1 ? "file" : "files"}</span>
              <span>&bull;</span>
              <span>{(storageInfo.totalSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
              <span>&bull;</span>
              <span>
                Max {storageInfo.maxUploadSizeMb >= 1024 ? `${(storageInfo.maxUploadSizeMb / 1024).toFixed(storageInfo.maxUploadSizeMb % 1024 === 0 ? 0 : 1)} GB` : `${storageInfo.maxUploadSizeMb} MB`}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {canInvoke && storageInfo.currentPin && (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                  <KeyRound className="h-3 w-3" />
                  PIN: {storageInfo.currentPin}
                </span>
              )}
              {storageInfo.uploadsAllowed ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px] border border-emerald-500/20">
                  <Unlock className="h-3 w-3" />
                  <span>Uploads On</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-[11px] border border-amber-500/20">
                  <Lock className="h-3 w-3" />
                  <span>Read-Only</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Read-Only Mode Banner if uploads are locked */}
        {storageInfo && !storageInfo.uploadsAllowed && (
          <div className="flex items-center gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
            <Lock className="h-4 w-4 shrink-0" />
            <span>Network uploads are currently locked in read-only mode by host. Downloads remain available.</span>
          </div>
        )}

        {/* Breadcrumbs & Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-border bg-card p-3 sm:p-4">
          {/* Breadcrumb Path - Scrollable on mobile */}
          <div className="flex items-center gap-1 text-xs sm:text-sm overflow-x-auto no-scrollbar py-0.5 min-w-0 flex-nowrap shrink">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <div key={crumb.path} className="flex items-center gap-1 shrink-0">
                  {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <button
                    onClick={() => setCurrentPath(crumb.path)}
                    disabled={isLast}
                    className={`rounded px-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                      isLast
                        ? "font-semibold text-foreground cursor-default"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {crumb.name}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Action Buttons - Optimized for touch on mobile */}
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewFolderModal(true)}
              className="flex-1 sm:flex-initial h-9 text-xs"
            >
              <FolderPlus className="h-4 w-4 text-primary" />
              <span>New Folder</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => folderInputRef.current?.click()}
              className="hidden sm:inline-flex h-9 text-xs"
              title="Upload folder hierarchy (desktop browsers)"
            >
              <FolderArchive className="h-4 w-4 text-primary" />
              <span>Upload Folder</span>
            </Button>

            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={storageInfo?.uploadsAllowed === false}
              className="flex-1 sm:flex-initial h-9 text-xs font-semibold shadow-sm"
            >
              <Upload className="h-4 w-4" />
              <span>Upload Files</span>
            </Button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 pr-8 text-xs bg-card"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1 overflow-x-auto no-scrollbar w-full sm:w-auto">
            {(["all", "audio", "video", "image", "doc"] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setTypeFilter(filter)}
                className={`flex-1 sm:flex-initial shrink-0 text-center rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  typeFilter === filter
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* File and Folder Listing */}
        {loading && entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-muted-foreground">
            <RefreshCw className="h-7 w-7 sm:h-8 sm:w-8 animate-spin mb-3 text-primary" />
            <p className="text-xs sm:text-sm">Loading files...</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 sm:py-20 rounded-md border border-dashed border-border bg-card/40 p-4 sm:p-8 text-center">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-md bg-secondary text-muted-foreground mb-3 sm:mb-4 border border-border">
              <Folder className="h-7 w-7 sm:h-8 sm:w-8" />
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              {searchQuery ? "No matching files found" : "No files in this folder"}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-5">
              {searchQuery
                ? `No files or folders matched "${searchQuery}". Try a different search.`
                : "Upload photos, videos, audio, or documents from your device to share over the local network."}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={storageInfo?.uploadsAllowed === false}
                className="h-9 px-4 text-xs font-semibold"
              >
                <Upload className="h-4 w-4" />
                <span>Upload First File</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredEntries.map((entry) => {
              const ext = entry.extension?.toLowerCase() || "";
              const isAudio = ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext);
              const isVideo = ["mp4", "webm", "mov", "mkv"].includes(ext);
              const isImage = ["png", "jpg", "jpeg", "webp", "svg", "gif"].includes(ext);
              const isDoc = ["pdf", "pptx", "docx", "txt", "md", "csv", "json"].includes(ext);

              if (entry.isDir) {
                const archiveUrl = getFolderArchiveUrl(entry.path, storageInfo?.currentPin);
                return (
                  <div
                    key={entry.path}
                    className="group relative flex flex-col justify-between rounded-md border border-border bg-card p-3.5 sm:p-4 hover:border-border/80 hover:bg-accent/20 transition-all shadow-sm"
                  >
                    <div
                      onClick={() => setCurrentPath(entry.path)}
                      className="cursor-pointer flex items-center gap-3 active:opacity-80"
                    >
                      <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20 group-hover:scale-105 transition-transform">
                        <Folder className="h-5 w-5 sm:h-6 sm:w-6 fill-primary/20" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors">
                          {entry.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Folder</p>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                      <a
                        href={archiveUrl}
                        download={`${entry.name}.zip`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 transition-colors"
                        title="Download as ZIP"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>ZIP</span>
                      </a>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setRenameTarget(entry);
                            setRenameValue(entry.name);
                          }}
                          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 transition-colors"
                          title="Rename"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(entry)}
                          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:bg-destructive/20 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // File Card
              const rawUrl = getFileRawUrl(entry.path, storageInfo?.currentPin);
              const isAttached = attachedId === entry.path;

              return (
                <div
                  key={entry.path}
                  className="group relative flex flex-col justify-between rounded-md border border-border bg-card p-3.5 sm:p-4 hover:border-border/80 hover:bg-accent/20 transition-all shadow-sm"
                >
                  <div
                    onClick={() => setPreviewEntry(entry)}
                    className="cursor-pointer flex items-center gap-3 active:opacity-80"
                  >
                    <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground border border-border group-hover:scale-105 transition-transform overflow-hidden relative">
                      {isAudio && <Music className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                      {isVideo && <Film className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                      {isImage && (
                        <>
                          <img
                            src={rawUrl}
                            alt={entry.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              const fallback = e.currentTarget.parentElement?.querySelector(".img-fallback");
                              if (fallback) (fallback as HTMLElement).style.display = "flex";
                            }}
                          />
                          <div className="img-fallback hidden items-center justify-center">
                            <ImageIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                          </div>
                        </>
                      )}
                      {isDoc && <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                      {!isAudio && !isVideo && !isImage && !isDoc && (
                        <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors">
                        {entry.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {(entry.sizeBytes / 1024 / 1024).toFixed(2)} MB &bull; {ext.toUpperCase() || "FILE"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
                    {/* Left: Attach button if activeItem, or preview trigger */}
                    {activeItem ? (
                      <button
                        onClick={() => void handleAttachToActiveItem(entry)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors shrink-0 ${
                          isAttached
                            ? "text-primary font-medium bg-primary/10"
                            : "hover:text-foreground text-muted-foreground hover:bg-accent"
                        }`}
                        title={`Attach to active cue: ${activeItem.title}`}
                      >
                        {isAttached ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        <span>{isAttached ? "Attached" : "Attach"}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setPreviewEntry(entry)}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Preview file"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Preview</span>
                      </button>
                    )}

                    {/* Right: Touch-friendly icon action buttons */}
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      {activeItem && (
                        <button
                          onClick={() => setPreviewEntry(entry)}
                          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 transition-colors"
                          title="Preview"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      )}
                      <a
                        href={rawUrl}
                        download={entry.name}
                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 transition-colors"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => {
                          setRenameTarget(entry);
                          setRenameValue(entry.name);
                        }}
                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 transition-colors"
                        title="Rename"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(entry)}
                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:bg-destructive/20 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Upload Progress Toast */}
      {(uploadProgress.uploading || uploadProgress.statusText) && (
        <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80 z-40 rounded-md border border-border bg-card shadow-2xl p-3.5 sm:p-4 text-foreground animate-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground">
              {uploadProgress.uploading ? "File Transfer in Progress" : "Transfer Status"}
            </span>
            <span className="text-xs font-mono text-primary font-bold">{uploadProgress.percent}%</span>
          </div>
          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 truncate">
            {uploadProgress.error ? (
              <span className="text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {uploadProgress.error}
              </span>
            ) : (
              uploadProgress.statusText
            )}
          </p>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 sm:p-6 shadow-2xl text-foreground">
            <h3 className="text-base font-semibold mb-1">Create New Folder</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Enter folder name in {currentPath ? `/${currentPath}` : "root"}
            </p>
            <Input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateFolder()}
              placeholder="Folder name"
              className="h-10 text-sm"
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleCreateFolder()}
                disabled={!newFolderName.trim()}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 sm:p-6 shadow-2xl text-foreground">
            <h3 className="text-base font-semibold mb-1">Rename Item</h3>
            <p className="text-xs text-muted-foreground mb-4">Enter new name for {renameTarget.name}</p>
            <Input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleRename()}
              className="h-10 text-sm"
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRenameTarget(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRename()}
                disabled={!renameValue.trim() || renameValue === renameTarget.name}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 sm:p-6 shadow-2xl text-foreground">
            <h3 className="text-base font-semibold text-destructive mb-1">Delete {deleteTarget.isDir ? "Folder" : "File"}?</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Are you sure you want to permanently delete <strong className="text-foreground">{deleteTarget.name}</strong>?
              {deleteTarget.isDir && " All files and subfolders inside will also be removed."}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      <MediaPreviewModal
        entry={previewEntry}
        onClose={() => setPreviewEntry(null)}
        pin={storageInfo?.currentPin || null}
      />

      {/* QR Code Sharing Modal */}
      <QrCodeModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        pin={storageInfo?.currentPin || null}
      />

      {/* Storage Settings Modal */}
      {storageInfo && (
        <StorageSettingsModal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          storageInfo={storageInfo}
          onSettingsSaved={() => void loadData()}
        />
      )}
    </div>
  );
}
