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
