// 複数のウィンドウを管理する。ウィンドウの作成、開く依頼の振り分け、終了時の保存の待ち合わせ、開き直し用の一覧を受け持つ
use crate::commands::{self, Backend, OpenRequest};
use crate::files::{Error, Result};
use crate::settings::{self, OpenWindow};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{atomic::Ordering, Mutex, MutexGuard, PoisonError};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

// 起動時の最初のウィンドウ。tauri.conf.jsonで作られる
pub(crate) const MAIN: &str = "main";

// ウィンドウごとの、開いているフォルダと最後に開いていたファイル。ワークスペースのロックを待たずに読めるよう別に持つ
#[derive(Clone, Debug)]
pub(crate) struct Project {
    pub(crate) root: String,
    pub(crate) file: Option<String>,
}

// 開く依頼を振り分ける候補。idleは起動直後でまだ何も開いていない空のウィンドウ
#[derive(Clone, Debug)]
pub(crate) struct Candidate {
    pub(crate) label: String,
    pub(crate) root: Option<String>,
    pub(crate) idle: bool,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Route {
    // 同じフォルダを開いているウィンドウを前に出すだけにする。依頼は積まない
    Show(String),
    // 同じフォルダを開いているウィンドウで、指定のファイルだけを開く
    Open(String),
    // 起動直後の空のウィンドウを使う
    Reuse(String),
    // どちらもなければ新しいウィンドウを作る
    Create,
}

// 同じフォルダを開いているウィンドウを優先し、なければ空の最初のウィンドウを使い、どちらもなければ新しく作る
pub(crate) fn route(candidates: &[Candidate], workspace: &str, file: Option<&str>) -> Route {
    if let Some(candidate) = candidates
        .iter()
        .find(|candidate| candidate.root.as_deref() == Some(workspace))
    {
        // フォルダは開き直さない。ファイルの指定がなければ前に出すだけにする
        return match file {
            Some(_) => Route::Open(candidate.label.clone()),
            None => Route::Show(candidate.label.clone()),
        };
    }
    match candidates.iter().find(|candidate| candidate.idle) {
        Some(candidate) => Route::Reuse(candidate.label.clone()),
        None => Route::Create,
    }
}

pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // 窓の状態は途中で壊れる作りではないので、ロックが毒されていても続ける
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Backend {
    pub(crate) fn push_request(&self, label: &str, request: Result<OpenRequest>) {
        locked(&self.open_requests)
            .entry(label.to_owned())
            .or_default()
            .push_back(request);
    }

    pub(crate) fn take_request(&self, label: &str) -> Result<Option<OpenRequest>> {
        locked(&self.open_requests)
            .get_mut(label)
            .and_then(|queue| queue.pop_front())
            .transpose()
    }

    pub(crate) fn project_root(&self, label: &str) -> Option<String> {
        locked(&self.projects)
            .get(label)
            .map(|project| project.root.clone())
    }

    // 開いているフォルダを記録する。同じフォルダを開き直した時は、開いていたファイルを残す
    pub(crate) fn set_root(&self, label: &str, root: String) {
        let mut projects = locked(&self.projects);
        let file = projects
            .get(label)
            .filter(|project| project.root == root)
            .and_then(|project| project.file.clone());
        projects.insert(label.to_owned(), Project { root, file });
    }

    pub(crate) fn set_file(&self, label: &str, file: Option<String>) {
        if let Some(project) = locked(&self.projects).get_mut(label) {
            project.file = file;
        }
    }
}

// 空のまま起動した最初のウィンドウを、起動直後の空きとして覚える。ほかの開く依頼はこれを使える
pub(crate) fn release_fresh(app: &AppHandle, label: &str) {
    let backend = app.state::<Backend>();
    let mut fresh = locked(&backend.fresh);
    if fresh.as_deref() == Some(label) {
        *fresh = None;
    }
}

fn candidates(app: &AppHandle) -> Vec<Candidate> {
    let backend = app.state::<Backend>();
    let fresh = locked(&backend.fresh).clone();
    let queued: HashSet<String> = locked(&backend.open_requests)
        .iter()
        .filter(|(_, queue)| !queue.is_empty())
        .map(|(label, _)| label.clone())
        .collect();
    let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
    labels.sort();
    labels
        .into_iter()
        .map(|label| {
            let root = backend.project_root(&label);
            let idle = root.is_none()
                && fresh.as_deref() == Some(label.as_str())
                && !queued.contains(&label);
            Candidate { label, root, idle }
        })
        .collect()
}

// 新しいウィンドウを作る。開く依頼があれば、そのウィンドウの最初の依頼として積んでおく
pub(crate) fn open_window(app: &AppHandle, request: Option<OpenRequest>) -> Result<()> {
    let backend = app.state::<Backend>();
    let label = format!(
        "window-{:06}",
        backend.created.fetch_add(1, Ordering::SeqCst) + 1
    );
    if let Some(request) = request {
        backend.push_request(&label, Ok(request));
    }
    // tauri.conf.jsonの最初のウィンドウと同じ見た目にそろえる
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Nagori")
        .inner_size(1120.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .hidden_title(true)
        .decorations(true)
        .center();
    // ドラッグ&ドロップは、tauri.conf.jsonのdragDropEnabled: falseと同じ設定にする
    #[cfg(windows)]
    let builder = builder.drag_and_drop(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 36.0));
    builder
        .build()
        .map_err(|error| Error::new("WINDOW", error.to_string()))?;
    Ok(())
}

// 窓を前に出す。依頼は積まない
fn show(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn deliver(app: &AppHandle, label: &str, request: Result<OpenRequest>) {
    app.state::<Backend>().push_request(label, request);
    let _ = app.emit_to(label, "nagori:open-requested", ());
    show(app, label);
}

// FinderやCLIからの開く依頼を、既存のウィンドウへ振り分ける。合わなければ新しいウィンドウで開く
pub(crate) fn open_urls(app: &AppHandle, urls: Vec<url::Url>) {
    let request = commands::open_request(urls).and_then(|request| {
        let enabled = settings::read(app).unwrap_or_default().blog_features;
        commands::blog_request(request, enabled)
    });
    let request = match request {
        Ok(request) => request,
        Err(error) => {
            // 開けない依頼は、フォーカス中のウィンドウに知らせる
            let label = focused_label(app).unwrap_or_else(|| MAIN.to_owned());
            deliver(app, &label, Err(error));
            return;
        }
    };
    match route(&candidates(app), &request.workspace, request.path.as_deref()) {
        Route::Show(label) => show(app, &label),
        Route::Open(label) | Route::Reuse(label) => deliver(app, &label, Ok(request)),
        Route::Create => {
            let _ = open_window(app, Some(request));
        }
    }
}

// 起動時に、前回終了した時に開いていたウィンドウを開き直す。一覧がなければ空の最初のウィンドウを用意する
pub(crate) fn restore(app: &AppHandle) {
    let backend = app.state::<Backend>();
    let saved = settings::read(app).unwrap_or_default().restored_windows();
    if saved.is_empty() {
        *locked(&backend.fresh) = Some(MAIN.to_owned());
        return;
    }
    for (index, window) in saved.into_iter().enumerate() {
        let request = OpenRequest {
            workspace: window.project,
            path: window.file,
            restore: true,
        };
        if index == 0 {
            backend.push_request(MAIN, Ok(request));
        } else {
            let _ = open_window(app, Some(request));
        }
    }
}

pub(crate) fn remember_focus(app: &AppHandle, label: &str) {
    *locked(&app.state::<Backend>().focused) = Some(label.to_owned());
}

// フォーカス中のウィンドウ。取れなければ最後にフォーカスを持ったもの、それもなければ適当な1つ
pub(crate) fn focused_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| {
            locked(&app.state::<Backend>().focused)
                .clone()
                .filter(|label| windows.contains_key(label))
        })
        .or_else(|| windows.keys().min().cloned())
}

