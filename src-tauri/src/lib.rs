mod commands;
mod server;
mod state;
mod timer;

use commands::{
    add_time, create_rundown_item, delete_rundown_item, export_schedule_file, get_snapshot, hide_message,
    import_schedule_file, pause_timer, reorder_rundown, replace_rundown, reset_timer, select_rundown_item, set_blackout,
    set_hide_timer, set_live, set_timer_color_settings, set_timer_duration, set_timer_end_time,
    set_timer_remaining, show_message, skip_timer, start_timer, update_message_draft, update_rundown_item,
};
use server::start_output_server;
use state::AppState;
use std::path::{Path, PathBuf};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Manager;

const RESTART_APP_MENU_ID: &str = "restart_app";

pub fn run() {
    let state = AppState::default();
    let server_state = state.clone();
    let setup_state = state.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(move |app| {
            let schedule_path = app.path().app_data_dir()?.join("schedule.json");
            tauri::async_runtime::block_on(setup_state.initialize_persistence(schedule_path));
            if let Some(opened_path) = schedule_path_from_args() {
                if let Err(error) = tauri::async_runtime::block_on(setup_state.import_schedule_file(&opened_path)) {
                    eprintln!("failed to open {}: {error}", opened_path.display());
                }
            }
            let file_menu = SubmenuBuilder::new(app, "File")
                .text(RESTART_APP_MENU_ID, "Restart app")
                .build()?;
            let menu = MenuBuilder::new(app).item(&file_menu).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == RESTART_APP_MENU_ID {
                    app.request_restart();
                }
            });

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = start_output_server(server_state, handle).await {
                    eprintln!("failed to start output server: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            start_timer,
            pause_timer,
            reset_timer,
            add_time,
            set_timer_duration,
            set_timer_remaining,
            set_timer_end_time,
            skip_timer,
            select_rundown_item,
            create_rundown_item,
            update_rundown_item,
            delete_rundown_item,
            reorder_rundown,
            replace_rundown,
            export_schedule_file,
            import_schedule_file,
            set_blackout,
            set_hide_timer,
            set_live,
            set_timer_color_settings,
            update_message_draft,
            show_message,
            hide_message
        ])
        .build(tauri::generate_context!())
        .expect("error while building TempoCue");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            if let Some(path) = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .find(|path| is_tempocue_schedule(path))
            {
                let state = app_handle.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = state.import_schedule_file(&path).await {
                        eprintln!("failed to open {}: {error}", path.display());
                    }
                });
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    });
}

fn schedule_path_from_args() -> Option<PathBuf> {
    std::env::args_os().skip(1).map(PathBuf::from).find(|path| is_tempocue_schedule(path))
}

fn is_tempocue_schedule(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tmpc"))
}
