use super::*;
#[test]
fn entries_report_modified_time_for_files_only() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::create_dir(root.join("folder")).unwrap();
    fs::write(root.join("note.md"), "x").unwrap();
    let file = entry(root, &root.join("note.md")).unwrap();
    let modified = file.modified.expect("ファイルには更新日時を入れる");
    let now = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    assert!(modified <= now && now - modified < 60_000);
    assert!(entry(root, &root.join("folder"))
        .unwrap()
        .modified
        .is_none());
    let json = serde_json::to_value(&file).unwrap();
    assert!(json["modified"].is_u64());
    let folder = serde_json::to_value(entry(root, &root.join("folder")).unwrap()).unwrap();
    assert!(folder.get("modified").is_none());
}

#[test]
fn filesystem_safety_and_formats() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let original = b"\xef\xbb\xbf# title\r\n\r\ntext  \r\n";
    fs::write(root.join("a.md"), original).unwrap();
    let opened = open(root, "a.md").unwrap();
    assert_eq!(opened.text, "# title\n\ntext  \n");
    save(root, "a.md", &opened.text, &opened.baseline).unwrap();
    assert_eq!(fs::read(root.join("a.md")).unwrap(), original);
    let saved = save(root, "a.md", "日本語\n", &opened.baseline).unwrap();
    assert_eq!(
        fs::read(root.join("a.md")).unwrap(),
        "\u{feff}日本語\r\n".as_bytes()
    );
    fs::write(root.join("a.md"), "external").unwrap();
    assert_eq!(
        save(root, "a.md", "overwrite", &saved.baseline)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "external");
    assert_eq!(create(root, "a.md", "markdown").unwrap_err().code, "EXISTS");
    assert_eq!(
        save_as(root, "a.md", "a.md", "overwrite").unwrap_err().code,
        "EXISTS"
    );
    create(root, "b.md", "markdown").unwrap();
    assert_eq!(rename(root, "a.md", "b.md").unwrap_err().code, "EXISTS");
    assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "external");
    fs::remove_file(root.join("a.md")).unwrap();
    assert_eq!(
        save(root, "a.md", "overwrite", &saved.baseline)
            .unwrap_err()
            .code,
        "MISSING"
    );
    assert!(!root.join("a.md").exists());
    save_as(root, "a.md", "rescued.md", "recovered\n").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("rescued.md")).unwrap(),
        "recovered\n"
    );
    save_as(
        root,
        "vanished/folder/article.md",
        "parent-rescued.md",
        "parent recovered",
    )
    .unwrap();
    fs::write(root.join("invalid.md"), [255]).unwrap();
    save_as(
        root,
        "invalid.md",
        "invalid-rescued.md",
        "valid editing text",
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("invalid-rescued.md")).unwrap(),
        "valid editing text"
    );
    let markdown_root = root.join("project.md");
    fs::create_dir(&markdown_root).unwrap();
    fs::create_dir(markdown_root.join("nested")).unwrap();
    for target in ["", ".", "nested/.."] {
        assert_eq!(
            save_as(&markdown_root, "missing.md", target, "rescue text")
                .unwrap_err()
                .code,
            "INVALID"
        );
    }
    assert_eq!(fs::read_dir(&markdown_root).unwrap().count(), 1);
    assert!(resolve(root, "../outside", true).is_err());
    assert!(resolve(root, "/etc/passwd", false).is_err());
    assert!(resolve(root, ".git", true).is_err());
    assert!(decode(b"a\r\nb\n").is_err());
    assert!(decode(&[255]).is_err());
    fs::write(root.join("large.md"), vec![b'a'; DOCUMENT_LIMIT + 1]).unwrap();
    assert_eq!(open(root, "large.md").unwrap_err().code, "LIMIT");
    #[cfg(unix)]
    {
        use std::os::unix::fs::{symlink, PermissionsExt};
        symlink(root.join("rescued.md"), root.join("link.md")).unwrap();
        symlink(root, root.join("alias")).unwrap();
        assert_eq!(open(root, "link.md").unwrap_err().code, "SYMLINK");
        assert_eq!(
            resolve(root, "alias/../b.md", true).unwrap_err().code,
            "SYMLINK"
        );
        assert_eq!(
            create(root, "alias/new.md", "markdown").unwrap_err().code,
            "SYMLINK"
        );
        fs::set_permissions(root.join("rescued.md"), fs::Permissions::from_mode(0o444)).unwrap();
        let readonly = open(root, "rescued.md").unwrap();
        assert!(readonly.readonly);
        assert_eq!(
            save(root, "rescued.md", "oops", &readonly.baseline)
                .unwrap_err()
                .code,
            "PERMISSION"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued.md")).unwrap(),
            "recovered\n"
        );
        fs::set_permissions(root.join("rescued.md"), fs::Permissions::from_mode(0o644)).unwrap();
    }
    #[cfg(target_os = "macos")]
    {
        rename(root, "b.md", "B.md").unwrap();
        assert!(fs::read_dir(root)
            .unwrap()
            .any(|e| e.unwrap().file_name() == "B.md"));
    }
}
#[cfg(target_os = "macos")]
#[test]
fn renamed_parent_and_case_only_paths_keep_saving_without_clobber() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    create(root, "Posts", "directory").unwrap();
    let original = b"\xef\xbb\xbf# original\r\n";
    fs::write(root.join("Posts/Note.md"), original).unwrap();
    fs::set_permissions(
        root.join("Posts/Note.md"),
        fs::Permissions::from_mode(0o640),
    )
    .unwrap();
    let opened = open(root, "Posts/Note.md").unwrap();
    let renamed = rename(root, "Posts", "Archive").unwrap();
    assert_eq!(renamed.path, "Archive");
    assert_eq!(renamed.kind, "directory");
    assert_eq!(
        save(root, "Posts/Note.md", "edit\n", &opened.baseline)
            .unwrap_err()
            .code,
        "MISSING"
    );
    assert!(!root.join("Posts").exists());
    let saved = save(root, "Archive/Note.md", "edit\n", &opened.baseline).unwrap();
    assert_eq!(
        fs::read(root.join("Archive/Note.md")).unwrap(),
        b"\xef\xbb\xbfedit\r\n"
    );
    assert_eq!(
        fs::metadata(root.join("Archive/Note.md"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o640
    );

    rename(root, "Archive", "archive").unwrap();
    rename(root, "archive/Note.md", "note.md").unwrap();
    assert!(fs::read_dir(root)
        .unwrap()
        .any(|e| e.unwrap().file_name() == "archive"));
    assert!(fs::read_dir(root.join("archive"))
        .unwrap()
        .any(|e| e.unwrap().file_name() == "note.md"));
    save(
        root,
        "archive/note.md",
        "after case rename\n",
        &saved.baseline,
    )
    .unwrap();
    let edited = fs::read(root.join("archive/note.md")).unwrap();
    fs::write(root.join("archive/existing.md"), b"do not replace").unwrap();
    assert_eq!(
        rename(root, "archive/note.md", "existing.md")
            .unwrap_err()
            .code,
        "EXISTS"
    );
    assert_eq!(fs::read(root.join("archive/note.md")).unwrap(), edited);
    assert_eq!(
        fs::read(root.join("archive/existing.md")).unwrap(),
        b"do not replace"
    );
    create(root, "Occupied", "directory").unwrap();
    fs::write(root.join("Occupied/keep.md"), b"keep folder").unwrap();
    assert_eq!(
        rename(root, "archive", "Occupied").unwrap_err().code,
        "EXISTS"
    );
    assert_eq!(
        fs::read(root.join("Occupied/keep.md")).unwrap(),
        b"keep folder"
    );
    assert_eq!(fs::read(root.join("archive/note.md")).unwrap(), edited);
    assert!(fs::read_dir(root).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".nagori-save-")));
}

