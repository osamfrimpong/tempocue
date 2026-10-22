use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Multipart, Path, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
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

use crate::state::{AppState, OutputMessage, OutputMessageDraft, RealtimeEvent, RundownItem, RundownTimingMode, TimerColorSettings};
use crate::storage;

pub async fn start_output_server(state: AppState, app: tauri::AppHandle) -> Result<(), String> {
    let network_host = local_network_ipv4().map(|ip| ip.to_string());
    let (listener, port) = bind_with_fallback(Ipv4Addr::UNSPECIFIED).await?;
    state.update_urls(network_host.clone(), port).await;
    tokio::spawn(watch_network_urls(state.clone(), port, network_host));

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/supporting-file/{item_id}/{file_index}/{*filename}", get(supporting_file_handler))
        .route("/api/files/list", get(files_list_handler))
        .route("/api/files/storage", get(files_storage_handler))
        .route("/api/files/verify-pin", post(files_verify_pin_handler))
        .route("/api/files/config", post(files_config_handler))
        .route("/api/files/mkdir", post(files_mkdir_handler))
        .route("/api/files/delete", post(files_delete_handler).delete(files_delete_handler))
        .route("/api/files/rename", post(files_rename_handler))
        .route(
            "/api/files/upload",
            post(files_upload_handler).layer(DefaultBodyLimit::max(10 * 1024 * 1024 * 1024)),
        )
        .route("/api/files/raw/{*path}", get(files_raw_handler))
        .route("/api/files/archive/{*path}", get(files_archive_handler))
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
    // Subscribe before taking the snapshot so an update cannot land in the
    // gap between the initial state read and the live event stream. Events
    // queued after this point are applied after the snapshot in order.
    let mut rx = state.subscribe();
    let snapshot = state.snapshot().await;
    let snapshot_event = RealtimeEvent::Snapshot(snapshot);

    if let Ok(payload) = serde_json::to_string(&snapshot_event) {
        if sender.send(Message::Text(payload.into())).await.is_err() {
            return;
        }
    }

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
    #[serde(rename = "rundown/reorder")]
    ReorderRundown {
        #[serde(rename = "itemIds")]
        item_ids: Vec<String>,
    },
    #[serde(rename = "rundown/replace")]
    ReplaceRundown { rundown: Vec<RundownItem> },
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
    #[serde(rename = "settings/timer-colors")]
    TimerColorSettings(TimerColorSettings),
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
        ClientCommand::ReorderRundown { item_ids } => {
            let _ = state.reorder_rundown(item_ids).await;
        }
        ClientCommand::ReplaceRundown { rundown } => {
            let _ = state.replace_rundown(rundown).await;
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
        ClientCommand::TimerColorSettings(settings) => {
            state.update_timer_color_settings(settings).await;
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
    matches!(path, "control" | "settings" | "files") || path.starts_with("files/")
}

#[derive(Deserialize)]
struct PinQuery {
    pin: Option<String>,
}

async fn is_pin_authorized(
    context: &ServerContext,
    headers: &HeaderMap,
    query_pin: Option<&str>,
) -> bool {
    let configured_pin = context.state.shared_files_pin().await;
    let Some(expected_pin) = configured_pin else {
        return true;
    };
    if expected_pin.trim().is_empty() {
        return true;
    }

    if let Some(pin) = query_pin {
        if pin.trim() == expected_pin.trim() {
            return true;
        }
    }

    if let Some(header_val) = headers.get("X-TempoCue-Pin").or_else(|| headers.get("x-tempocue-pin")) {
        if let Ok(pin_str) = header_val.to_str() {
            if pin_str.trim() == expected_pin.trim() {
                return true;
            }
        }
    }

    if let Some(cookie_val) = headers.get(header::COOKIE) {
        if let Ok(cookie_str) = cookie_val.to_str() {
            for cookie in cookie_str.split(';') {
                let parts: Vec<&str> = cookie.trim().splitn(2, '=').collect();
                if parts.len() == 2 && parts[0].trim() == "tempocue_pin" && parts[1].trim() == expected_pin.trim() {
                    return true;
                }
            }
        }
    }

    // Requests directly originating from the local Tauri desktop app or local dev environment
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if origin.starts_with("tauri://")
            || origin.starts_with("http://tauri.localhost")
            || origin.starts_with("https://tauri.localhost")
            || origin.starts_with("http://localhost:1420")
            || origin.starts_with("http://127.0.0.1:1420")
        {
            return true;
        }
    }
    if let Some(referer) = headers.get(header::REFERER).and_then(|v| v.to_str().ok()) {
        if referer.starts_with("tauri://")
            || referer.starts_with("http://tauri.localhost")
            || referer.starts_with("https://tauri.localhost")
            || referer.starts_with("http://localhost:1420")
            || referer.starts_with("http://127.0.0.1:1420")
        {
            return true;
        }
    }

    false
}

#[derive(Deserialize)]
struct ListFilesQuery {
    path: Option<String>,
    pin: Option<String>,
}

async fn files_list_handler(
    State(context): State<ServerContext>,
    Query(query): Query<ListFilesQuery>,
    headers: HeaderMap,
) -> Response {
    if !is_pin_authorized(&context, &headers, query.pin.as_deref()).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    let base_dir = context.state.shared_storage_dir().await;
    let rel_path = query.path.unwrap_or_default();
    match storage::list_directory(&base_dir, &rel_path) {
        Ok(entries) => axum::Json(entries).into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, err).into_response(),
    }
}

