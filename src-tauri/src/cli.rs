use crate::files::{Error, Result};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const DESTINATION: &str = "/usr/local/bin/nagori";

#[derive(serde::Serialize)]
pub struct Status {
    path: String,
    installed: bool,
    available: bool,
    message: String,
}

fn source() -> Result<PathBuf> {
    let executable = fs::canonicalize(std::env::current_exe()?)?;
    let contents = executable
        .parent()
        .and_then(Path::parent)
        .filter(|path| path.file_name().is_some_and(|name| name == "Contents"))
        .ok_or_else(|| {
            Error::new(
                "CLI_BUNDLE",
                "アプリをビルドし、Applicationsフォルダへ移動してください。",
            )
        })?;
    Ok(contents.join("Resources/cli/nagori"))
}

fn available(source: &Path) -> bool {
    let Some(bundle) = source.ancestors().nth(4) else {
        return false;
    };
    let Some(parent) = bundle.parent() else {
        return false;
    };
    let in_applications = parent == Path::new("/Applications")
        || std::env::var_os("HOME")
            .is_some_and(|home| parent == PathBuf::from(home).join("Applications"));
    in_applications && source.is_file() && source.with_file_name("cli-link.sh").is_file()
}

fn owns(destination: &Path, source: &Path) -> bool {
    fs::read_link(destination).is_ok_and(|target| target == source)
}

fn status(message: Option<String>) -> Status {
    let source = source().ok();
    let installed = source
        .as_ref()
        .is_some_and(|source| owns(Path::new(DESTINATION), source));
    let available = source.as_ref().is_some_and(|source| available(source));
    Status {
        path: DESTINATION.into(),
        installed,
        available,
        message: message.unwrap_or_else(|| {
            if installed {
                "nagoriコマンドは登録済みです。".into()
            } else if available {
                "nagoriコマンドを登録できます。".into()
            } else {
                "アプリをApplicationsフォルダへ移動してから登録してください。".into()
            }
        }),
    }
}

// Shell arguments are always single-quoted; AppleScript receives the command as argv.
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn change(action: &str) -> Result<Status> {
    if !cfg!(target_os = "macos") {
        return Err(Error::new(
            "UNSUPPORTED",
            "コマンドの登録はmacOSで利用できます。",
        ));
    }
    let source = source()?;
    if action == "install" && !available(&source) {
        return Err(Error::new(
            "CLI_BUNDLE",
            "アプリをApplicationsフォルダへ移動してから登録してください。",
        ));
    }
    let helper = source.with_file_name("cli-link.sh");
    let result = Command::new("/bin/sh")
        .arg(&helper)
        .arg(action)
        .arg(&source)
        .arg(DESTINATION)
        .output()?;
    if !result.status.success() {
        if result.status.code() != Some(13) {
            return Err(Error::new(
                "CLI_CONFLICT",
                String::from_utf8_lossy(&result.stderr).trim(),
            ));
        }
        let source_text = source
            .to_str()
            .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないパスです。"))?;
        let helper_text = helper
            .to_str()
            .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないパスです。"))?;
        let command = format!(
            "/bin/sh {} {} {} {}",
            quote(helper_text),
            quote(action),
            quote(source_text),
            quote(DESTINATION)
        );
        let output = Command::new("/usr/bin/osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "do shell script (item 1 of argv) with administrator privileges",
                "-e",
                "end run",
                "--",
                &command,
            ])
            .output()?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if error.contains("(-128)") {
                return Err(Error::new(
                    "CANCELLED",
                    "コマンドの登録操作をキャンセルしました。",
                ));
            }
            return Err(Error::new("PERMISSION", error.trim()));
        }
    }
    if action == "install" && !owns(Path::new(DESTINATION), &source) {
        return Err(Error::new(
            "CLI_CONFLICT",
            "コマンドの登録先を確認できませんでした。",
        ));
    }
    let message = if action == "install" {
        let legacy =
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/bin/nagori"));
        if legacy.is_some_and(|path| fs::symlink_metadata(path).is_ok()) {
            "nagoriコマンドを/usr/local/bin/nagoriに登録しました。~/.local/bin/nagoriにもコマンドがあります。古い登録が先に使われる場合は、登録先を確認して解除してください。"
        } else {
            "nagoriコマンドを/usr/local/bin/nagoriに登録しました。ターミナルを開き直して使ってください。PATHに/usr/local/binがない場合は追加してください。"
        }
    } else {
        "nagoriコマンドの登録を解除しました。"
    };
    Ok(status(Some(message.into())))
}

async fn run(action: &'static str) -> Result<Status> {
    tauri::async_runtime::spawn_blocking(move || change(action))
        .await
        .map_err(|error| Error::new("INTERNAL", error.to_string()))?
}

#[tauri::command]
pub async fn cli_install() -> Result<Status> {
    run("install").await
}

#[tauri::command]
pub async fn cli_uninstall() -> Result<Status> {
    run("uninstall").await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_quote_preserves_literal_arguments() {
        let value = "日本語 ' $(touch /tmp/nagori-should-not-exist) `id` $HOME\nname";
        let command = format!("printf %s {}", quote(value));
        let result = Command::new("/bin/sh")
            .args(["-c", &command])
            .output()
            .unwrap();
        assert!(result.status.success());
        assert_eq!(result.stdout, value.as_bytes());
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("nagori");
        let source = temp.path().join("other/nagori");
        std::os::unix::fs::symlink(&source, &destination).unwrap();
        assert!(owns(&destination, &source));
        assert!(!owns(&destination, &temp.path().join("unrelated")));
        assert!(!available(&source));
    }
}
