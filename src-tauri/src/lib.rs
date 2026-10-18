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
mod windows;

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
            windows::restore(app.handle());
            #[cfg(target_os = "macos")]
            apple_quit::install(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => windows::begin_quit(app),
            "new-window" => {
                let _ = windows::open_window(app, None);
            }
            // Cmd+Wはフォーカス中のウィンドウだけを、保存してから閉じる
            "close-window" => windows::emit_focused(app, "nagori:close-requested", ()),
            id => windows::emit_focused(app, "nagori:menu", serde_json::json!({ "action": id })),
        })
        .on_window_event(|window, event| match event {
            // 閉じるボタンも、そのウィンドウだけを保存してから閉じる。終了の途中なら止めない
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if !window.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit_to(window.label(), "nagori:close-requested", ());
                }
            }
            tauri::WindowEvent::Focused(true) => {
                windows::remember_focus(window.app_handle(), window.label());
            }
            tauri::WindowEvent::Destroyed => {
                windows::forget(window.app_handle(), window.label());
            }
            _ => {}
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
            commands::workspace_last_file,
            commands::window_close,
            commands::quit_ready,
            commands::quit_cancel,
            commands::external_open
        ])
        .build(tauri::generate_context!())
        .expect("Nagori could not start");
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            windows::open_urls(app, urls.clone());
        }
        if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
            if !app.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
                api.prevent_exit();
                // 最後のウィンドウが閉じた時(code がない)は、その破棄の処理で終了を始める
                if code.is_some() {
                    windows::begin_quit(app);
                }
            }
        }
    });
}
