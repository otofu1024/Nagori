use super::*;
use std::fs;

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