#[test]
fn vanished_workspace_does_not_recreate_and_recovers_with_baseline_checks() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("workspace");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("note.md"), b"original\n").unwrap();
    let opened = open(&root, "note.md").unwrap();
    let detached = directory.path().join("detached");
    fs::rename(&root, &detached).unwrap();
    assert_eq!(list(&root, "").unwrap_err().code, "MISSING");
    assert_eq!(index(&root).unwrap_err().code, "MISSING");
    assert_eq!(
        save(&root, "note.md", "pending\n", &opened.baseline)
            .unwrap_err()
            .code,
        "MISSING"
    );
    assert_eq!(
        create(&root, "new.md", "markdown").unwrap_err().code,
        "MISSING"
    );
    assert!(!root.exists());
    assert_eq!(fs::read(detached.join("note.md")).unwrap(), b"original\n");
    fs::write(detached.join("note.md"), b"external while absent\n").unwrap();
    fs::rename(&detached, &root).unwrap();
    assert_eq!(index(&root).unwrap().len(), 1);
    assert_eq!(
        save(&root, "note.md", "pending\n", &opened.baseline)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    let fresh = open(&root, "note.md").unwrap();
    assert_eq!(fresh.text, "external while absent\n");
    save_as(&root, "note.md", "rescued.md", "pending\n").unwrap();
    assert_eq!(
        fs::read(root.join("note.md")).unwrap(),
        b"external while absent\n"
    );
    let saved = save(
        &root,
        "note.md",
        "accepted fresh baseline\n",
        &fresh.baseline,
    )
    .unwrap();
    assert_eq!(open(&root, "note.md").unwrap().baseline, saved.baseline);
    assert_eq!(fs::read(root.join("rescued.md")).unwrap(), b"pending\n");
}