// メニューの操作は、フォーカス中のウィンドウだけへ送る
pub(crate) fn emit_focused<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Some(label) = focused_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}

// 設定を保存した窓以外へ、保存された項目の値を知らせる
pub(crate) fn broadcast_settings(
    app: &AppHandle,
    source: &str,
    values: serde_json::Map<String, serde_json::Value>,
) {
    for label in app.webview_windows().into_keys() {
        if label != source {
            let _ = app.emit_to(
                label.as_str(),
                "nagori:settings-changed",
                serde_json::json!({ "values": &values }),
            );
        }
    }
}

// 終了を始める。全ウィンドウに保存を求め、全部が応じたら終了する。どこかが保存できなければ quit_cancel で取り消す
pub(crate) fn begin_quit(app: &AppHandle) {
    let backend = app.state::<Backend>();
    if backend.allow_exit.load(Ordering::SeqCst) {
        return;
    }
    let labels: HashSet<String> = app.webview_windows().into_keys().collect();
    if labels.is_empty() {
        finish_quit(app, open_records(app));
        return;
    }
    {
        let mut quit = locked(&backend.quit);
        // 既に保存を待っている終了があれば、それに任せる
        if quit.is_some() {
            return;
        }
        *quit = Some(labels.clone());
    }
    for label in &labels {
        let _ = app.emit_to(label.as_str(), "nagori:quit-requested", ());
    }
}

