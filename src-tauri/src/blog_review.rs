use crate::files::{Error, Result};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const LIMIT: u64 = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(180);
#[derive(Default)]
pub struct Reviews(Mutex<HashMap<String, Arc<AtomicBool>>>);
#[derive(Deserialize)]
pub struct Request {
    pub feature: String,
    pub prompt: String,
    pub schema: Value,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
}

fn executable(ai: &str) -> Option<PathBuf> {
    if !["agy", "claude", "codex"].contains(&ai) {
        return None;
    }
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME") {
        for directory in [".local/bin", ".npm-global/bin", ".cargo/bin"] {
            paths.push(PathBuf::from(&home).join(directory));
        }
    }
    paths.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    paths.into_iter().map(|path| path.join(ai)).find(|path| {
        fs::metadata(path)
            .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    })
}
#[tauri::command]
pub fn blog_review_available() -> Vec<String> {
    ["agy", "claude", "codex"]
        .into_iter()
        .filter(|ai| executable(ai).is_some())
        .map(str::to_owned)
        .collect()
}

fn model_names(value: &Value) -> Vec<String> {
    let entries = value
        .as_array()
        .or_else(|| value.get("models").and_then(Value::as_array));
    entries
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            entry.as_str().or_else(|| {
                ["slug", "id", "name"]
                    .into_iter()
                    .find_map(|key| entry.get(key).and_then(Value::as_str))
            })
        })
        .filter(|name| !name.is_empty() && name.len() <= 200 && !name.chars().any(char::is_control))
        .map(str::to_owned)
        .collect()
}
fn agy_models(output: &str) -> Vec<String> {
    if let Ok(value) = serde_json::from_str::<Value>(output) {
        return model_names(&value);
    }
    let mut names = Vec::new();
    for line in output.lines() {
        let line = line.trim().trim_matches('|').trim();
        let name = line.split_whitespace().next().unwrap_or("");
        if name.contains('-')
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-._/".contains(c))
            && name.chars().any(char::is_alphabetic)
            && !names.iter().any(|n| n == name)
        {
            names.push(name.to_owned());
        }
    }
    names
}
#[tauri::command]
pub async fn blog_review_models(ai: String) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || match ai.as_str() {
        "claude" => Ok(["fable", "opus", "sonnet", "haiku"]
            .map(str::to_owned)
            .to_vec()),
        "codex" => {
            let home = std::env::var_os("HOME")
                .ok_or_else(|| Error::new("AI_MODELS", "モデルの一覧がありません。"))?;
            let bytes = fs::read(PathBuf::from(home).join(".codex/models_cache.json"))?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| Error::new("AI_MODELS", "モデルの一覧を読めません。"))?;
            let names = model_names(&value);
            if names.is_empty() {
                return Err(Error::new("AI_MODELS", "モデルの一覧がありません。"));
            }
            Ok(names)
        }
        "agy" => {
            let program = executable("agy")
                .ok_or_else(|| Error::new("AI_MISSING", "AIのコマンドが見つかりません。"))?;
            let workspace = tempfile::tempdir()?;
            let mut output = tempfile::tempfile()?;
            let errors = tempfile::tempfile()?;
            let mut child = Command::new(program)
                .arg("models")
                .current_dir(workspace.path())
                .stdin(Stdio::null())
                .stdout(output.try_clone()?)
                .stderr(errors.try_clone()?)
                .process_group(0)
                .spawn()?;
            let status = wait(
                &mut child,
                &AtomicBool::new(false),
                Duration::from_secs(10),
                &output,
                &errors,
            )?;
            if !status.success() {
                return Err(Error::new("AI_MODELS", "モデルの一覧を取得できません。"));
            }
            let names = agy_models(&read_output(&mut output)?);
            if names.is_empty() {
                return Err(Error::new("AI_MODELS", "モデルの一覧を読めません。"));
            }
            Ok(names)
        }
        _ => Err(Error::new("INVALID", "添削のAIが違います。")),
    })
    .await
    .map_err(|error| Error::new("INTERNAL", error.to_string()))?
}

