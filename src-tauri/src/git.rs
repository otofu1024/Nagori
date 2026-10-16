use crate::files::{Error, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub original_path: Option<String>,
    pub index: char,
    pub worktree: char,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit {
    pub oid: String,
    pub message: String,
    pub undo: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub changes: Vec<Change>,
    pub last_commit: Option<LastCommit>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    Stage { paths: Vec<String> },
    Unstage { paths: Vec<String> },
    Commit { message: String },
    Push,
    Pull,
    Undo { oid: String, mode: String },
}

// パイプの容量でGitが止まらないよう、出力を一時ファイルで受ける。
fn run(root: &Path, args: &[&str]) -> Result<Output> {
    run_timeout(root, args, Duration::from_secs(60))
}

fn run_timeout(root: &Path, args: &[&str], timeout: Duration) -> Result<Output> {
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_ASKPASS", "/usr/bin/false")
        .env("SSH_ASKPASS", "/usr/bin/false")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env("LC_ALL", "C")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(Stdio::null())
        .stdout(stdout.try_clone()?)
        .stderr(stderr.try_clone()?);
    // 親の環境で指定された別のリポジトリや索引を使わない。
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
    ] {
        command.env_remove(key);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|error| {
        Error::new(
            if error.kind() == std::io::ErrorKind::NotFound {
                "GIT_MISSING"
            } else {
                "GIT"
            },
            error.to_string(),
        )
    })?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::new(
                "GIT_TIMEOUT",
                "Gitの処理が1分以内に終わりませんでした。",
            ));
        }
        thread::sleep(Duration::from_millis(15));
    };
    stdout.seek(SeekFrom::Start(0))?;
    stderr.seek(SeekFrom::Start(0))?;
    let mut out = Vec::new();
    let mut err = Vec::new();
    stdout.take(16 * 1024 * 1024).read_to_end(&mut out)?;
    stderr.take(64 * 1024).read_to_end(&mut err)?;
    Ok(Output {
        status,
        stdout: out,
        stderr: err,
    })
}

fn checked(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = run(root, args)?;
    if !output.status.success() {
        return Err(output_error(&output));
    }
    Ok(output.stdout)
}

fn output_error(output: &Output) -> Error {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let lower = text.to_lowercase();
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied (publickey")
        || lower.contains("terminal prompts disabled")
    {
        return Error::new(
            "GIT_AUTH",
            "GitHubのログインが要ります。ターミナルで1回pushしてください",
        );
    }
    let code = if lower.contains("[rejected]")
        && (lower.contains("fetch first") || lower.contains("non-fast-forward"))
    {
        "GIT_PULL_REQUIRED"
    } else {
        "GIT"
    };
    let message = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join("\n");
    Error::new(code, message.chars().take(500).collect::<String>())
}

fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| Error::new("GIT", "UTF-8で表現できないファイル名です。"))
}

// 開いたフォルダの親のリポジトリは操作しない。
fn repository(root: &Path) -> Result<bool> {
    let output = match run(root, &["rev-parse", "--show-toplevel"]) {
        Err(error) if error.code == "GIT_MISSING" => return Ok(false),
        result => result?,
    };
    if !output.status.success() {
        return Ok(false);
    }
    let path = text(output.stdout)?;
    Ok(fs::canonicalize(path.trim_end_matches('\n'))? == fs::canonicalize(root)?)
}