async fn files_storage_handler(
    State(context): State<ServerContext>,
    Query(query): Query<PinQuery>,
    headers: HeaderMap,
) -> Response {
    let is_auth = is_pin_authorized(&context, &headers, query.pin.as_deref()).await;
    let base_dir = context.state.shared_storage_dir().await;
    let config = context.state.storage_config().await;
    let info = storage::get_storage_info(
        &base_dir,
        config.allow_network_uploads,
        config.max_upload_size_mb,
        config.pin.is_some(),
        if is_auth { config.pin } else { None },
    );
    axum::Json(info).into_response()
}

#[derive(Deserialize)]
struct VerifyPinPayload {
    pin: String,
}

async fn files_verify_pin_handler(
    State(context): State<ServerContext>,
    axum::Json(payload): axum::Json<VerifyPinPayload>,
) -> Response {
    let configured = context.state.shared_files_pin().await;
    let Some(expected) = configured else {
        return axum::Json(serde_json::json!({ "valid": true })).into_response();
    };

    if expected.trim().is_empty() || expected.trim() == payload.pin.trim() {
        let cookie_header = format!(
            "tempocue_pin={}; Path=/; SameSite=Lax; Max-Age=86400",
            payload.pin.trim()
        );
        let mut resp = axum::Json(serde_json::json!({ "valid": true })).into_response();
        if let Ok(hv) = HeaderValue::from_str(&cookie_header) {
            resp.headers_mut().insert(header::SET_COOKIE, hv);
        }
        resp
    } else {
        (StatusCode::UNAUTHORIZED, "Invalid PIN").into_response()
    }
}

#[derive(Deserialize)]
struct UpdateStorageConfigPayload {
    allow_network_uploads: bool,
    max_upload_size_mb: u64,
    pin: Option<String>,
}

async fn files_config_handler(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<UpdateStorageConfigPayload>,
) -> Response {
    if !is_pin_authorized(&context, &headers, None).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    context
        .state
        .update_storage_config(
            payload.allow_network_uploads,
            payload.max_upload_size_mb,
            payload.pin,
        )
        .await;
    context.state.broadcast_files_changed("config_changed", "");
    StatusCode::OK.into_response()
}

#[derive(Deserialize)]
struct MkdirPayload {
    path: String,
}

async fn files_mkdir_handler(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<MkdirPayload>,
) -> Response {
    if !is_pin_authorized(&context, &headers, None).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    if !context.state.allow_network_uploads().await {
        return (StatusCode::FORBIDDEN, "Network uploads and modifications are disabled by host").into_response();
    }
    let base_dir = context.state.shared_storage_dir().await;
    match storage::create_directory(&base_dir, &payload.path) {
        Ok(()) => {
            context.state.broadcast_files_changed("created", &payload.path);
            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::BAD_REQUEST, err).into_response(),
    }
}

#[derive(Deserialize)]
struct DeletePayload {
    path: String,
}

