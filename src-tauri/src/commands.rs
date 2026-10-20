use crate::files::{self, Entry, Error, OpenedDocument, Result, Saved};
use crate::image::{self, InsertedImage};
use crate::settings::{self, Settings};
use crate::trash::TrashItem;
use crate::windows;
use crate::{search, trash};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Workspace {
    root: Option<PathBuf>,
    blog_mode: bool,
    watcher: Option<RecommendedWatcher>,
}
impl Workspace {
    fn directory(&self) -> &str {
        if self.blog_mode {
            files::BLOG_DIRECTORY
        } else {
            ""
        }
    }
    fn list(&self, path: &str) -> Result<Vec<Entry>> {
        let path = if path.is_empty() {
            self.directory()
        } else {
            path
        };
        if self.blog_mode
            && path != files::BLOG_DIRECTORY
            && !path.starts_with(&format!("{}/", files::BLOG_DIRECTORY))
        {
            return Err(Error::new("INVALID", "記事のフォルダを選択してください。"));
        }
        files::list(self.root()?, path)
    }
    fn index(&self) -> Result<Vec<Entry>> {
        if self.blog_mode {
            files::index_from(self.root()?, self.directory())
        } else {
            files::index(self.root()?)
        }
    }
    fn blog_theme(&self) -> Option<files::BlogTheme> {
        self.blog_mode
            .then(|| files::read_blog_theme(self.root().ok()?))
            .flatten()
    }
    fn root(&self) -> Result<&Path> {
        self.root
            .as_deref()
            .ok_or_else(|| Error::new("WORKSPACE", "プロジェクトフォルダを開いてください。"))
    }
}
#[derive(Clone, Default)]
pub(crate) struct Backend {
    // shortcut: ワークスペースの操作は1つのロックで直列化する。画面の処理量を測って必要になった時だけ、読み取り用のロックを分ける。
    // ウィンドウのlabelごとに持ち、閉じた時に外す
    workspaces: Arc<Mutex<HashMap<String, Arc<Mutex<Workspace>>>>>,
    pub(crate) projects: Arc<Mutex<HashMap<String, crate::windows::Project>>>,
    pub(crate) allow_exit: Arc<AtomicBool>,
    // ウィンドウのlabelごとに、まだ読まれていない開く依頼
    pub(crate) open_requests: Arc<Mutex<HashMap<String, VecDeque<Result<OpenRequest>>>>>,
    // 終了の保存を待っているウィンドウ。終了していない時はNone
    pub(crate) quit: Arc<Mutex<Option<HashSet<String>>>>,
    // 起動直後の、まだ何も開いていない最初のウィンドウ
    pub(crate) fresh: Arc<Mutex<Option<String>>>,
    pub(crate) focused: Arc<Mutex<Option<String>>>,
    pub(crate) created: Arc<AtomicUsize>,
    previews: Arc<Mutex<image::PreviewCache>>,
    link_cards: Arc<crate::link_cards::Fetcher>,
}
#[derive(Debug, serde::Serialize)]
pub(crate) struct OpenRequest {
    pub(crate) workspace: String,
    pub(crate) path: Option<String>,
    // 終了前に開いていたウィンドウを開き直す依頼。ファイルがなくても開き直しを止めない
    pub(crate) restore: bool,
}

impl Backend {
    // ウィンドウのワークスペース。初めて使う時に空のものを作る
    fn workspace(&self, label: &str) -> Result<Arc<Mutex<Workspace>>> {
        let mut workspaces = self
            .workspaces
            .lock()
            .map_err(|_| Error::new("INTERNAL", "ファイル処理のロックに失敗しました。"))?;
        Ok(workspaces.entry(label.to_owned()).or_default().clone())
    }
    // 閉じたウィンドウのワークスペースを捨てる。フォルダの監視もここで止まる
    pub(crate) fn remove_workspace(&self, label: &str) {
        if let Ok(mut workspaces) = self.workspaces.lock() {
            workspaces.remove(label);
        }
    }
}

pub(crate) fn open_request(urls: Vec<url::Url>) -> Result<OpenRequest> {
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
        restore: false,
    })
}

