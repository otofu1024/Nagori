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
        fs::read_dir(directory(base.path(), root.path()).unwrap())
            .unwrap()
            .count(),
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
