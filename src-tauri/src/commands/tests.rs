use super::*;
use std::fs;
use std::path::PathBuf;

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
    backend.push_request(windows::MAIN, Ok(folder));
    backend.push_request(windows::MAIN, Err(Error::new("INVALID", "invalid")));
    backend.push_request(windows::MAIN, Ok(alone));
    assert!(backend
        .take_request(windows::MAIN)
        .unwrap()
        .unwrap()
        .path
        .is_none());
    assert!(backend.take_request(windows::MAIN).is_err());
    assert_eq!(
        backend
            .take_request(windows::MAIN)
            .unwrap()
            .unwrap()
            .path
            .as_deref(),
        Some("test file.md")
    );
    assert!(backend.take_request(windows::MAIN).unwrap().is_none());
    // 依頼はウィンドウごとに分かれ、ほかのウィンドウの依頼は受け取れない
    assert!(backend.take_request("window-000001").unwrap().is_none());
}

#[test]
fn each_window_keeps_its_own_workspace_and_project() {
    let backend = Backend::default();
    let first = backend.workspace("main").unwrap();
    let second = backend.workspace("window-000001").unwrap();
    assert!(!Arc::ptr_eq(&first, &second));
    assert!(Arc::ptr_eq(&first, &backend.workspace("main").unwrap()));
    first.lock().unwrap().root = Some(PathBuf::from("/fixture/first"));
    second.lock().unwrap().root = Some(PathBuf::from("/fixture/second"));
    assert_eq!(
        first.lock().unwrap().root().unwrap(),
        Path::new("/fixture/first")
    );
    assert_eq!(
        second.lock().unwrap().root().unwrap(),
        Path::new("/fixture/second")
    );
    // 同じフォルダを2つのウィンドウで開いてもよい。ワークスペースは別々に持つ
    second.lock().unwrap().root = Some(PathBuf::from("/fixture/first"));
    assert_eq!(
        first.lock().unwrap().root().unwrap(),
        second.lock().unwrap().root().unwrap()
    );
    backend.set_root("main", "/fixture/first".into());
    backend.set_file("main", Some("a.md".into()));
    assert_eq!(
        backend.project_root("main").as_deref(),
        Some("/fixture/first")
    );
    assert!(backend.project_root("window-000001").is_none());
    // 同じフォルダを開き直しても、開いていたファイルは残る。別のフォルダへ変えたら空になる
    backend.set_root("main", "/fixture/first".into());
    assert_eq!(
        backend.projects.lock().unwrap()["main"].file.as_deref(),
        Some("a.md")
    );
    backend.set_root("main", "/fixture/second".into());
    assert_eq!(backend.projects.lock().unwrap()["main"].file, None);
    // 閉じたウィンドウのワークスペースは捨てられ、同じ名前で作り直すと空になる
    backend.workspaces.lock().unwrap().remove("main");
    assert!(backend
        .workspace("main")
        .unwrap()
        .lock()
        .unwrap()
        .root()
        .is_err());
}

#[test]
fn blog_mode_scopes_the_tree_index_and_search_and_off_keeps_generic_behavior() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    fs::create_dir_all(root.join(files::BLOG_DIRECTORY).join("post")).unwrap();
    fs::create_dir_all(root.join("src/theme")).unwrap();
    fs::write(root.join("src/theme/theme.css"), "needle").unwrap();
    fs::write(root.join("src/config.ts"), "needle").unwrap();
    fs::write(root.join("README.md"), "needle").unwrap();
    let article = root.join(files::BLOG_DIRECTORY).join("post/index.md");
    fs::write(&article, "needle").unwrap();
    for enabled in [true, false] {
        let workspace = Workspace {
            root: Some(root.clone()),
            blog_mode: files::blog_mode(&root, enabled),
            watcher: None,
        };
        let entries = workspace.index().unwrap();
        assert_eq!(entries.len(), if enabled { 1 } else { 4 });
        assert_eq!(
            workspace.list("").unwrap()[0].name,
            if enabled { "post" } else { "src" }
        );
        assert_eq!(workspace.list("src/theme").is_err(), enabled);
        let found = search::run_from(&root, workspace.directory(), "needle", false, false).unwrap();
        assert_eq!(found.results.len(), if enabled { 1 } else { 4 });
        assert!(found
            .results
            .iter()
            .any(|entry| entry.path == "src/content/blog/post/index.md"));
        let request = blog_request(
            open_request(vec![url::Url::from_file_path(&article).unwrap()]).unwrap(),
            enabled,
        )
        .unwrap();
        assert_eq!(
            request.workspace,
            if enabled {
                root.to_str().unwrap()
            } else {
                article.parent().unwrap().to_str().unwrap()
            }
        );
        assert_eq!(
            request.path.as_deref(),
            Some(if enabled {
                "src/content/blog/post/index.md"
            } else {
                "index.md"
            })
        );
    }
    fs::remove_file(root.join("src/config.ts")).unwrap();
    assert!(files::validate_blog(&root).is_err());
    let request = blog_request(
        open_request(vec![url::Url::from_file_path(&article).unwrap()]).unwrap(),
        true,
    )
    .unwrap();
    assert_eq!(
        request.workspace,
        article.parent().unwrap().to_str().unwrap()
    );
}