fn arguments(ai: &str, request: &Request, schema: &Path, answer: &Path) -> Result<Vec<String>> {
    if !["review", "suggest"].contains(&request.feature.as_str())
        || request.model.len() > 200
        || request.model.chars().any(char::is_control)
        || !["", "low", "medium", "high", "xhigh", "max"].contains(&request.effort.as_str())
        || request.prompt.len() > LIMIT as usize
        || !request.schema.is_object()
        || request.schema.to_string().len() > 64 * 1024
    {
        return Err(Error::new("INVALID", "添削の依頼の形式が違います。"));
    }
    let mut args: Vec<String> = match ai {
        "agy" => [
            "-p",
            &request.prompt,
            "--output-format",
            "json",
            "--json-schema",
            &request.schema.to_string(),
            "--mode",
            "plan",
            "--sandbox",
            "--disable-slash-commands",
        ]
        .map(str::to_owned)
        .to_vec(),
        "claude" => [
            "-p",
            &request.prompt,
            "--output-format",
            "json",
            "--json-schema",
            &request.schema.to_string(),
            "--tools",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--permission-mode",
            "dontAsk",
            "--no-session-persistence",
        ]
        .map(str::to_owned)
        .to_vec(),
        "codex" => [
            "exec",
            "--output-schema",
            &schema.to_string_lossy(),
            "-s",
            "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "-c",
            "features.shell_tool=false",
            "-o",
            &answer.to_string_lossy(),
        ]
        .map(str::to_owned)
        .to_vec(),
        _ => return Err(Error::new("INVALID", "添削のAIが違います。")),
    };
    if !request.model.is_empty() {
        args.extend([
            if ai == "codex" { "-m" } else { "--model" }.into(),
            request.model.clone(),
        ]);
    }
    if !request.effort.is_empty() {
        args.extend(if ai == "codex" {
            vec![
                "-c".into(),
                format!("model_reasoning_effort={}", request.effort),
            ]
        } else {
            vec!["--effort".into(), request.effort.clone()]
        });
    }
    if ai == "codex" {
        args.push(request.prompt.clone());
    }
    Ok(args)
}

fn short_error(text: &str) -> String {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .last()
        .unwrap_or("AIのコマンドが失敗しました。")
        .chars()
        .take(240)
        .collect()
}
fn extract(ai: &str, output: &str) -> Result<Value> {
    let envelope: Value = serde_json::from_str(output.trim())
        .map_err(|_| Error::new("AI_JSON", "AIのJSONを読めません。"))?;
    if ai == "codex" {
        return Ok(envelope);
    }
    if envelope.get("is_error") == Some(&Value::Bool(true))
        || envelope
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status != "SUCCESS")
        || envelope
            .get("subtype")
            .and_then(Value::as_str)
            .is_some_and(|status| status != "success")
    {
        return Err(Error::new(
            "AI_COMMAND",
            short_error(
                envelope
                    .get("result")
                    .or_else(|| envelope.get("response"))
                    .and_then(Value::as_str)
                    .unwrap_or("AIのコマンドが失敗しました。"),
            ),
        ));
    }
    // agyとClaudeのJSONは、会話の情報とは別に構造化した答えを持つ。
    if let Some(answer) = envelope
        .get("structured_output")
        .filter(|answer| answer.is_object())
    {
        return Ok(answer.clone());
    }
    let text = envelope
        .get("result")
        .or_else(|| envelope.get("response"))
        .and_then(Value::as_str)
        .ok_or_else(|| Error::new("AI_JSON", "AIの答えがありません。"))?;
    serde_json::from_str(text).map_err(|_| Error::new("AI_JSON", "AIのJSONを読めません。"))
}

fn stop(child: &mut Child) {
    // 子コマンドも同じプロセス群で終わらせる。
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn wait(
    child: &mut Child,
    cancelled: &AtomicBool,
    timeout: Duration,
    output: &File,
    errors: &File,
) -> Result<std::process::ExitStatus> {
    let started = Instant::now();
    loop {
        let sizes = output
            .metadata()
            .and_then(|stdout| errors.metadata().map(|stderr| (stdout.len(), stderr.len())));
        let (stdout_len, stderr_len) = match sizes {
            Ok(sizes) => sizes,
            Err(error) => {
                stop(child);
                return Err(error.into());
            }
        };
        let error = if cancelled.load(Ordering::SeqCst) {
            Some(Error::new("CANCELLED", "取り消しました。"))
        } else if started.elapsed() >= timeout {
            Some(Error::new("TIMEOUT", "添削の時間切れです。"))
        } else if stdout_len > LIMIT || stderr_len > LIMIT {
            Some(Error::new("AI_LIMIT", "AIの答えが長すぎます。"))
        } else {
            None
        };
        if let Some(error) = error {
            stop(child);
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                stop(child);
                return Ok(status);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                stop(child);
                return Err(error.into());
            }
        }
    }
}
fn read_output(file: &mut File) -> Result<String> {
    file.seek(SeekFrom::Start(0))?;
    let mut text = String::new();
    file.take(LIMIT + 1).read_to_string(&mut text)?;
    if text.len() as u64 > LIMIT {
        return Err(Error::new("AI_LIMIT", "AIの答えが長すぎます。"));
    }
    Ok(text)
}
fn execute(ai: &str, request: Request, cancelled: Arc<AtomicBool>) -> Result<Value> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(Error::new("CANCELLED", "取り消しました。"));
    }
    let program =
        executable(ai).ok_or_else(|| Error::new("AI_MISSING", "AIのコマンドが見つかりません。"))?;
    // 作業場所は空にし、スキーマと出力は別の一時ディレクトリへ置く。
    let workspace = tempfile::Builder::new()
        .prefix("nagori-review-work-")
        .tempdir()?;
    let data = tempfile::Builder::new()
        .prefix("nagori-review-data-")
        .tempdir()?;
    let schema = data.path().join("schema.json");
    let answer = data.path().join("answer.json");
    fs::write(&schema, request.schema.to_string())?;
    let mut output = tempfile::tempfile()?;
    let mut errors = tempfile::tempfile()?;
    let mut child = Command::new(program)
        .args(arguments(ai, &request, &schema, &answer)?)
        .current_dir(workspace.path())
        .stdin(Stdio::null())
        .stdout(output.try_clone()?)
        .stderr(errors.try_clone()?)
        .process_group(0)
        .spawn()?;
    let status = wait(&mut child, &cancelled, TIMEOUT, &output, &errors)?;
    if !status.success() {
        let stderr = read_output(&mut errors)?;
        let stdout = read_output(&mut output)?;
        return Err(Error::new(
            "AI_COMMAND",
            short_error(if stderr.trim().is_empty() {
                &stdout
            } else {
                &stderr
            }),
        ));
    }
    let text = if ai == "codex" {
        read_output(&mut File::open(answer)?)?
    } else {
        read_output(&mut output)?
    };
    extract(ai, &text)
}

