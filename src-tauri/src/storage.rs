use mime_guess::MimeGuess;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub total_files: usize,
    pub total_dirs: usize,
    pub total_size_bytes: u64,
    pub storage_path: String,
    pub uploads_allowed: bool,
    pub max_upload_size_mb: u64,
    pub pin_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_pin: Option<String>,
}

/// Normalizes and ensures that `rel_path` stays within `base_dir` to prevent path traversal attacks.
pub fn resolve_safe_path(base_dir: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for comp in Path::new(rel_path).components() {
        match comp {
            Component::Normal(p) => normalized.push(p),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Directory traversal attempt ('..') rejected".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                // Reject absolute paths or Windows prefixes in relative parameter
                return Err("Absolute path components rejected in relative path".to_string());
            }
        }
    }

    let resolved = base_dir.join(&normalized);
    // If base_dir doesn't exist yet, create it
    if !base_dir.exists() {
        fs::create_dir_all(base_dir)
            .map_err(|e| format!("failed to create base directory {}: {e}", base_dir.display()))?;
    }

    let canonical_base = base_dir
        .canonicalize()
        .map_err(|e| format!("cannot canonicalize base path: {e}"))?;

    // If candidate path exists, verify its canonical root matches base
    if resolved.exists() {
        let canonical_resolved = resolved
            .canonicalize()
            .map_err(|e| format!("cannot canonicalize candidate path: {e}"))?;
        if !canonical_resolved.starts_with(&canonical_base) {
            return Err("Resolved path escapes base directory".to_string());
        }
    } else {
        // If not created yet, check parent
        let mut parent = resolved.as_path();
        while let Some(p) = parent.parent() {
            if p.exists() {
                let canonical_p = p
                    .canonicalize()
                    .map_err(|e| format!("cannot canonicalize parent: {e}"))?;
                if !canonical_p.starts_with(&canonical_base) {
                    return Err("Candidate parent escapes base directory".to_string());
                }
                break;
            }
            parent = p;
        }
    }

    Ok(resolved)
}

/// Lists files and directories inside a relative subfolder of `base_dir`.
pub fn list_directory(base_dir: &Path, rel_path: &str) -> Result<Vec<FileEntry>, String> {
    let target = resolve_safe_path(base_dir, rel_path)?;
    if !target.exists() {
        return Ok(Vec::new());
    }
    if !target.is_dir() {
        return Err(format!("{} is not a directory", target.display()));
    }

    let read_dir = fs::read_dir(&target)
        .map_err(|e| format!("failed to read directory {}: {e}", target.display()))?;

    let mut entries = Vec::new();

    for item in read_dir {
        let entry = match item {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files (.DS_Store, etc.)
        if file_name.starts_with('.') {
            continue;
        }

        let is_dir = file_type.is_dir();
        let path_obj = entry.path();
        let metadata = entry.metadata().ok();

        let size_bytes = if is_dir {
            0
        } else {
            metadata.as_ref().map(|m| m.len()).unwrap_or(0)
        };

        let modified_ms = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);

        let extension = if is_dir {
            None
        } else {
            path_obj
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_lowercase())
        };

        let mime_type = if is_dir {
            None
        } else {
            Some(
                MimeGuess::from_path(&path_obj)
                    .first_or_octet_stream()
                    .to_string(),
            )
        };

        let item_rel_path = if rel_path.is_empty() {
            file_name.clone()
        } else {
            format!("{}/{}", rel_path.trim_matches('/'), file_name)
        };

        entries.push(FileEntry {
            name: file_name,
            path: item_rel_path,
            is_dir,
            size_bytes,
            modified_ms,
            mime_type,
            extension,
        });
    }

    // Sort directories first, then alphabetical by name
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// Creates a directory recursively within `base_dir`.
pub fn create_directory(base_dir: &Path, rel_path: &str) -> Result<(), String> {
    let target = resolve_safe_path(base_dir, rel_path)?;
    fs::create_dir_all(&target)
        .map_err(|e| format!("failed to create directory {}: {e}", target.display()))?;
    Ok(())
}

/// Deletes a file or directory recursively within `base_dir`.
pub fn delete_entry(base_dir: &Path, rel_path: &str) -> Result<(), String> {
    let target = resolve_safe_path(base_dir, rel_path)?;
    if !target.exists() {
        return Ok(());
    }

    if target.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("failed to remove directory {}: {e}", target.display()))?;
    } else {
        fs::remove_file(&target)
            .map_err(|e| format!("failed to remove file {}: {e}", target.display()))?;
    }
    Ok(())
}

/// Renames or moves a file/directory within `base_dir`.
pub fn rename_entry(base_dir: &Path, from_rel: &str, to_rel: &str) -> Result<(), String> {
    let from_target = resolve_safe_path(base_dir, from_rel)?;
    let to_target = resolve_safe_path(base_dir, to_rel)?;

    if !from_target.exists() {
        return Err(format!("source path does not exist: {from_rel}"));
    }

    if let Some(parent) = to_target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create destination folder: {e}"))?;
    }

    fs::rename(&from_target, &to_target).map_err(|e| {
        format!(
            "failed to rename {} to {}: {e}",
            from_target.display(),
            to_target.display()
        )
    })?;
    Ok(())
}

