mod cli;
mod files;
mod search;
mod trash;
use files::{Entry, Error, InsertedImage, OpenedDocument, Result, Saved, Settings};
use trash::TrashItem;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::VecDeque,
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
    open_requests: Arc<Mutex<VecDeque<Result<OpenRequest>>>>,
    previews: Arc<Mutex<files::PreviewCache>>,
}
#[derive(Debug, serde::Serialize)]
struct OpenRequest {
    workspace: String,
    path: Option<String>,
}

fn open_request(urls: Vec<url::Url>) -> Result<OpenRequest> {
    if urls.is_empty() || urls.len() > 2 {
        return Err(Error::new(
            "INVALID",
            "フォルダ、またはフォルダとファイルを指定してください。",
        ));
    }
    let paths = urls
        .into_iter()
        .map(|url| {
            let path = url
                .to_file_path()
                .map_err(|_| Error::new("INVALID", "ローカルファイルのみ開けます。"))?;
            Ok(std::fs::canonicalize(path)?)
        })
        .collect::<Result<Vec<_>>>()?;
    let (root, file): (&Path, Option<&PathBuf>) = if paths[0].is_dir() {
        (&paths[0], paths.get(1))
    } else if paths.len() == 1 && paths[0].is_file() {
        (
            paths[0]
                .parent()
                .ok_or_else(|| Error::new("INVALID", "親フォルダがありません。"))?,
            Some(&paths[0]),
        )
    } else {
        return Err(Error::new(
            "INVALID",
            "フォルダまたは通常ファイルを指定してください。",
        ));
    };
    let path = file
        .map(|file| {
            if !file.is_file() {
                return Err(Error::new("INVALID", "通常ファイルを指定してください。"));
            }
            let relative = files::relative(root, file)?;
            files::resolve(root, &relative, false)?;
            Ok(relative)
        })
        .transpose()?;
    Ok(OpenRequest {
        workspace: root
            .to_str()
            .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないパスです。"))?
            .to_owned(),
        path,
    })
}

#[tauri::command]
fn open_request_take(state: State<'_, Backend>) -> Result<Option<OpenRequest>> {
    state
        .open_requests
        .lock()
        .map_err(|_| Error::new("INTERNAL", "起動要求のロックに失敗しました。"))?
        .pop_front()
        .transpose()
}

#[cfg(test)]
mod open_tests {
    use super::*;

