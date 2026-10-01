mod files;
use files::{Entry, Error, Image, InsertedImage, OpenedDocument, Result, Saved, Settings};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Workspace {
    root: Option<PathBuf>,
    watcher: Option<RecommendedWatcher>,
}
impl Workspace {
    fn root(&self) -> Result<&Path> {
        self.root
            .as_deref()
            .ok_or_else(|| Error::new("WORKSPACE", "プロジェクトフォルダを開いてください。"))
    }
}
#[derive(Clone, Default)]
struct Backend {
    // ponytail: one lock serializes project operations; split read locks only if measured UI throughput requires it.
    workspace: Arc<Mutex<Workspace>>,
    allow_exit: Arc<AtomicBool>,
}
async fn work<T: Send + 'static>(
    state: &Backend,
    task: impl FnOnce(&mut Workspace) -> Result<T> + Send + 'static,
) -> Result<T> {
    let workspace = state.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut workspace = workspace
            .lock()
            .map_err(|_| Error::new("INTERNAL", "ファイル処理のロックに失敗しました。"))?;
        task(&mut workspace)
    })
    .await
    .map_err(|e| Error::new("INTERNAL", e.to_string()))?
}
#[tauri::command]
async fn workspace_open(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    path: String,
) -> Result<String> {
    work(&state, move |workspace| {
        let root = std::fs::canonicalize(&path)?;
        if !root.is_dir() {
            return Err(Error::new("INVALID", "フォルダを選択してください。"));
        }
        std::fs::read_dir(&root)?;
        let project = root
            .to_str()
            .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないパスです。"))?
            .to_owned();
        let watched_root = root.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
                Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                    let paths: Vec<String> = event
                        .paths
                        .iter()
                        .filter_map(|path| path.strip_prefix(&watched_root).ok())
                        .filter(|path| !files::excluded(path))
                        .filter_map(|p| p.to_str().map(str::to_owned))
                        .collect();
                    if !paths.is_empty() {
                        let _ = app.emit(
                            "nagori:fs-changed",
                            serde_json::json!({ "paths": paths, "project": watched_root }),
                        );
                    }
                }
                Err(error) => {
                    let _ = app.emit("nagori:fs-error", error.to_string());
                }
                _ => {}
            })
            .map_err(|e| Error::new("WATCH", e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| Error::new("WATCH", e.to_string()))?;
        workspace.root = Some(root);
        workspace.watcher = Some(watcher);
        Ok(project)
    })
    .await
}
#[tauri::command]
async fn workspace_list(state: State<'_, Backend>, path: String) -> Result<Vec<Entry>> {
    work(&state, move |w| files::list(w.root()?, &path)).await
}
#[tauri::command]
async fn workspace_index(state: State<'_, Backend>) -> Result<Vec<Entry>> {
    work(&state, move |w| files::index(w.root()?)).await
}
#[tauri::command]
async fn document_open(state: State<'_, Backend>, path: String) -> Result<OpenedDocument> {
    work(&state, move |w| files::open(w.root()?, &path)).await
}
#[tauri::command]
async fn document_save(
    state: State<'_, Backend>,
    path: String,
    text: String,
    baseline: String,
) -> Result<Saved> {
    work(&state, move |w| {
        files::save(w.root()?, &path, &text, &baseline)
    })
    .await
}
#[tauri::command]
async fn document_save_as(
    state: State<'_, Backend>,
    source_path: String,
    path: String,
    text: String,
) -> Result<OpenedDocument> {
    work(&state, move |w| {
        files::save_as(w.root()?, &source_path, &path, &text)
    })
    .await
}
#[tauri::command]
async fn file_create(state: State<'_, Backend>, path: String, kind: String) -> Result<Entry> {
    work(&state, move |w| files::create(w.root()?, &path, &kind)).await
}
#[tauri::command]
async fn file_rename(state: State<'_, Backend>, path: String, new_name: String) -> Result<Entry> {
    work(&state, move |w| files::rename(w.root()?, &path, &new_name)).await
}
#[tauri::command]
async fn file_trash(state: State<'_, Backend>, path: String) -> Result<()> {
    work(&state, move |w| files::trash(w.root()?, &path)).await
}
#[tauri::command]
async fn image_read(
    state: State<'_, Backend>,
    path: String,
    document_path: Option<String>,
) -> Result<Image> {
    work(&state, move |w| {
        files::read_image(&files::image_path(
            w.root()?,
            &path,
            document_path.as_deref(),
        )?)
    })
    .await
}
#[tauri::command]
async fn image_insert(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    source_path: String,
    document_path: String,
) -> Result<InsertedImage> {
    if !app.fs_scope().is_allowed(&source_path) {
        return Err(Error::new(
            "PERMISSION",
            "ファイル選択で明示された画像だけを取り込めます。",
        ));
    }
    work(&state, move |w| {
        files::insert_image(w.root()?, &source_path, &document_path)
    })
    .await
}
#[tauri::command]
async fn workspace_reveal(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    path: String,
) -> Result<()> {
    work(&state, move |w| {
        app.opener()
            .reveal_item_in_dir(files::resolve(w.root()?, &path, false)?)
            .map_err(|e| Error::new("OPENER", e.to_string()))
    })
    .await
}
#[tauri::command]
fn external_open(app: tauri::AppHandle, url: String) -> Result<()> {
    let parsed = url::Url::parse(&url).map_err(|_| Error::new("INVALID", "URLが不正です。"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(Error::new(
            "UNSUPPORTED",
            "HTTP / HTTPSリンクのみ開けます。",
        ));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| Error::new("OPENER", e.to_string()))
}
#[tauri::command]
async fn settings_get(app: tauri::AppHandle) -> Result<Settings> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .path()
            .app_config_dir()
            .map_err(|e| Error::new("SETTINGS", e.to_string()))?
            .join("settings.json");
        if !path.exists() {
            return Ok(Settings::default());
        }
        let bytes = files::read_limited(&path, 64 * 1024)?;
        let settings: Settings =
            serde_json::from_slice(&bytes).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
        settings.validate()?;
        Ok(settings)
    })
    .await
    .map_err(|e| Error::new("INTERNAL", e.to_string()))?
}
#[tauri::command]
async fn settings_save(app: tauri::AppHandle, settings: Settings) -> Result<()> {
    settings.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|e| Error::new("SETTINGS", e.to_string()))?;
        std::fs::create_dir_all(&directory)?;
        let bytes = serde_json::to_vec_pretty(&settings)
            .map_err(|e| Error::new("SETTINGS", e.to_string()))?;
        if bytes.len() > 64 * 1024 {
            return Err(Error::new("LIMIT", "設定サイズの上限を超えています。"));
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&directory)?;
        temporary.write_all(&bytes)?;
        temporary.flush()?;
        temporary
            .persist(directory.join("settings.json"))
            .map_err(|e| Error::from(e.error))?;
        Ok(())
    })
    .await
    .map_err(|e| Error::new("INTERNAL", e.to_string()))?
}
#[tauri::command]
fn app_exit(app: tauri::AppHandle, state: State<'_, Backend>) {
    state.allow_exit.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn native_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let action = |id: &str, text: &str, shortcut: Option<&str>| {
        MenuItem::with_id(app, id, text, true, shortcut)
    };
    let about = P::about(app, Some("Nagoriについて"), None)?;
    let services = P::services(app, None)?;
    let hide = P::hide(app, None)?;
    let hide_others = P::hide_others(app, None)?;
    let show_all = P::show_all(app, None)?;
    let quit = action("quit", "Nagoriを終了", Some("CmdOrCtrl+Q"))?;
    let separator = P::separator(app)?;
    let application = Submenu::with_items(
        app,
        "Nagori",
        true,
        &[
            &about,
            &separator,
            &services,
            &separator,
            &hide,
            &hide_others,
            &show_all,
            &separator,
            &quit,
        ],
    )?;
    let open = action("open-project", "プロジェクトを開く…", Some("CmdOrCtrl+O"))?;
    let new = action("new-markdown", "新しい記事", Some("CmdOrCtrl+N"))?;
    let folder = action("new-folder", "新しいフォルダ", None)?;
    let insert = action("image-insert", "画像を挿入…", None)?;
    let quick = action("quick-open", "Quick Open…", Some("CmdOrCtrl+P"))?;
    let save = action("save", "保存", Some("CmdOrCtrl+S"))?;
    let close = action("quit", "ウィンドウを閉じる", Some("CmdOrCtrl+W"))?;
    let file = Submenu::with_items(
        app,
        "ファイル",
        true,
        &[
            &open, &quick, &separator, &new, &folder, &insert, &separator, &save, &close,
        ],
    )?;
    let undo = P::undo(app, None)?;
    let redo = P::redo(app, None)?;
    let cut = P::cut(app, None)?;
    let copy = P::copy(app, None)?;
    let paste = P::paste(app, None)?;
    let select_all = P::select_all(app, None)?;
    let find = action("find", "検索…", Some("CmdOrCtrl+F"))?;
    let edit = Submenu::with_items(
        app,
        "編集",
        true,
        &[
            &undo,
            &redo,
            &separator,
            &cut,
            &copy,
            &paste,
            &select_all,
            &separator,
            &find,
        ],
    )?;
    let bold = action("bold", "太字", Some("CmdOrCtrl+B"))?;
    let italic = action("italic", "斜体", Some("CmdOrCtrl+I"))?;
    let link = action("link", "リンク…", Some("CmdOrCtrl+K"))?;
    let strike = action("strike", "取り消し線", None)?;
    let code = action("code", "インラインコード", None)?;
    let format = Submenu::with_items(app, "書式", true, &[&bold, &italic, &strike, &link, &code])?;
    let source = action(
        "source",
        "Live Preview / ソース表示",
        Some("CmdOrCtrl+Shift+L"),
    )?;
    let view = Submenu::with_items(app, "表示", true, &[&source])?;
    Menu::with_items(app, &[&application, &file, &edit, &format, &view])
}
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Backend::default())
        .setup(|app| {
            app.set_menu(native_menu(app)?)?;
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
            workspace_open,
            workspace_list,
            workspace_index,
            document_open,
            document_save,
            document_save_as,
            file_create,
            file_rename,
            file_trash,
            image_read,
            image_insert,
            settings_get,
            settings_save,
            workspace_reveal,
            external_open,
            app_exit
        ])
        .build(tauri::generate_context!())
        .expect("Nagori could not start");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
                api.prevent_exit();
                let _ = app.emit("nagori:quit-requested", ());
            }
        }
    });
}