#[test]
fn staged_save_failure_keeps_disk_contents() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("a.md"), "original").unwrap();
    let expected = open(root, "a.md").unwrap().baseline;
    let stage = || {
        let mut file = tempfile::Builder::new()
            .prefix(".nagori-save-")
            .tempfile_in(root)
            .unwrap();
        file.write_all(b"pending editor content").unwrap();
        file.flush().unwrap();
        file
    };
    let temporary = stage();
    let temporary_path = temporary.path().to_owned();
    fs::write(root.join("a.md"), "external edit during staging").unwrap();
    assert_eq!(
        commit(root, "a.md", &expected, temporary).unwrap_err().code,
        "CONFLICT"
    );
    assert_eq!(
        fs::read_to_string(root.join("a.md")).unwrap(),
        "external edit during staging"
    );
    assert!(!temporary_path.exists());
    let temporary = stage();
    fs::remove_file(root.join("a.md")).unwrap();
    assert_eq!(
        commit(root, "a.md", &expected, temporary).unwrap_err().code,
        "MISSING"
    );
    assert!(!root.join("a.md").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(root.join("a.md"), "original").unwrap();
        let temporary = stage();
        fs::set_permissions(root.join("a.md"), fs::Permissions::from_mode(0o444)).unwrap();
        let error = commit(root, "a.md", &expected, temporary).unwrap_err();
        assert_eq!(error.code, "PERMISSION");
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "original");
        fs::set_permissions(root.join("a.md"), fs::Permissions::from_mode(0o644)).unwrap();
    }
}
#[test]
fn text_files_open_and_save_like_markdown() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("config.json"), b"{\r\n  \"a\": 1\r\n}\r\n").unwrap();
    let opened = open(root, "config.json").unwrap();
    assert_eq!(opened.text, "{\n  \"a\": 1\n}\n");
    save(root, "config.json", "{\n  \"a\": 2\n}\n", &opened.baseline).unwrap();
    // 既存のCRLFを保ったまま保存する
    assert_eq!(
        fs::read(root.join("config.json")).unwrap(),
        b"{\r\n  \"a\": 2\r\n}\r\n"
    );
    fs::write(root.join("Makefile"), "all:\n\techo ok\n").unwrap();
    assert_eq!(open(root, "Makefile").unwrap().text, "all:\n\techo ok\n");
    let code = |result: Result<OpenedDocument>| result.err().map(|e| e.code);
    fs::write(root.join("data.bin"), b"abc\0def").unwrap();
    assert_eq!(code(open(root, "data.bin")), Some("BINARY"));
    fs::write(root.join("latin1.txt"), b"caf\xe9").unwrap();
    assert_eq!(code(open(root, "latin1.txt")), Some("ENCODING"));
    image::RgbaImage::new(1, 1)
        .save(root.join("photo.png"))
        .unwrap();
    assert_eq!(code(open(root, "photo.png")), Some("UNSUPPORTED"));
    // テキストファイルの別名保存は画像以外の名前に限り、Markdownの別名保存はMarkdownに限る
    let copied = save_as(root, "config.json", "config-copy.json", "{}\n").unwrap();
    assert_eq!(copied.path, "config-copy.json");
    assert_eq!(fs::read(root.join("config-copy.json")).unwrap(), b"{}\r\n");
    assert_eq!(
        code(save_as(root, "config.json", "copy.png", "{}\n")),
        Some("UNSUPPORTED")
    );
    create(root, "note.md", "markdown").unwrap();
    assert_eq!(
        code(save_as(root, "note.md", "note.txt", "text\n")),
        Some("UNSUPPORTED")
    );
    let names: Vec<_> = index(root).unwrap().into_iter().map(|e| e.path).collect();
    assert!(names.contains(&"config.json".to_string()) && names.contains(&"Makefile".to_string()));
}
fn no_staging_files(root: &Path) -> bool {
    fs::read_dir(root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".nagori-save-")
    })
}