    #[test]
    fn native_open_requests_validate_and_preserve_workspace() {
        let temporary = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temporary.path()).unwrap();
        let child = root.join("日本語 # notes");
        std::fs::create_dir(&child).unwrap();
        let file = child.join("test file.md");
        std::fs::write(&file, "# Test").unwrap();
        let dir_url = url::Url::from_directory_path(&root).unwrap();
        let file_url = url::Url::from_file_path(&file).unwrap();
        let folder = open_request(vec![dir_url.clone()]).unwrap();
        assert_eq!(folder.workspace, root.to_str().unwrap());
        assert!(folder.path.is_none());
        let request = open_request(vec![dir_url.clone(), file_url.clone()]).unwrap();
        assert_eq!(request.workspace, root.to_str().unwrap());
        assert_eq!(request.path.as_deref(), Some("日本語 # notes/test file.md"));
        let alone = open_request(vec![file_url.clone()]).unwrap();
        assert_eq!(alone.workspace, child.to_str().unwrap());
        assert_eq!(alone.path.as_deref(), Some("test file.md"));
        assert!(open_request(vec![]).is_err());
        assert!(open_request(vec![file_url, dir_url.clone()]).is_err());
        assert!(open_request(vec![url::Url::parse("https://example.com").unwrap()]).is_err());
        assert!(open_request(vec![dir_url.clone(), dir_url.clone()]).is_err());
        assert!(open_request(vec![dir_url.clone(), dir_url.clone(), dir_url.clone()]).is_err());
        let missing = url::Url::from_file_path(root.join("missing.md")).unwrap();
        assert!(open_request(vec![dir_url.clone(), missing]).is_err());
        let outside = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(
            open_request(vec![
                dir_url.clone(),
                url::Url::from_file_path(outside.path()).unwrap()
            ])
            .unwrap_err()
            .code,
            "OUTSIDE"
        );
        std::fs::create_dir(root.join(".git")).unwrap();
        let excluded = root.join(".git/config");
        std::fs::write(&excluded, "secret").unwrap();
        assert_eq!(
            open_request(vec![dir_url, url::Url::from_file_path(excluded).unwrap()])
                .unwrap_err()
                .code,
            "EXCLUDED"
        );
        let backend = Backend::default();
        backend.open_requests.lock().unwrap().extend([
            Ok(folder),
            Err(Error::new("INVALID", "invalid")),
            Ok(alone),
        ]);
        let mut queue = backend.open_requests.lock().unwrap();
        assert!(queue.pop_front().unwrap().unwrap().path.is_none());
        assert!(queue.pop_front().unwrap().is_err());
        assert_eq!(
            queue.pop_front().unwrap().unwrap().path.as_deref(),
            Some("test file.md")
        );
        assert!(queue.is_empty());
    }
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
// アプリ内のゴミ箱の置き場所。アプリのデータの場所の下に作り、ワークスペースには何も作らない
fn trash_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("trash"))
        .map_err(|e| Error::new("TRASH", e.to_string()))
}
#[tauri::command]
async fn workspace_open(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    path: String,
) -> Result<String> {
    let trash_base = trash_base(&app).ok();
    // 設定が読めない時は既定の30日で整理する
    let retention_days = read_settings(&app).unwrap_or_default().trash_retention_days;
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
        // 保存期限を過ぎた項目の整理は失敗しても開く処理を止めない
        if let Some(base) = &trash_base {
            trash::purge_expired(base, &root, retention_days);
        }
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
// 検索は時間がかかるため、ワークスペースのロックを持たずに別のスレッドで動かす。保存などの処理を待たせない
#[tauri::command]
async fn workspace_search(
    state: State<'_, Backend>,
    query: String,
    case_sensitive: bool,
    regexp: bool,
) -> Result<search::SearchResult> {
    let root = {
        let workspace = state
            .workspace
            .lock()
            .map_err(|_| Error::new("INTERNAL", "ファイル処理のロックに失敗しました。"))?;
        workspace.root()?.to_path_buf()
    };
    tauri::async_runtime::spawn_blocking(move || {
        search::run(&root, &query, case_sensitive, regexp)
    })
    .await
    .map_err(|e| Error::new("INTERNAL", e.to_string()))?
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
async fn file_move(state: State<'_, Backend>, path: String, to_directory: String) -> Result<Entry> {
    work(&state, move |w| {
        files::move_entry(w.root()?, &path, &to_directory)
    })
    .await
}
#[tauri::command]
async fn file_trash(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    path: String,
) -> Result<TrashItem> {
    let base = trash_base(&app)?;
    work(&state, move |w| {
        trash::move_to_trash(&base, w.root()?, &path)
    })
    .await
}
#[tauri::command]
async fn trash_list(app: tauri::AppHandle, state: State<'_, Backend>) -> Result<Vec<TrashItem>> {
    let base = trash_base(&app)?;
    work(&state, move |w| trash::list(&base, w.root()?)).await
}
#[tauri::command]
async fn trash_restore(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    id: String,
) -> Result<Entry> {
    let base = trash_base(&app)?;
    work(&state, move |w| trash::restore(&base, w.root()?, &id)).await
}
#[tauri::command]
async fn trash_delete(app: tauri::AppHandle, state: State<'_, Backend>, id: String) -> Result<()> {
    let base = trash_base(&app)?;
    work(&state, move |w| trash::delete(&base, w.root()?, &id)).await
}
#[tauri::command]
async fn trash_empty(app: tauri::AppHandle, state: State<'_, Backend>) -> Result<()> {
    let base = trash_base(&app)?;
    work(&state, move |w| trash::empty(&base, w.root()?)).await
}
#[tauri::command]
async fn image_read(
    state: State<'_, Backend>,
    path: String,
    document_path: Option<String>,
    preview: Option<bool>,
) -> Result<tauri::ipc::Response> {
    // JSONの数値配列にせず、バイナリのままWebViewへ渡す
    if !preview.unwrap_or(false) {
        return work(&state, move |w| {
            files::read_image(&files::image_path(
                w.root()?,
                &path,
                document_path.as_deref(),
            )?)
        })
        .await
        .map(|image| tauri::ipc::Response::new(image.data));
    }
    // 記事中の表示は縮小版を使う。ワークスペースのロックの中では読み込みだけをし、
    // 縮小とキャッシュはロックの外で行う
    let source = work(&state, move |w| {
        files::PreviewSource::read(&files::image_path(
            w.root()?,
            &path,
            document_path.as_deref(),
        )?)
    })
    .await?;
    let previews = state.previews.clone();
    tauri::async_runtime::spawn_blocking(move || source.preview(&previews))
        .await
        .map_err(|e| Error::new("INTERNAL", e.to_string()))?
        .map(tauri::ipc::Response::new)
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
// 貼り付けた画像は、JSONにせずバイト列のまま受け取る。記事のパスはヘッダーで渡す
#[tauri::command]
async fn image_paste(
    state: State<'_, Backend>,
    request: tauri::ipc::Request<'_>,
) -> Result<InsertedImage> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(Error::new("INVALID", "画像のデータを受け取れません。"));
    };
    let document_path = request
        .headers()
        .get("x-document-path")
        .and_then(|value| value.to_str().ok())
        .map(|value| format!("p={value}"))
        .and_then(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .next()
                .map(|(_, value)| value.into_owned())
        })
        .ok_or_else(|| Error::new("INVALID", "貼り付け先の記事が分かりません。"))?;
    let data = data.clone();
    work(&state, move |w| {
        files::paste_image(w.root()?, &document_path, data)
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
// 保存された設定を読む。ファイルがなければ初期値を返す
fn read_settings(app: &tauri::AppHandle) -> Result<Settings> {
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
}
#[tauri::command]
async fn settings_get(app: tauri::AppHandle) -> Result<Settings> {
    tauri::async_runtime::spawn_blocking(move || read_settings(&app))
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

// 終了のApple Event(Dock終了、osascript、ログアウトなど)は、tao 0.37では
// applicationWillTerminateへ直行し、ExitRequestedもフロントの保存も通らない。
// そこでデリゲートへapplicationShouldTerminate:を足し、保存が済むまで終了を取り消す。
#[cfg(target_os = "macos")]
mod apple_quit {
    use super::Backend;
    use std::ffi::{c_char, c_void};
    use std::sync::atomic::Ordering;
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
        fn object_getClass(object: Id) -> Id;
        fn class_addMethod(class: Id, name: Sel, imp: *const c_void, types: *const c_char) -> bool;
    }

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    // NSTerminateCancel = 0、NSTerminateNow = 1
    extern "C" fn should_terminate(_this: Id, _sel: Sel, _sender: Id) -> usize {
        let Some(app) = APP.get() else { return 1 };
        if app.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
            return 1;
        }
        let _ = app.emit("nagori:quit-requested", ());
        0
    }

    pub fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            let send: unsafe extern "C" fn(Id, Sel) -> Id =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            let ns_app = send(
                objc_getClass(c"NSApplication".as_ptr()),
                sel_registerName(c"sharedApplication".as_ptr()),
            );
            let delegate = send(ns_app, sel_registerName(c"delegate".as_ptr()));
            if delegate.is_null() {
                return;
            }
            class_addMethod(
                object_getClass(delegate),
                sel_registerName(c"applicationShouldTerminate:".as_ptr()),
                should_terminate as *const c_void,
                c"Q@:@".as_ptr(),
            );
        }
    }
}

