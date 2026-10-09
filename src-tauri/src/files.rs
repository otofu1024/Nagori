use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const DOCUMENT_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const PIXEL_LIMIT: u64 = 16_000_000;

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
pub struct Image {
    pub data: Vec<u8>,
    format: image::ImageFormat,
}
#[derive(Serialize)]
pub struct InsertedImage {
    pub path: String,
    pub markdown: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub last_project: Option<String>,
    pub last_file: Option<String>,
    pub theme: String,
    pub font_size: u8,
    pub recent_files: Vec<String>,
    #[serde(
        deserialize_with = "deserialize_ranged::<_, 200, 420, 272>",
        serialize_with = "serialize_ranged::<_, 200, 420, 272>"
    )]
    pub sidebar_width: u16,
    #[serde(
        deserialize_with = "deserialize_ranged::<_, 180, 360, 220>",
        serialize_with = "serialize_ranged::<_, 180, 360, 220>"
    )]
    pub outline_width: u16,
    pub outline_visible: bool,
    pub focus_mode: bool,
    pub typewriter_mode: bool,
    // キーはワークスペースのルートの絶対パス、値はスターを付けた記事の相対パス
    pub starred: BTreeMap<String, Vec<String>>,
    // 設定画面の項目。範囲外の値は保存時に拒否せず、読み込み時に初期値へ戻す
    #[serde(deserialize_with = "deserialize_ranged::<_, 560, 1000, 720>")]
    pub editor_width: u16,
    #[serde(deserialize_with = "deserialize_line_height")]
    pub line_height: f64,
    #[serde(deserialize_with = "deserialize_font_family")]
    pub font_family: String,
    #[serde(deserialize_with = "deserialize_ranged::<_, 300, 5000, 500>")]
    pub autosave_delay: u16,
    pub start_in_preview: bool,
    pub heading_rule: bool,
    #[serde(deserialize_with = "deserialize_ranged::<_, 10, 50, 30>")]
    pub recent_edited_count: u16,
    // nullは無期限。7・14・30・60・90以外の値は30日へ直す
    #[serde(deserialize_with = "deserialize_retention")]
    pub trash_retention_days: Option<u16>,
    // 拡大縮小のショートカットとピンチで文字サイズを変える。古い設定はオフで読む
    pub zoom_font_size: bool,
    // キーはワークスペース基準の相対パス、値は最後にNagoriで開いた時刻（Unixのミリ秒）
    #[serde(deserialize_with = "deserialize_recent_opened")]
    pub recent_opened_at: BTreeMap<String, u64>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            last_project: None,
            last_file: None,
            theme: "system".into(),
            font_size: 19,
            recent_files: vec![],
            sidebar_width: 272,
            outline_width: 220,
            outline_visible: true,
            focus_mode: false,
            typewriter_mode: false,
            starred: BTreeMap::new(),
            editor_width: 720,
            line_height: 1.9,
            font_family: "sans".into(),
            autosave_delay: 500,
            start_in_preview: false,
            heading_rule: true,
            recent_edited_count: 30,
            trash_retention_days: Some(30),
            zoom_font_size: false,
            recent_opened_at: BTreeMap::new(),
        }
    }
}

// 読み込みと保存の両方で、範囲外の幅を初期値へ戻す。
fn deserialize_ranged<
    'de,
    D: serde::Deserializer<'de>,
    const MIN: u16,
    const MAX: u16,
    const INITIAL: u16,
>(
    deserializer: D,
) -> std::result::Result<u16, D::Error> {
    let width = f64::deserialize(deserializer)?;
    Ok(
        if width.is_finite() && width >= MIN as f64 && width <= MAX as f64 {
            width.round() as u16
        } else {
            INITIAL
        },
    )
}

fn serialize_ranged<
    S: serde::Serializer,
    const MIN: u16,
    const MAX: u16,
    const INITIAL: u16,
>(
    width: &u16,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    serializer.serialize_u16(if (MIN..=MAX).contains(width) {
        *width
    } else {
        INITIAL
    })
}
// 行間は1.4〜2.4の範囲だけを受け付け、範囲外は初期値の1.9へ戻す
fn deserialize_line_height<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<f64, D::Error> {
    let height = f64::deserialize(deserializer)?;
    Ok(if height.is_finite() && (1.4..=2.4).contains(&height) {
        height
    } else {
        1.9
    })
}

