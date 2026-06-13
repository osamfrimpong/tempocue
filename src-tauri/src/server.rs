use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rust_embed::RustEmbed;
use serde::Deserialize;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    path::Path as FsPath,
};
use tokio::net::TcpListener;
use tokio::time::{interval, Duration};
use tower_http::cors::CorsLayer;

use crate::state::{AppState, OutputMessage, OutputMessageDraft, RealtimeEvent, RundownTimingMode};

pub async fn start_output_server(state: AppState, app: tauri::AppHandle) -> Result<(), String> {
    let network_host = local_network_ipv4().map(|ip| ip.to_string());
    let (listener, port) = bind_with_fallback(Ipv4Addr::UNSPECIFIED).await?;
    state.update_urls(network_host.clone(), port).await;
    tokio::spawn(watch_network_urls(state.clone(), port, network_host));

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/supporting-file/{item_id}/{file_index}/{*filename}", get(supporting_file_handler))
        .route("/", get(index_handler))
        .route("/{*path}", get(asset_or_index_handler))
        .layer(CorsLayer::permissive())
        .with_state(ServerContext { state, app });

    axum::serve(listener, router)
        .await
        .map_err(|error| format!("server failed: {error}"))
}

async fn watch_network_urls(state: AppState, port: u16, mut current_host: Option<String>) {
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;
        let next_host = local_network_ipv4().map(|ip| ip.to_string());
        if next_host != current_host {
            current_host = next_host.clone();
            state.update_urls(next_host, port).await;
        }
    }
}

#[derive(Clone)]
struct ServerContext {
    state: AppState,
    #[allow(dead_code)]
    app: tauri::AppHandle,
}

#[derive(RustEmbed)]
#[folder = "../dist"]
struct FrontendAssets;

async fn bind_with_fallback(host: Ipv4Addr) -> Result<(TcpListener, u16), String> {
    for port in 4310..4320 {
        let addr = SocketAddr::new(IpAddr::V4(host), port);
        if let Ok(listener) = TcpListener::bind(addr).await {
            return Ok((listener, port));
        }
    }
    Err("no available local server port in 4310..4319".to_string())
}

fn local_network_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    let IpAddr::V4(ip) = socket.local_addr().ok()?.ip() else {
        return None;
    };

    if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() {
        return None;
    }

    Some(ip)
}

async fn index_handler(State(context): State<ServerContext>) -> Response {
    if !context.state.is_live().await {
        return inactive_response();
    }
    serve_index()
}

async fn asset_or_index_handler(Path(path): Path<String>, State(context): State<ServerContext>) -> Response {
    if path.starts_with("assets/") {
        return serve_asset(&path);
    }
    if is_controller_path(&path) {
        return serve_index();
    }
    if !context.state.is_live().await {
        return inactive_response();
    }
    serve_index()
}

async fn supporting_file_handler(
    Path((item_id, file_index, _filename)): Path<(String, usize, String)>,
    State(context): State<ServerContext>,
) -> Response {
    if !context.state.is_live().await {
        return inactive_response();
    }

    let Some(file_path) = context.state.supporting_file(&item_id, file_index).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if file_path.starts_with("http://") || file_path.starts_with("https://") {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let normalized = file_path
        .strip_prefix("file://")
        .or_else(|| file_path.strip_prefix("FILE://"))
        .unwrap_or(&file_path);
    let Ok(data) = tokio::fs::read(normalized).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mime = mime_guess::from_path(normalized).first_or_octet_stream();
    let filename = FsPath::new(normalized)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("supporting-file")
        .replace('"', "");
    let mut response = data.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("inline; filename=\"{filename}\""))
            .unwrap_or(HeaderValue::from_static("inline")),
    );
    response
}

