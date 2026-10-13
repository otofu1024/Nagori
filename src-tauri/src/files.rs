use crate::image::image_extension;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const DOCUMENT_LIMIT: usize = 2 * 1024 * 1024;
#[derive(Debug, serde::Serialize)]
pub struct BlogTheme {
    pub template: String,
    pub theme: String,
}
pub fn read_blog_theme(root: &Path) -> Option<BlogTheme> {
    let read = |path| {
        String::from_utf8(read_limited(&resolve(root, path, false).ok()?, 1024 * 1024).ok()?).ok()
    };
    Some(BlogTheme {
        template: read("src/styles/template.css")?,
        theme: read("src/theme/theme.css")?,
    })
}

pub const BLOG_DIRECTORY: &str = "src/content/blog";

pub fn blog_mode(root: &Path, enabled: bool) -> bool {
    enabled && validate_blog(root).is_ok()
}

// テンプレートの構成を確かめる。途中のシンボリックリンクも既存のパス検証で拒否する
pub fn validate_blog(root: &Path) -> Result<()> {
    let valid = resolve(root, BLOG_DIRECTORY, false).is_ok_and(|path| path.is_dir())
        && ["src/theme/theme.css", "src/config.ts"]
            .iter()
            .all(|path| resolve(root, path, false).is_ok_and(|path| path.is_file()));
    if !valid {
        return Err(Error::new(
            "BLOG",
            "ブログのリポジトリではありません。src/content/blog/、src/theme/theme.css、src/config.tsがあるフォルダを選んでください。",
        ));
    }
    Ok(())
}
#[derive(Debug, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => "MISSING",
            std::io::ErrorKind::AlreadyExists => "EXISTS",
            std::io::ErrorKind::PermissionDenied => "PERMISSION",
            _ => "IO",
        };
        Self::new(code, e.to_string())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub kind: String,
    // ファイルの更新日時（Unixのミリ秒）。ディレクトリや取得できない時は省く
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<u64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub path: String,
    pub text: String,
    pub baseline: String,
    pub readonly: bool,
}
#[derive(Debug, Serialize)]
pub struct Saved {
    pub baseline: String,
}
pub fn excluded(path: &Path) -> bool {
    path.components().any(|p| matches!(p, Component::Normal(n) if n == ".git" || n == "node_modules" || n.to_string_lossy().starts_with(".nagori-save-")))
}
pub fn valid_name(name: &str) -> Result<()> {
    if name.trim().is_empty()
        || matches!(name, "." | "..")
        || name.contains(['/', '\\', ':', '\0'])
        || name.chars().any(char::is_control)
    {
        return Err(Error::new(
            "INVALID",
            "空の名前、区切り文字、制御文字は使用できません。",
        ));
    }
    Ok(())
}
pub fn relative(root: &Path, path: &Path) -> Result<String> {
    path.strip_prefix(root)
        .map_err(|_| Error::new("OUTSIDE", "プロジェクト外にはアクセスできません。"))?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないファイル名です。"))
}

