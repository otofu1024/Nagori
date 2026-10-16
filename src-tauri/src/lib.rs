#[cfg(target_os = "macos")]
mod apple_quit;
mod blog_characters;
mod blog_posts;
mod blog_themes;
mod cli;
mod commands;
mod files;
mod graph;
mod git;
mod image;
mod link_cards;
mod menu;
mod search;
mod settings;
mod trash;

use commands::Backend;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Backend::default())
        .setup(|app| {
            app.set_menu(menu::native_menu(app)?)?;
            #[cfg(target_os = "macos")]
            apple_quit::install(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                let _ = app.emit("nagori:quit-requested", ());
            } else {
                let _ = app.emit(
                    "nagori:menu",
                    serde_json::json!({ "action": event.id().as_ref() }),
                );
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("nagori:quit-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cli::cli_install,
            cli::cli_uninstall,
            commands::open_request_take,
            commands::workspace_open,
            commands::git_status,
            commands::git_action,
            commands::workspace_list,
            commands::workspace_index,
            commands::workspace_blog_theme,
            commands::workspace_blog_config,
            commands::blog_themes_read,
            commands::blog_themes_apply,
            commands::blog_themes_delete,
            commands::blog_themes_restore,
            commands::blog_characters_image_baseline,
            commands::blog_characters_save,
            commands::workspace_link_cards,
            commands::workspace_link_card,
            commands::workspace_graph_documents,
            commands::workspace_search,
            commands::document_open,
            commands::document_save,
            commands::document_save_as,
            commands::file_create,
            commands::blog_post_create,
            commands::file_rename,
            commands::file_move,
            commands::file_trash,
            commands::trash_list,
            commands::trash_restore,
            commands::trash_delete,
            commands::trash_empty,
            commands::image_read,
            commands::image_insert,
            commands::image_paste,
            commands::settings_get,
            commands::settings_save,
            commands::workspace_reveal,
            commands::external_open,
            commands::app_exit
        ])
        .build(tauri::generate_context!())
        .expect("Nagori could not start");
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let request = commands::open_request(urls.clone());
            if let Ok(mut queue) = app.state::<Backend>().open_requests.lock() {
                queue.push_back(request);
            }
            let _ = app.emit("nagori:open-requested", ());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
                api.prevent_exit();
                let _ = app.emit("nagori:quit-requested", ());
            }
        }
    });
}
