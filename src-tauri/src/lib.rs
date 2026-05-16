mod commands;
mod server;
mod state;
mod timer;

use commands::{
    add_time, delete_rundown_item, get_snapshot, hide_message, pause_timer, reset_timer, select_rundown_item,
    set_blackout, set_hide_timer, set_live, set_timer_duration, set_timer_end_time, set_timer_remaining, show_message, skip_timer,
    start_timer, create_rundown_item, update_rundown_item,
};
use server::start_output_server;
use state::AppState;
use tauri::menu::{MenuBuilder, SubmenuBuilder};

const RESTART_APP_MENU_ID: &str = "restart_app";

pub fn run() {
    let state = AppState::default();
    let server_state = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(move |app| {
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
            set_blackout,
            set_hide_timer,
            set_live,
            show_message,
            hide_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running TempoCue");
}
