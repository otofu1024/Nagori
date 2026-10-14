use super::*;
fn fixture() -> (tempfile::TempDir, tempfile::TempDir) {
    let root = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("src/content/blog")).unwrap();
    fs::create_dir_all(root.path().join("src/theme")).unwrap();
    fs::write(
        root.path().join("src/config.ts"),
        "export const CHARACTERS = {};",
    )
    .unwrap();
    fs::write(root.path().join(THEME_PATH), PRESETS[0].1).unwrap();
    (root, base)
}
fn bytes(root: &Path) -> Vec<u8> {
    fs::read(root.join(THEME_PATH)).unwrap()
}
#[test]
fn apply_and_restore_keep_the_previous_bytes_outside_the_blog() {
    let (root, base) = fixture();
    let custom = b"\xef\xbb\xbf:root {\n --color-bg: #fff; }\r\n";
    fs::write(root.path().join(THEME_PATH), custom).unwrap();
    let opened = read(root.path(), base.path()).unwrap();
    assert_eq!(opened.preset, None);
    let saved = apply(root.path(), base.path(), "dusk", &opened.baseline).unwrap();
    assert_eq!(bytes(root.path()), PRESETS[3].1.as_bytes());
    let opened = read(root.path(), base.path()).unwrap();
    assert_eq!(opened.preset, Some("dusk"));
    assert_eq!(opened.baseline, saved.baseline);
    assert_eq!(opened.history.len(), 1);
    assert!(opened.history[0].saved_at > 0);
    let id = &opened.history[0].id;
    assert_eq!(
        fs::read(
            directory(base.path(), root.path())
                .unwrap()
                .join(format!("{id}.css"))
        )
        .unwrap(),
        custom
    );
    restore(root.path(), base.path(), id, &opened.baseline).unwrap();
    assert_eq!(bytes(root.path()), custom);
    let opened = read(root.path(), base.path()).unwrap();
    assert_eq!(opened.history.len(), 2);
    assert_eq!(opened.history[0].preset, Some("dusk"));
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}
#[test]
fn oldest_history_is_removed_and_blogs_are_separate() {
    let (root, base) = fixture();
    let (other, _) = fixture();
    let mut first = String::new();
    for i in 0..35 {
        let state = read(root.path(), base.path()).unwrap();
        replace(
            root.path(),
            base.path(),
            format!(":root {{ --color-text: #111; }} /* {i} */\n").as_bytes(),
            &state.baseline,
        )
        .unwrap();
        if i == 0 {
            first = read(root.path(), base.path()).unwrap().history[0]
                .id
                .clone();
        }
    }
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.history.len(), HISTORY_LIMIT);
    assert!(!state.history.iter().any(|entry| entry.id == first));
    assert_eq!(
        history(&directory(base.path(), root.path()).unwrap(), &[])
            .unwrap()
            .len(),
        HISTORY_LIMIT
    );
    assert!(read(other.path(), base.path()).unwrap().history.is_empty());
    assert_eq!(
        restore(
            other.path(),
            base.path(),
            &state.history[0].id,
            &read(other.path(), base.path()).unwrap().baseline
        )
        .unwrap_err()
        .code,
        "MISSING"
    );
    restore(
        root.path(),
        base.path(),
        &state.history[10].id,
        &state.baseline,
    )
    .unwrap();
    assert_eq!(
        read(root.path(), base.path()).unwrap().history.len(),
        HISTORY_LIMIT
    );
}
#[test]
fn conflicts_before_and_during_staging_preserve_disk_and_history() {
    let (root, base) = fixture();
    let state = read(root.path(), base.path()).unwrap();
    fs::write(root.path().join(THEME_PATH), "external").unwrap();
    assert_eq!(
        apply(root.path(), base.path(), "mono", &state.baseline)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    let state = read(root.path(), base.path()).unwrap();
    let result = replace_with(
        root.path(),
        base.path(),
        PRESETS[1].1.as_bytes(),
        &state.baseline,
        || {
            fs::write(root.path().join(THEME_PATH), "changed during staging").unwrap();
        },
    );
    assert_eq!(result.unwrap_err().code, "CONFLICT");
    assert_eq!(bytes(root.path()), b"changed during staging");
    assert!(read(root.path(), base.path()).unwrap().history.is_empty());
}
#[test]
fn failures_and_invalid_inputs_do_not_replace_the_theme() {
    let (root, base) = fixture();
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(
        apply(root.path(), base.path(), "missing", &state.baseline)
            .unwrap_err()
            .code,
        "INVALID"
    );
    assert_eq!(
        restore(root.path(), base.path(), "../file", &state.baseline)
            .unwrap_err()
            .code,
        "INVALID"
    );
    assert_eq!(
        replace(root.path(), base.path(), &[0xff], &state.baseline)
            .unwrap_err()
            .code,
        "ENCODING"
    );
    assert_eq!(
        replace(
            root.path(),
            base.path(),
            &vec![b'a'; files::DOCUMENT_LIMIT + 1],
            &state.baseline
        )
        .unwrap_err()
        .code,
        "LIMIT"
    );
    let inside = root.path().join("history");
    assert_eq!(
        apply(root.path(), &inside, "mono", &state.baseline)
            .unwrap_err()
            .code,
        "INVALID"
    );
    assert!(!inside.exists());
    let blocked = base.path().join("not-a-directory");
    fs::write(&blocked, "file").unwrap();
    assert!(apply(
        root.path(),
        &blocked.join("history"),
        "mono",
        &state.baseline
    )
    .is_err());
    assert_eq!(bytes(root.path()), PRESETS[0].1.as_bytes());
    assert!(read(root.path(), base.path()).unwrap().history.is_empty());
    apply(root.path(), base.path(), "standard", &state.baseline).unwrap();
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.history.len(), 1);
    restore(
        root.path(),
        base.path(),
        &state.history[0].id,
        &state.baseline,
    )
    .unwrap();
    assert_eq!(read(root.path(), base.path()).unwrap().history.len(), 2);
}
#[cfg(unix)]
#[test]
fn readonly_and_symlinks_are_rejected() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (root, base) = fixture();
    let state = read(root.path(), base.path()).unwrap();
    let path = root.path().join(THEME_PATH);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
    assert_eq!(
        apply(root.path(), base.path(), "mono", &state.baseline)
            .unwrap_err()
            .code,
        "PERMISSION"
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    fs::remove_file(&path).unwrap();
    symlink(base.path().join("outside.css"), &path).unwrap();
    assert!(apply(root.path(), base.path(), "mono", &state.baseline).is_err());
    fs::remove_file(&path).unwrap();
    fs::write(&path, PRESETS[0].1).unwrap();
    let directory = directory(base.path(), root.path()).unwrap();
    fs::remove_dir(&directory).unwrap();
    symlink(root.path().join("src/theme"), &directory).unwrap();
    assert_eq!(
        apply(root.path(), base.path(), "mono", &state.baseline)
            .unwrap_err()
            .code,
        "SYMLINK"
    );
    assert_eq!(bytes(root.path()), PRESETS[0].1.as_bytes());
}
#[test]
fn all_presets_are_complete_and_match_exactly() {
    let (root, base) = fixture();
    for (id, css) in PRESETS {
        let state = read(root.path(), base.path()).unwrap();
        apply(root.path(), base.path(), id, &state.baseline).unwrap();
        assert_eq!(bytes(root.path()), css.as_bytes());
        assert_eq!(read(root.path(), base.path()).unwrap().preset, Some(id));
        assert_eq!(identify(format!("{css}\n").as_bytes()), None);
    }
}