fn serve_asset(path: &str) -> Response {
    let Some(asset) = FrontendAssets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = asset.data.into_owned().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn serve_index() -> Response {
    if let Some(index) = FrontendAssets::get("index.html") {
        let mut response = index.data.into_owned().into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return response;
    }

    Html(dev_index_html()).into_response()
}

fn inactive_response() -> Response {
    let mut response = Html(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TempoCue inactive</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #07090f;
        color: #f7f8fb;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.75rem;
      }
      p {
        margin: 0;
        color: #aeb6c5;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Output inactive</h1>
      <p>Use the TempoCue controller to go live before opening local output URLs.</p>
    </main>
  </body>
</html>"#,
    )
    .into_response();
    *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn ws_handler(ws: WebSocketUpgrade, State(context): State<ServerContext>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, context.state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let snapshot = state.snapshot().await;
    let snapshot_event = RealtimeEvent::Snapshot(snapshot);

    if let Ok(payload) = serde_json::to_string(&snapshot_event) {
        if sender.send(Message::Text(payload.into())).await.is_err() {
            return;
        }
    }

    let mut rx = state.subscribe();
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let Ok(payload) = serde_json::to_string(&event) else {
                continue;
            };
            if sender.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(message)) = receiver.next().await {
            match message {
                Message::Text(payload) => {
                    if let Ok(command) = serde_json::from_str::<ClientCommand>(&payload) {
                        apply_client_command(&state, command).await;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
enum ClientCommand {
    #[serde(rename = "timer/start")]
    StartTimer,
    #[serde(rename = "timer/pause")]
    PauseTimer,
    #[serde(rename = "timer/reset")]
    ResetTimer,
    #[serde(rename = "timer/add-time")]
    AddTime {
        #[serde(rename = "deltaMs")]
        delta_ms: i64,
    },
    #[serde(rename = "timer/set-duration")]
    SetDuration {
        #[serde(rename = "durationMs")]
        duration_ms: i64,
    },
    #[serde(rename = "timer/set-remaining")]
    SetRemaining {
        #[serde(rename = "remainingMs")]
        remaining_ms: i64,
    },
    #[serde(rename = "timer/set-end-time")]
    SetEndTime {
        #[serde(rename = "targetTime")]
        target_time: String,
    },
    #[serde(rename = "rundown/select-item")]
    SelectItem {
        #[serde(rename = "itemId")]
        item_id: String,
    },
    #[serde(rename = "rundown/skip")]
    SkipTimer,
    #[serde(rename = "rundown/create-item")]
    CreateItem {
        title: String,
        speaker: String,
        #[serde(rename = "durationMs")]
        duration_ms: i64,
        #[serde(rename = "timingMode")]
        timing_mode: RundownTimingMode,
        #[serde(rename = "endTime")]
        end_time: Option<String>,
        notes: String,
        #[serde(rename = "supportingFiles")]
        supporting_files: Vec<String>,
    },
    #[serde(rename = "rundown/update-item")]
    UpdateItem {
        #[serde(rename = "itemId")]
        item_id: String,
        title: String,
        speaker: String,
        #[serde(rename = "durationMs")]
        duration_ms: i64,
        #[serde(rename = "timingMode")]
        timing_mode: RundownTimingMode,
        #[serde(rename = "endTime")]
        end_time: Option<String>,
        notes: String,
        #[serde(rename = "supportingFiles")]
        supporting_files: Vec<String>,
    },
    #[serde(rename = "rundown/delete-item")]
    DeleteItem {
        #[serde(rename = "itemId")]
        item_id: String,
    },
    #[serde(rename = "output/blackout")]
    SetBlackout { enabled: bool },
    #[serde(rename = "output/hide-timer")]
    SetHideTimer { enabled: bool },
    #[serde(rename = "output/live")]
    SetLive { enabled: bool },
    #[serde(rename = "message/show")]
    ShowMessage(OutputMessage),
    #[serde(rename = "message/draft")]
    MessageDraft(OutputMessageDraft),
    #[serde(rename = "message/hide")]
    HideMessage,
}

async fn apply_client_command(state: &AppState, command: ClientCommand) {
    match command {
        ClientCommand::StartTimer => {
            state.update_timer(|timer| timer.start()).await;
        }
        ClientCommand::PauseTimer => {
            state.update_timer(|timer| timer.pause()).await;
        }
        ClientCommand::ResetTimer => {
            state.update_timer(|timer| timer.reset()).await;
        }
        ClientCommand::AddTime { delta_ms } => {
            state.add_time(delta_ms).await;
        }
        ClientCommand::SetDuration { duration_ms } => {
            state.update_timer(|timer| timer.set_duration(duration_ms)).await;
        }
        ClientCommand::SetRemaining { remaining_ms } => {
            state.set_remaining(remaining_ms).await;
        }
        ClientCommand::SetEndTime { target_time } => {
            state
                .update_timer(|timer| {
                    let _ = timer.set_end_at_time(&target_time);
                })
                .await;
        }
        ClientCommand::SelectItem { item_id } => {
            state.select_item(item_id).await;
        }
        ClientCommand::SkipTimer => {
            state.skip_item().await;
        }
        ClientCommand::CreateItem {
            title,
            speaker,
            duration_ms,
            timing_mode,
            end_time,
            notes,
            supporting_files,
        } => {
            let title = title.trim().to_string();
            if !title.is_empty() {
                state
                    .create_item(
                        title,
                        speaker.trim().to_string(),
                        duration_ms,
                        timing_mode,
                        end_time,
                        notes.trim().to_string(),
                        clean_supporting_files(supporting_files),
                    )
                    .await;
            }
        }
        ClientCommand::UpdateItem {
            item_id,
            title,
            speaker,
            duration_ms,
            timing_mode,
            end_time,
            notes,
            supporting_files,
        } => {
            let title = title.trim().to_string();
            if !title.is_empty() {
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
                    .await;
            }
        }
        ClientCommand::DeleteItem { item_id } => {
            state.delete_item(item_id).await;
        }
        ClientCommand::SetBlackout { enabled } => {
            state.set_blackout(enabled).await;
        }
        ClientCommand::SetHideTimer { enabled } => {
            state.set_hide_timer(enabled).await;
        }
        ClientCommand::SetLive { enabled } => {
            state.set_live(enabled).await;
        }
        ClientCommand::ShowMessage(message) => {
            state.show_message(message).await;
        }
        ClientCommand::MessageDraft(draft) => {
            state.update_message_draft(draft).await;
        }
        ClientCommand::HideMessage => {
            state.hide_message().await;
        }
    }
}

fn clean_supporting_files(files: Vec<String>) -> Vec<String> {
    files
        .into_iter()
        .map(|file| file.trim().to_string())
        .filter(|file| !file.is_empty())
        .collect()
}

fn is_controller_path(path: &str) -> bool {
    matches!(path, "control" | "settings")
}

fn dev_index_html() -> String {
    r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TempoCue</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="http://127.0.0.1:1420/src/main.tsx"></script>
  </body>
</html>"#
        .to_string()
}