#[test]
fn blog_theme_reads_only_in_blog_mode_and_missing_or_unsafe_files_are_ignored() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    fs::create_dir_all(root.join("src/styles")).unwrap();
    fs::create_dir_all(root.join("src/theme")).unwrap();
    fs::write(root.join("src/styles/template.css"), ".prose{}").unwrap();
    fs::write(root.join("src/theme/theme.css"), ":root{}").unwrap();
    let mut workspace = Workspace {
        root: Some(root.clone()),
        blog_mode: false,
        watcher: None,
    };
    assert!(workspace.blog_theme().is_none());
    workspace.blog_mode = true;
    let theme = workspace.blog_theme().unwrap();
    assert_eq!(theme.template, ".prose{}");
    assert_eq!(theme.theme, ":root{}");
    fs::write(root.join("src/theme/theme.css"), "changed").unwrap();
    assert_eq!(workspace.blog_theme().unwrap().theme, "changed");
    fs::remove_file(root.join("src/styles/template.css")).unwrap();
    assert!(workspace.blog_theme().is_none());
    fs::write(root.join("src/styles/template.css"), [0xff]).unwrap();
    assert!(workspace.blog_theme().is_none());
    #[cfg(unix)]
    {
        fs::remove_file(root.join("src/styles/template.css")).unwrap();
        std::os::unix::fs::symlink(
            root.join("src/theme/theme.css"),
            root.join("src/styles/template.css"),
        )
        .unwrap();
        assert!(workspace.blog_theme().is_none());
    }
}

#[test]
fn public_images_are_resolved_only_in_blog_mode() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    fs::create_dir_all(root.join("public/images")).unwrap();
    fs::create_dir_all(root.join("src/content/blog/post")).unwrap();
    fs::write(root.join("src/content/blog/post/index.md"), "").unwrap();
    fs::write(root.join("public/images/character.png"), "image").unwrap();
    let mut workspace = Workspace {
        root: Some(root.to_owned()),
        blog_mode: true,
        ..Default::default()
    };
    let path = blog_image_path(&workspace, "/images/character.png").unwrap();
    assert_eq!(
        image::image_path(root, &path, None).unwrap(),
        root.join("public/images/character.png")
    );
    assert!(blog_image_path(&workspace, "/../outside.png").is_err());
    assert!(image::image_path(
        root,
        &blog_image_path(&workspace, "//outside/image.png").unwrap(),
        None
    )
    .is_err());
    workspace.blog_mode = false;
    assert_eq!(
        blog_image_path(&workspace, "/images/character.png").unwrap(),
        "/images/character.png"
    );
    assert!(image::image_path(
        root,
        "/images/character.png",
        Some("src/content/blog/post/index.md")
    )
    .is_err());
}

#[test]
fn theme_requests_require_blog_mode_and_the_same_project() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    let project = root.to_str().unwrap();
    let mut workspace = Workspace {
        root: Some(root.clone()),
        blog_mode: false,
        watcher: None,
    };
    assert_eq!(theme_root(&workspace, project).unwrap_err().code, "BLOG");
    workspace.blog_mode = true;
    assert_eq!(theme_root(&workspace, project).unwrap(), root.as_path());
    assert_eq!(
        theme_root(&workspace, "/another/blog").unwrap_err().code,
        "WORKSPACE"
    );
}