// 字体は sans と serif だけを受け付け、それ以外は sans へ戻す
fn deserialize_font_family<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<String, D::Error> {
    let family = String::deserialize(deserializer)?;
    Ok(match family.as_str() {
        "serif" => family,
        _ => "sans".into(),
    })
}

// 保存期限はnull（無期限）か選べる日数だけを受け付け、それ以外は30日へ戻す
fn deserialize_retention<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<u16>, D::Error> {
    let days = Option::<f64>::deserialize(deserializer)?;
    Ok(match days {
        None => None,
        Some(days) if [7.0, 14.0, 30.0, 60.0, 90.0].contains(&days) => Some(days as u16),
        Some(_) => Some(30),
    })
}

// 最近開いた時刻は、時刻が数でない項目を捨て、上限を超えたら古いものから捨てる
const RECENT_OPENED_LIMIT: usize = 200;
fn deserialize_recent_opened<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, u64>, D::Error> {
    let entries = BTreeMap::<String, serde_json::Value>::deserialize(deserializer)?;
    let mut opened: Vec<(String, u64)> = entries
        .into_iter()
        .filter_map(|(path, time)| {
            let time = time.as_f64().filter(|time| time.is_finite() && *time >= 0.0)?;
            Some((path, time as u64))
        })
        .collect();
    opened.sort_by_key(|(_, time)| std::cmp::Reverse(*time));
    opened.truncate(RECENT_OPENED_LIMIT);
    Ok(opened.into_iter().collect())
}