#[test]
fn save_failures_keep_disk_contents_and_leave_no_staging_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("a.md"), "original\n").unwrap();
    let opened = open(root, "a.md").unwrap();
    // 改行が混ざった本文は符号化で失敗し、ディスクは変わらない
    assert_eq!(
        save(root, "a.md", "bad\r\n", &opened.baseline)
            .unwrap_err()
            .code,
        "NEWLINES"
    );
    // 上限超過の本文も保存を拒否する
    let huge = "a".repeat(DOCUMENT_LIMIT + 1);
    assert_eq!(
        save(root, "a.md", &huge, &opened.baseline)
            .unwrap_err()
            .code,
        "LIMIT"
    );
    assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "original\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.join("a.md"), fs::Permissions::from_mode(0o444)).unwrap();
        assert!(open(root, "a.md").unwrap().readonly);
        assert_eq!(
            save(root, "a.md", "edited\n", &opened.baseline)
                .unwrap_err()
                .code,
            "PERMISSION"
        );
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "original\n");
        // 読み取り専用で失敗した本文は別名保存で救済でき、元ファイルは変わらない
        let rescued = save_as(root, "a.md", "rescued.md", "edited\n").unwrap();
        assert_eq!(rescued.text, "edited\n");
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "original\n");
        fs::set_permissions(root.join("a.md"), fs::Permissions::from_mode(0o644)).unwrap();
    }
    assert!(no_staging_files(root));
}