// Check every traversed component, including before '..', rather than merely canonicalizing the final path.
pub fn resolve(root: &Path, input: &str, allow_missing_leaf: bool) -> Result<PathBuf> {
    let mut current = root.to_path_buf();
    if fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(Error::new("SYMLINK", "シンボリックリンクは辿れません。"));
    }
    let components: Vec<_> = Path::new(input).components().collect();
    for (i, part) in components.iter().enumerate() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if current == root {
                    return Err(Error::new(
                        "OUTSIDE",
                        "プロジェクト外にはアクセスできません。",
                    ));
                }
                current.pop();
            }
            Component::Normal(name) => {
                current.push(name);
                if excluded(current.strip_prefix(root).unwrap()) {
                    return Err(Error::new("EXCLUDED", "このフォルダは対象外です。"));
                }
                match fs::symlink_metadata(&current) {
                    Ok(meta) if meta.file_type().is_symlink() => {
                        return Err(Error::new("SYMLINK", "シンボリックリンクは辿れません。"))
                    }
                    Ok(_) => {}
                    Err(e)
                        if allow_missing_leaf
                            && i + 1 == components.len()
                            && e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
            _ => {
                return Err(Error::new(
                    "OUTSIDE",
                    "プロジェクト相対パスを指定してください。",
                ))
            }
        }
    }
    if !current.starts_with(root) {
        return Err(Error::new(
            "OUTSIDE",
            "プロジェクト外にはアクセスできません。",
        ));
    }
    Ok(current)
}
fn require_file(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(Error::new("INVALID", "通常ファイルではありません。"));
    }
    Ok(())
}
pub(crate) fn open_limited(path: &Path, limit: usize) -> Result<fs::File> {
    require_file(path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    if file.metadata()?.len() > limit as u64 {
        return Err(Error::new(
            "LIMIT",
            format!("ファイルサイズの上限は{}MiBです。", limit / 1024 / 1024),
        ));
    }
    Ok(file)
}
pub fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>> {
    read_file_limited(open_limited(path, limit)?, limit)
}
pub(crate) fn read_file_limited(mut file: fs::File, limit: usize) -> Result<Vec<u8>> {
    io::Seek::rewind(&mut file)?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(Error::new("LIMIT", "ファイルサイズが上限を超えています。"));
    }
    Ok(bytes)
}
pub(crate) fn markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    )
}
pub fn entry(root: &Path, path: &Path) -> Result<Entry> {
    let metadata = fs::symlink_metadata(path)?;
    let kind = if metadata.file_type().is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "directory"
    } else if markdown(path) {
        "markdown"
    } else if image_extension(path) {
        "image"
    } else {
        "other"
    };
    let modified = if metadata.is_dir() {
        None
    } else {
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as u64)
    };
    Ok(Entry {
        path: relative(root, path)?,
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないファイル名です。"))?
            .into(),
        kind: kind.into(),
        modified,
    })
}
pub fn list(root: &Path, path: &str) -> Result<Vec<Entry>> {
    let directory = resolve(root, path, false)?;
    let mut result = vec![];
    for item in fs::read_dir(directory)? {
        let item = item?;
        if excluded(item.path().strip_prefix(root).unwrap()) {
            continue;
        }
        result.push(entry(root, &item.path())?);
    }
    result.sort_by(|a, b| {
        (a.kind != "directory", a.name.to_lowercase(), &a.name).cmp(&(
            b.kind != "directory",
            b.name.to_lowercase(),
            &b.name,
        ))
    });
    Ok(result)
}
pub fn index(root: &Path) -> Result<Vec<Entry>> {
    index_from(root, "")
}
pub fn index_from(root: &Path, path: &str) -> Result<Vec<Entry>> {
    let mut result = vec![];
    let mut pending = vec![path.to_owned()];
    while let Some(path) = pending.pop() {
        for entry in list(root, &path)? {
            if entry.kind == "directory" {
                pending.push(entry.path);
            } else if matches!(entry.kind.as_str(), "markdown" | "image" | "other") {
                result.push(entry);
            }
        }
    }
    Ok(result)
}
pub fn baseline(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
struct Format {
    bom: bool,
    crlf: bool,
}
fn decode(bytes: &[u8]) -> Result<(String, Format)> {
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let text = std::str::from_utf8(if bom { &bytes[3..] } else { bytes })
        .map_err(|_| Error::new("ENCODING", "UTF-8ではない文書は編集できません。"))?;
    // NUL文字を含むものはテキストではないとみなし、文字化けしたまま編集させない
    if text.contains('\0') {
        return Err(Error::new(
            "BINARY",
            "テキストではないファイルは開けません。",
        ));
    }
    let crlf = text.contains("\r\n");
    let without_crlf = text.replace("\r\n", "");
    if without_crlf.contains('\r') || (crlf && without_crlf.contains('\n')) {
        return Err(Error::new("NEWLINES", "混在した改行形式は編集対象外です。"));
    }
    Ok((text.replace("\r\n", "\n"), Format { bom, crlf }))
}
// 開く処理と同じ判定で、テキストとして読める本文だけを返す（検索の対象の判定に使う）
pub fn text_of(bytes: &[u8]) -> Option<String> {
    decode(bytes).ok().map(|(text, _)| text)
}
fn encode(text: &str, format: &Format) -> Result<Vec<u8>> {
    if text.contains('\r') {
        return Err(Error::new(
            "NEWLINES",
            "エディタ本文はLF形式で渡してください。",
        ));
    }
    let mut result = if format.bom {
        vec![0xef, 0xbb, 0xbf]
    } else {
        vec![]
    };
    result.extend(if format.crlf {
        text.replace('\n', "\r\n").into_bytes()
    } else {
        text.as_bytes().to_vec()
    });
    if result.len() > DOCUMENT_LIMIT {
        return Err(Error::new("LIMIT", "文書の上限は2MiBです。"));
    }
    Ok(result)
}
pub(crate) fn readonly(path: &Path) -> Result<bool> {
    let metadata = fs::metadata(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Ok(metadata.permissions().mode() & 0o222 == 0)
    }
    #[cfg(not(unix))]
    {
        Ok(metadata.permissions().readonly())
    }
}
pub fn open(root: &Path, path: &str) -> Result<OpenedDocument> {
    let absolute = resolve(root, path, false)?;
    // Markdown以外も、画像でなければテキストとして開く。中身の判定はdecodeで行う
    if image_extension(&absolute) {
        return Err(Error::new(
            "UNSUPPORTED",
            "画像は画像プレビューで表示します。",
        ));
    }
    let bytes = read_limited(&absolute, DOCUMENT_LIMIT)?;
    let (text, _) = decode(&bytes)?;
    Ok(OpenedDocument {
        path: relative(root, &absolute)?,
        text,
        baseline: baseline(&bytes),
        readonly: readonly(&absolute)?,
    })
}
// 基準と一致した時は、読み込んだ内容も返して再読み込みを省く
fn check_baseline(root: &Path, path: &str, expected: &str) -> Result<(PathBuf, Vec<u8>)> {
    let absolute = resolve(root, path, false)?;
    let bytes = read_limited(&absolute, DOCUMENT_LIMIT)?;
    if baseline(&bytes) != expected {
        return Err(Error::new("CONFLICT", "ディスクの内容が変更されています。"));
    }
    Ok((absolute, bytes))
}
pub fn save(root: &Path, path: &str, text: &str, expected: &str) -> Result<Saved> {
    let (absolute, before) = check_baseline(root, path, expected)?;
    if image_extension(&absolute) {
        return Err(Error::new("UNSUPPORTED", "画像は保存できません。"));
    }
    if readonly(&absolute)? {
        return Err(Error::new("PERMISSION", "読み取り専用ファイルです。"));
    }
    let (_, format) = decode(&before)?;
    let bytes = encode(text, &format)?;
    if bytes == before {
        return Ok(Saved {
            baseline: baseline(&bytes),
        });
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".nagori-save-")
        .tempfile_in(absolute.parent().unwrap())?;
    temporary
        .as_file()
        .set_permissions(fs::metadata(&absolute)?.permissions())?;
    temporary.write_all(&bytes)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    commit(root, path, expected, temporary)?;
    Ok(Saved {
        baseline: baseline(&bytes),
    })
}
fn commit(
    root: &Path,
    path: &str,
    expected: &str,
    temporary: tempfile::NamedTempFile,
) -> Result<()> {
    // Cooperative app writes are serialized; a final content check detects external changes during staging.
    // ponytail: external writers can still race this check; OS coordination if stronger guarantees are needed.
    let (checked, _) = check_baseline(root, path, expected)?;
    if readonly(&checked)? {
        return Err(Error::new("PERMISSION", "読み取り専用ファイルです。"));
    }
    temporary
        .persist(&checked)
        .map_err(|e| Error::from(e.error))?;
    Ok(())
}

pub(crate) fn create_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut temporary = tempfile::Builder::new()
        .prefix(".nagori-save-")
        .tempfile_in(path.parent().unwrap())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o644))?;
    }
    temporary.write_all(bytes)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(path)
        .map_err(|e| Error::from(e.error))?;
    Ok(())
}
pub fn save_as(root: &Path, source_path: &str, path: &str, text: &str) -> Result<OpenedDocument> {
    let target = resolve(root, path, true)?;
    if target == root {
        return Err(Error::new(
            "INVALID",
            "プロジェクトのルートは保存先にできません。",
        ));
    }
    valid_name(target.file_name().and_then(|n| n.to_str()).unwrap_or(""))?;
    // Markdownの別名保存はMarkdownのまま、テキストファイルは画像以外の名前へ保存する
    if markdown(Path::new(source_path)) && !markdown(&target) {
        return Err(Error::new(
            "UNSUPPORTED",
            "保存先には.mdまたは.markdownを使用してください。",
        ));
    }
    if image_extension(&target) {
        return Err(Error::new(
            "UNSUPPORTED",
            "画像の拡張子では保存できません。",
        ));
    }
    let source = match resolve(root, source_path, true) {
        Ok(source) => Some(source),
        Err(error) if error.code == "MISSING" => None,
        Err(error) => return Err(error),
    };
    // Rescue the current text even when the old file disappeared or became unreadable/invalid.
    let format = source
        .and_then(|source| read_limited(&source, DOCUMENT_LIMIT).ok())
        .and_then(|bytes| decode(&bytes).ok().map(|(_, format)| format))
        .unwrap_or(Format {
            bom: false,
            crlf: false,
        });
    let bytes = encode(text, &format)?;
    resolve(root, path, true)?;
    create_bytes(&target, &bytes)?;
    open(root, path)
}
pub fn create(root: &Path, path: &str, kind: &str) -> Result<Entry> {
    let absolute = resolve(root, path, true)?;
    if absolute == root {
        return Err(Error::new(
            "INVALID",
            "プロジェクトのルートは操作できません。",
        ));
    }
    valid_name(absolute.file_name().and_then(|n| n.to_str()).unwrap_or(""))?;
    match kind {
        "markdown" if markdown(&absolute) => create_bytes(&absolute, b"")?,
        "directory" => fs::create_dir(&absolute)?,
        _ => return Err(Error::new("INVALID", "種類または拡張子が不正です。")),
    }
    entry(root, &absolute)
}
// 同じボリューム内で、既存の項目を上書きせずに移す。別のボリュームの時はEXDEVを返す
#[cfg(target_os = "macos")]
pub fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let invalid = || io::Error::new(io::ErrorKind::InvalidInput, "不正なパスです。");
    let from = CString::new(from.as_os_str().as_bytes()).map_err(|_| invalid())?;
    let to = CString::new(to.as_os_str().as_bytes()).map_err(|_| invalid())?;
    // SAFETY: both C strings are valid and live through this synchronous syscall.
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(not(target_os = "macos"))]
pub fn rename_exclusive(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "名前変更は現在macOSのみ対応しています。",
    ))
}
pub fn rename(root: &Path, path: &str, new_name: &str) -> Result<Entry> {
    valid_name(new_name)?;
    let from = resolve(root, path, false)?;
    if from == root {
        return Err(Error::new(
            "INVALID",
            "プロジェクトのルートは操作できません。",
        ));
    }
    let to = from.parent().unwrap().join(new_name);
    if excluded(to.strip_prefix(root).unwrap()) {
        return Err(Error::new("EXCLUDED", "この名前は対象外です。"));
    }
    if from == to {
        return entry(root, &from);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(destination) = fs::symlink_metadata(&to) {
            let original = fs::symlink_metadata(&from)?;
            let case_only = from.file_name().unwrap().to_string_lossy().to_lowercase()
                == new_name.to_lowercase();
            if destination.file_type().is_symlink()
                || !case_only
                || destination.ino() != original.ino()
                || destination.dev() != original.dev()
            {
                return Err(Error::new("EXISTS", "同名の項目が存在します。"));
            }
            // Stage case-only renames so exclusive destination creation still holds on case-insensitive filesystems.
            let directory = tempfile::Builder::new()
                .prefix(".nagori-save-")
                .tempdir_in(from.parent().unwrap())?;
            let staged = directory.path().join("item");
            rename_exclusive(&from, &staged)?;
            if let Err(error) = rename_exclusive(&staged, &to).map_err(Error::from) {
                if let Err(rollback) = rename_exclusive(&staged, &from).map_err(Error::from) {
                    let retained = directory.keep();
                    return Err(Error::new(
                        "IO",
                        format!(
                            "名前変更と復元に失敗しました。元の項目は {} に残っています。{} / {}",
                            retained.join("item").display(),
                            error.message,
                            rollback.message
                        ),
                    ));
                }
                return Err(error);
            }
            return entry(root, &to);
        }
    }
    resolve(root, &relative(root, &to)?, true)?;
    rename_exclusive(&from, &to)?;
    entry(root, &to)
}
// 項目を別のフォルダへ移す。移動先に同じ名前があれば上書きせず、一番上へ移す時はto_directoryを空にする
pub fn move_entry(root: &Path, path: &str, to_directory: &str) -> Result<Entry> {
    let from = resolve(root, path, false)?;
    if from == root {
        return Err(Error::new(
            "INVALID",
            "プロジェクトのルートは操作できません。",
        ));
    }
    let directory = resolve(root, to_directory, false)?;
    if !fs::symlink_metadata(&directory)?.is_dir() {
        return Err(Error::new(
            "INVALID",
            "移動先はフォルダを指定してください。",
        ));
    }
    // 自分自身と、その下のフォルダへは移さない
    if directory.starts_with(&from) {
        return Err(Error::new(
            "INVALID",
            "自分自身や配下のフォルダへは移動できません。",
        ));
    }
    if from.parent() == Some(directory.as_path()) {
        return Err(Error::new("INVALID", "すでにその場所にあります。"));
    }
    let to = directory.join(from.file_name().unwrap());
    if excluded(to.strip_prefix(root).unwrap()) {
        return Err(Error::new("EXCLUDED", "この場所は対象外です。"));
    }
    resolve(root, &relative(root, &to)?, true)?;
    match fs::symlink_metadata(&to) {
        Ok(_) => return Err(Error::new("EXISTS", "移動先に同じ名前があります。")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    rename_exclusive(&from, &to)?;
    entry(root, &to)
}
#[cfg(test)]
#[path = "files/tests.rs"]
mod tests;