#[test]
fn opening_settings_saves_customs_once_and_uses_their_names() {
    let (root, base) = fixture();
    let standard = read(root.path(), base.path()).unwrap();
    assert_eq!(standard.current.as_deref(), Some("standard"));
    assert!(standard.customs.is_empty());
    let custom = b"\xef\xbb\xbf:root { --color-bg: #fff; }\r\n";
    fs::write(root.path().join(THEME_PATH), custom).unwrap();
    for _ in 0..3 {
        let state = read(root.path(), base.path()).unwrap();
        assert_eq!(state.current.as_deref(), Some("custom-1"));
        assert_eq!(state.customs.len(), 1);
        assert_eq!(state.customs[0].name, "カスタム1");
        assert!(state.history.is_empty());
    }
    fs::write(
        root.path().join(THEME_PATH),
        b":root { --color-bg: #fff; }\n",
    )
    .unwrap();
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.current.as_deref(), Some("custom-2"));
    assert_eq!(state.customs.len(), 2);
    assert_eq!(
        fs::read(
            directory(base.path(), root.path())
                .unwrap()
                .join("custom-1.css")
        )
        .unwrap(),
        custom
    );
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}
#[test]
fn switching_to_basic_custom_and_history_saves_the_current_custom() {
    let (root, base) = fixture();
    let path = root.path().join(THEME_PATH);
    let a = b":root { --color-bg: #123456; }\n";
    let b = b":root { --color-bg: #abcdef; }\n";
    let c = b":root { --color-bg: #654321; }\n";
    fs::write(&path, a).unwrap();
    apply(root.path(), base.path(), "mono", &files::baseline(a)).unwrap();
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.customs.len(), 1);
    assert_eq!(state.history[0].theme.as_deref(), Some("custom-1"));
    fs::write(&path, b).unwrap();
    apply(root.path(), base.path(), "custom-1", &files::baseline(b)).unwrap();
    assert_eq!(bytes(root.path()), a);
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.current.as_deref(), Some("custom-1"));
    assert_eq!(state.customs.len(), 2);
    fs::write(&path, c).unwrap();
    restore(
        root.path(),
        base.path(),
        &state.history[0].id,
        &files::baseline(c),
    )
    .unwrap();
    assert_eq!(bytes(root.path()), b);
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.current.as_deref(), Some("custom-2"));
    assert_eq!(state.customs.len(), 3);
    let (other, _) = fixture();
    assert!(read(other.path(), base.path()).unwrap().customs.is_empty());
    assert!(apply(
        other.path(),
        base.path(),
        "custom-1",
        &files::baseline(&bytes(other.path()))
    )
    .is_err());
}
#[test]
fn deletion_does_not_change_theme_and_numbers_are_not_reused() {
    let (root, base) = fixture();
    let path = root.path().join(THEME_PATH);
    fs::write(&path, "custom a").unwrap();
    read(root.path(), base.path()).unwrap();
    fs::write(&path, "custom b").unwrap();
    let state = read(root.path(), base.path()).unwrap();
    let state = delete_custom(root.path(), base.path(), &state.current.unwrap()).unwrap();
    assert_eq!(bytes(root.path()), b"custom b");
    assert_eq!(state.current, None);
    assert_eq!(state.customs.len(), 1);
    delete_custom(root.path(), base.path(), "custom-1").unwrap();
    let state = read(root.path(), base.path()).unwrap();
    assert_eq!(state.current.as_deref(), Some("custom-3"));
    assert_eq!(state.customs.len(), 1);
    fs::write(&path, PRESETS[0].1).unwrap();
    delete_custom(root.path(), base.path(), "custom-3").unwrap();
    fs::write(&path, "custom a").unwrap();
    assert_eq!(
        read(root.path(), base.path()).unwrap().current.as_deref(),
        Some("custom-4")
    );
    for id in ["standard", "../custom-4", "custom-04", "custom-0"] {
        assert_eq!(
            delete_custom(root.path(), base.path(), id)
                .unwrap_err()
                .code,
            "INVALID"
        );
    }
    assert_eq!(bytes(root.path()), b"custom a");
}
#[test]
fn custom_save_failure_prevents_replacement_and_skips_reserved_numbers() {
    let (root, base) = fixture();
    let path = root.path().join(THEME_PATH);
    fs::write(&path, "custom a").unwrap();
    let directory = directory(base.path(), root.path()).unwrap();
    fs::create_dir(directory.join("custom-1.css")).unwrap();
    // 番号を残した後にCSSの保存が失敗しても、元のテーマは置き換えない。
    assert!(save_custom(&directory, b"custom a", &mut vec![]).is_err());
    assert_eq!(bytes(root.path()), b"custom a");
    fs::remove_dir(directory.join("custom-1.css")).unwrap();
    assert_eq!(
        read(root.path(), base.path()).unwrap().current.as_deref(),
        Some("custom-2")
    );
    fs::remove_file(directory.join("custom-counter")).unwrap();
    fs::create_dir(directory.join("custom-counter")).unwrap();
    fs::write(&path, "custom b").unwrap();
    assert!(apply(
        root.path(),
        base.path(),
        "mono",
        &files::baseline(b"custom b")
    )
    .is_err());
    assert_eq!(bytes(root.path()), b"custom b");
}