#[test]
fn external_update_is_a_conflict_but_own_save_and_same_bytes_are_not() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("a.md"), b"\xef\xbb\xbfone\r\n").unwrap();
    let opened = open(root, "a.md").unwrap();
    // 自分の保存後の基準は、ディスクを読み直した基準と一致する(自分の保存通知は外部変更にならない)
    let saved = save(root, "a.md", "two\n", &opened.baseline).unwrap();
    let reread = open(root, "a.md").unwrap();
    assert_eq!(saved.baseline, reread.baseline);
    assert_eq!(fs::read(root.join("a.md")).unwrap(), b"\xef\xbb\xbftwo\r\n");
    // 外部アプリが別内容を書くと、古い基準での保存は競合になり本文は上書きされない
    fs::write(root.join("a.md"), "external\n").unwrap();
    assert_eq!(
        save(root, "a.md", "three\n", &saved.baseline)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "external\n");
    // 同じバイト列を書き戻しただけなら基準は変わらず、競合にならない
    let before = open(root, "a.md").unwrap();
    fs::write(root.join("a.md"), "external\n").unwrap();
    assert_eq!(open(root, "a.md").unwrap().baseline, before.baseline);
    save(root, "a.md", "four\n", &before.baseline).unwrap();
    assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "four\n");
    assert!(no_staging_files(root));
}

#[test]
fn unreadable_external_updates_fail_to_open_without_touching_the_file() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("a.md"), "original\n").unwrap();
    let opened = open(root, "a.md").unwrap();
    // 保存側のコード: 基準比較で読める内容は CONFLICT、上限超過は読み取り段階の LIMIT で止まる
    for (bytes, code, save_code) in [
        (b"\xff\xfe broken".to_vec(), "ENCODING", "CONFLICT"),
        (b"a\r\nb\n".to_vec(), "NEWLINES", "CONFLICT"),
        (vec![b'x'; DOCUMENT_LIMIT + 1], "LIMIT", "LIMIT"),
    ] {
        fs::write(root.join("a.md"), &bytes).unwrap();
        // 再読み込みは失敗し、画面側は現在の本文を保持して理由を表示する
        assert_eq!(open(root, "a.md").unwrap_err().code, code);
        // 保存も止まり、外部内容を上書きしない
        assert_eq!(
            save(root, "a.md", "mine\n", &opened.baseline)
                .unwrap_err()
                .code,
            save_code
        );
        assert_eq!(fs::read(root.join("a.md")).unwrap(), bytes);
    }
}

#[test]
fn deleted_file_is_never_recreated_and_recreation_is_compared_again() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("a.md"), "original\n").unwrap();
    let opened = open(root, "a.md").unwrap();
    fs::remove_file(root.join("a.md")).unwrap();
    // 削除後の保存と再読み込みは MISSING で、元のパスを作り直さない
    assert_eq!(
        save(root, "a.md", "mine\n", &opened.baseline)
            .unwrap_err()
            .code,
        "MISSING"
    );
    assert_eq!(open(root, "a.md").unwrap_err().code, "MISSING");
    assert!(!root.join("a.md").exists());
    // 別名保存は削除後でも救済でき、既存ファイルは上書きしない
    fs::write(root.join("taken.md"), "keep\n").unwrap();
    assert_eq!(
        save_as(root, "a.md", "taken.md", "mine\n")
            .unwrap_err()
            .code,
        "EXISTS"
    );
    assert_eq!(fs::read_to_string(root.join("taken.md")).unwrap(), "keep\n");
    save_as(root, "a.md", "rescued.md", "mine\n").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("rescued.md")).unwrap(),
        "mine\n"
    );
    assert!(!root.join("a.md").exists());
    // 外部アプリが別内容で作り直した場合は、古い基準での保存が競合になる
    fs::write(root.join("a.md"), "recreated elsewhere\n").unwrap();
    assert_eq!(
        save(root, "a.md", "mine\n", &opened.baseline)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(
        fs::read_to_string(root.join("a.md")).unwrap(),
        "recreated elsewhere\n"
    );
    // 通常ファイルでない物に置き換わった場合も、書き込まず失敗する
    fs::remove_file(root.join("a.md")).unwrap();
    fs::create_dir(root.join("a.md")).unwrap();
    assert!(save(root, "a.md", "mine\n", &opened.baseline).is_err());
    assert!(root.join("a.md").is_dir());
    assert!(no_staging_files(root));
}