fn safe_path(root: &Path, path: &str) -> Result<()> {
    if path.is_empty()
        || path.contains('\0')
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || Path::new(path)
            .components()
            .any(|part| part.as_os_str() == ".git")
    {
        return Err(Error::new(
            "GIT_PATH",
            "開いたフォルダ内のファイルを選んでください。",
        ));
    }
    let mut current = root.to_path_buf();
    let parts: Vec<_> = Path::new(path).components().collect();
    for (index, part) in parts.iter().enumerate() {
        current.push(part.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() && index + 1 < parts.len() => {
                return Err(Error::new(
                    "GIT_PATH",
                    "シンボリックリンクの中は操作できません。",
                ));
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
    }
    Ok(())
}

fn parse_status(bytes: Vec<u8>) -> Result<Status> {
    let input = text(bytes)?;
    let mut fields = input.split('\0');
    let mut status = Status {
        branch: String::new(),
        upstream: None,
        ahead: 0,
        changes: vec![],
        last_commit: None,
    };
    while let Some(field) = fields.next() {
        if let Some(branch) = field.strip_prefix("# branch.head ") {
            status.branch = branch.to_owned();
        } else if let Some(upstream) = field.strip_prefix("# branch.upstream ") {
            status.upstream = Some(upstream.to_owned());
        } else if let Some(ab) = field.strip_prefix("# branch.ab +") {
            status.ahead = ab
                .split(' ')
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
        } else if field.starts_with("1 ") || field.starts_with("2 ") || field.starts_with("u ") {
            let count = if field.starts_with("1 ") {
                9
            } else if field.starts_with("2 ") {
                10
            } else {
                11
            };
            let parts: Vec<_> = field.splitn(count, ' ').collect();
            if parts.len() != count {
                return Err(Error::new("GIT", "Gitの状態を読み取れませんでした。"));
            }
            let xy: Vec<_> = parts[1].chars().collect();
            let original_path = if count == 10 {
                fields.next().map(str::to_owned)
            } else {
                None
            };
            status.changes.push(Change {
                path: parts[count - 1].to_owned(),
                original_path,
                index: if count == 11 { 'U' } else { xy[0] },
                worktree: if count == 11 { 'U' } else { xy[1] },
            });
        } else if let Some(path) = field.strip_prefix("? ") {
            status.changes.push(Change {
                path: path.to_owned(),
                original_path: None,
                index: '.',
                worktree: '?',
            });
        }
    }
    Ok(status)
}

fn in_progress(root: &Path) -> Result<bool> {
    let directory = text(checked(root, &["rev-parse", "--absolute-git-dir"])?)?;
    Ok([
        "MERGE_HEAD",
        "REVERT_HEAD",
        "CHERRY_PICK_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ]
    .iter()
    .any(|name| {
        Path::new(directory.trim_end_matches('\n'))
            .join(name)
            .exists()
    }))
}

pub fn status(root: &Path) -> Result<Option<Status>> {
    if !repository(root)? {
        return Ok(None);
    }
    let mut status = parse_status(checked(
        root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ],
    )?)?;
    for change in &status.changes {
        safe_path(root, &change.path)?;
        if let Some(path) = &change.original_path {
            safe_path(root, path)?;
        }
    }
    let head = run(root, &["log", "-1", "--format=%H%x00%s%x00%P"])?;
    if head.status.success() {
        let head = text(head.stdout)?;
        let parts: Vec<_> = head.trim_end_matches('\n').split('\0').collect();
        if parts.len() != 3 {
            return Err(Error::new("GIT", "コミットを読み取れませんでした。"));
        }
        let parents = parts[2].split_whitespace().count();
        let remotes = checked(
            root,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "--contains",
                parts[0],
                "refs/remotes/",
            ],
        )?;
        let published =
            !remotes.is_empty() || status.upstream.as_ref().is_some_and(|_| status.ahead == 0);
        let reason = if in_progress(root)? {
            Some("Gitの別の操作が進行中です。")
        } else if parents == 0 {
            Some("最初のコミットは取り消せません。")
        } else if parents > 1 {
            Some("マージのコミットは取り消せません。")
        } else if published && !status.changes.is_empty() {
            Some("コミットしていない変更があります。")
        } else {
            None
        };
        status.last_commit = Some(LastCommit {
            oid: parts[0].to_owned(),
            message: parts[1].to_owned(),
            undo: reason
                .is_none()
                .then(|| if published { "revert" } else { "reset" }.to_owned()),
            reason: reason.map(str::to_owned),
        });
    }
    Ok(Some(status))
}

pub fn action(root: &Path, action: Action) -> Result<Status> {
    let before =
        status(root)?.ok_or_else(|| Error::new("GIT", "Gitのリポジトリではありません。"))?;
    if in_progress(root)? {
        return Err(Error::new(
            "GIT",
            "Gitの別の操作が進行中です。ターミナルで完了してください。",
        ));
    }
    let stage = matches!(&action, Action::Stage { .. });
    match action {
        Action::Stage { paths } | Action::Unstage { paths } => {
            let mut selected = BTreeSet::new();
            for path in paths {
                safe_path(root, &path)?;
                let change = before
                    .changes
                    .iter()
                    .find(|change| change.path == path)
                    .ok_or_else(|| {
                        Error::new(
                            "GIT_CHANGED",
                            "変更の一覧が変わりました。もう一度選んでください。",
                        )
                    })?;
                selected.insert(change.path.as_str());
                if !stage {
                    if let Some(original) = &change.original_path {
                        selected.insert(original.as_str());
                    }
                }
            }
            if selected.is_empty() {
                return Err(Error::new("GIT", "ファイルを選んでください。"));
            }
            let mut args = if stage {
                vec!["add", "--"]
            } else if before.last_commit.is_none() {
                vec!["rm", "--cached", "-f", "--"]
            } else {
                vec!["restore", "--staged", "--"]
            };
            args.extend(selected);
            checked(root, &args)?;
        }
        Action::Commit { message } => {
            if message.trim().is_empty() || message.contains('\0') {
                return Err(Error::new("GIT", "コミットメッセージを入力してください。"));
            }
            if !before.changes.iter().any(|change| change.index != '.') {
                return Err(Error::new("GIT", "ステージした変更がありません。"));
            }
            checked(root, &["commit", "-m", &message])?;
        }
        Action::Push => {
            if before.upstream.is_none() {
                return Err(Error::new("GIT", "リモートがありません"));
            }
            let (remote, branch) = upstream_target(root, &before.branch)?;
            // push.defaultやremote.*.pushに、別のブランチを含む設定があっても使わない。
            checked(root, &["push", "--", &remote, &format!("HEAD:{branch}")])?;
        }
        Action::Pull => {
            if before.upstream.is_none() {
                return Err(Error::new("GIT", "リモートがありません"));
            }
            let original = before
                .last_commit
                .as_ref()
                .ok_or_else(|| Error::new("GIT", "コミットがありません。"))?;
            // abortでautostashが戻る時に、部分的なステージの状態も復元する。
            let staged_tree = text(checked(root, &["write-tree"])?)?;
            let output = run(root, &["pull", "--rebase", "--autostash"]);
            if !output.as_ref().is_ok_and(|output| output.status.success()) {
                if in_progress(root)? {
                    checked(root, &["rebase", "--abort"])?;
                    checked(root, &["read-tree", staged_tree.trim()])?;
                    return Err(Error::new("GIT_CONFLICT", "GitHubの変更とぶつかったため、取り込めませんでした。ターミナルで直してください"));
                }
                return Err(match output {
                    Ok(output) => output_error(&output),
                    Err(error) => error,
                });
            }
            // autostashを戻す時の衝突も成功として扱わない。退避した内容はGitに残る。
            let after = status(root)?.unwrap();
            if after
                .changes
                .iter()
                .any(|change| change.index == 'U' || change.worktree == 'U')
            {
                // autostashの適用でぶつかった時も、元の履歴と退避した変更を戻す。
                // Gitが作ったstashは復旧用に残し、既存のstashには触れない。
                let stash = text(checked(root, &["rev-parse", "refs/stash"])?)?;
                checked(root, &["reset", "--merge", &original.oid])?;
                checked(root, &["stash", "apply", "--index", stash.trim()])?;
                return Err(Error::new("GIT_CONFLICT", "GitHubの変更とぶつかったため、取り込めませんでした。ターミナルで直してください"));
            }
        }
        Action::Undo { oid, mode } => {
            let last = before
                .last_commit
                .ok_or_else(|| Error::new("GIT", "コミットがありません。"))?;
            if last.oid != oid || last.undo.as_deref() != Some(&mode) {
                return Err(Error::new(
                    "GIT_CHANGED",
                    "コミットの状態が変わりました。もう一度確かめてください。",
                ));
            }
            if mode == "reset" {
                checked(root, &["reset", "--soft", "HEAD~1"])?;
            } else {
                revert(root, "HEAD")?;
            }
        }
    }
    status(root)?.ok_or_else(|| Error::new("GIT", "Gitの状態を読み取れませんでした。"))
}

fn upstream_target(root: &Path, branch: &str) -> Result<(String, String)> {
    let remote = text(checked(
        root,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )?)?;
    let merge = text(checked(
        root,
        &["config", "--get", &format!("branch.{branch}.merge")],
    )?)?;
    let remote = remote.trim_end_matches('\n').to_owned();
    let merge = merge.trim_end_matches('\n').to_owned();
    if !merge.starts_with("refs/heads/") || merge.contains('\n') || remote.contains('\n') {
        return Err(Error::new(
            "GIT",
            "追跡するリモートを読み取れませんでした。",
        ));
    }
    Ok((remote, merge))
}

fn revert(root: &Path, revision: &str) -> Result<()> {
    let output = run(root, &["revert", "--no-edit", revision]);
    if output.as_ref().is_ok_and(|output| output.status.success()) {
        return Ok(());
    }
    if in_progress(root)? {
        checked(root, &["revert", "--abort"])?;
        return Err(Error::new(
            "GIT_CONFLICT",
            "ぶつかったため取り消せませんでした",
        ));
    }
    Err(match output {
        Ok(output) => output_error(&output),
        Err(error) => error,
    })
}

#[cfg(test)]
mod tests;
