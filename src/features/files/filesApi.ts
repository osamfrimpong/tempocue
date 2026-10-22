import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, StorageInfo, StorageConfig } from "../../types/timer";
import { useTempoCueStore } from "../../stores/useTempoCueStore";

const canInvoke = "__TAURI_INTERNALS__" in window;
const PIN_STORAGE_KEY = "tempocue_files_pin";

let inMemoryPin: string | null = null;

export function getSessionPin(): string | null {
  if (inMemoryPin) return inMemoryPin;
  if (typeof window === "undefined") return null;
  const urlParams = new URLSearchParams(window.location.search);
  const urlPin = urlParams.get("pin");
  if (urlPin) {
    const trimmed = urlPin.trim();
    setSessionPin(trimmed);
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("pin");
      window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    } catch {}
    return trimmed;
  }
  try {
    const saved = sessionStorage.getItem(PIN_STORAGE_KEY) || localStorage.getItem(PIN_STORAGE_KEY);
    if (saved) {
      inMemoryPin = saved.trim();
      return inMemoryPin;
    }
  } catch {}
  return null;
}

export function setSessionPin(pin: string | null): void {
  const trimmed = pin && pin.trim() ? pin.trim() : null;
  inMemoryPin = trimmed;
  if (typeof window === "undefined") return;
  if (trimmed) {
    try { sessionStorage.setItem(PIN_STORAGE_KEY, trimmed); } catch {}
    try { localStorage.setItem(PIN_STORAGE_KEY, trimmed); } catch {}
    try {
      document.cookie = `tempocue_pin=${encodeURIComponent(trimmed)}; Path=/; Max-Age=2592000; SameSite=Lax`;
    } catch {}
  } else {
    try { sessionStorage.removeItem(PIN_STORAGE_KEY); } catch {}
    try { localStorage.removeItem(PIN_STORAGE_KEY); } catch {}
    try {
      document.cookie = "tempocue_pin=; Path=/; Max-Age=0; SameSite=Lax";
    } catch {}
  }
}

export function getAuthHeaders(): Record<string, string> {
  const pin = getSessionPin();
  const headers: Record<string, string> = {};
  if (pin) {
    headers["X-TempoCue-Pin"] = pin;
  }
  return headers;
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const isTauri = "__TAURI_INTERNALS__" in window || window.location.protocol === "tauri:";
  const isViteDev = window.location.port === "1420";
  if (isTauri || isViteDev) {
    const urls = useTempoCueStore.getState().urls;
    const port = urls?.port || 4310;
    return `http://127.0.0.1:${port}`;
  }
  return "";
}

export function getFileRawUrl(path: string, pinOverride?: string | null): string {
  const clean = path.replace(/^\/+/, "");
  const pin = pinOverride || getSessionPin();
  const pinQuery = pin ? `?pin=${encodeURIComponent(pin)}` : "";
  const encodedPath = clean
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${getApiBaseUrl()}/api/files/raw/${encodedPath}${pinQuery}`;
}

export function getFolderArchiveUrl(path: string, pinOverride?: string | null): string {
  const clean = path.replace(/^\/+/, "");
  const pin = pinOverride || getSessionPin();
  const pinQuery = pin ? `?pin=${encodeURIComponent(pin)}` : "";
  const encodedPath = clean
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${getApiBaseUrl()}/api/files/archive/${encodedPath}${pinQuery}`;
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/files/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      setSessionPin(pin);
      return true;
    } else {
      setSessionPin(null);
    }
  } catch (err) {
    setSessionPin(null);
    console.error("PIN verification error:", err);
  }
  return false;
}

