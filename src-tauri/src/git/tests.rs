use super::*;
use tempfile::{tempdir_in, TempDir};

fn git(root: &Path, args: &[&str]) -> String {
    text(checked(root, args).unwrap())
        .unwrap()
        .trim_end_matches('\n')
        .to_owned()
}

fn repo() -> TempDir {
    let dir = tempdir_in("/private/tmp").unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    configure(dir.path());
    dir
}

fn configure(root: &Path) {
    git(root, &["config", "user.name", "Nagori Test"]);
    git(root, &["config", "user.email", "nagori@example.invalid"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    git(root, &["config", "core.hooksPath", "/dev/null"]);
}

fn write(root: &Path, path: &str, content: &str) {
    fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
    fs::write(root.join(path), content).unwrap();
}

fn commit(root: &Path, message: &str) {
    let paths = status(root)
        .unwrap()
        .unwrap()
        .changes
        .into_iter()
        .map(|change| change.path)
        .collect();
    action(root, Action::Stage { paths }).unwrap();
    action(
        root,
        Action::Commit {
            message: message.to_owned(),
        },
    )
    .unwrap();
}

fn state(root: &Path) -> Status {
    status(root).unwrap().unwrap()
}

fn undo(root: &Path) -> Result<Status> {
    let last = state(root).last_commit.unwrap();
    action(
        root,
        Action::Undo {
            oid: last.oid,
            mode: last.undo.unwrap_or_default(),
        },
    )
}

fn remote(root: &Path) -> TempDir {
    let bare = tempdir_in("/private/tmp").unwrap();
    git(bare.path(), &["init", "--bare", "-b", "main"]);
    git(
        root,
        &["remote", "add", "origin", bare.path().to_str().unwrap()],
    );
    git(root, &["push", "-u", "origin", "main"]);
    bare
}

fn clone(bare: &Path) -> TempDir {
    let other = tempdir_in("/private/tmp").unwrap();
    git(other.path(), &["clone", bare.to_str().unwrap(), "."]);
    configure(other.path());
    other
}

#[test]
fn status_stage_unstage_commit_and_literal_names() {
    let dir = repo();
    let root = dir.path();
    for name in [
        "日本語 空白.md",
        "-option.md",
        ":(glob)*.md",
        "notes/改行\n名.md",
    ] {
        write(root, name, "# 初稿\n");
    }
    assert_eq!(state(root).changes.len(), 4);
    action(
        root,
        Action::Stage {
            paths: vec!["日本語 空白.md".into()],
        },
    )
    .unwrap();
    assert_eq!(
        state(root)
            .changes
            .iter()
            .filter(|c| c.index == 'A')
            .count(),
        1
    );
    write(root, "日本語 空白.md", "ステージ後の編集");
    action(
        root,
        Action::Unstage {
            paths: vec!["日本語 空白.md".into()],
        },
    )
    .unwrap();
    assert!(state(root).changes.iter().all(|c| c.worktree == '?'));
    commit(root, "最初");
    assert!(state(root).changes.is_empty());
    assert!(state(root).last_commit.unwrap().undo.is_none());
    assert!(undo(root).is_err());
    git(root, &["mv", "--", "日本語 空白.md", "名前を 変更.md"]);
    let changes = state(root).changes;
    assert_eq!(changes[0].original_path.as_deref(), Some("日本語 空白.md"));
    assert_eq!(changes[0].index, 'R');
    action(
        root,
        Action::Unstage {
            paths: vec!["名前を 変更.md".into()],
        },
    )
    .unwrap();
    commit(root, "名前の変更");
    write(root, "-option.md", "更新");
    action(
        root,
        Action::Stage {
            paths: vec!["-option.md".into()],
        },
    )
    .unwrap();
    action(
        root,
        Action::Unstage {
            paths: vec!["-option.md".into()],
        },
    )
    .unwrap();
    assert_eq!(state(root).changes[0].worktree, 'M');
    assert!(action(root, Action::Commit { message: "".into() }).is_err());
    assert!(action(
        root,
        Action::Commit {
            message: "未ステージ".into()
        }
    )
    .is_err());
}

#[test]
fn unpublished_undo_keeps_staged_changes_and_rechecks_confirmation() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初");
    commit(root, "最初");
    write(root, "note.md", "更新");
    commit(root, "更新");
    let old = state(root).last_commit.unwrap();
    assert_eq!(old.undo.as_deref(), Some("reset"));
    undo(root).unwrap();
    assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "更新");
    assert_eq!(state(root).changes[0].index, 'M');
    assert!(action(
        root,
        Action::Undo {
            oid: old.oid,
            mode: "reset".into()
        }
    )
    .is_err());
}

