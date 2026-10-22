use tauri::State;

use crate::state::{AppState, OutputMessage, OutputMessageDraft, RundownItem, RundownTimingMode, Snapshot, TimerColorSettings};
use crate::storage::{self, FileEntry, StorageInfo};

#[tauri::command]
pub async fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    Ok(state.snapshot().await)
}

#[tauri::command]
pub async fn start_timer(state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer(|timer| timer.start()).await;
    Ok(())
}

#[tauri::command]
pub async fn pause_timer(state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer(|timer| timer.pause()).await;
    Ok(())
}

#[tauri::command]
pub async fn reset_timer(state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer(|timer| timer.reset()).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_time(delta_ms: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.add_time(delta_ms).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_timer_duration(duration_ms: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer(|timer| timer.set_duration(duration_ms)).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_timer_remaining(remaining_ms: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.set_remaining(remaining_ms).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_timer_end_time(target_time: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut error = None;
    state
        .update_timer(|timer| {
            if let Err(message) = timer.set_end_at_time(&target_time) {
                error = Some(message);
            }
        })
        .await;
    if let Some(message) = error {
        return Err(message);
    }
    Ok(())
}

#[tauri::command]
pub async fn skip_timer(state: State<'_, AppState>) -> Result<(), String> {
    state.skip_item().await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn select_rundown_item(item_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.select_item(item_id).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_rundown_item(
    title: String,
    speaker: String,
    duration_ms: i64,
    timing_mode: RundownTimingMode,
    end_time: Option<String>,
    notes: String,
    supporting_files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<RundownItem, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Title is required".to_string());
    }

    Ok(state
        .create_item(
            title,
            speaker.trim().to_string(),
            duration_ms,
            timing_mode,
            end_time,
            notes.trim().to_string(),
            clean_supporting_files(supporting_files),
        )
        .await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_rundown_item(
    item_id: String,
    title: String,
    speaker: String,
    duration_ms: i64,
    timing_mode: RundownTimingMode,
    end_time: Option<String>,
    notes: String,
    supporting_files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<RundownItem, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Title is required".to_string());
    }

    state
        .update_item(
            item_id,
            title,
            speaker.trim().to_string(),
            duration_ms,
            timing_mode,
            end_time,
            notes.trim().to_string(),
            clean_supporting_files(supporting_files),
        )
        .await
        .ok_or_else(|| "Rundown item not found".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_rundown_item(item_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if state.delete_item(item_id).await {
        Ok(())
    } else {
        Err("Rundown item could not be deleted".to_string())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_rundown(item_ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.reorder_rundown(item_ids).await
}

#[tauri::command]
pub async fn replace_rundown(rundown: Vec<RundownItem>, state: State<'_, AppState>) -> Result<(), String> {
    state.replace_rundown(rundown).await
}

#[tauri::command]
pub async fn export_schedule_file(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Export TempoCue schedule")
        .set_file_name("tempocue-schedule.tmpc")
        .add_filter("TempoCue Schedule", &["tmpc"])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let mut path = file.path().to_path_buf();
    if path.extension().and_then(|extension| extension.to_str()) != Some("tmpc") {
        path.set_extension("tmpc");
    }
    state.export_schedule_file(&path).await?;
    Ok(path.file_name().and_then(|name| name.to_str()).map(str::to_string))
}

#[tauri::command]
pub async fn import_schedule_file(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Import TempoCue schedule")
        .add_filter("TempoCue Schedule", &["tmpc"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    state.import_schedule_file(file.path()).await?;
    Ok(file.file_name().into())
}

#[tauri::command]
pub async fn set_blackout(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.set_blackout(enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn set_hide_timer(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.set_hide_timer(enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn set_live(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.set_live(enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn show_message(message: OutputMessage, state: State<'_, AppState>) -> Result<(), String> {
    state.show_message(message).await;
    Ok(())
}

#[tauri::command]
pub async fn update_message_draft(draft: OutputMessageDraft, state: State<'_, AppState>) -> Result<(), String> {
    state.update_message_draft(draft).await;
    Ok(())
}

#[tauri::command]
pub async fn set_timer_color_settings(settings: TimerColorSettings, state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer_color_settings(settings).await;
    Ok(())
}

#[tauri::command]
pub async fn hide_message(state: State<'_, AppState>) -> Result<(), String> {
    state.hide_message().await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_shared_files(path: Option<String>, state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let base_dir = state.shared_storage_dir().await;
    let rel_path = path.unwrap_or_default();
    storage::list_directory(&base_dir, &rel_path)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_shared_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let base_dir = state.shared_storage_dir().await;
    storage::create_directory(&base_dir, &path)?;
    state.broadcast_files_changed("created", &path);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_shared_entry(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let base_dir = state.shared_storage_dir().await;
    storage::delete_entry(&base_dir, &path)?;
    state.broadcast_files_changed("deleted", &path);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_shared_entry(from: String, to: String, state: State<'_, AppState>) -> Result<(), String> {
    let base_dir = state.shared_storage_dir().await;
    storage::rename_entry(&base_dir, &from, &to)?;
    state.broadcast_files_changed("renamed", &to);
    Ok(())
}

#[tauri::command]
pub async fn get_shared_storage_info(state: State<'_, AppState>) -> Result<StorageInfo, String> {
    let base_dir = state.shared_storage_dir().await;
    let config = state.storage_config().await;
    Ok(storage::get_storage_info(
        &base_dir,
        config.allow_network_uploads,
        config.max_upload_size_mb,
        config.pin.is_some(),
        config.pin,
    ))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_allow_network_uploads(allowed: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.set_allow_network_uploads(allowed).await;
    state.broadcast_files_changed("permission_changed", "");
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_shared_storage_config(
    allow_network_uploads: bool,
    max_upload_size_mb: u64,
    pin: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.update_storage_config(allow_network_uploads, max_upload_size_mb, pin).await;
    state.broadcast_files_changed("config_changed", "");
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_shared_storage_folder(state: State<'_, AppState>) -> Result<(), String> {
    let base_dir = state.shared_storage_dir().await;
    if !base_dir.exists() {
        std::fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    }
    open::that(&base_dir).map_err(|e| format!("Failed to open folder: {e}"))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn attach_file_to_rundown(item_id: String, file_url_or_path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.attach_supporting_file(&item_id, &file_url_or_path).await
}

fn clean_supporting_files(files: Vec<String>) -> Vec<String> {
    files
        .into_iter()
        .map(|file| file.trim().to_string())
        .filter(|file| !file.is_empty())
        .collect()
}