/// Computes overall storage statistics for `base_dir`.
pub fn get_storage_info(
    base_dir: &Path,
    uploads_allowed: bool,
    max_upload_size_mb: u64,
    pin_required: bool,
    current_pin: Option<String>,
) -> StorageInfo {
    let mut total_files = 0;
    let mut total_dirs = 0;
    let mut total_size_bytes = 0;

    fn walk(dir: &Path, files: &mut usize, dirs: &mut usize, size: &mut u64) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() {
                        *dirs += 1;
                        walk(&entry.path(), files, dirs, size);
                    } else if ft.is_file() {
                        *files += 1;
                        if let Ok(m) = entry.metadata() {
                            *size += m.len();
                        }
                    }
                }
            }
        }
    }

    if base_dir.exists() {
        walk(
            base_dir,
            &mut total_files,
            &mut total_dirs,
            &mut total_size_bytes,
        );
    }

    StorageInfo {
        total_files,
        total_dirs,
        total_size_bytes,
        storage_path: base_dir.to_string_lossy().to_string(),
        uploads_allowed,
        max_upload_size_mb,
        pin_required,
        current_pin,
    }
}

/// Recursively packages a folder inside `base_dir` into an in-memory ZIP archive.
pub fn zip_directory(base_dir: &Path, rel_path: &str) -> Result<Vec<u8>, String> {
    let target = resolve_safe_path(base_dir, rel_path)?;
    if !target.exists() {
        return Err(format!("folder does not exist: {rel_path}"));
    }
    if !target.is_dir() {
        return Err(format!("{rel_path} is not a directory"));
    }

    let buffer = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buffer);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    fn add_dir_to_zip<W: Write + std::io::Seek>(
        zip: &mut ZipWriter<W>,
        base_dir: &Path,
        current_dir: &Path,
        options: SimpleFileOptions,
    ) -> Result<(), String> {
        let read_dir = fs::read_dir(current_dir)
            .map_err(|e| format!("failed to read directory {}: {e}", current_dir.display()))?;

        for item in read_dir {
            let entry = match item {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }

            let rel_entry_path = path
                .strip_prefix(base_dir)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();

            if path.is_dir() {
                let dir_path = format!("{rel_entry_path}/");
                zip.add_directory(&dir_path, options)
                    .map_err(|e| format!("zip error adding directory: {e}"))?;
                add_dir_to_zip(zip, base_dir, &path, options)?;
            } else if path.is_file() {
                zip.start_file(&rel_entry_path, options)
                    .map_err(|e| format!("zip error starting file {rel_entry_path}: {e}"))?;
                let mut f = fs::File::open(&path)
                    .map_err(|e| format!("failed to open file {}: {e}", path.display()))?;
                let mut file_buf = Vec::new();
                f.read_to_end(&mut file_buf)
                    .map_err(|e| format!("failed to read file: {e}"))?;
                zip.write_all(&file_buf)
                    .map_err(|e| format!("failed to write zip file: {e}"))?;
            }
        }
        Ok(())
    }

    add_dir_to_zip(&mut zip, &target, &target, options)?;

    let finished_cursor = zip
        .finish()
        .map_err(|e| format!("failed to finalize zip archive: {e}"))?;

    Ok(finished_cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::ZipArchive;

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tempocue_test_{name}_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_resolve_safe_path() {
        let base = temp_test_dir("safe_path");
        let safe = resolve_safe_path(&base, "sub/folder/file.txt").unwrap();
        assert!(safe.starts_with(&base));

        // Directory traversal rejection
        assert!(resolve_safe_path(&base, "../outside.txt").is_err());
        assert!(resolve_safe_path(&base, "sub/../../outside.txt").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_storage_operations_and_listing() {
        let base = temp_test_dir("ops");

        // Create directory
        create_directory(&base, "media/audio").unwrap();
        let target_dir = base.join("media/audio");
        assert!(target_dir.is_dir());

        // Write a test file
        let file_path = target_dir.join("cue.mp3");
        fs::write(&file_path, b"dummy audio content").unwrap();

        // List directory
        let items = list_directory(&base, "media/audio").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "cue.mp3");
        assert_eq!(items[0].is_dir, false);
        assert_eq!(items[0].extension.as_deref(), Some("mp3"));
        assert!(items[0].mime_type.as_ref().unwrap().contains("audio") || items[0].mime_type.as_ref().unwrap().contains("mpeg"));

        // Rename entry
        rename_entry(&base, "media/audio/cue.mp3", "media/audio/stinger.mp3").unwrap();
        let items_after_rename = list_directory(&base, "media/audio").unwrap();
        assert_eq!(items_after_rename[0].name, "stinger.mp3");

        // Storage info
        let info = get_storage_info(&base, true, 1024, false, None);
        assert_eq!(info.total_files, 1);
        assert!(info.total_dirs >= 2);
        assert_eq!(info.max_upload_size_mb, 1024);
        assert_eq!(info.pin_required, false);

        // Delete entry
        delete_entry(&base, "media/audio/stinger.mp3").unwrap();
        let items_after_delete = list_directory(&base, "media/audio").unwrap();
        assert_eq!(items_after_delete.len(), 0);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_zip_directory() {
        let base = temp_test_dir("zip");
        create_directory(&base, "deck/slides").unwrap();
        fs::write(base.join("deck/notes.txt"), b"speaker notes").unwrap();
        fs::write(base.join("deck/slides/slide1.png"), b"slide data").unwrap();

        let zip_bytes = zip_directory(&base, "deck").unwrap();
        assert!(!zip_bytes.is_empty());

        let reader = Cursor::new(zip_bytes);
        let mut archive = ZipArchive::new(reader).unwrap();
        let mut file_names = Vec::new();
        for i in 0..archive.len() {
            let file = archive.by_index(i).unwrap();
            file_names.push(file.name().to_string());
        }

        assert!(file_names.iter().any(|name| name == "notes.txt"));
        assert!(file_names.iter().any(|name| name == "slides/slide1.png"));

        let _ = fs::remove_dir_all(&base);
    }
}