#[test]
fn published_undo_creates_revert_and_rejects_dirty_or_merge() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初");
    commit(root, "最初");
    write(root, "note.md", "更新");
    commit(root, "更新");
    let _bare = remote(root);
    assert_eq!(
        state(root).last_commit.unwrap().undo.as_deref(),
        Some("revert")
    );
    write(root, "untracked.md", "未保存");
    assert!(state(root).last_commit.unwrap().undo.is_none());
    assert!(undo(root).is_err());
    fs::remove_file(root.join("untracked.md")).unwrap();
    undo(root).unwrap();
    assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "最初");
    assert_eq!(state(root).ahead, 1);
    action(root, Action::Push).unwrap();
    assert_eq!(state(root).ahead, 0);
    git(root, &["checkout", "-b", "side"]);
    write(root, "side.md", "枝");
    commit(root, "枝");
    git(root, &["checkout", "main"]);
    git(root, &["merge", "--no-ff", "side", "-m", "マージ"]);
    assert!(state(root)
        .last_commit
        .unwrap()
        .reason
        .unwrap()
        .contains("マージ"));
    assert!(undo(root).is_err());
}

#[test]
fn push_rejection_pull_rebase_and_autostash_do_not_push() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初\n");
    commit(root, "最初");
    let bare = remote(root);
    let other = clone(bare.path());
    write(other.path(), "remote.md", "リモート");
    commit(other.path(), "リモート");
    action(other.path(), Action::Push).unwrap();
    let remote_head = git(bare.path(), &["rev-parse", "main"]);
    write(root, "local.md", "自分");
    commit(root, "自分");
    write(root, "note.md", "コミット前\n");
    assert_eq!(
        action(root, Action::Push).unwrap_err().code,
        "GIT_PULL_REQUIRED"
    );
    let after = action(root, Action::Pull).unwrap();
    assert_eq!(after.ahead, 1);
    assert_eq!(
        fs::read_to_string(root.join("note.md")).unwrap(),
        "コミット前\n"
    );
    assert!(root.join("remote.md").exists());
    assert_eq!(git(bare.path(), &["rev-parse", "main"]), remote_head);
    assert!(!in_progress(root).unwrap());
}

#[test]
fn conflicting_pull_aborts_and_restores_head_and_dirty_files() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初\n");
    write(root, "draft.md", "下書き\n");
    commit(root, "最初");
    let bare = remote(root);
    let other = clone(bare.path());
    write(other.path(), "note.md", "リモート\n");
    commit(other.path(), "リモート");
    action(other.path(), Action::Push).unwrap();
    write(root, "note.md", "自分\n");
    commit(root, "自分");
    write(root, "draft.md", "コミット前\n");
    action(
        root,
        Action::Stage {
            paths: vec!["draft.md".into()],
        },
    )
    .unwrap();
    write(root, "draft.md", "ステージ後の編集\n");
    let staged = git(root, &["write-tree"]);
    let head = git(root, &["rev-parse", "HEAD"]);
    assert_eq!(action(root, Action::Pull).unwrap_err().code, "GIT_CONFLICT");
    assert_eq!(git(root, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        fs::read_to_string(root.join("draft.md")).unwrap(),
        "ステージ後の編集\n"
    );
    assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "自分\n");
    assert!(!in_progress(root).unwrap());
    assert_eq!(git(root, &["write-tree"]), staged);
}

#[test]
fn autostash_conflict_restores_original_history_and_changes() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初\n");
    commit(root, "最初");
    let bare = remote(root);
    let other = clone(bare.path());
    write(other.path(), "note.md", "リモート\n");
    commit(other.path(), "リモート");
    action(other.path(), Action::Push).unwrap();
    write(root, "local.md", "自分");
    commit(root, "自分");
    write(root, "note.md", "コミット前\n");
    let head = git(root, &["rev-parse", "HEAD"]);
    assert_eq!(action(root, Action::Pull).unwrap_err().code, "GIT_CONFLICT");
    assert_eq!(git(root, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        fs::read_to_string(root.join("note.md")).unwrap(),
        "コミット前\n"
    );
    assert!(!in_progress(root).unwrap());
    assert!(state(root).changes.iter().all(|c| c.index != 'U'));
}

