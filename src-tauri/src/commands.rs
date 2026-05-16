use tauri::State;

use crate::state::{AppState, OutputMessage, RundownItem, Snapshot};

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
    state.update_timer(|timer| timer.add_time(delta_ms)).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_timer_duration(duration_ms: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer(|timer| timer.set_duration(duration_ms)).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_timer_remaining(remaining_ms: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.update_timer(|timer| timer.set_remaining(remaining_ms)).await;
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
    notes: String,
    supporting_files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<RundownItem, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Title is required".to_string());
    }

    Ok(state
        .create_and_select_item(
            title,
            speaker.trim().to_string(),
            duration_ms,
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
pub async fn show_message(message: OutputMessage, state: State<'_, AppState>) -> Result<(), String> {
    state.show_message(message).await;
    Ok(())
}

#[tauri::command]
pub async fn hide_message(state: State<'_, AppState>) -> Result<(), String> {
    state.hide_message().await;
    Ok(())
}

fn clean_supporting_files(files: Vec<String>) -> Vec<String> {
    files
        .into_iter()
        .map(|file| file.trim().to_string())
        .filter(|file| !file.is_empty())
        .collect()
}