pub(crate) fn blog_request(mut request: OpenRequest, enabled: bool) -> Result<OpenRequest> {
    if !enabled {
        return Ok(request);
    }
    if let Some(path) = &request.path {
        let absolute = Path::new(&request.workspace).join(path);
        if let Some(root) = absolute.ancestors().skip(1).find(|root| {
            files::validate_blog(root).is_ok()
                && absolute
                    .strip_prefix(root)
                    .is_ok_and(|path| path.starts_with(files::BLOG_DIRECTORY))
        }) {
            request.path = Some(files::relative(root, &absolute)?);
            request.workspace = root.to_string_lossy().into_owned();
        }
    }
    Ok(request)
}

#[tauri::command]
pub(crate) fn open_request_take(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<Option<OpenRequest>> {
    state.take_request(window.label())
}

async fn work<T: Send + 'static>(
    state: &Backend,
    label: &str,
    task: impl FnOnce(&mut Workspace) -> Result<T> + Send + 'static,
) -> Result<T> {
    let workspace = state.workspace(label)?;
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
pub(crate) async fn git_status(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<Option<crate::git::Status>> {
    work(&state, window.label(), |workspace| {
        crate::git::status(workspace.root()?)
    })
    .await
}

#[tauri::command]
pub(crate) async fn git_action(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    project: String,
    action: crate::git::Action,
) -> Result<crate::git::Status> {
    work(&state, window.label(), move |workspace| {
        let root = workspace.root()?;
        if root.to_str() != Some(project.as_str()) {
            return Err(Error::new(
                "GIT_CHANGED",
                "開いたフォルダが変わりました。もう一度選んでください。",
            ));
        }
        crate::git::action(root, action)
    })
    .await
}
// アプリ内のゴミ箱の置き場所。アプリのデータの場所の下に作り、ワークスペースには何も作らない
fn trash_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("trash"))
        .map_err(|e| Error::new("TRASH", e.to_string()))
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedWorkspace {
    root: String,
    blog_mode: bool,
}

#[tauri::command]
pub(crate) async fn workspace_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    blog_features: bool,
) -> Result<OpenedWorkspace> {
    let trash_base = trash_base(&app).ok();
    // 設定が読めない時は既定の30日で整理する
    let retention_days = settings::read(&app)
        .unwrap_or_default()
        .trash_retention_days;
    let label = window.label().to_owned();
    let watched_label = label.clone();
    let emitter = app.clone();
    let opened = work(&state, &label, move |workspace| {
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
        // 監視の知らせは、このフォルダを開いているウィンドウだけへ送る
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
                        let _ = emitter.emit_to(
                            watched_label.as_str(),
                            "nagori:fs-changed",
                            serde_json::json!({ "paths": paths, "project": watched_root }),
                        );
                    }
                }
                Err(error) => {
                    let _ = emitter.emit_to(
                        watched_label.as_str(),
                        "nagori:fs-error",
                        error.to_string(),
                    );
                }
                _ => {}
            })
            .map_err(|e| Error::new("WATCH", e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| Error::new("WATCH", e.to_string()))?;
        workspace.blog_mode = files::blog_mode(&root, blog_features);
        workspace.root = Some(root);
        workspace.watcher = Some(watcher);
        Ok(OpenedWorkspace {
            root: project,
            blog_mode: workspace.blog_mode,
        })
    })
    .await?;
    state.set_root(&label, opened.root.clone());
    windows::release_fresh(&app, &label);
    Ok(opened)
}
#[tauri::command]
pub(crate) async fn workspace_list(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
) -> Result<Vec<Entry>> {
    work(&state, window.label(), move |w| w.list(&path)).await
}
#[tauri::command]
pub(crate) async fn workspace_index(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<Vec<Entry>> {
    work(&state, window.label(), move |w| w.index()).await
}
#[tauri::command]
pub(crate) async fn workspace_blog_theme(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<Option<files::BlogTheme>> {
    work(&state, window.label(), move |w| Ok(w.blog_theme())).await
}
#[tauri::command]
pub(crate) async fn workspace_blog_config(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<Option<String>> {
    work(&state, window.label(), move |w| {
        Ok(if w.blog_mode {
            files::read_blog_config(w.root()?)
        } else {
            None
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn blog_characters_image_baseline(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
) -> Result<Option<String>> {
    work(&state, window.label(), move |w| {
        if !w.blog_mode {
            return Err(Error::new("BLOG", "ブログのモードで開いてください。"));
        }
        crate::blog_characters::image_baseline(w.root()?, &path)
    })
    .await
}
fn theme_root<'a>(workspace: &'a Workspace, project: &str) -> Result<&'a Path> {
    if !workspace.blog_mode {
        return Err(Error::new("BLOG", "ブログのモードで開いてください。"));
    }
    let root = workspace.root()?;
    if root != Path::new(project) {
        return Err(Error::new("WORKSPACE", "開いているブログが変わりました。"));
    }
    Ok(root)
}
fn theme_history_base(app: &tauri::AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("blog-theme-history"))
        .map_err(|error| Error::new("IO", error.to_string()))
}
#[tauri::command]
pub(crate) async fn blog_themes_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    project: String,
) -> Result<crate::blog_themes::Snapshot> {
    let base = theme_history_base(&app)?;
    work(&state, window.label(), move |w| {
        crate::blog_themes::read(theme_root(w, &project)?, &base)
    })
    .await
}
#[tauri::command]
pub(crate) async fn blog_themes_apply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    project: String,
    preset: String,
    baseline: String,
) -> Result<crate::blog_themes::Saved> {
    let base = theme_history_base(&app)?;
    work(&state, window.label(), move |w| {
        crate::blog_themes::apply(theme_root(w, &project)?, &base, &preset, &baseline)
    })
    .await
}
#[tauri::command]
pub(crate) async fn blog_themes_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    project: String,
    id: String,
) -> Result<crate::blog_themes::Snapshot> {
    let base = theme_history_base(&app)?;
    work(&state, window.label(), move |w| {
        crate::blog_themes::delete_custom(theme_root(w, &project)?, &base, &id)
    })
    .await
}
#[tauri::command]
pub(crate) async fn blog_themes_restore(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    project: String,
    id: String,
    baseline: String,
) -> Result<crate::blog_themes::Saved> {
    let base = theme_history_base(&app)?;
    work(&state, window.label(), move |w| {
        crate::blog_themes::restore(theme_root(w, &project)?, &base, &id, &baseline)
    })
    .await
}
#[tauri::command]
pub(crate) async fn blog_characters_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    request: crate::blog_characters::SaveRequest,
) -> Result<crate::blog_characters::Saved> {
    let base = trash_base(&app)?;
    work(&state, window.label(), move |w| {
        if !w.blog_mode {
            return Err(Error::new("BLOG", "ブログのモードで開いてください。"));
        }
        crate::blog_characters::save(w.root()?, &base, request)
    })
    .await
}
#[tauri::command]
pub(crate) async fn workspace_link_cards(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<crate::link_cards::Cache> {
    work(&state, window.label(), move |w| {
        Ok(if w.blog_mode {
            crate::link_cards::load(w.root()?)
        } else {
            Default::default()
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn workspace_link_card(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    url: String,
) -> Result<Option<crate::link_cards::Preview>> {
    let root = work(&state, window.label(), move |w| {
        if !w.blog_mode {
            return Err(Error::new("BLOG", "ブログのモードで開いてください。"));
        }
        Ok(w.root()?.to_owned())
    })
    .await?;
    let fetcher = state.link_cards.clone();
    tauri::async_runtime::spawn_blocking(move || fetcher.fetch(&root, &url))
        .await
        .map_err(|error| Error::new("INTERNAL", error.to_string()))?
}
#[derive(serde::Deserialize)]
pub(crate) struct GraphDraft {
    path: String,
    text: String,
}

#[tauri::command]
pub(crate) async fn workspace_graph_documents(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    draft: Option<GraphDraft>,
) -> Result<Vec<crate::graph::GraphArticle>> {
    work(&state, window.label(), move |w| {
        let root = w.root()?;
        w.index()?
            .into_iter()
            .filter(|entry| {
                entry.kind == "markdown" && entry.path.to_ascii_lowercase().ends_with(".md")
            })
            .map(|entry| {
                let document = files::open(root, &entry.path)?;
                let text = draft
                    .as_ref()
                    .filter(|draft| draft.path == document.path)
                    .map_or(document.text.as_str(), |draft| draft.text.as_str());
                Ok(crate::graph::extract(document.path, text))
            })
            .collect()
    })
    .await
}
// 検索は時間がかかるため、ワークスペースのロックを持たずに別のスレッドで動かす。保存などの処理を待たせない
#[tauri::command]
pub(crate) async fn workspace_search(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    query: String,
    case_sensitive: bool,
    regexp: bool,
) -> Result<search::SearchResult> {
    let (root, directory) = {
        let handle = state.workspace(window.label())?;
        let workspace = handle
            .lock()
            .map_err(|_| Error::new("INTERNAL", "ファイル処理のロックに失敗しました。"))?;
        (
            workspace.root()?.to_path_buf(),
            workspace.directory().to_owned(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        if directory.is_empty() {
            search::run(&root, &query, case_sensitive, regexp)
        } else {
            search::run_from(&root, &directory, &query, case_sensitive, regexp)
        }
    })
    .await
    .map_err(|e| Error::new("INTERNAL", e.to_string()))?
}
#[tauri::command]
pub(crate) async fn document_open(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
) -> Result<OpenedDocument> {
    work(&state, window.label(), move |w| {
        files::open(w.root()?, &path)
    })
    .await
}
#[tauri::command]
pub(crate) async fn document_save(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    text: String,
    baseline: String,
) -> Result<Saved> {
    work(&state, window.label(), move |w| {
        files::save(w.root()?, &path, &text, &baseline)
    })
    .await
}
#[tauri::command]
pub(crate) async fn document_save_as(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    source_path: String,
    path: String,
    text: String,
) -> Result<OpenedDocument> {
    work(&state, window.label(), move |w| {
        files::save_as(w.root()?, &source_path, &path, &text)
    })
    .await
}
#[tauri::command]
pub(crate) async fn blog_post_create(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    expected_root: String,
    date: String,
    text: String,
) -> Result<Entry> {
    work(&state, window.label(), move |w| {
        if !w.blog_mode || w.root()? != Path::new(&expected_root) {
            return Err(Error::new(
                "WORKSPACE",
                "ブログのフォルダが切り替わりました。",
            ));
        }
        crate::blog_posts::create(w.root()?, &date, &text)
    })
    .await
}
#[tauri::command]
pub(crate) async fn file_create(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    kind: String,
) -> Result<Entry> {
    work(&state, window.label(), move |w| {
        files::create(w.root()?, &path, &kind)
    })
    .await
}
#[tauri::command]
pub(crate) async fn file_rename(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    new_name: String,
) -> Result<Entry> {
    work(&state, window.label(), move |w| {
        files::rename(w.root()?, &path, &new_name)
    })
    .await
}
#[tauri::command]
pub(crate) async fn file_move(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    to_directory: String,
) -> Result<Entry> {
    work(&state, window.label(), move |w| {
        files::move_entry(w.root()?, &path, &to_directory)
    })
    .await
}
#[tauri::command]
pub(crate) async fn file_trash(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
) -> Result<TrashItem> {
    let base = trash_base(&app)?;
    work(&state, window.label(), move |w| {
        trash::move_to_trash(&base, w.root()?, &path)
    })
    .await
}
#[tauri::command]
pub(crate) async fn trash_list(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<Vec<TrashItem>> {
    let base = trash_base(&app)?;
    work(&state, window.label(), move |w| {
        trash::list(&base, w.root()?)
    })
    .await
}
#[tauri::command]
pub(crate) async fn trash_restore(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    id: String,
) -> Result<Entry> {
    let base = trash_base(&app)?;
    work(&state, window.label(), move |w| {
        trash::restore(&base, w.root()?, &id)
    })
    .await
}
#[tauri::command]
pub(crate) async fn trash_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    id: String,
) -> Result<()> {
    let base = trash_base(&app)?;
    work(&state, window.label(), move |w| {
        trash::delete(&base, w.root()?, &id)
    })
    .await
}
#[tauri::command]
pub(crate) async fn trash_empty(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
) -> Result<()> {
    let base = trash_base(&app)?;
    work(&state, window.label(), move |w| {
        trash::empty(&base, w.root()?)
    })
    .await
}
fn blog_image_path(workspace: &Workspace, path: &str) -> Result<String> {
    if workspace.blog_mode && path.starts_with('/') && !path.starts_with("//") {
        if Path::new(path)
            .components()
            .any(|part| part == std::path::Component::ParentDir)
        {
            return Err(Error::new(
                "OUTSIDE",
                "publicの下の画像を指定してください。",
            ));
        }
        Ok(format!("public/{}", path.trim_start_matches('/')))
    } else {
        Ok(path.to_owned())
    }
}
#[tauri::command]
pub(crate) async fn image_read(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    document_path: Option<String>,
    preview: Option<bool>,
) -> Result<tauri::ipc::Response> {
    // JSONの数値配列にせず、バイナリのままWebViewへ渡す
    if !preview.unwrap_or(false) {
        return work(&state, window.label(), move |w| {
            image::read_image(&image::image_path(
                w.root()?,
                &blog_image_path(w, &path)?,
                if w.blog_mode && path.starts_with('/') {
                    None
                } else {
                    document_path.as_deref()
                },
            )?)
        })
        .await
        .map(|image| tauri::ipc::Response::new(image.data));
    }
    // 記事中の表示は縮小版を使う。ワークスペースのロックの中ではファイルを開いてヘッダーを読み、
    // 縮小とキャッシュはロックの外で行う
    let source = work(&state, window.label(), move |w| {
        image::PreviewSource::read(&image::image_path(
            w.root()?,
            &blog_image_path(w, &path)?,
            if w.blog_mode && path.starts_with('/') {
                None
            } else {
                document_path.as_deref()
            },
        )?)
    })
    .await?;
    let previews = state.previews.clone();
    tauri::async_runtime::spawn_blocking(move || source.preview(&previews))
        .await
        .map_err(|e| Error::new("INTERNAL", e.to_string()))?
        .map(tauri::ipc::Response::new)
}
// 画像の元のファイルをクリップボードへ入れる。読み込みは image_read と同じ規則で行う
#[tauri::command]
pub(crate) async fn image_copy(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
    document_path: Option<String>,
) -> Result<()> {
    work(&state, window.label(), move |w| {
        let picture = image::copy_source(
            w.root()?,
            &blog_image_path(w, &path)?,
            if w.blog_mode && path.starts_with('/') {
                None
            } else {
                document_path.as_deref()
            },
        )?;
        image::copy_to_clipboard(&picture)
    })
    .await
}
#[tauri::command]
pub(crate) async fn image_insert(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
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
    work(&state, window.label(), move |w| {
        image::insert_image(w.root()?, &source_path, &document_path)
    })
    .await
}
// 貼り付けた画像は、JSONにせずバイト列のまま受け取る。記事のパスはヘッダーで渡す
#[tauri::command]
pub(crate) async fn image_paste(
    window: tauri::WebviewWindow,
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
    work(&state, window.label(), move |w| {
        image::paste_image(w.root()?, &document_path, data)
    })
    .await
}
#[tauri::command]
pub(crate) async fn workspace_reveal(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: String,
) -> Result<()> {
    work(&state, window.label(), move |w| {
        app.opener()
            .reveal_item_in_dir(files::resolve(w.root()?, &path, false)?)
            .map_err(|e| Error::new("OPENER", e.to_string()))
    })
    .await
}
#[tauri::command]
pub(crate) fn external_open(app: tauri::AppHandle, url: String) -> Result<()> {
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
pub(crate) async fn settings_get(app: tauri::AppHandle) -> Result<Settings> {
    tauri::async_runtime::spawn_blocking(move || settings::read(&app))
        .await
        .map_err(|e| Error::new("INTERNAL", e.to_string()))?
}
// 送られた項目だけを保存し、同じ設定を見ているほかのウィンドウへ知らせる
#[tauri::command]
pub(crate) async fn settings_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<()> {
    let source = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let sent = patch.clone();
        let saved = settings::update(&app, patch)?;
        let stored =
            serde_json::to_value(&saved).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
        // 範囲外の値は読み込みと同じ規則で直されるので、直した後の値を知らせる
        windows::broadcast_settings(&app, &source, settings::broadcast_values(&stored, &sent));
        Ok(())
    })
    .await
    .map_err(|e| Error::new("INTERNAL", e.to_string()))?
}
// 開いているファイルを、このウィンドウの最後のファイルとして覚える。開き直す時に使う
#[tauri::command]
pub(crate) fn workspace_last_file(
    window: tauri::WebviewWindow,
    state: State<'_, Backend>,
    path: Option<String>,
) {
    state.set_file(window.label(), path);
}
// 保存を済ませたこのウィンドウを閉じる。最後の1枚なら、終了の処理へ進む
#[tauri::command]
pub(crate) async fn window_close(window: tauri::WebviewWindow) -> Result<()> {
    window
        .destroy()
        .map_err(|e| Error::new("WINDOW", e.to_string()))
}
// 終了の前の保存が済んだことを知らせる。全ウィンドウが済んだら終了する
#[tauri::command]
pub(crate) async fn quit_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    windows::quit_ready(&app, window.label());
}
// 保存できなかったウィンドウがあった時に、終了を取り消す
#[tauri::command]
pub(crate) async fn quit_cancel(app: tauri::AppHandle) {
    windows::quit_cancel(&app);
}

#[cfg(test)]
mod tests;