#[test]
fn revert_conflict_is_aborted() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初\n");
    commit(root, "最初");
    write(root, "note.md", "次\n");
    commit(root, "次");
    write(root, "note.md", "さらに次\n");
    commit(root, "さらに次");
    // 競合時の復元処理を、実際にぶつかる古いコミットで確かめる。
    // 画面から呼べる取り消しはHEADだけに限っている。
    let head = git(root, &["rev-parse", "HEAD"]);
    assert_eq!(revert(root, "HEAD~1").unwrap_err().code, "GIT_CONFLICT");
    assert!(!in_progress(root).unwrap());
    assert_eq!(git(root, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        fs::read_to_string(root.join("note.md")).unwrap(),
        "さらに次\n"
    );
    assert!(state(root).changes.is_empty());
}

#[test]
fn paths_are_literal_and_cannot_leave_workspace() {
    let dir = repo();
    let root = dir.path();
    write(root, "safe.md", "安全");
    commit(root, "最初");
    for path in [
        "../outside",
        "/tmp/outside",
        ".git/config",
        "",
        "../safe.md",
    ] {
        assert!(action(
            root,
            Action::Stage {
                paths: vec![path.into()]
            }
        )
        .is_err());
    }
    fs::create_dir(root.join("nested")).unwrap();
    assert!(status(&root.join("nested")).unwrap().is_none());
    let plain = tempdir_in("/private/tmp").unwrap();
    assert!(status(plain.path()).unwrap().is_none());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(plain.path(), root.join("outside")).unwrap();
        assert!(safe_path(root, "outside/file").is_err());
    }
    let output = Output {
        status: run(root, &["not-a-command"]).unwrap().status,
        stdout: vec![],
        stderr: b"fatal: Authentication failed".to_vec(),
    };
    assert_eq!(output_error(&output).code, "GIT_AUTH");
}

#[test]
fn failing_hooks_and_timeouts_are_reported() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初");
    commit(root, "最初");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let hooks = root.join(".git/hooks");
        fs::create_dir_all(&hooks).unwrap();
        git(root, &["config", "core.hooksPath", hooks.to_str().unwrap()]);
        fs::write(
            hooks.join("pre-commit"),
            "#!/bin/sh\necho フックの失敗 >&2\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(hooks.join("pre-commit"), fs::Permissions::from_mode(0o755)).unwrap();
        write(root, "note.md", "更新");
        action(
            root,
            Action::Stage {
                paths: vec!["note.md".into()],
            },
        )
        .unwrap();
        assert!(action(
            root,
            Action::Commit {
                message: "更新".into()
            }
        )
        .unwrap_err()
        .message
        .contains("フックの失敗"));
        git(root, &["config", "alias.wait", "!sleep 5"]);
        assert_eq!(
            run_timeout(root, &["wait"], Duration::from_millis(50))
                .unwrap_err()
                .code,
            "GIT_TIMEOUT"
        );
    }
}

#[test]
fn push_updates_only_the_current_upstream_even_with_matching_config() {
    let dir = repo();
    let root = dir.path();
    write(root, "note.md", "最初");
    commit(root, "最初");
    let bare = remote(root);
    git(root, &["checkout", "-b", "side"]);
    write(root, "side.md", "枝");
    commit(root, "枝");
    git(root, &["push", "-u", "origin", "side"]);
    let remote_side = git(bare.path(), &["rev-parse", "side"]);
    write(root, "side.md", "枝の更新");
    commit(root, "枝の更新");
    git(root, &["checkout", "main"]);
    git(root, &["config", "push.default", "matching"]);
    git(
        root,
        &[
            "config",
            "remote.origin.push",
            "refs/heads/side:refs/heads/side",
        ],
    );
    write(root, "note.md", "更新");
    commit(root, "更新");
    action(root, Action::Push).unwrap();
    assert_eq!(
        git(bare.path(), &["rev-parse", "main"]),
        git(root, &["rev-parse", "HEAD"])
    );
    assert_eq!(git(bare.path(), &["rev-parse", "side"]), remote_side);
}