#[test]
fn save_as_rescue_stays_inside_the_workspace_and_keeps_the_source_format() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("a.md"), b"\xef\xbb\xbfone\r\n").unwrap();
    let rescued = save_as(root, "a.md", "copy.md", "edited\n").unwrap();
    assert_eq!(rescued.path, "copy.md");
    assert_eq!(
        fs::read(root.join("copy.md")).unwrap(),
        b"\xef\xbb\xbfedited\r\n"
    );
    for target in [
        "../outside.md",
        "/tmp/outside.md",
        "sub/../../outside.md",
        "x.txt",
    ] {
        assert!(
            save_as(root, "a.md", target, "edited\n").is_err(),
            "{target}"
        );
    }
    assert!(!directory
        .path()
        .parent()
        .unwrap()
        .join("outside.md")
        .exists());
    assert_eq!(
        save_as(root, "a.md", "bad.md", "x\r\n").unwrap_err().code,
        "NEWLINES"
    );
    assert!(!root.join("bad.md").exists());
    assert!(no_staging_files(root));
}

#[test]
fn move_entry_moves_files_and_folders_without_overwriting() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    create(root, "Posts", "directory").unwrap();
    create(root, "Posts/Sub", "directory").unwrap();
    create(root, "Archive", "directory").unwrap();
    fs::write(root.join("a.md"), b"# a\n").unwrap();
    fs::write(root.join("Posts/b.md"), b"# b\n").unwrap();
    fs::write(root.join("Posts/Sub/c.md"), b"# c\n").unwrap();

    // ファイルをフォルダへ移す。移した後のパスを返す
    let moved = move_entry(root, "a.md", "Archive").unwrap();
    assert_eq!(moved.path, "Archive/a.md");
    assert_eq!(moved.kind, "markdown");
    assert!(!root.join("a.md").exists());
    assert_eq!(fs::read(root.join("Archive/a.md")).unwrap(), b"# a\n");

    // フォルダを一番上へ移すと、配下ごと移る
    let moved = move_entry(root, "Posts/Sub", "").unwrap();
    assert_eq!(moved.path, "Sub");
    assert_eq!(moved.kind, "directory");
    assert!(root.join("Sub/c.md").exists());
    assert!(!root.join("Posts/Sub").exists());

    // フォルダへ移したファイルは、そのフォルダの中へ入る
    let moved = move_entry(root, "Posts/b.md", "Sub").unwrap();
    assert_eq!(moved.path, "Sub/b.md");
    assert!(root.join("Sub/b.md").exists());
    assert!(!root.join("Posts/b.md").exists());
}

#[test]
fn move_entry_rejects_same_place_self_descendant_and_existing_names() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    create(root, "Posts", "directory").unwrap();
    create(root, "Posts/Sub", "directory").unwrap();
    create(root, "Other", "directory").unwrap();
    fs::write(root.join("a.md"), b"root\n").unwrap();
    fs::write(root.join("Posts/a.md"), b"posts\n").unwrap();

    // 同じ場所へは移さない（一番上の項目を一番上へ移す場合も含む）
    assert_eq!(move_entry(root, "Posts", "").unwrap_err().code, "INVALID");
    assert_eq!(
        move_entry(root, "Posts/a.md", "Posts").unwrap_err().code,
        "INVALID"
    );
    // 自分自身と、その下のフォルダへは移さない
    assert_eq!(
        move_entry(root, "Posts", "Posts").unwrap_err().code,
        "INVALID"
    );
    assert_eq!(
        move_entry(root, "Posts", "Posts/Sub").unwrap_err().code,
        "INVALID"
    );
    // 移動先に同じ名前があれば上書きせず、両方とも残す
    assert_eq!(
        move_entry(root, "a.md", "Posts").unwrap_err().code,
        "EXISTS"
    );
    assert_eq!(fs::read(root.join("a.md")).unwrap(), b"root\n");
    assert_eq!(fs::read(root.join("Posts/a.md")).unwrap(), b"posts\n");
    // 移動先がフォルダでなければ拒む
    assert_eq!(
        move_entry(root, "Other", "a.md").unwrap_err().code,
        "INVALID"
    );
    // ルートは移さない
    assert_eq!(move_entry(root, "", "Other").unwrap_err().code, "INVALID");
    assert!(root.join("Posts/Sub").exists());
    assert!(root.join("Other").exists());
}

