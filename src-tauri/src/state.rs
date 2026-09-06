use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::timer::{TimerState, TimerStatus, DEFAULT_DURATION_MS};

const DEFAULT_YELLOW_THRESHOLD_MS: i64 = 5 * 60 * 1000;
const DEFAULT_RED_THRESHOLD_MS: i64 = 60 * 1000;
const PORTABLE_SCHEDULE_MAGIC: &[u8] = b"TEMPOCUE\0\x01";

#[derive(Clone)]
pub struct AppState {
    inner: Arc<RwLock<InnerState>>,
    tx: broadcast::Sender<RealtimeEvent>,
    persistence_path: Arc<RwLock<Option<PathBuf>>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSchedule {
    version: u32,
    rundown: Vec<RundownItem>,
    active_item_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub timer: TimerState,
    pub rundown: Vec<RundownItem>,
    pub output: OutputState,
    pub message_draft: OutputMessageDraft,
    pub timer_color_settings: TimerColorSettings,
    pub urls: ServerUrls,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RundownItem {
    pub id: String,
    pub title: String,
    pub speaker: String,
    pub notes: String,
    #[serde(default)]
    pub supporting_files: Vec<String>,
    pub duration_ms: i64,
    #[serde(default)]
    pub timing_mode: RundownTimingMode,
    #[serde(default)]
    pub end_time: Option<String>,
    pub color: String,
    pub completed: bool,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RundownTimingMode {
    Duration,
    EndTime,
}

impl Default for RundownTimingMode {
    fn default() -> Self {
        Self::Duration
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputState {
    pub live: bool,
    pub blackout: bool,
    pub hide_timer: bool,
    pub message: Option<OutputMessage>,
    pub active_item_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub body: String,
    #[serde(default)]
    pub formatting: Option<OutputMessageFormatting>,
    #[serde(default)]
    pub flashing: bool,
    pub visible: bool,
    pub target: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputMessageFormatting {
    pub body: OutputMessageTextStyle,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputMessageDraft {
    pub body: String,
    pub formatting: OutputMessageFormatting,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputMessageTextStyle {
    pub bold: bool,
    pub italic: bool,
    pub color: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerColorSettings {
    pub yellow_threshold_ms: i64,
    pub red_threshold_ms: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerUrls {
    pub port: u16,
    pub local: UrlSet,
    pub network: Option<UrlSet>,
    pub network_host: Option<String>,
    pub control: String,
    pub viewer: String,
    pub obs: String,
    pub lower_third: String,
    pub agenda: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlSet {
    pub control: String,
    pub viewer: String,
    pub obs: String,
    pub lower_third: String,
    pub agenda: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum RealtimeEvent {
    #[serde(rename = "snapshot")]
    Snapshot(Snapshot),
    #[serde(rename = "timer/state")]
    TimerState(TimerState),
    #[serde(rename = "rundown/active-item")]
    ActiveItem {
        #[serde(rename = "itemId")]
        item_id: String,
    },
    #[serde(rename = "rundown/items")]
    RundownItems(Vec<RundownItem>),
    #[serde(rename = "message/show")]
    MessageShow(OutputMessage),
    #[serde(rename = "message/draft")]
    MessageDraft(OutputMessageDraft),
    #[serde(rename = "message/hide")]
    MessageHide { id: String },
    #[serde(rename = "output/blackout")]
    Blackout { enabled: bool },
    #[serde(rename = "output/hide-timer")]
    HideTimer { enabled: bool },
    #[serde(rename = "output/live")]
    Live { enabled: bool },
    #[serde(rename = "settings/timer-colors")]
    TimerColorSettings(TimerColorSettings),
}

struct InnerState {
    timer: TimerState,
    timers_by_item: HashMap<String, TimerState>,
    rundown: Vec<RundownItem>,
    output: OutputState,
    message_draft: OutputMessageDraft,
    timer_color_settings: TimerColorSettings,
    urls: ServerUrls,
}

impl Default for AppState {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(128);
        let rundown = default_rundown();
        let active_item_id = "opening".to_string();
        let timer = TimerState::new(
            rundown
                .iter()
                .find(|item| item.id == active_item_id)
                .map(|item| item.duration_ms)
                .unwrap_or(DEFAULT_DURATION_MS),
        );
        let mut timers_by_item = HashMap::new();
        timers_by_item.insert(active_item_id.clone(), timer.clone());

        Self {
            inner: Arc::new(RwLock::new(InnerState {
                timer,
                timers_by_item,
                rundown,
                output: OutputState {
                    live: false,
                    blackout: false,
                    hide_timer: false,
                    message: None,
                    active_item_id,
                },
                message_draft: default_message_draft(),
                timer_color_settings: default_timer_color_settings(),
                urls: urls_for_host_port(None, 4310),
            })),
            tx,
            persistence_path: Arc::new(RwLock::new(None)),
        }
    }
}

impl AppState {
    pub async fn export_schedule_file(&self, path: &std::path::Path) -> Result<(), String> {
        let saved = {
            let state = self.inner.read().await;
            PersistedSchedule {
                version: 1,
                rundown: state.rundown.clone(),
                active_item_id: state.output.active_item_id.clone(),
            }
        };
        let payload = serde_json::to_vec(&saved).map_err(|error| format!("Could not encode schedule: {error}"))?;
        let mut encoded = Vec::with_capacity(PORTABLE_SCHEDULE_MAGIC.len() + payload.len());
        encoded.extend_from_slice(PORTABLE_SCHEDULE_MAGIC);
        encoded.extend_from_slice(&payload);
        tokio::fs::write(path, encoded)
            .await
            .map_err(|error| format!("Could not save schedule: {error}"))
    }

    pub async fn import_schedule_file(&self, path: &std::path::Path) -> Result<(), String> {
        let encoded = tokio::fs::read(path)
            .await
            .map_err(|error| format!("Could not read schedule: {error}"))?;
        let payload = encoded
            .strip_prefix(PORTABLE_SCHEDULE_MAGIC)
            .ok_or_else(|| "This is not a valid TempoCue schedule file".to_string())?;
        let saved: PersistedSchedule = serde_json::from_slice(payload)
            .map_err(|_| "This TempoCue schedule file is damaged or unsupported".to_string())?;
        if saved.version != 1 {
            return Err(format!("TempoCue schedule version {} is not supported", saved.version));
        }
        self.replace_rundown_with_active(saved.rundown, Some(saved.active_item_id)).await
    }

    pub async fn initialize_persistence(&self, path: PathBuf) {
        {
            let mut persistence_path = self.persistence_path.write().await;
            *persistence_path = Some(path.clone());
        }

        let Ok(contents) = tokio::fs::read_to_string(&path).await else {
            return;
        };
        let Ok(saved) = serde_json::from_str::<PersistedSchedule>(&contents) else {
            eprintln!("failed to parse saved schedule at {}", path.display());
            return;
        };
        if saved.version != 1 || saved.rundown.is_empty() {
            return;
        }

        let active_item_id = if saved.rundown.iter().any(|item| item.id == saved.active_item_id) {
            saved.active_item_id
        } else {
            saved.rundown[0].id.clone()
        };
        let active_item = saved.rundown.iter().find(|item| item.id == active_item_id).unwrap();
        let timer = timer_for_rundown_item(active_item);
        let mut timers_by_item = HashMap::new();
        timers_by_item.insert(active_item_id.clone(), timer.clone());

        let mut state = self.inner.write().await;
        state.rundown = saved.rundown;
        state.output.active_item_id = active_item_id;
        state.timer = timer;
        state.timers_by_item = timers_by_item;
    }

    async fn persist_schedule(&self) {
        let Some(path) = self.persistence_path.read().await.clone() else {
            return;
        };
        let saved = {
            let state = self.inner.read().await;
            PersistedSchedule {
                version: 1,
                rundown: state.rundown.clone(),
                active_item_id: state.output.active_item_id.clone(),
            }
        };
        let Ok(contents) = serde_json::to_vec_pretty(&saved) else {
            return;
        };
        if let Some(parent) = path.parent() {
            if let Err(error) = tokio::fs::create_dir_all(parent).await {
                eprintln!("failed to create schedule data directory: {error}");
                return;
            }
        }
        let temporary_path = path.with_extension("json.tmp");
        if let Err(error) = tokio::fs::write(&temporary_path, contents).await {
            eprintln!("failed to save schedule: {error}");
            return;
        }
        if let Err(error) = tokio::fs::rename(&temporary_path, &path).await {
            eprintln!("failed to finish saving schedule: {error}");
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RealtimeEvent> {
        self.tx.subscribe()
    }

    pub async fn snapshot(&self) -> Snapshot {
        let state = self.inner.read().await;
        let mut timer = state.timer.clone();
        timer.touch_server_now();
        Snapshot {
            timer,
            rundown: state.rundown.clone(),
            output: state.output.clone(),
            message_draft: state.message_draft.clone(),
            timer_color_settings: state.timer_color_settings.clone(),
            urls: state.urls.clone(),
        }
    }

    pub async fn update_urls(&self, network_host: Option<String>, port: u16) {
        let snapshot = {
            let mut state = self.inner.write().await;
            state.urls = urls_for_host_port(network_host, port);
            let mut timer = state.timer.clone();
            timer.touch_server_now();
            Snapshot {
                timer,
                rundown: state.rundown.clone(),
                output: state.output.clone(),
                message_draft: state.message_draft.clone(),
                timer_color_settings: state.timer_color_settings.clone(),
                urls: state.urls.clone(),
            }
        };
        self.broadcast(RealtimeEvent::Snapshot(snapshot));
    }

    pub async fn update_timer<F>(&self, updater: F) -> TimerState
    where
        F: FnOnce(&mut TimerState),
    {
        let timer = {
            let mut state = self.inner.write().await;
            updater(&mut state.timer);
            let active_item_id = state.output.active_item_id.clone();
            let timer = state.timer.clone();
            state.timers_by_item.insert(active_item_id, timer.clone());
            state.timer.clone()
        };
        self.broadcast(RealtimeEvent::TimerState(timer.clone()));
        timer
    }

    pub async fn add_time(&self, delta_ms: i64) -> TimerState {
        let (timer, items) = {
            let mut state = self.inner.write().await;
            state.timer.add_time(delta_ms);
            let active_item_id = state.output.active_item_id.clone();
            let timer = state.timer.clone();
            state.timers_by_item.insert(active_item_id.clone(), timer.clone());

            let items = if let Some(end_time) = end_time_for_timer(&timer) {
                if let Some(item) = state.rundown.iter_mut().find(|item| item.id == active_item_id) {
                    if item.timing_mode == RundownTimingMode::EndTime {
                        item.duration_ms = timer.duration_ms;
                        item.end_time = Some(end_time);
                        Some(state.rundown.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            (timer, items)
        };

        self.broadcast(RealtimeEvent::TimerState(timer.clone()));
        let schedule_changed = items.is_some();
        if let Some(items) = items {
            self.broadcast(RealtimeEvent::RundownItems(items));
        }
        if schedule_changed {
            self.persist_schedule().await;
        }
        timer
    }

    pub async fn set_remaining(&self, remaining_ms: i64) -> TimerState {
        let (timer, items) = {
            let mut state = self.inner.write().await;
            state.timer.set_remaining(remaining_ms);
            let active_item_id = state.output.active_item_id.clone();
            let timer = state.timer.clone();
            state.timers_by_item.insert(active_item_id.clone(), timer.clone());

            let items = if let Some(end_time) = end_time_for_timer(&timer) {
                if let Some(item) = state.rundown.iter_mut().find(|item| item.id == active_item_id) {
                    if item.timing_mode == RundownTimingMode::EndTime {
                        item.duration_ms = timer.duration_ms;
                        item.end_time = Some(end_time);
                        Some(state.rundown.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            (timer, items)
        };

        self.broadcast(RealtimeEvent::TimerState(timer.clone()));
        let schedule_changed = items.is_some();
        if let Some(items) = items {
            self.broadcast(RealtimeEvent::RundownItems(items));
        }
        if schedule_changed {
            self.persist_schedule().await;
        }
        timer
    }

    pub async fn select_item(&self, item_id: String) {
        let timer = {
            let mut state = self.inner.write().await;
            if state.output.active_item_id == item_id {
                let mut timer = state.timer.clone();
                timer.touch_server_now();
                state.timer = timer.clone();
                state.timers_by_item.insert(item_id.clone(), timer.clone());
                Some(timer)
            } else {
                let previous_item_id = state.output.active_item_id.clone();
                let mut previous_timer = state.timer.clone();
                previous_timer.pause();
                state.timers_by_item.insert(previous_item_id, previous_timer);

                let duration_ms = state
                    .rundown
                    .iter()
                    .find(|item| item.id == item_id)
                    .map(|item| item.duration_ms)
                    .unwrap_or(DEFAULT_DURATION_MS);
                let mut next_timer = state
                    .timers_by_item
                    .get(&item_id)
                    .cloned()
                    .unwrap_or_else(|| {
                        state
                            .rundown
                            .iter()
                            .find(|item| item.id == item_id)
                            .map(timer_for_rundown_item)
                            .unwrap_or_else(|| TimerState::new(duration_ms))
                    });
                next_timer.pause();
                next_timer.touch_server_now();
                state.output.active_item_id = item_id.clone();
                state.timer = next_timer.clone();
                state.timers_by_item.insert(item_id.clone(), next_timer.clone());
                Some(next_timer)
            }
        };
        let Some(timer) = timer else {
            return;
        };
        self.broadcast(RealtimeEvent::ActiveItem { item_id });
        self.broadcast(RealtimeEvent::TimerState(timer));
        self.persist_schedule().await;
    }

    pub async fn create_item(
        &self,
        title: String,
        speaker: String,
        duration_ms: i64,
        timing_mode: RundownTimingMode,
        end_time: Option<String>,
        notes: String,
        supporting_files: Vec<String>,
    ) -> RundownItem {
        let (item, items) = {
            let mut state = self.inner.write().await;
            let active_item_id = state.output.active_item_id.clone();
            let active_timer = state.timer.clone();
            state.timers_by_item.insert(active_item_id, active_timer);

            let item = RundownItem {
                id: uuid::Uuid::new_v4().to_string(),
                title,
                speaker,
                notes,
                supporting_files,
                duration_ms: duration_ms.max(0),
                timing_mode,
                end_time: clean_end_time(end_time),
                color: next_item_color(state.rundown.len()),
                completed: false,
            };
            state.rundown.push(item.clone());
            (item, state.rundown.clone())
        };
        self.broadcast(RealtimeEvent::RundownItems(items));
        self.persist_schedule().await;
        item
    }

    pub async fn update_item(
        &self,
        item_id: String,
        title: String,
        speaker: String,
        duration_ms: i64,
        timing_mode: RundownTimingMode,
        end_time: Option<String>,
        notes: String,
        supporting_files: Vec<String>,
    ) -> Option<RundownItem> {
        let (updated, items, timer) = {
            let mut state = self.inner.write().await;
            let Some(index) = state.rundown.iter().position(|item| item.id == item_id) else {
                return None;
            };
            if state.output.active_item_id == item_id && state.timer.status == TimerStatus::Running {
                return None;
            }

            state.rundown[index].title = title;
            state.rundown[index].speaker = speaker;
            state.rundown[index].duration_ms = duration_ms.max(0);
            state.rundown[index].timing_mode = timing_mode;
            state.rundown[index].end_time = clean_end_time(end_time);
            state.rundown[index].notes = notes;
            state.rundown[index].supporting_files = supporting_files;
            let updated = state.rundown[index].clone();
            let updated_timer = timer_for_rundown_item(&updated);

            if let Some(timer) = state.timers_by_item.get_mut(&item_id) {
                *timer = updated_timer.clone();
            }
            if state.output.active_item_id == item_id {
                state.timer = updated_timer;
                let active_timer = state.timer.clone();
                state.timers_by_item.insert(item_id.clone(), active_timer.clone());
                (updated, state.rundown.clone(), Some(active_timer))
            } else {
                (updated, state.rundown.clone(), None)
            }
        };

        self.broadcast(RealtimeEvent::RundownItems(items));
        if let Some(timer) = timer {
            self.broadcast(RealtimeEvent::TimerState(timer));
        }
        self.persist_schedule().await;
        Some(updated)
    }

    pub async fn delete_item(&self, item_id: String) -> bool {
        let result = {
            let mut state = self.inner.write().await;
            let Some(index) = state.rundown.iter().position(|item| item.id == item_id) else {
                return false;
            };
            if state.rundown.len() == 1 {
                return false;
            }

            let was_active = state.output.active_item_id == item_id;
            if was_active && state.timer.status == TimerStatus::Running {
                return false;
            }

            state.rundown.remove(index);
            state.timers_by_item.remove(&item_id);

            let mut next_active_id = state.output.active_item_id.clone();
            if was_active {
                let next_index = index.min(state.rundown.len().saturating_sub(1));
                next_active_id = state.rundown[next_index].id.clone();
                let duration_ms = state.rundown[next_index].duration_ms;
                let mut next_timer = state
                    .timers_by_item
                    .get(&next_active_id)
                    .cloned()
                    .unwrap_or_else(|| TimerState::new(duration_ms));
                next_timer.touch_server_now();
                state.output.active_item_id = next_active_id.clone();
                state.timer = next_timer.clone();
                state.timers_by_item.insert(next_active_id.clone(), next_timer);
            }

            (
                state.rundown.clone(),
                was_active.then(|| next_active_id),
                was_active.then(|| state.timer.clone()),
            )
        };

        self.broadcast(RealtimeEvent::RundownItems(result.0));
        if let Some(item_id) = result.1 {
            self.broadcast(RealtimeEvent::ActiveItem { item_id });
        }
        if let Some(timer) = result.2 {
            self.broadcast(RealtimeEvent::TimerState(timer));
        }
        self.persist_schedule().await;
        true
    }

    pub async fn reorder_rundown(&self, item_ids: Vec<String>) -> Result<(), String> {
        let items = {
            let mut state = self.inner.write().await;
            if item_ids.len() != state.rundown.len() {
                return Err("Item count mismatch".to_string());
            }

            let mut current_items: std::collections::HashMap<String, RundownItem> = state
                .rundown
                .iter()
                .cloned()
                .map(|item| (item.id.clone(), item))
                .collect();

            let mut reordered = Vec::with_capacity(item_ids.len());
            for id in &item_ids {
                if let Some(item) = current_items.remove(id) {
                    reordered.push(item);
                } else {
                    return Err(format!("Invalid schedule item id: {id}"));
                }
            }

            state.rundown = reordered.clone();
            reordered
        };

        self.broadcast(RealtimeEvent::RundownItems(items));
        self.persist_schedule().await;
        Ok(())
    }

    pub async fn replace_rundown(&self, rundown: Vec<RundownItem>) -> Result<(), String> {
        self.replace_rundown_with_active(rundown, None).await
    }

    async fn replace_rundown_with_active(
        &self,
        rundown: Vec<RundownItem>,
        requested_active_item_id: Option<String>,
    ) -> Result<(), String> {
        if rundown.is_empty() {
            return Err("A schedule must contain at least one item".to_string());
        }

        let mut seen_ids = std::collections::HashSet::new();
        let mut normalized = Vec::with_capacity(rundown.len());
        for (index, mut item) in rundown.into_iter().enumerate() {
            item.title = item.title.trim().to_string();
            if item.title.is_empty() {
                return Err(format!("Schedule item {} is missing a title", index + 1));
            }
            if item.id.trim().is_empty() || !seen_ids.insert(item.id.clone()) {
                item.id = uuid::Uuid::new_v4().to_string();
                seen_ids.insert(item.id.clone());
            }
            item.duration_ms = item.duration_ms.max(0);
            item.end_time = clean_end_time(item.end_time);
            item.supporting_files = item
                .supporting_files
                .into_iter()
                .map(|file| file.trim().to_string())
                .filter(|file| !file.is_empty())
                .collect();
            if item.color.trim().is_empty() {
                item.color = next_item_color(index);
            }
            normalized.push(item);
        }

        let active_item_id = requested_active_item_id
            .filter(|id| normalized.iter().any(|item| item.id == *id))
            .unwrap_or_else(|| normalized[0].id.clone());
        let active_item = normalized.iter().find(|item| item.id == active_item_id).unwrap();
        let timer = timer_for_rundown_item(active_item);
        {
            let mut state = self.inner.write().await;
            state.rundown = normalized.clone();
            state.output.active_item_id = active_item_id.clone();
            state.timer = timer.clone();
            state.timers_by_item.clear();
            state.timers_by_item.insert(active_item_id.clone(), timer.clone());
        }
        self.broadcast(RealtimeEvent::RundownItems(normalized));
        self.broadcast(RealtimeEvent::ActiveItem { item_id: active_item_id });
        self.broadcast(RealtimeEvent::TimerState(timer));
        self.persist_schedule().await;
        Ok(())
    }

    pub async fn skip_item(&self) {
        let next_id = {
            let state = self.inner.read().await;
            let active_index = state
                .rundown
                .iter()
                .position(|item| item.id == state.output.active_item_id)
                .unwrap_or(0);
            state
                .rundown
                .get((active_index + 1).min(state.rundown.len().saturating_sub(1)))
                .map(|item| item.id.clone())
        };
        if let Some(item_id) = next_id {
            self.select_item(item_id).await;
        }
    }

    pub async fn set_blackout(&self, enabled: bool) {
        {
            let mut state = self.inner.write().await;
            state.output.blackout = enabled;
        }
        self.broadcast(RealtimeEvent::Blackout { enabled });
    }

    pub async fn set_hide_timer(&self, enabled: bool) {
        {
            let mut state = self.inner.write().await;
            state.output.hide_timer = enabled;
        }
        self.broadcast(RealtimeEvent::HideTimer { enabled });
    }

    pub async fn set_live(&self, enabled: bool) {
        {
            let mut state = self.inner.write().await;
            state.output.live = enabled;
        }
        self.broadcast(RealtimeEvent::Live { enabled });
    }

    pub async fn is_live(&self) -> bool {
        let state = self.inner.read().await;
        state.output.live
    }

    pub async fn show_message(&self, message: OutputMessage) {
        {
            let mut state = self.inner.write().await;
            state.output.message = Some(message.clone());
        }
        self.broadcast(RealtimeEvent::MessageShow(message));
    }

    pub async fn update_message_draft(&self, draft: OutputMessageDraft) {
        {
            let mut state = self.inner.write().await;
            state.message_draft = draft.clone();
        }
        self.broadcast(RealtimeEvent::MessageDraft(draft));
    }

    pub async fn update_timer_color_settings(&self, settings: TimerColorSettings) {
        let settings = normalize_timer_color_settings(settings);
        {
            let mut state = self.inner.write().await;
            state.timer_color_settings = settings.clone();
        }
        self.broadcast(RealtimeEvent::TimerColorSettings(settings));
    }

    pub async fn hide_message(&self) {
        let id = {
            let mut state = self.inner.write().await;
            state.output.message.take().map(|message| message.id).unwrap_or_default()
        };
        self.broadcast(RealtimeEvent::MessageHide { id });
    }

    pub async fn supporting_file(&self, item_id: &str, file_index: usize) -> Option<String> {
        let state = self.inner.read().await;
        state
            .rundown
            .iter()
            .find(|item| item.id == item_id)
            .and_then(|item| item.supporting_files.get(file_index))
            .cloned()
    }

    fn broadcast(&self, event: RealtimeEvent) {
        let _ = self.tx.send(event);
    }
}

fn next_item_color(index: usize) -> String {
    const COLORS: [&str; 6] = ["#3ddc97", "#f5c542", "#5cc8ff", "#ff7a59", "#b48cff", "#f25f8c"];
    COLORS[index % COLORS.len()].to_string()
}

fn default_message_draft() -> OutputMessageDraft {
    OutputMessageDraft {
        body: "Please welcome the next speaker".to_string(),
        formatting: OutputMessageFormatting {
            body: OutputMessageTextStyle {
                bold: true,
                italic: false,
                color: "#ffffff".to_string(),
            },
        },
    }
}

fn default_timer_color_settings() -> TimerColorSettings {
    TimerColorSettings {
        yellow_threshold_ms: DEFAULT_YELLOW_THRESHOLD_MS,
        red_threshold_ms: DEFAULT_RED_THRESHOLD_MS,
    }
}

fn normalize_timer_color_settings(settings: TimerColorSettings) -> TimerColorSettings {
    TimerColorSettings {
        yellow_threshold_ms: settings.yellow_threshold_ms.max(0),
        red_threshold_ms: settings.red_threshold_ms.max(0),
    }
}

fn timer_for_rundown_item(item: &RundownItem) -> TimerState {
    let mut timer = TimerState::new(item.duration_ms);
    if item.timing_mode == RundownTimingMode::EndTime {
        if let Some(end_time) = &item.end_time {
            if timer.configure_end_at_time(end_time).is_ok() {
                return timer;
            }
        }
    }
    timer
}

fn clean_end_time(end_time: Option<String>) -> Option<String> {
    end_time
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn end_time_for_timer(timer: &TimerState) -> Option<String> {
    use chrono::{Local, TimeZone};

    let target_end_at_ms = timer.target_end_at_ms?;
    Local
        .timestamp_millis_opt(target_end_at_ms)
        .single()
        .map(|value| value.format("%H:%M").to_string())
}

fn urls_for_host_port(network_host: Option<String>, port: u16) -> ServerUrls {
    let local = url_set_for_host_port("localhost", port);
    let network = network_host
        .as_deref()
        .map(|host| url_set_for_host_port(host, port));
    let advertised = network.clone().unwrap_or_else(|| local.clone());

    ServerUrls {
        port,
        local,
        network,
        network_host,
        control: advertised.control,
        viewer: advertised.viewer,
        obs: advertised.obs,
        lower_third: advertised.lower_third,
        agenda: advertised.agenda,
    }
}

fn url_set_for_host_port(host: &str, port: u16) -> UrlSet {
    let base = format!("http://{host}:{port}");
    UrlSet {
        control: format!("{base}/control"),
        viewer: format!("{base}/viewer"),
        obs: format!("{base}/obs?transparent=true"),
        lower_third: format!("{base}/lower-third"),
        agenda: format!("{base}/agenda"),
    }
}

fn default_rundown() -> Vec<RundownItem> {
    vec![
        RundownItem {
            id: "opening".to_string(),
            title: "Opening Countdown".to_string(),
            speaker: "Production".to_string(),
            notes: "Confirm stream is live before zero.".to_string(),
            supporting_files: vec![],
            duration_ms: DEFAULT_DURATION_MS,
            timing_mode: RundownTimingMode::Duration,
            end_time: None,
            color: "#3ddc97".to_string(),
            completed: false,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn portable_schedule_round_trip_preserves_items_and_active_item() {
        let source = AppState::default();
        let added = source
            .create_item(
                "Keynote".to_string(),
                "Speaker".to_string(),
                20 * 60 * 1000,
                RundownTimingMode::Duration,
                None,
                "Notes".to_string(),
                vec![],
            )
            .await;
        source.select_item(added.id.clone()).await;

        let path = std::env::temp_dir().join(format!("tempocue-test-{}.tmpc", uuid::Uuid::new_v4()));
        source.export_schedule_file(&path).await.unwrap();
        let encoded = tokio::fs::read(&path).await.unwrap();
        assert!(encoded.starts_with(PORTABLE_SCHEDULE_MAGIC));

        let restored = AppState::default();
        restored.import_schedule_file(&path).await.unwrap();
        let snapshot = restored.snapshot().await;
        assert_eq!(snapshot.rundown.len(), 2);
        assert_eq!(snapshot.output.active_item_id, added.id);
        assert_eq!(snapshot.rundown[1].title, "Keynote");

        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn portable_schedule_rejects_unencoded_json() {
        let path = std::env::temp_dir().join(format!("tempocue-test-{}.tmpc", uuid::Uuid::new_v4()));
        tokio::fs::write(&path, br#"{"version":1}"#).await.unwrap();

        let state = AppState::default();
        let error = state.import_schedule_file(&path).await.unwrap_err();
        assert!(error.contains("not a valid TempoCue schedule"));

        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn reorder_rundown_updates_order_and_preserves_active_item() {
        let state = AppState::default();
        let second = state
            .create_item(
                "Second Item".to_string(),
                "Speaker 2".to_string(),
                15 * 60 * 1000,
                RundownTimingMode::Duration,
                None,
                "".to_string(),
                vec![],
            )
            .await;
        let third = state
            .create_item(
                "Third Item".to_string(),
                "Speaker 3".to_string(),
                10 * 60 * 1000,
                RundownTimingMode::Duration,
                None,
                "".to_string(),
                vec![],
            )
            .await;

        let snapshot = state.snapshot().await;
        assert_eq!(snapshot.rundown.len(), 3);
        let first_id = snapshot.rundown[0].id.clone();
        assert_eq!(snapshot.output.active_item_id, first_id);

        // Reorder to: [third, first, second]
        state
            .reorder_rundown(vec![third.id.clone(), first_id.clone(), second.id.clone()])
            .await
            .unwrap();

        let updated = state.snapshot().await;
        assert_eq!(updated.rundown[0].id, third.id);
        assert_eq!(updated.rundown[1].id, first_id);
        assert_eq!(updated.rundown[2].id, second.id);
        // Active item should remain unchanged
        assert_eq!(updated.output.active_item_id, first_id);
    }

    #[tokio::test]
    async fn reorder_rundown_validates_ids_and_count() {
        let state = AppState::default();
        let added = state
            .create_item(
                "Second Item".to_string(),
                "Speaker 2".to_string(),
                15 * 60 * 1000,
                RundownTimingMode::Duration,
                None,
                "".to_string(),
                vec![],
            )
            .await;
        let original_ids: Vec<String> = state
            .snapshot()
            .await
            .rundown
            .into_iter()
            .map(|item| item.id)
            .collect();

        // Mismatch count
        let err = state.reorder_rundown(vec![added.id.clone()]).await.unwrap_err();
        assert!(err.contains("Item count mismatch"));
        assert_eq!(
            state
                .snapshot()
                .await
                .rundown
                .into_iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            original_ids
        );

        // Invalid ID
        let err = state
            .reorder_rundown(vec!["fake-id".to_string(), added.id.clone()])
            .await
            .unwrap_err();
        assert!(err.contains("Invalid schedule item id"));
        assert_eq!(
            state
                .snapshot()
                .await
                .rundown
                .into_iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            original_ids
        );

        // Duplicate IDs must not mutate the schedule either.
        let err = state
            .reorder_rundown(vec![added.id.clone(), added.id.clone()])
            .await
            .unwrap_err();
        assert!(err.contains("Invalid schedule item id"));
        assert_eq!(
            state
                .snapshot()
                .await
                .rundown
                .into_iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            original_ids
        );
    }
}