async fn files_delete_handler(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<DeletePayload>,
) -> Response {
    if !is_pin_authorized(&context, &headers, None).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    if !context.state.allow_network_uploads().await {
        return (StatusCode::FORBIDDEN, "Modifications are disabled by host").into_response();
    }
    let base_dir = context.state.shared_storage_dir().await;
    match storage::delete_entry(&base_dir, &payload.path) {
        Ok(()) => {
            context.state.broadcast_files_changed("deleted", &payload.path);
            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::BAD_REQUEST, err).into_response(),
    }
}

#[derive(Deserialize)]
struct RenamePayload {
    from: String,
    to: String,
}

async fn files_rename_handler(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<RenamePayload>,
) -> Response {
    if !is_pin_authorized(&context, &headers, None).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    if !context.state.allow_network_uploads().await {
        return (StatusCode::FORBIDDEN, "Modifications are disabled by host").into_response();
    }
    let base_dir = context.state.shared_storage_dir().await;
    match storage::rename_entry(&base_dir, &payload.from, &payload.to) {
        Ok(()) => {
            context.state.broadcast_files_changed("renamed", &payload.to);
            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::BAD_REQUEST, err).into_response(),
    }
}

#[derive(Deserialize)]
struct UploadQuery {
    dir: Option<String>,
    pin: Option<String>,
}

async fn files_upload_handler(
    State(context): State<ServerContext>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    if !is_pin_authorized(&context, &headers, query.pin.as_deref()).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    if !context.state.allow_network_uploads().await {
        return (StatusCode::FORBIDDEN, "Uploads are disabled by host").into_response();
    }

    let max_bytes = context.state.max_upload_size_bytes().await;
    let max_mb = context.state.max_upload_size_mb().await;

    if let Some(content_length) = headers.get(header::CONTENT_LENGTH)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        if content_length > max_bytes {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("Upload exceeds configured maximum limit of {max_mb} MB"),
            ).into_response();
        }
    }

    let base_dir = context.state.shared_storage_dir().await;
    let base_subpath = query.dir.unwrap_or_default();

    let mut saved_count = 0;
    loop {
        let field_opt = match multipart.next_field().await {
            Ok(opt) => opt,
            Err(err) => {
                eprintln!("[TempoCue] upload multipart error: {err}");
                if saved_count > 0 {
                    break;
                }
                return (StatusCode::BAD_REQUEST, format!("Upload error: {err}")).into_response();
            }
        };

        let mut field = match field_opt {
            Some(f) => f,
            None => break,
        };

        let name = match field.file_name() {
            Some(n) => n.to_string(),
            None => continue,
        };

        let rel_dest = if base_subpath.is_empty() {
            name
        } else {
            format!("{}/{}", base_subpath.trim_matches('/'), name.trim_start_matches('/'))
        };

        let safe_target = match storage::resolve_safe_path(&base_dir, &rel_dest) {
            Ok(p) => p,
            Err(err) => return (StatusCode::BAD_REQUEST, err).into_response(),
        };

        if let Some(parent) = safe_target.parent() {
            if let Err(err) = tokio::fs::create_dir_all(parent).await {
                return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create parent directory: {err}")).into_response();
            }
        }

        let mut dest_file = match tokio::fs::File::create(&safe_target).await {
            Ok(f) => f,
            Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create destination file: {err}")).into_response(),
        };

        use tokio::io::AsyncWriteExt;
        let mut upload_err = None;
        let mut file_size: u64 = 0;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    file_size += chunk.len() as u64;
                    if file_size > max_bytes {
                        upload_err = Some((
                            StatusCode::PAYLOAD_TOO_LARGE,
                            format!("File \"{}\" exceeds the configured maximum upload limit of {} MB", rel_dest, max_mb),
                        ));
                        break;
                    }
                    if let Err(err) = dest_file.write_all(&chunk).await {
                        upload_err = Some((StatusCode::INTERNAL_SERVER_ERROR, format!("Write error: {err}")));
                        break;
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    upload_err = Some((StatusCode::BAD_REQUEST, format!("Stream error: {err}")));
                    break;
                }
            }
        }

        if let Some((status, err_msg)) = upload_err {
            drop(dest_file);
            let _ = tokio::fs::remove_file(&safe_target).await;
            eprintln!("[TempoCue] aborted upload of {rel_dest}: {err_msg}");
            return (status, err_msg).into_response();
        }

        let _ = dest_file.flush().await;
        saved_count += 1;
    }

    context.state.broadcast_files_changed("uploaded", &base_subpath);
    axum::Json(serde_json::json!({ "uploaded": saved_count })).into_response()
}

