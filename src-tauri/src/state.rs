use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::timer::{TimerState, DEFAULT_DURATION_MS};

#[derive(Clone)]
pub struct AppState {
    inner: Arc<RwLock<InnerState>>,
    tx: broadcast::Sender<RealtimeEvent>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub timer: TimerState,
    pub rundown: Vec<RundownItem>,
    pub output: OutputState,
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
    pub color: String,
    pub completed: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputState {
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
    pub title: String,
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
    pub title: OutputMessageTextStyle,
    pub body: OutputMessageTextStyle,
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
pub struct ServerUrls {
    pub port: u16,
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
    #[serde(rename = "message/hide")]
    MessageHide { id: String },
    #[serde(rename = "output/blackout")]
    Blackout { enabled: bool },
    #[serde(rename = "output/hide-timer")]
    HideTimer { enabled: bool },
}

struct InnerState {
    timer: TimerState,
    timers_by_item: HashMap<String, TimerState>,
    rundown: Vec<RundownItem>,
    output: OutputState,
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
                    blackout: false,
                    hide_timer: false,
                    message: None,
                    active_item_id,
                },
                urls: urls_for_host_port("localhost".to_string(), 4310),
            })),
            tx,
        }
    }
}

impl AppState {
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
            urls: state.urls.clone(),
        }
    }

    pub async fn update_urls(&self, host: String, port: u16) {
        let snapshot = {
            let mut state = self.inner.write().await;
            state.urls = urls_for_host_port(host, port);
            let mut timer = state.timer.clone();
            timer.touch_server_now();
            Snapshot {
                timer,
                rundown: state.rundown.clone(),
                output: state.output.clone(),
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

    pub async fn select_item(&self, item_id: String) {
        let timer = {
            let mut state = self.inner.write().await;
            if state.output.active_item_id == item_id {
                let mut timer = state.timer.clone();
                timer.touch_server_now();
                state.timer = timer.clone();
                state.timers_by_item.insert(item_id.clone(), timer.clone());
                timer
            } else {
                let previous_item_id = state.output.active_item_id.clone();
                let previous_timer = state.timer.clone();
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
                    .unwrap_or_else(|| TimerState::new(duration_ms));
                next_timer.touch_server_now();
                state.output.active_item_id = item_id.clone();
                state.timer = next_timer.clone();
                state.timers_by_item.insert(item_id.clone(), next_timer.clone());
                next_timer
            }
        };
        self.broadcast(RealtimeEvent::ActiveItem { item_id });
        self.broadcast(RealtimeEvent::TimerState(timer));
    }

    pub async fn create_and_select_item(
        &self,
        title: String,
        speaker: String,
        duration_ms: i64,
        notes: String,
        supporting_files: Vec<String>,
    ) -> RundownItem {
        let (item, items) = {
            let mut state = self.inner.write().await;
            let previous_item_id = state.output.active_item_id.clone();
            let previous_timer = state.timer.clone();
            state.timers_by_item.insert(previous_item_id, previous_timer);

            let item = RundownItem {
                id: uuid::Uuid::new_v4().to_string(),
                title,
                speaker,
                notes,
                supporting_files,
                duration_ms: duration_ms.max(0),
                color: next_item_color(state.rundown.len()),
                completed: false,
            };
            let timer = TimerState::new(item.duration_ms);
            state.timers_by_item.insert(item.id.clone(), timer.clone());
            state.output.active_item_id = item.id.clone();
            state.timer = timer;
            state.rundown.push(item.clone());
            (item, state.rundown.clone())
        };
        self.broadcast(RealtimeEvent::RundownItems(items));
        self.select_item(item.id.clone()).await;
        item
    }

    pub async fn update_item(
        &self,
        item_id: String,
        title: String,
        speaker: String,
        duration_ms: i64,
        notes: String,
        supporting_files: Vec<String>,
    ) -> Option<RundownItem> {
        let (updated, items, timer) = {
            let mut state = self.inner.write().await;
            let Some(index) = state.rundown.iter().position(|item| item.id == item_id) else {
                return None;
            };

            state.rundown[index].title = title;
            state.rundown[index].speaker = speaker;
            state.rundown[index].duration_ms = duration_ms.max(0);
            state.rundown[index].notes = notes;
            state.rundown[index].supporting_files = supporting_files;
            let updated = state.rundown[index].clone();

            if let Some(timer) = state.timers_by_item.get_mut(&item_id) {
                timer.set_duration(updated.duration_ms);
            }
            if state.output.active_item_id == item_id {
                state.timer.set_duration(updated.duration_ms);
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
        true
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

    pub async fn show_message(&self, message: OutputMessage) {
        {
            let mut state = self.inner.write().await;
            state.output.message = Some(message.clone());
        }
        self.broadcast(RealtimeEvent::MessageShow(message));
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

fn urls_for_host_port(host: String, port: u16) -> ServerUrls {
    let base = format!("http://{host}:{port}");
    ServerUrls {
        port,
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
            color: "#3ddc97".to_string(),
            completed: false,
        },
        RundownItem {
            id: "welcome".to_string(),
            title: "Welcome".to_string(),
            speaker: "Host".to_string(),
            notes: "Lower-third name graphic on cue.".to_string(),
            supporting_files: vec![],
            duration_ms: 5 * 60 * 1000,
            color: "#f5c542".to_string(),
            completed: false,
        },
        RundownItem {
            id: "main".to_string(),
            title: "Main Segment".to_string(),
            speaker: "Speaker".to_string(),
            notes: "Warn at five minutes remaining.".to_string(),
            supporting_files: vec![],
            duration_ms: 25 * 60 * 1000,
            color: "#5cc8ff".to_string(),
            completed: false,
        },
    ]
}