// 保存を済ませたウィンドウを待ちの一覧から外す。全部済んだら終了する
pub(crate) fn quit_ready(app: &AppHandle, label: &str) {
    settle(app, label);
}

pub(crate) fn quit_cancel(app: &AppHandle) {
    *locked(&app.state::<Backend>().quit) = None;
}

fn settle(app: &AppHandle, label: &str) {
    let backend = app.state::<Backend>();
    let finished = {
        let mut quit = locked(&backend.quit);
        let Some(pending) = quit.as_mut() else {
            return;
        };
        pending.remove(label);
        if pending.is_empty() {
            *quit = None;
            true
        } else {
            false
        }
    };
    if finished {
        finish_quit(app, open_records(app));
    }
}

// 終了する時点のウィンドウを開き直し用に記録してから終える
fn finish_quit(app: &AppHandle, records: Vec<OpenWindow>) {
    let backend = app.state::<Backend>();
    backend.allow_exit.store(true, Ordering::SeqCst);
    let mut patch = serde_json::Map::new();
    if let Ok(value) = serde_json::to_value(records) {
        patch.insert("openWindows".to_owned(), value);
    }
    let _ = settings::update(app, patch);
    app.exit(0);
}

// 開いているウィンドウのフォルダとファイル。フォルダのないウィンドウは記録しない
fn open_records(app: &AppHandle) -> Vec<OpenWindow> {
    let backend = app.state::<Backend>();
    let labels: Vec<String> = app.webview_windows().into_keys().collect();
    let projects = locked(&backend.projects);
    window_records(&projects, &labels)
}

// 1つの窓のフォルダとファイル。窓の一覧に残っているかは見ない。フォルダのない窓はNone
fn window_record(projects: &HashMap<String, Project>, label: &str) -> Option<OpenWindow> {
    projects.get(label).map(|project| OpenWindow {
        project: project.root.clone(),
        file: project.file.clone(),
    })
}

// 指定した窓の記録を、labelの順に並べる。フォルダのない窓は記録しない
fn window_records(projects: &HashMap<String, Project>, labels: &[String]) -> Vec<OpenWindow> {
    let mut labels = labels.to_vec();
    labels.sort();
    labels
        .iter()
        .filter_map(|label| window_record(projects, label))
        .collect()
}

// ウィンドウが閉じた時に、その窓の状態を捨てる。最後の1枚なら、その窓の記録を残して終了する
pub(crate) fn forget(app: &AppHandle, label: &str) {
    let backend = app.state::<Backend>();
    let last = !app.webview_windows().keys().any(|other| other != label);
    // 最後の1枚の記録は、状態を捨てる前に作る。Destroyedの時点で窓が一覧に残っているかは当てにしない
    let closing = if last {
        window_record(&locked(&backend.projects), label)
            .into_iter()
            .collect()
    } else {
        Vec::new()
    };
    backend.remove_workspace(label);
    locked(&backend.projects).remove(label);
    locked(&backend.open_requests).remove(label);
    {
        let mut focused = locked(&backend.focused);
        if focused.as_deref() == Some(label) {
            *focused = None;
        }
    }
    release_fresh(app, label);
    if backend.allow_exit.load(Ordering::SeqCst) {
        return;
    }
    if last {
        finish_quit(app, closing);
    } else {
        settle(app, label);
    }
}

#[cfg(test)]
mod tests;