async fn files_raw_handler(
    Path(path): Path<String>,
    Query(query): Query<PinQuery>,
    State(context): State<ServerContext>,
    headers: HeaderMap,
) -> Response {
    if !is_pin_authorized(&context, &headers, query.pin.as_deref()).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    let base_dir = context.state.shared_storage_dir().await;
    let safe_target = match storage::resolve_safe_path(&base_dir, &path) {
        Ok(p) => p,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    if !safe_target.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let Ok(data) = tokio::fs::read(&safe_target).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mime = mime_guess::from_path(&safe_target).first_or_octet_stream();
    let filename = safe_target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .replace('"', "");

    let mut response = data.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("inline; filename=\"{filename}\""))
            .unwrap_or(HeaderValue::from_static("inline")),
    );
    response
}

async fn files_archive_handler(
    Path(path): Path<String>,
    Query(query): Query<PinQuery>,
    State(context): State<ServerContext>,
    headers: HeaderMap,
) -> Response {
    if !is_pin_authorized(&context, &headers, query.pin.as_deref()).await {
        return (StatusCode::UNAUTHORIZED, "PIN authentication required").into_response();
    }
    let base_dir = context.state.shared_storage_dir().await;
    let safe_target = match storage::resolve_safe_path(&base_dir, &path) {
        Ok(p) => p,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    if !safe_target.is_dir() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let folder_name = safe_target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("archive")
        .replace('"', "");

    match storage::zip_directory(&base_dir, &path) {
        Ok(zip_bytes) => {
            let mut response = zip_bytes.into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/zip"),
            );
            response.headers_mut().insert(
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename=\"{folder_name}.zip\""))
                    .unwrap_or(HeaderValue::from_static("attachment; filename=\"archive.zip\"")),
            );
            response
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err).into_response(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_browser_message_show_command() {
        let payload = r##"{
            "type": "message/show",
            "payload": {
                "id": "message-1",
                "type": "lower-third",
                "body": "Please welcome the next speaker",
                "formatting": {
                    "body": { "bold": true, "italic": false, "color": "#ffffff" }
                },
                "flashing": false,
                "visible": true,
                "target": "all"
            }
        }"##;

        let command = serde_json::from_str::<ClientCommand>(payload).expect("message/show should parse");

        match command {
            ClientCommand::ShowMessage(message) => {
                assert_eq!(message.id, "message-1");
                assert_eq!(message.message_type, "lower-third");
                assert_eq!(message.target, "all");
            }
            _ => panic!("expected message/show command"),
        }
    }

    #[test]
    fn deserializes_browser_message_hide_command() {
        let command = serde_json::from_str::<ClientCommand>(r#"{ "type": "message/hide" }"#)
            .expect("message/hide should parse");

        assert!(matches!(command, ClientCommand::HideMessage));
    }

    #[test]
    fn deserializes_browser_timer_color_settings_command() {
        let payload = r#"{
            "type": "settings/timer-colors",
            "payload": {
                "yellowThresholdMs": 300000,
                "redThresholdMs": 60000
            }
        }"#;

        let command = serde_json::from_str::<ClientCommand>(payload)
            .expect("settings/timer-colors should parse");

        match command {
            ClientCommand::TimerColorSettings(settings) => {
                assert_eq!(settings.yellow_threshold_ms, 300000);
                assert_eq!(settings.red_threshold_ms, 60000);
            }
            _ => panic!("expected settings/timer-colors command"),
        }
    }

    #[test]
    fn deserializes_browser_rundown_reorder_command() {
        let payload = r#"{
            "type": "rundown/reorder",
            "payload": {
                "itemIds": ["item-2", "item-1"]
            }
        }"#;

        let command = serde_json::from_str::<ClientCommand>(payload)
            .expect("rundown/reorder should parse");

        match command {
            ClientCommand::ReorderRundown { item_ids } => {
                assert_eq!(item_ids, vec!["item-2", "item-1"]);
            }
            _ => panic!("expected rundown/reorder command"),
        }
    }
}