impl Settings {
    pub fn validate(&self) -> Result<()> {
        if !["system", "light", "dark"].contains(&self.theme.as_str())
            || !(12..=32).contains(&self.font_size)
            || self.recent_files.len() > 100
            || self.starred.len() > 100
            || self.starred.iter().any(|(root, paths)| {
                root.is_empty()
                    || paths.len() > 1000
                    || paths.iter().any(|path| path.is_empty())
            })
        {
            return Err(Error::new("INVALID", "設定値が範囲外です。"));
        }
        Ok(())
    }
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
pub fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>> {
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
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(Error::new("LIMIT", "ファイルサイズが上限を超えています。"));
    }
    Ok(bytes)
}
fn markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    )
}
fn image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp")
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
    let mut result = vec![];
    let mut pending = vec![String::new()];
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
fn readonly(path: &Path) -> Result<bool> {
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

fn create_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
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
pub fn read_image(path: &Path) -> Result<Image> {
    if !image_extension(path) {
        return Err(Error::new(
            "UNSUPPORTED",
            "PNG、JPEG、GIF、WebPのみ対応しています。",
        ));
    }
    image_from_bytes(read_limited(path, IMAGE_LIMIT)?)
}
// 画像のバイト列について、対応形式と寸法の上限を確かめる
fn image_from_bytes(data: Vec<u8>) -> Result<Image> {
    let format = image::guess_format(&data).map_err(|e| Error::new("IMAGE", e.to_string()))?;
    if !matches!(
        format,
        image::ImageFormat::Png
            | image::ImageFormat::Jpeg
            | image::ImageFormat::Gif
            | image::ImageFormat::WebP
    ) {
        return Err(Error::new("UNSUPPORTED", "非対応の画像形式です。"));
    }
    // 表示ではWebViewがデコードするため、ここでは形式と寸法だけを確かめる
    let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(&data), format)
        .into_dimensions()
        .map_err(|e| Error::new("IMAGE", e.to_string()))?;
    if width == 0 || height == 0 || width as u64 * height as u64 > PIXEL_LIMIT {
        return Err(Error::new("LIMIT", "画像の上限は1,600万画素です。"));
    }
    Ok(Image { data, format })
}
// 取り込む画像だけは最後までデコードし、破損したファイルをプロジェクトへ複製しない
fn verify_image(image: &Image) -> Result<()> {
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(&image.data), image.format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| Error::new("IMAGE", e.to_string()))?;
    Ok(())
}
pub fn image_path(root: &Path, path: &str, document_path: Option<&str>) -> Result<PathBuf> {
    let input = if let Some(document_path) = document_path {
        let document = resolve(root, document_path, false)?;
        if Path::new(path).is_absolute() {
            return Err(Error::new(
                "OUTSIDE",
                "画像はプロジェクト内の相対パスを指定してください。",
            ));
        }
        relative(root, &document.parent().unwrap().join(path))?
    } else {
        path.into()
    };
    resolve(root, &input, false)
}
// 画像を取り込む先が、編集できるMarkdownかを確かめる
fn writable_document(root: &Path, document_path: &str) -> Result<PathBuf> {
    let document = resolve(root, document_path, false)?;
    if !markdown(&document) || readonly(&document)? {
        return Err(Error::new(
            "PERMISSION",
            "編集可能なMarkdownを開いてください。",
        ));
    }
    Ok(document)
}
// 記事と同じフォルダのassetsへ、既存のファイルを上書きしない名前で画像を保存し、相対パスの記法を返す
fn store_image(
    root: &Path,
    document: &Path,
    stem: &str,
    extension: &str,
    image: &Image,
) -> Result<InsertedImage> {
    valid_name(&format!("{stem}.{extension}"))?;
    let assets = document.parent().unwrap().join("assets");
    let assets_relative = relative(root, &assets)?;
    resolve(root, &assets_relative, true)?;
    match fs::create_dir(&assets) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.into()),
    }
    resolve(root, &assets_relative, false)?;
    for number in 0..10_000 {
        let name = if number == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{number}.{extension}")
        };
        let destination = assets.join(&name);
        resolve(root, &relative(root, &destination)?, true)?;
        match create_bytes(&destination, &image.data) {
            Ok(_) => {
                let escaped: String = format!("assets/{name}")
                    .bytes()
                    .map(|byte| {
                        if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
                            (byte as char).to_string()
                        } else {
                            format!("%{byte:02X}")
                        }
                    })
                    .collect();
                return Ok(InsertedImage {
                    path: relative(root, &destination)?,
                    markdown: format!("![](<{escaped}>)"),
                });
            }
            Err(error) if error.code == "EXISTS" => continue,
            Err(error) => return Err(error),
        }
    }
    Err(Error::new("EXISTS", "画像名の空きが見つかりません。"))
}
pub fn insert_image(root: &Path, source_path: &str, document_path: &str) -> Result<InsertedImage> {
    let document = writable_document(root, document_path)?;
    let source = Path::new(source_path);
    if !source.is_absolute() {
        return Err(Error::new(
            "INVALID",
            "ファイル選択された画像の絶対パスを指定してください。",
        ));
    }
    // Reject symlink components of an explicitly selected external image as well.
    let mut traversed = PathBuf::new();
    for component in source.components() {
        traversed.push(component.as_os_str());
        if fs::symlink_metadata(&traversed)?.file_type().is_symlink() {
            return Err(Error::new(
                "SYMLINK",
                "シンボリックリンク経由の画像は取り込めません。",
            ));
        }
    }
    let image = read_image(source)?;
    verify_image(&image)?;
    let stem = source
        .file_stem()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::new("INVALID", "画像名をUTF-8で表現できません。"))?;
    let extension = source
        .extension()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::new("INVALID", "画像名をUTF-8で表現できません。"))?;
    store_image(root, &document, stem, extension, &image)
}
// クリップボードから貼り付けた画像を、記事と同じフォルダのassetsへ保存する
pub fn paste_image(root: &Path, document_path: &str, data: Vec<u8>) -> Result<InsertedImage> {
    let document = writable_document(root, document_path)?;
    if data.len() > IMAGE_LIMIT {
        return Err(Error::new(
            "LIMIT",
            format!("画像の上限は{}MiBです。", IMAGE_LIMIT / 1024 / 1024),
        ));
    }
    let image = image_from_bytes(data)?;
    verify_image(&image)?;
    let extension = match image.format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::Gif => "gif",
        _ => "webp",
    };
    store_image(root, &document, "pasted-image", extension, &image)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_defaults_and_resolved_theme_roundtrip() {
        let defaults = Settings::default();
        assert_eq!(defaults.theme, "system");
        assert_eq!(defaults.font_size, 19);
        for theme in ["light", "dark"] {
            let settings = Settings {
                theme: theme.into(),
                last_project: Some("/fixture/project".into()),
                last_file: Some("posts/note.md".into()),
                recent_files: vec!["posts/note.md".into(), "other.md".into()],
                font_size: 17,
                ..defaults.clone()
            };
            settings.validate().unwrap();
            let stored = serde_json::to_vec(&settings).unwrap();
            let restored: Settings = serde_json::from_slice(&stored).unwrap();
            assert_eq!(restored.theme, theme);
            assert_eq!(restored.font_size, 17);
            assert_eq!(restored.last_project, settings.last_project);
            assert_eq!(restored.last_file, settings.last_file);
            assert_eq!(restored.recent_files, settings.recent_files);
        }
        let old: Settings = serde_json::from_str(r#"{"theme":"system","fontSize":17}"#).unwrap();
        old.validate().unwrap();
        assert_eq!(old.font_size, 17);
        assert_eq!(old.sidebar_width, 272);
        assert_eq!(old.outline_width, 220);
        // 以前の版が書いた未知の項目は無視して読み込める
        let legacy: Settings =
            serde_json::from_str(r#"{"theme":"dark","appearanceVersion":1}"#).unwrap();
        assert_eq!(legacy.theme, "dark");
    }

    #[test]
    fn settings_writing_modes_default_roundtrip_and_type_check() {
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(!old.focus_mode && !old.typewriter_mode);
        for focus in [true, false] {
            for typewriter in [true, false] {
                let settings: Settings = serde_json::from_str(&format!(
                    r#"{{"focusMode":{focus},"typewriterMode":{typewriter}}}"#
                ))
                .unwrap();
                settings.validate().unwrap();
                let restored: Settings =
                    serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
                assert_eq!(restored.focus_mode, focus);
                assert_eq!(restored.typewriter_mode, typewriter);
            }
        }
        for key in ["focusMode", "typewriterMode"] {
            for value in ["null", "0", "1", r#""false""#, "[]", "{}"] {
                assert!(serde_json::from_str::<Settings>(&format!(r#"{{"{key}":{value}}}"#)).is_err());
            }
        }
    }

    #[test]
    fn settings_outline_visibility_defaults_roundtrip_and_type_check() {
        assert!(Settings::default().outline_visible);
        let old: Settings = serde_json::from_str(r#"{"theme":"dark","fontSize":17}"#).unwrap();
        assert!(old.outline_visible);
        assert_eq!(old.theme, "dark");
        assert_eq!(old.font_size, 17);
        for visible in [true, false] {
            let settings: Settings =
                serde_json::from_str(&format!(r#"{{"outlineVisible":{visible}}}"#)).unwrap();
            settings.validate().unwrap();
            assert_eq!(settings.outline_visible, visible);
            let stored = serde_json::to_vec(&settings).unwrap();
            let restored: Settings = serde_json::from_slice(&stored).unwrap();
            assert_eq!(restored.outline_visible, visible);
        }
        for value in ["null", "0", "1", r#""false""#, "[]", "{}"] {
            assert!(
                serde_json::from_str::<Settings>(&format!(r#"{{"outlineVisible":{value}}}"#))
                    .is_err()
            );
        }
    }

    #[test]
    fn settings_pane_widths_validate_on_read_and_write() {
        for (sidebar, outline) in [(200, 180), (272, 220), (420, 360)] {
            let stored = format!(r#"{{"sidebarWidth":{sidebar},"outlineWidth":{outline}}}"#);
            let settings: Settings = serde_json::from_str(&stored).unwrap();
            settings.validate().unwrap();
            assert_eq!(settings.sidebar_width, sidebar);
            assert_eq!(settings.outline_width, outline);
            let restored: Settings =
                serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
            assert_eq!(restored.sidebar_width, sidebar);
            assert_eq!(restored.outline_width, outline);
        }
        for value in [-1, 0, 179, 421, 65536] {
            let settings: Settings = serde_json::from_str(&format!(
                r#"{{"sidebarWidth":{value},"outlineWidth":{value},"theme":"dark","fontSize":17}}"#
            ))
            .unwrap();
            assert_eq!(settings.sidebar_width, 272);
            assert_eq!(settings.outline_width, 220);
            assert_eq!(settings.theme, "dark");
            assert_eq!(settings.font_size, 17);
        }
        for (sidebar, outline) in [(199, 179), (421, 361)] {
            let settings = Settings {
                sidebar_width: sidebar,
                outline_width: outline,
                ..Settings::default()
            };
            let restored: Settings =
                serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
            assert_eq!(restored.sidebar_width, 272);
            assert_eq!(restored.outline_width, 220);
        }
    }

    #[test]
    fn settings_starred_defaults_roundtrip_and_validate() {
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(old.starred.is_empty());
        old.validate().unwrap();
        let stored: Settings = serde_json::from_str(
            r#"{"starred":{"/Users/me/notes":["a.md","posts/b.md"],"/Users/me/other":[]}}"#,
        )
        .unwrap();
        stored.validate().unwrap();
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&stored).unwrap()).unwrap();
        assert_eq!(restored.starred, stored.starred);
        assert_eq!(restored.starred["/Users/me/notes"], ["a.md", "posts/b.md"]);
        // 型が違う、または件数や空の値が上限を超える設定は拒否する
        for value in [r#""a.md""#, "[]", r#"{"/x":"a.md"}"#, r#"{"/x":[1]}"#] {
            assert!(serde_json::from_str::<Settings>(&format!(r#"{{"starred":{value}}}"#)).is_err());
        }
        let many_paths = Settings {
            starred: BTreeMap::from([("/x".to_owned(), vec!["a.md".to_owned(); 1001])]),
            ..Settings::default()
        };
        assert!(many_paths.validate().is_err());
        let many_roots = Settings {
            starred: (0..101).map(|i| (format!("/root/{i}"), vec![])).collect(),
            ..Settings::default()
        };
        assert!(many_roots.validate().is_err());
        let empty_path = Settings {
            starred: BTreeMap::from([("/x".to_owned(), vec![String::new()])]),
            ..Settings::default()
        };
        assert!(empty_path.validate().is_err());
    }

    #[test]
    fn settings_panel_fields_default_and_read_back_in_range() {
        let defaults = Settings::default();
        assert_eq!(defaults.editor_width, 720);
        assert_eq!(defaults.line_height, 1.9);
        assert_eq!(defaults.font_family, "sans");
        assert_eq!(defaults.autosave_delay, 500);
        assert!(!defaults.start_in_preview);
        assert!(defaults.heading_rule);
        assert_eq!(defaults.recent_edited_count, 30);
        assert_eq!(defaults.trash_retention_days, Some(30));
        assert!(!defaults.zoom_font_size);
        assert!(defaults.recent_opened_at.is_empty());
        // 項目のない古い設定は初期値で読む
        let old: Settings = serde_json::from_str(r#"{"theme":"dark","fontSize":17}"#).unwrap();
        assert_eq!(old.editor_width, 720);
        assert_eq!(old.trash_retention_days, Some(30));
        assert!(!old.zoom_font_size);
        assert!(old.heading_rule && !old.start_in_preview);
        assert!(old.recent_opened_at.is_empty());
        // 範囲内の値は保存して読み直しても同じ
        let stored = r#"{"editorWidth":900,"lineHeight":2.2,"fontFamily":"serif","autosaveDelay":1200,"startInPreview":true,"headingRule":false,"recentEditedCount":45,"trashRetentionDays":90,"recentOpenedAt":{"posts/a.md":1700000000000}}"#;
        let settings: Settings = serde_json::from_str(stored).unwrap();
        settings.validate().unwrap();
        assert_eq!(settings.editor_width, 900);
        assert_eq!(settings.line_height, 2.2);
        assert_eq!(settings.font_family, "serif");
        assert_eq!(settings.autosave_delay, 1200);
        assert!(settings.start_in_preview && !settings.heading_rule);
        assert_eq!(settings.recent_edited_count, 45);
        assert_eq!(settings.trash_retention_days, Some(90));
        assert_eq!(settings.recent_opened_at["posts/a.md"], 1700000000000);
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restored.editor_width, 900);
        assert_eq!(restored.line_height, 2.2);
        assert_eq!(restored.font_family, "serif");
        assert_eq!(restored.trash_retention_days, Some(90));
        assert_eq!(restored.recent_opened_at, settings.recent_opened_at);
        let zoom: Settings = serde_json::from_str(r#"{"zoomFontSize":true}"#).unwrap();
        assert!(zoom.zoom_font_size);
        let saved = serde_json::to_value(&zoom).unwrap();
        assert_eq!(saved["zoomFontSize"], true);
        // 範囲の両端は受け付ける
        for (width, height, delay, edited) in [(560, 1.4, 300, 10), (1000, 2.4, 5000, 50)] {
            let settings: Settings = serde_json::from_str(&format!(
                r#"{{"editorWidth":{width},"lineHeight":{height},"autosaveDelay":{delay},"recentEditedCount":{edited}}}"#
            ))
            .unwrap();
            assert_eq!(settings.editor_width, width);
            assert_eq!(settings.line_height, height);
            assert_eq!(settings.autosave_delay, delay);
            assert_eq!(settings.recent_edited_count, edited);
        }
        // 範囲外の数値は初期値へ戻す
        for (key, value, initial) in [
            ("editorWidth", "559", 720.0),
            ("editorWidth", "1001", 720.0),
            ("lineHeight", "1.39", 1.9),
            ("lineHeight", "2.41", 1.9),
            ("autosaveDelay", "299", 500.0),
            ("autosaveDelay", "5001", 500.0),
            ("recentEditedCount", "9", 30.0),
            ("recentEditedCount", "51", 30.0),
        ] {
            let settings: Settings = serde_json::from_str(&format!(r#"{{"{key}":{value}}}"#)).unwrap();
            let actual = match key {
                "editorWidth" => settings.editor_width as f64,
                "lineHeight" => settings.line_height,
                "autosaveDelay" => settings.autosave_delay as f64,
                _ => settings.recent_edited_count as f64,
            };
            assert_eq!(actual, initial, "{key}={value}");
        }
        // 字体は sans と serif 以外を sans へ戻す
        let settings: Settings = serde_json::from_str(r#"{"fontFamily":"mono"}"#).unwrap();
        assert_eq!(settings.font_family, "sans");
        // 保存期限は null（無期限）と選べる日数を残し、それ以外は30日へ戻す
        for days in [7, 14, 30, 60, 90] {
            let settings: Settings =
                serde_json::from_str(&format!(r#"{{"trashRetentionDays":{days}}}"#)).unwrap();
            assert_eq!(settings.trash_retention_days, Some(days));
        }
        let forever: Settings = serde_json::from_str(r#"{"trashRetentionDays":null}"#).unwrap();
        assert_eq!(forever.trash_retention_days, None);
        for days in ["0", "1", "45", "365", "-7", "7.5"] {
            let settings: Settings =
                serde_json::from_str(&format!(r#"{{"trashRetentionDays":{days}}}"#)).unwrap();
            assert_eq!(settings.trash_retention_days, Some(30), "{days}");
        }
        // 型が違う値は読み込みを失敗させる
        for (key, value) in [("startInPreview", "1"), ("headingRule", r#""true""#), ("editorWidth", "null")] {
            assert!(serde_json::from_str::<Settings>(&format!(r#"{{"{key}":{value}}}"#)).is_err());
        }
    }

    #[test]
    fn recent_opened_times_drop_bad_entries_and_keep_the_newest_200() {
        // 時刻が数でない項目は捨て、残りはそのまま読む
        let settings: Settings = serde_json::from_str(
            r#"{"recentOpenedAt":{"a.md":1000,"b.md":"2026","c.md":null,"d.md":-5,"e.md":2000.0}}"#,
        )
        .unwrap();
        assert_eq!(
            settings.recent_opened_at,
            BTreeMap::from([("a.md".to_owned(), 1000), ("e.md".to_owned(), 2000)])
        );
        // 上限を超えたら、古いものから捨てる
        let entries: Vec<String> = (0..205)
            .map(|i| format!(r#""n{i:03}.md":{}"#, 1_000 + i))
            .collect();
        let settings: Settings =
            serde_json::from_str(&format!(r#"{{"recentOpenedAt":{{{}}}}}"#, entries.join(","))).unwrap();
        assert_eq!(settings.recent_opened_at.len(), 200);
        assert!(!settings.recent_opened_at.contains_key("n000.md"));
        assert!(!settings.recent_opened_at.contains_key("n004.md"));
        assert_eq!(settings.recent_opened_at["n005.md"], 1_005);
        assert_eq!(settings.recent_opened_at["n204.md"], 1_204);
        // 配列など、対応しない型は読み込みを失敗させる
        assert!(serde_json::from_str::<Settings>(r#"{"recentOpenedAt":[]}"#).is_err());
    }

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
        assert!(entry(root, &root.join("folder")).unwrap().modified.is_none());
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
            fs::set_permissions(root.join("rescued.md"), fs::Permissions::from_mode(0o444))
                .unwrap();
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
            fs::set_permissions(root.join("rescued.md"), fs::Permissions::from_mode(0o644))
                .unwrap();
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
        assert!(
            names.contains(&"config.json".to_string()) && names.contains(&"Makefile".to_string())
        );
    }
    #[test]
    fn pasted_images_are_stored_in_assets_without_clobber() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::create_dir(root.join("posts")).unwrap();
        create(root, "posts/article.md", "markdown").unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::RgbaImage::new(2, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        let first = paste_image(root, "posts/article.md", png.clone()).unwrap();
        assert_eq!(first.path, "posts/assets/pasted-image.png");
        assert_eq!(first.markdown, "![](<assets/pasted-image.png>)");
        assert_eq!(fs::read(root.join(&first.path)).unwrap(), png);
        let second = paste_image(root, "posts/article.md", png.clone()).unwrap();
        assert_eq!(second.path, "posts/assets/pasted-image-1.png");
        assert_eq!(fs::read(root.join(&first.path)).unwrap(), png);
        let mut jpeg = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(1, 1)
            .write_to(&mut jpeg, image::ImageFormat::Jpeg)
            .unwrap();
        assert_eq!(
            paste_image(root, "posts/article.md", jpeg.into_inner())
                .unwrap()
                .path,
            "posts/assets/pasted-image.jpg"
        );
        let code = |result: Result<InsertedImage>| result.err().map(|e| e.code);
        assert_eq!(
            code(paste_image(
                root,
                "posts/article.md",
                png[..png.len() / 2].to_vec()
            )),
            Some("IMAGE")
        );
        assert_eq!(
            code(paste_image(
                root,
                "posts/article.md",
                b"not an image".to_vec()
            )),
            Some("IMAGE")
        );
        assert_eq!(
            code(paste_image(
                root,
                "posts/article.md",
                vec![0; IMAGE_LIMIT + 1]
            )),
            Some("LIMIT")
        );
        fs::write(root.join("note.txt"), "text").unwrap();
        assert_eq!(
            code(paste_image(root, "note.txt", png.clone())),
            Some("PERMISSION")
        );
        assert_eq!(list(root, "posts/assets").unwrap().len(), 3);
    }
    #[test]
    fn images_validate_and_copy_without_clobber() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        create(root, "article.md", "markdown").unwrap();
        let external = tempfile::tempdir().unwrap();
        let source = external.path().join("画像 (1).png");
        image::RgbaImage::new(1, 1).save(&source).unwrap();
        let source = fs::canonicalize(&source).unwrap();
        let a = insert_image(root, source.to_str().unwrap(), "article.md").unwrap();
        let b = insert_image(root, source.to_str().unwrap(), "article.md").unwrap();
        assert_ne!(a.path, b.path);
        assert!(a.markdown.contains("%20%281%29"));
        assert!(read_image(&root.join(&a.path)).is_ok());
        assert_eq!(
            fs::read(&source).unwrap(),
            fs::read(root.join(a.path)).unwrap()
        );
        // 寸法までは読める途中切れの画像は、閲覧では通し、取り込みでは拒否する
        image::RgbaImage::from_fn(64, 64, |x, y| {
            image::Rgba([x as u8 * 4, y as u8 * 4, 0, 255])
        })
        .save(&source)
        .unwrap();
        let valid = fs::read(&source).unwrap();
        fs::write(&source, &valid[..valid.len() / 2]).unwrap();
        assert!(read_image(&source).is_ok());
        assert_eq!(
            insert_image(root, source.to_str().unwrap(), "article.md")
                .err()
                .map(|e| e.code),
            Some("IMAGE")
        );
        fs::write(&source, b"corrupt").unwrap();
        assert!(insert_image(root, source.to_str().unwrap(), "article.md").is_err());
        assert_eq!(list(root, "assets").unwrap().len(), 2);
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
        std::os::unix::fs::symlink(directory.path().join("outside-dir"), root.join("link"))
            .unwrap();
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
}
