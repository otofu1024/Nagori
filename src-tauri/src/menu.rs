pub(crate) fn native_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
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
    let new_window = action("new-window", "新しいウィンドウ", Some("CmdOrCtrl+Shift+N"))?;
    let open = action("open-project", "プロジェクトを開く…", Some("CmdOrCtrl+O"))?;
    let new = action("new-markdown", "新しい記事", Some("CmdOrCtrl+N"))?;
    let folder = action("new-folder", "新しいフォルダ", None)?;
    let insert = action("image-insert", "画像を挿入…", None)?;
    let quick = action("quick-open", "Quick Open…", Some("CmdOrCtrl+P"))?;
    let save = action("save", "保存", Some("CmdOrCtrl+S"))?;
    let close = action("close-window", "ウィンドウを閉じる", Some("CmdOrCtrl+W"))?;
    let file = Submenu::with_items(
        app,
        "ファイル",
        true,
        &[
            &new_window,
            &open,
            &quick,
            &separator,
            &new,
            &folder,
            &insert,
            &separator,
            &save,
            &close,
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