#[tauri::command]
pub async fn blog_review_run(
    state: tauri::State<'_, Reviews>,
    id: String,
    ai: String,
    request: Request,
) -> Result<Value> {
    if id.is_empty() || id.len() > 100 {
        return Err(Error::new("INVALID", "添削のIDが違います。"));
    }
    let token = {
        let mut active = state
            .0
            .lock()
            .map_err(|_| Error::new("INTERNAL", "添削の状態を読めません。"))?;
        if active.len() >= 16 && !active.contains_key(&id) {
            return Err(Error::new("AI_BUSY", "添削を実行中です。"));
        }
        if active
            .get(&id)
            .is_some_and(|token| !token.load(Ordering::SeqCst))
        {
            return Err(Error::new("AI_BUSY", "添削を実行中です。"));
        }
        active.entry(id.clone()).or_default().clone()
    };
    let result = tauri::async_runtime::spawn_blocking(move || execute(&ai, request, token))
        .await
        .map_err(|error| Error::new("INTERNAL", error.to_string()))
        .and_then(|result| result);
    if let Ok(mut active) = state.0.lock() {
        active.remove(&id);
    }
    result
}
#[tauri::command]
pub fn blog_review_cancel(state: tauri::State<'_, Reviews>, id: String) -> Result<()> {
    let mut active = state
        .0
        .lock()
        .map_err(|_| Error::new("INTERNAL", "添削の状態を読めません。"))?;
    if id.is_empty() || id.len() > 100 || (active.len() >= 16 && !active.contains_key(&id)) {
        return Err(Error::new("INVALID", "添削のIDが違います。"));
    }
    // 起動の直前に取り消しが届いた時も、起動側へ取り消しを渡す。
    active.entry(id).or_default().store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_for_every_feature_and_ai() {
        for feature in ["review", "suggest"] {
            let request = Request {
                feature: feature.into(),
                prompt: format!("{feature}\n日本語 ' $(id)"),
                schema: serde_json::json!({"type":"object"}),
                model: String::new(),
                effort: String::new(),
            };
            for ai in ["agy", "claude", "codex"] {
                let args = arguments(
                    ai,
                    &request,
                    Path::new("/tmp/schema.json"),
                    Path::new("/tmp/answer.json"),
                )
                .unwrap();
                assert!(args.contains(&request.prompt));
                assert!(!args.iter().any(|arg| arg == "--model"
                    || arg == "-m"
                    || arg == "--effort"
                    || arg.starts_with("model_reasoning_effort=")));
                if ai == "agy" {
                    assert!(args.windows(2).any(|pair| pair == ["--mode", "plan"]));
                    assert!(args.contains(&"--sandbox".into()));
                    assert!(args.contains(&"--disable-slash-commands".into()));
                }
                if ai == "claude" {
                    assert!(args.windows(2).any(|pair| pair == ["--tools", ""]));
                    assert!(args
                        .windows(2)
                        .any(|pair| pair == ["--permission-mode", "dontAsk"]));
                    assert!(args
                        .windows(2)
                        .any(|pair| pair == ["--mcp-config", "{\"mcpServers\":{}}"]));
                }
                assert!(!args
                    .iter()
                    .any(|arg| arg.contains("dangerously") || arg == "accept-edits"));
                if ai == "codex" {
                    assert!(args.contains(&"read-only".into()));
                    assert!(args.contains(&"--output-schema".into()));
                } else {
                    assert!(args.contains(&"--json-schema".into()));
                }
            }
        }
    }
    #[test]
    fn model_and_effort_arguments() {
        for ai in ["agy", "claude", "codex"] {
            let mut request = Request {
                feature: "review".into(),
                prompt: "本文".into(),
                schema: serde_json::json!({"type":"object"}),
                model: "custom-model".into(),
                effort: "high".into(),
            };
            let args = arguments(ai, &request, Path::new("schema"), Path::new("answer")).unwrap();
            assert!(
                args.windows(2)
                    .any(|pair| pair
                        == [if ai == "codex" { "-m" } else { "--model" }, "custom-model"])
            );
            assert!(args.windows(2).any(|pair| pair
                == if ai == "codex" {
                    ["-c", "model_reasoning_effort=high"]
                } else {
                    ["--effort", "high"]
                }));
            request.effort = "unsupported".into();
            assert!(arguments(ai, &request, Path::new("schema"), Path::new("answer")).is_err());
            request.effort.clear();
            request.model = "model\ncommand".into();
            assert!(arguments(ai, &request, Path::new("schema"), Path::new("answer")).is_err());
        }
    }
    #[test]
    fn parses_model_lists() {
        assert_eq!(
            model_names(&serde_json::json!({"models":[{"slug":"gpt-model"},{"id":"other-model"}]})),
            ["gpt-model", "other-model"]
        );
        assert_eq!(
            agy_models(r#"{"models":["gemini-model",{"id":"claude-model"}]}"#),
            ["gemini-model", "claude-model"]
        );
        assert_eq!(
            agy_models("Model Description\n------\ngemini-model Fast\nclaude-model Deep\n"),
            ["gemini-model", "claude-model"]
        );
    }
    #[test]
    fn extracts_provider_envelopes_and_errors() {
        let answer = serde_json::json!({"issues": [{"original":"誤字", "replacement":"修正", "reason":"理由"}]});
        for (ai, fixture) in [
            (
                "agy",
                serde_json::json!({"status":"SUCCESS", "response":"ignored", "structured_output":answer}),
            ),
            (
                "claude",
                serde_json::json!({"type":"result", "subtype":"success", "is_error":false, "structured_output":answer}),
            ),
            ("codex", answer.clone()),
        ] {
            assert_eq!(extract(ai, &fixture.to_string()).unwrap(), answer);
        }
        assert_eq!(
            extract(
                "claude",
                &serde_json::json!({"result":answer.to_string()}).to_string()
            )
            .unwrap(),
            answer
        );
        assert_eq!(
            extract(
                "agy",
                &serde_json::json!({"response":answer.to_string()}).to_string()
            )
            .unwrap(),
            answer
        );
        assert!(extract("claude", r#"{"is_error":true,"result":"failed"}"#).is_err());
        assert!(extract("agy", r#"{"status":"ERROR","response":"failed"}"#).is_err());
        assert!(extract("codex", "not json").is_err());
    }
    fn child(script: &str, output: &File, errors: &File) -> Child {
        Command::new("/bin/sh")
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(output.try_clone().unwrap())
            .stderr(errors.try_clone().unwrap())
            .process_group(0)
            .spawn()
            .unwrap()
    }
    #[test]
    fn timeout_cancel_and_closed_stdin() {
        let output = tempfile::tempfile().unwrap();
        let errors = tempfile::tempfile().unwrap();
        let mut process = child("sleep 10", &output, &errors);
        assert_eq!(
            wait(
                &mut process,
                &AtomicBool::new(false),
                Duration::from_millis(30),
                &output,
                &errors
            )
            .unwrap_err()
            .code,
            "TIMEOUT"
        );
        assert!(process.try_wait().unwrap().is_some());
        let token = Arc::new(AtomicBool::new(false));
        let signal = token.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            signal.store(true, Ordering::SeqCst);
        });
        let mut process = child("sleep 10", &output, &errors);
        assert_eq!(
            wait(
                &mut process,
                &token,
                Duration::from_secs(5),
                &output,
                &errors
            )
            .unwrap_err()
            .code,
            "CANCELLED"
        );
        thread.join().unwrap();
        assert!(process.try_wait().unwrap().is_some());
        let mut process = child(
            "if read input; then exit 1; else exit 0; fi",
            &output,
            &errors,
        );
        assert!(wait(
            &mut process,
            &AtomicBool::new(false),
            Duration::from_secs(1),
            &output,
            &errors
        )
        .unwrap()
        .success());
    }
}