#[test]
fn move_entry_stays_inside_the_workspace() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("project");
    fs::create_dir(&root).unwrap();
    create(&root, "Posts", "directory").unwrap();
    fs::write(root.join("a.md"), b"# a\n").unwrap();
    fs::write(directory.path().join("outside.md"), b"# outside\n").unwrap();
    fs::create_dir(directory.path().join("outside-dir")).unwrap();

    // プロジェクトの外へ出るパスは、移動元・移動先のどちらでも拒む
    for (from, to) in [
        ("../outside.md", "Posts"),
        ("a.md", "../outside-dir"),
        ("a.md", "../"),
        ("/tmp/outside.md", "Posts"),
        ("a.md", "/tmp"),
    ] {
        assert!(move_entry(&root, from, to).is_err(), "{from} -> {to}");
    }
    assert!(root.join("a.md").exists());
    assert!(directory.path().join("outside.md").exists());
    assert!(!directory.path().join("outside-dir/a.md").exists());
    assert!(!directory.path().join("a.md").exists());

    // シンボリックリンクは辿らず、リンク自体も移さない
    std::os::unix::fs::symlink(directory.path().join("outside-dir"), root.join("link")).unwrap();
    assert_eq!(
        move_entry(&root, "a.md", "link").unwrap_err().code,
        "SYMLINK"
    );
    assert_eq!(
        move_entry(&root, "link", "Posts").unwrap_err().code,
        "SYMLINK"
    );
    assert!(root.join("a.md").exists());
    assert!(directory.path().join("outside-dir").is_dir());
    assert!(no_staging_files(&root));
}

#[test]
fn blog_detection_requires_the_template_and_rejects_symlinks() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    assert!(validate_blog(root).is_err());
    fs::create_dir_all(root.join(BLOG_DIRECTORY)).unwrap();
    fs::create_dir_all(root.join("src/theme")).unwrap();
    fs::write(root.join("src/theme/theme.css"), "").unwrap();
    assert!(validate_blog(root).is_err());
    fs::write(root.join("src/config.ts"), "").unwrap();
    assert!(validate_blog(root).is_ok());
    assert!(blog_mode(root, true));
    assert!(!blog_mode(root, false));
    #[cfg(unix)]
    {
        fs::remove_file(root.join("src/config.ts")).unwrap();
        fs::write(root.join("config.ts"), "").unwrap();
        std::os::unix::fs::symlink(root.join("config.ts"), root.join("src/config.ts")).unwrap();
        assert!(validate_blog(root).is_err());
    }
}

#[test]
fn blog_config_reads_utf8_and_rejects_missing_oversized_and_symlink_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    fs::create_dir(root.join("src")).unwrap();
    assert!(read_blog_config(&root).is_none());
    let config = root.join("src/config.ts");
    fs::write(&config, "export const CATEGORIES = {tech: {label: '技術'}}").unwrap();
    assert!(read_blog_config(&root).unwrap().contains("技術"));
    fs::write(&config, [0xff]).unwrap();
    assert!(read_blog_config(&root).is_none());
    fs::write(&config, vec![b'a'; 1024 * 1024 + 1]).unwrap();
    assert!(read_blog_config(&root).is_none());
    #[cfg(unix)]
    {
        fs::remove_file(&config).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), &config).unwrap();
        assert!(read_blog_config(&root).is_none());
    }
}