fn native_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let action = |id: &str, text: &str, shortcut: Option<&str>| {
        MenuItem::with_id(app, id, text, true, shortcut)
    };
    let about = P::about(app, Some("Nagoriについて"), None)?;
    let settings = action("settings-open", "設定…", Some("CmdOrCtrl+,"))?;
    let services = P::services(app, None)?;
    let hide = P::hide(app, None)?;
    let hide_others = P::hide_others(app, None)?;
    let show_all = P::show_all(app, None)?;
    let cli_install = action("cli-install", "nagoriコマンドを登録…", None)?;
    let cli_uninstall = action("cli-uninstall", "nagoriコマンドの登録を解除", None)?;
    let quit = action("quit", "Nagoriを終了", Some("CmdOrCtrl+Q"))?;
    let separator = P::separator(app)?;
    let application = Submenu::with_items(
        app,
        "Nagori",
        true,
        &[
            &about,
            &separator,
            &settings,
            &separator,
            &cli_install,
            &cli_uninstall,
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
    let workspace_search = action(
        "workspace-search",
        "ワークスペース全体を検索…",
        Some("CmdOrCtrl+Shift+F"),
    )?;
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
            &workspace_search,
        ],
    )?;
    let bold = action("bold", "太字", Some("CmdOrCtrl+B"))?;
    let italic = action("italic", "斜体", Some("CmdOrCtrl+I"))?;
    let link = action("link", "リンク…", Some("CmdOrCtrl+K"))?;
    let strike = action("strike", "取り消し線", None)?;
    let code = action("code", "インラインコード", None)?;
    let format = Submenu::with_items(app, "書式", true, &[&bold, &italic, &strike, &link, &code])?;
    let preview = action(
        "preview-toggle",
        "Live Preview / Preview",
        Some("CmdOrCtrl+Shift+L"),
    )?;
    let outline = action("outline-toggle", "目次を表示 / 非表示", None)?;
    let focus = action(
        "focus-toggle",
        "集中モードを切り替え",
        Some("CmdOrCtrl+Shift+J"),
    )?;
    let typewriter = action(
        "typewriter-toggle",
        "タイプライター表示を切り替え",
        Some("CmdOrCtrl+Shift+T"),
    )?;
    let font_larger = action("font-larger", "文字を大きく", Some("CmdOrCtrl+="))?;
    let font_smaller = action("font-smaller", "文字を小さく", Some("CmdOrCtrl+-"))?;
    let font_reset = action("font-reset", "文字を標準サイズに", Some("CmdOrCtrl+0"))?;
    let view = Submenu::with_items(
        app,
        "表示",
        true,
        &[
            &preview,
            &outline,
            &focus,
            &typewriter,
            &separator,
            &font_larger,
            &font_smaller,
            &font_reset,
        ],
    )?;
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
            open_request_take,
            workspace_open,
            workspace_list,
            workspace_index,
            workspace_search,
            document_open,
            document_save,
            document_save_as,
            file_create,
            file_rename,
            file_move,
            file_trash,
            trash_list,
            trash_restore,
            trash_delete,
            trash_empty,
            image_read,
            image_insert,
            image_paste,
            settings_get,
            settings_save,
            workspace_reveal,
            external_open,
            app_exit
        ])
        .build(tauri::generate_context!())
        .expect("Nagori could not start");
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let request = open_request(urls.clone());
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