export async function listFiles(path = ""): Promise<FileEntry[]> {
  if (canInvoke) {
    try {
      return await invoke<FileEntry[]>("get_shared_files", { path: path || null });
    } catch (e) {
      console.warn("Tauri invoke get_shared_files failed, falling back to HTTP:", e);
    }
  }

  const pin = getSessionPin();
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (pin) params.set("pin", pin);
  const query = params.toString() ? `?${params.toString()}` : "";

  const res = await fetch(`${getApiBaseUrl()}/api/files/list${query}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function getStorageInfo(): Promise<StorageInfo> {
  if (canInvoke) {
    try {
      const info = await invoke<StorageInfo>("get_shared_storage_info");
      if (info?.currentPin) {
        setSessionPin(info.currentPin);
      }
      return info;
    } catch (e) {
      console.warn("Tauri invoke get_shared_storage_info failed, falling back to HTTP:", e);
    }
  }

  const pin = getSessionPin();
  const query = pin ? `?pin=${encodeURIComponent(pin)}` : "";
  const res = await fetch(`${getApiBaseUrl()}/api/files/storage${query}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const info: StorageInfo = await res.json();
  if (info?.currentPin) {
    setSessionPin(info.currentPin);
  }
  return info;
}

export async function updateStorageConfig(config: StorageConfig): Promise<void> {
  if (canInvoke) {
    try {
      await invoke("set_shared_storage_config", {
        allowNetworkUploads: config.allowNetworkUploads,
        maxUploadSizeMb: config.maxUploadSizeMb,
        pin: config.pin,
      });
      setSessionPin(config.pin || null);
      return;
    } catch (e) {
      console.warn("Tauri invoke set_shared_storage_config failed, falling back to HTTP:", e);
    }
  }

  const res = await fetch(`${getApiBaseUrl()}/api/files/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  setSessionPin(config.pin || null);
}

export async function createFolder(path: string): Promise<void> {
  if (canInvoke) {
    try {
      await invoke("create_shared_folder", { path });
      return;
    } catch (e) {
      console.warn("Tauri invoke create_shared_folder failed, falling back to HTTP:", e);
    }
  }

  const res = await fetch(`${getApiBaseUrl()}/api/files/mkdir`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function deleteEntry(path: string): Promise<void> {
  if (canInvoke) {
    try {
      await invoke("delete_shared_entry", { path });
      return;
    } catch (e) {
      console.warn("Tauri invoke delete_shared_entry failed, falling back to HTTP:", e);
    }
  }

  const res = await fetch(`${getApiBaseUrl()}/api/files/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function renameEntry(from: string, to: string): Promise<void> {
  if (canInvoke) {
    try {
      await invoke("rename_shared_entry", { from, to });
      return;
    } catch (e) {
      console.warn("Tauri invoke rename_shared_entry failed, falling back to HTTP:", e);
    }
  }

  const res = await fetch(`${getApiBaseUrl()}/api/files/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ from, to }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function setUploadsAllowed(allowed: boolean): Promise<void> {
  if (canInvoke) {
    try {
      await invoke("set_allow_network_uploads", { allowed });
      return;
    } catch (e) {
      console.warn("Tauri invoke set_allow_network_uploads failed:", e);
    }
  }
}

export async function openFolderInDesktop(): Promise<void> {
  if (canInvoke) {
    await invoke("open_shared_storage_folder");
  }
}

export type UploadItem = {
  file: File;
  relativePath?: string;
};

export async function uploadFiles(
  targetDir: string,
  items: UploadItem[],
  maxUploadSizeBytes?: number,
  onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (maxUploadSizeBytes && maxUploadSizeBytes > 0) {
    for (const item of items) {
      if (item.file.size > maxUploadSizeBytes) {
        const fileMb = (item.file.size / 1024 / 1024).toFixed(1);
        const maxMb = Math.round(maxUploadSizeBytes / (1024 * 1024));
        throw new Error(
          `"${item.file.name}" (${fileMb} MB) exceeds the maximum allowed upload limit of ${maxMb} MB.`,
        );
      }
    }
  }

  const formData = new FormData();
  let totalBytes = 0;

  for (const item of items) {
    const filename = item.relativePath || item.file.name;
    formData.append("files", item.file, filename);
    totalBytes += item.file.size;
  }

  const pin = getSessionPin();
  const params = new URLSearchParams();
  if (targetDir) params.set("dir", targetDir);
  if (pin) params.set("pin", pin);
  const queryString = params.toString() ? `?${params.toString()}` : "";
  const uploadUrl = `${getApiBaseUrl()}/api/files/upload${queryString}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    if (pin) {
      xhr.setRequestHeader("X-TempoCue-Pin", pin);
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
          onProgress(pct, event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100, totalBytes, totalBytes);
        resolve();
      } else {
        reject(new Error(xhr.responseText || `Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during file upload. Check connection to host."));
    };

    xhr.onabort = () => {
      reject(new Error("File upload aborted."));
    };

    xhr.ontimeout = () => {
      reject(new Error("File upload timed out."));
    };

    xhr.send(formData);
  });
}


