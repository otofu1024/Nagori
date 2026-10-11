use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub const DOCUMENT_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const PIXEL_LIMIT: u64 = 16_000_000;
// 記事中の画像の表示用に、長い辺をこの長さまで縮める
#[cfg(target_os = "macos")]
const PREVIEW_EDGE: u32 = 1600;
// 表示用の画像のキャッシュは件数とバイト数の両方で上限を付ける
const PREVIEW_CACHE_COUNT: usize = 64;
const PREVIEW_CACHE_BYTES: usize = 64 * 1024 * 1024;

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
fn open_limited(path: &Path, limit: usize) -> Result<fs::File> {
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
fn read_file_limited(mut file: fs::File, limit: usize) -> Result<Vec<u8>> {
    io::Seek::rewind(&mut file)?;
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
    read_image_file(open_limited(path, IMAGE_LIMIT)?)
}
fn read_image_file(file: fs::File) -> Result<Image> {
    image_from_bytes(read_file_limited(file, IMAGE_LIMIT)?)
}
// 画像のバイト列について、対応形式と寸法の上限を確かめる
fn image_from_bytes(data: Vec<u8>) -> Result<Image> {
    let format = image::guess_format(&data).map_err(|e| Error::new("IMAGE", e.to_string()))?;
    validate_image(image::ImageReader::with_format(
        std::io::Cursor::new(&data),
        format,
    ))?;
    Ok(Image { data, format })
}
fn validate_image<R: io::BufRead + io::Seek>(reader: image::ImageReader<R>) -> Result<()> {
    let format = reader
        .format()
        .ok_or_else(|| Error::new("IMAGE", "画像の形式を判別できません。"))?;
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
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| Error::new("IMAGE", e.to_string()))?;
    if width == 0 || height == 0 || width as u64 * height as u64 > PIXEL_LIMIT {
        return Err(Error::new("LIMIT", "画像の上限は1,600万画素です。"));
    }
    Ok(())
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
// 表示用の画像を見分けるための鍵。外部で更新されると更新日時かサイズが変わり、作り直される
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewKey {
    path: PathBuf,
    modified: SystemTime,
    len: u64,
}
// 表示用の画像のキャッシュ。使われた順に並べ、件数かバイト数が上限を超えたら古いものから捨てる
#[derive(Default)]
pub struct PreviewCache {
    entries: Vec<(PreviewKey, Vec<u8>)>,
    bytes: usize,
}
impl PreviewCache {
    fn get(&mut self, key: &PreviewKey) -> Option<Vec<u8>> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        // 使われたものを末尾へ移し、捨てられにくくする
        let entry = self.entries.remove(index);
        let data = entry.1.clone();
        self.entries.push(entry);
        Some(data)
    }
    fn insert(&mut self, key: PreviewKey, data: Vec<u8>) {
        // 上限より大きいものは残さず、毎回作り直す
        if data.len() > PREVIEW_CACHE_BYTES {
            return;
        }
        if let Some(index) = self.entries.iter().position(|(k, _)| k == &key) {
            let (_, old) = self.entries.remove(index);
            self.bytes -= old.len();
        }
        self.bytes += data.len();
        self.entries.push((key, data));
        while self.entries.len() > PREVIEW_CACHE_COUNT || self.bytes > PREVIEW_CACHE_BYTES {
            let (_, old) = self.entries.remove(0);
            self.bytes -= old.len();
        }
    }
}
// 縮小は同時に1枚だけ行う。大きな画像を複数同時に展開すると、メモリが一気に増えるため
static PREVIEW_GATE: Mutex<()> = Mutex::new(());
#[cfg(test)]
static PREVIEW_RUNNING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
static PREVIEW_PEAK: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
// 表示用の元画像はファイルを開いたまま保持し、処理前の移動や差し替えで別のパスを読まない
pub struct PreviewSource {
    key: PreviewKey,
    file: fs::File,
}
impl PreviewSource {
    // ワークスペースのロックの中で行う。ファイルを開いて鍵とヘッダーを読み、重い処理はしない
    pub fn read(path: &Path) -> Result<Self> {
        if !image_extension(path) {
            return Err(Error::new(
                "UNSUPPORTED",
                "PNG、JPEG、GIF、WebPのみ対応しています。",
            ));
        }
        let mut file = open_limited(path, IMAGE_LIMIT)?;
        let metadata = file.metadata()?;
        let key = PreviewKey {
            path: path.to_path_buf(),
            modified: metadata.modified()?,
            len: metadata.len(),
        };
        let reader = image::ImageReader::new(io::BufReader::new(&mut file))
            .with_guessed_format()
            .map_err(|e| Error::new("IMAGE", e.to_string()))?;
        validate_image(reader)?;
        io::Seek::rewind(&mut file)?;
        Ok(Self { key, file })
    }
    // ワークスペースのロックの外で行う。キャッシュにあればそれを返し、なければ縮小して登録する
    pub fn preview(self, cache: &Mutex<PreviewCache>) -> Result<Vec<u8>> {
        let lock = || {
            cache
                .lock()
                .map_err(|_| Error::new("INTERNAL", "画像のキャッシュのロックに失敗しました。"))
        };
        if let Some(data) = lock()?.get(&self.key) {
            return Ok(data);
        }
        // 待っている間に別の呼び出しが同じ画像を作っていれば、その結果を使う
        let _gate = PREVIEW_GATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(data) = lock()?.get(&self.key) {
            return Ok(data);
        }
        #[cfg(test)]
        let running = PREVIEW_RUNNING.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        #[cfg(test)]
        PREVIEW_PEAK.fetch_max(running, std::sync::atomic::Ordering::SeqCst);
        let data = make_preview(self.file);
        #[cfg(test)]
        PREVIEW_RUNNING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        let data = data?;
        lock()?.insert(self.key, data.clone());
        Ok(data)
    }
}
// 長い辺が上限以下の画像と、アニメーションGIFは元のバイト列のまま返す
#[cfg(target_os = "macos")]
fn make_preview(file: fs::File) -> Result<Vec<u8>> {
    imageio::preview(file)
}
// macOS以外では縮小せず、元のバイト列を返す
#[cfg(not(target_os = "macos"))]
fn make_preview(file: fs::File) -> Result<Vec<u8>> {
    Ok(read_image_file(file)?.data)
}
// macOSのImageIOで縮小する。展開を元の解像度で行わず、CGImageSourceの縮小機能に任せるため、
// 大きな写真を開いてもメモリの使用量を抑えられる
#[cfg(target_os = "macos")]
#[allow(non_snake_case, non_upper_case_globals)]
mod imageio {
    use super::{read_image_file, Error, Result, IMAGE_LIMIT, PIXEL_LIMIT, PREVIEW_EDGE};
    use std::{ffi::c_void, fs::File, os::fd::AsRawFd, ptr};

    // フレームワークごとにextern "C"のブロックを分ける。1つのブロックに複数の#[link]を並べると、
    // リンク指定が重複したとclippyに指摘されるため
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: *const c_void;
        static kCFBooleanFalse: *const c_void;
        // コールバックはアドレスだけを渡すため、中身の型は問わない
        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;

        fn CFRelease(cf: *const c_void);
        fn CFEqual(first: *const c_void, second: *const c_void) -> bool;
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: *const c_void,
            bytes: *const u8,
            length: isize,
            is_directory: bool,
        ) -> *const c_void;
        fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *const c_void;
        fn CFDataGetLength(data: *const c_void) -> isize;
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
        fn CFStringCreateWithBytes(
            allocator: *const c_void,
            bytes: *const u8,
            length: isize,
            encoding: u32,
            is_external_representation: bool,
        ) -> *const c_void;
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFDictionaryGetValue(dictionary: *const c_void, key: *const c_void) -> *const c_void;
        fn CFNumberCreate(
            allocator: *const c_void,
            number_type: isize,
            value: *const c_void,
        ) -> *const c_void;
        fn CFNumberGetValue(number: *const c_void, number_type: isize, value: *mut c_void) -> bool;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGImageGetAlphaInfo(image: *const c_void) -> u32;
    }
    #[link(name = "ImageIO", kind = "framework")]
    unsafe extern "C" {
        static kCGImageSourceCreateThumbnailFromImageAlways: *const c_void;
        static kCGImageSourceCreateThumbnailWithTransform: *const c_void;
        static kCGImageSourceShouldCacheImmediately: *const c_void;
        static kCGImageSourceThumbnailMaxPixelSize: *const c_void;
        static kCGImagePropertyPixelWidth: *const c_void;
        static kCGImagePropertyPixelHeight: *const c_void;
        static kCGImageDestinationLossyCompressionQuality: *const c_void;

        fn CGImageSourceCreateWithURL(url: *const c_void, options: *const c_void) -> *const c_void;
        fn CGImageSourceGetType(source: *const c_void) -> *const c_void;
        fn CGImageSourceGetCount(source: *const c_void) -> usize;
        fn CGImageSourceCopyPropertiesAtIndex(
            source: *const c_void,
            index: usize,
            options: *const c_void,
        ) -> *const c_void;
        fn CGImageSourceCreateThumbnailAtIndex(
            source: *const c_void,
            index: usize,
            options: *const c_void,
        ) -> *const c_void;
        fn CGImageDestinationCreateWithData(
            data: *const c_void,
            uti: *const c_void,
            count: usize,
            options: *const c_void,
        ) -> *const c_void;
        fn CGImageDestinationAddImage(
            destination: *const c_void,
            image: *const c_void,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(destination: *const c_void) -> bool;
    }

    // CFNumberTypeとCFStringEncodingの値。ヘッダーで定められた定数
    const CF_NUMBER_SINT32: isize = 3;
    const CF_NUMBER_SINT64: isize = 4;
    const CF_NUMBER_FLOAT64: isize = 6;
    const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    // 所有権を持つCF参照。Dropで解放するため、途中で失敗しても参照は漏れない
    struct Cf(*const c_void);
    impl Drop for Cf {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) }
        }
    }

    fn failed() -> Error {
        Error::new("IMAGE", "画像を縮小できませんでした。")
    }
    // Create/Copyで得た参照を受け取る。nullなら失敗として扱う
    fn owned(ptr: *const c_void) -> Result<Cf> {
        if ptr.is_null() {
            return Err(failed());
        }
        Ok(Cf(ptr))
    }
    fn string(text: &str) -> Result<Cf> {
        owned(unsafe {
            CFStringCreateWithBytes(
                ptr::null(),
                text.as_ptr(),
                text.len() as isize,
                CF_STRING_ENCODING_UTF8,
                false,
            )
        })
    }
    fn number<T>(number_type: isize, value: &T) -> Result<Cf> {
        owned(unsafe { CFNumberCreate(ptr::null(), number_type, (value as *const T).cast()) })
    }
    fn dictionary(pairs: &[(*const c_void, *const c_void)]) -> Result<Cf> {
        let keys: Vec<*const c_void> = pairs.iter().map(|&(key, _)| key).collect();
        let values: Vec<*const c_void> = pairs.iter().map(|&(_, value)| value).collect();
        owned(unsafe {
            CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                pairs.len() as isize,
                ptr::addr_of!(kCFTypeDictionaryKeyCallBacks).cast(),
                ptr::addr_of!(kCFTypeDictionaryValueCallBacks).cast(),
            )
        })
    }
    // 展開せずにプロパティから整数の値を読む。値がなければNone
    fn property(properties: &Cf, key: *const c_void) -> Option<i64> {
        let value = unsafe { CFDictionaryGetValue(properties.0, key) };
        if value.is_null() {
            return None;
        }
        let mut out: i64 = 0;
        let ok =
            unsafe { CFNumberGetValue(value, CF_NUMBER_SINT64, (&mut out as *mut i64).cast()) };
        ok.then_some(out)
    }

    // 長い辺がPREVIEW_EDGEを超える画像だけを縮小し、そのほかは元のバイト列のまま返す
    pub fn preview(file: File) -> Result<Vec<u8>> {
        // 待っている間の書き換えも考慮し、実際にImageIOが読むサイズと形式・寸法を確かめる
        if file.metadata()?.len() > IMAGE_LIMIT as u64 {
            return Err(Error::new("LIMIT", "ファイルサイズが上限を超えています。"));
        }
        // 検証済みのファイル記述子を使い、元画像をVecとCFDataへ丸ごとコピーしない
        let path = format!("/dev/fd/{}", file.as_raw_fd());
        let url = owned(unsafe {
            CFURLCreateFromFileSystemRepresentation(
                ptr::null(),
                path.as_ptr(),
                path.len() as isize,
                false,
            )
        })?;
        let source = owned(unsafe { CGImageSourceCreateWithURL(url.0, ptr::null()) })?;
        let source_type = unsafe { CGImageSourceGetType(source.0) };
        if source_type.is_null() {
            return Err(failed());
        }
        let mut supported = false;
        for format in [
            "public.png",
            "public.jpeg",
            "com.compuserve.gif",
            "org.webmproject.webp",
        ] {
            let format = string(format)?;
            supported |= unsafe { CFEqual(source_type, format.0) };
        }
        if !supported {
            return Err(Error::new("UNSUPPORTED", "非対応の画像形式です。"));
        }
        // 2枚以上のフレームがあるアニメーションは、1枚にすると動かなくなるため元のまま返す
        if unsafe { CGImageSourceGetCount(source.0) } > 1 {
            return Ok(read_image_file(file)?.data);
        }
        let properties =
            owned(unsafe { CGImageSourceCopyPropertiesAtIndex(source.0, 0, ptr::null()) })?;
        let (width_key, height_key) =
            unsafe { (kCGImagePropertyPixelWidth, kCGImagePropertyPixelHeight) };
        let (Some(width), Some(height)) = (
            property(&properties, width_key),
            property(&properties, height_key),
        ) else {
            return Err(failed());
        };
        if width <= 0
            || height <= 0
            || width
                .checked_mul(height)
                .is_none_or(|pixels| pixels > PIXEL_LIMIT as i64)
        {
            return Err(Error::new("LIMIT", "画像の上限は1,600万画素です。"));
        }
        if width.max(height) <= i64::from(PREVIEW_EDGE) {
            return Ok(read_image_file(file)?.data);
        }

        // EXIFの向きを反映し、長い辺をPREVIEW_EDGEにした画像を作る。展開は縮小した大きさだけ
        let max_size = number(CF_NUMBER_SINT32, &(PREVIEW_EDGE as i32))?;
        let thumbnail_options = dictionary(unsafe {
            &[
                (kCGImageSourceCreateThumbnailFromImageAlways, kCFBooleanTrue),
                (kCGImageSourceThumbnailMaxPixelSize, max_size.0),
                (kCGImageSourceCreateThumbnailWithTransform, kCFBooleanTrue),
                (kCGImageSourceShouldCacheImmediately, kCFBooleanFalse),
            ]
        })?;
        let thumbnail = owned(unsafe {
            CGImageSourceCreateThumbnailAtIndex(source.0, 0, thumbnail_options.0)
        })?;

        // 透過のない画像はJPEG、透過のある画像は透過を残すためPNGにする。
        // CGImageAlphaInfoのうち、アルファ成分を持つ値は1から4と7(Onlyのみ)
        let has_alpha = matches!(unsafe { CGImageGetAlphaInfo(thumbnail.0) }, 1..=4 | 7);
        let (uti, encode_options) = if has_alpha {
            ("public.png", None)
        } else {
            let quality = number(CF_NUMBER_FLOAT64, &0.8_f64)?;
            let options =
                dictionary(unsafe { &[(kCGImageDestinationLossyCompressionQuality, quality.0)] })?;
            ("public.jpeg", Some(options))
        };
        let uti = string(uti)?;
        let out = owned(unsafe { CFDataCreateMutable(ptr::null(), 0) })?;
        let destination =
            owned(unsafe { CGImageDestinationCreateWithData(out.0, uti.0, 1, ptr::null()) })?;
        let encode_options = encode_options
            .as_ref()
            .map_or(ptr::null(), |options| options.0);
        unsafe { CGImageDestinationAddImage(destination.0, thumbnail.0, encode_options) };
        if !unsafe { CGImageDestinationFinalize(destination.0) } {
            return Err(failed());
        }
        let length = unsafe { CFDataGetLength(out.0) } as usize;
        if length == 0 {
            return Err(failed());
        }
        let encoded = unsafe { std::slice::from_raw_parts(CFDataGetBytePtr(out.0), length) };
        Ok(encoded.to_vec())
    }
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
    // 読み込みと縮小をまとめて行う(実際にはワークスペースのロックの中と外に分かれる)
    fn preview_of(path: &Path, cache: &Mutex<PreviewCache>) -> Result<Vec<u8>> {
        PreviewSource::read(path)?.preview(cache)
    }
    #[cfg(unix)]
    #[test]
    fn preview_keeps_the_open_file_when_its_path_is_replaced() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("original.png");
        image::RgbImage::from_pixel(16, 16, image::Rgb([255, 0, 0]))
            .save(&path)
            .unwrap();
        let original = fs::read(&path).unwrap();
        let source = PreviewSource::read(&path).unwrap();
        let moved = directory.path().join("moved.png");
        fs::rename(&path, &moved).unwrap();
        // ロックの外でパスがリンクに差し替わっても、検証済みの元画像だけを読む
        std::os::unix::fs::symlink("missing.png", &path).unwrap();
        let cache = Mutex::new(PreviewCache::default());
        assert_eq!(source.preview(&cache).unwrap(), original);
        assert_eq!(fs::read(moved).unwrap(), original);
        assert_eq!(PreviewSource::read(&path).err().unwrap().code, "INVALID");
    }
    #[test]
    fn preview_checks_format_size_and_dimensions_before_processing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("invalid.png");
        fs::write(&path, b"invalid").unwrap();
        assert_eq!(PreviewSource::read(&path).err().unwrap().code, "IMAGE");
        fs::write(&path, b"BM invalid").unwrap();
        assert_eq!(
            PreviewSource::read(&path).err().unwrap().code,
            "UNSUPPORTED"
        );
        fs::File::create(&path)
            .unwrap()
            .set_len(IMAGE_LIMIT as u64 + 1)
            .unwrap();
        assert_eq!(PreviewSource::read(&path).err().unwrap().code, "LIMIT");
        image::RgbImage::new(4001, 4000).save(&path).unwrap();
        assert_eq!(PreviewSource::read(&path).err().unwrap().code, "LIMIT");
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_rechecks_dimensions_if_the_open_file_is_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("changed.png");
        image::RgbImage::new(16, 16).save(&path).unwrap();
        let source = PreviewSource::read(&path).unwrap();
        image::RgbImage::new(4001, 4000).save(&path).unwrap();
        assert_eq!(
            source
                .preview(&Mutex::new(PreviewCache::default()))
                .err()
                .unwrap()
                .code,
            "LIMIT"
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_accepts_webp_from_the_file_source() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("photo.webp");
        image::RgbImage::new(2000, 1000).save(&path).unwrap();
        let result = preview_of(&path, &Mutex::new(PreviewCache::default())).unwrap();
        assert_eq!(
            image::load_from_memory(&result).unwrap().width(),
            PREVIEW_EDGE
        );
    }
    // 表示用の画像の寸法と形式を、ヘッダーだけ読んで確かめる
    #[cfg(target_os = "macos")]
    fn preview_shape(bytes: &[u8]) -> (u32, u32, image::ImageFormat) {
        let format = image::guess_format(bytes).unwrap();
        let (width, height) = image::ImageReader::with_format(io::Cursor::new(bytes), format)
            .into_dimensions()
            .unwrap();
        (width, height, format)
    }
    // ImageIOの縮小は端数の丸めで1pxずれることがあるため、1pxまでの差を許す
    #[cfg(target_os = "macos")]
    fn assert_preview_size(bytes: &[u8], expected: (u32, u32), format: image::ImageFormat) {
        let (width, height, actual) = preview_shape(bytes);
        assert_eq!(actual, format);
        assert!(
            width.abs_diff(expected.0) <= 1 && height.abs_diff(expected.1) <= 1,
            "{width}x{height}"
        );
    }
    // EXIFの向き(Orientation)だけを持つAPP1を、JPEGのSOIの直後に差し込む
    #[cfg(target_os = "macos")]
    fn with_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        let mut tiff = b"II*\0".to_vec();
        tiff.extend(8u32.to_le_bytes());
        tiff.extend(1u16.to_le_bytes());
        tiff.extend(0x0112u16.to_le_bytes());
        tiff.extend(3u16.to_le_bytes());
        tiff.extend(1u32.to_le_bytes());
        tiff.extend(orientation.to_le_bytes());
        tiff.extend([0, 0]);
        tiff.extend(0u32.to_le_bytes());
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend(tiff);
        let mut out = jpeg[..2].to_vec();
        out.extend([0xFF, 0xE1]);
        out.extend(((app1.len() + 2) as u16).to_be_bytes());
        out.extend(app1);
        out.extend(&jpeg[2..]);
        out
    }
    #[test]
    fn preview_keeps_images_within_the_edge_limit() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let cache = Mutex::new(PreviewCache::default());
        let small = root.join("small.png");
        image::RgbImage::from_fn(1600, 900, |x, y| image::Rgb([x as u8, y as u8, 0]))
            .save(&small)
            .unwrap();
        assert_eq!(
            preview_of(&small, &cache).unwrap(),
            fs::read(&small).unwrap()
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_resizes_large_images_and_keeps_aspect_ratio() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let cache = Mutex::new(PreviewCache::default());
        let wide = root.join("wide.png");
        image::RgbImage::from_fn(3000, 1500, |x, y| image::Rgb([x as u8, y as u8, 128]))
            .save(&wide)
            .unwrap();
        assert_preview_size(
            &preview_of(&wide, &cache).unwrap(),
            (1600, 800),
            image::ImageFormat::Jpeg,
        );
        let tall = root.join("tall.png");
        image::RgbImage::from_fn(800, 2400, |x, y| image::Rgb([x as u8, y as u8, 128]))
            .save(&tall)
            .unwrap();
        assert_preview_size(
            &preview_of(&tall, &cache).unwrap(),
            (533, 1600),
            image::ImageFormat::Jpeg,
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_applies_exif_orientation_before_resizing() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Mutex::new(PreviewCache::default());
        let path = directory.path().join("photo.jpg");
        image::RgbImage::from_fn(3000, 1500, |x, y| image::Rgb([x as u8, y as u8, 128]))
            .save(&path)
            .unwrap();
        let jpeg = fs::read(&path).unwrap();
        // 向きが1(そのまま)なら横長のまま、6(時計回りに90度)なら縦長になる
        fs::write(&path, with_orientation(&jpeg, 1)).unwrap();
        assert_preview_size(
            &preview_of(&path, &cache).unwrap(),
            (1600, 800),
            image::ImageFormat::Jpeg,
        );
        fs::write(&path, with_orientation(&jpeg, 6)).unwrap();
        assert_preview_size(
            &preview_of(&path, &cache).unwrap(),
            (800, 1600),
            image::ImageFormat::Jpeg,
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_keeps_transparency_as_png() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Mutex::new(PreviewCache::default());
        let path = directory.path().join("clear.png");
        image::RgbaImage::from_fn(3000, 1500, |x, _| {
            let alpha = if x < 300 { 0 } else { 255 };
            image::Rgba([x as u8, 0, 0, alpha])
        })
        .save(&path)
        .unwrap();
        assert_preview_size(
            &preview_of(&path, &cache).unwrap(),
            (1600, 800),
            image::ImageFormat::Png,
        );
    }
    #[test]
    fn preview_keeps_animated_gifs() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Mutex::new(PreviewCache::default());
        let frames = [[255, 0, 0, 255], [0, 0, 255, 255]].map(|color| {
            image::Frame::new(image::RgbaImage::from_pixel(1700, 1700, image::Rgba(color)))
        });
        let mut animated = Vec::new();
        image::codecs::gif::GifEncoder::new(&mut animated)
            .encode_frames(frames)
            .unwrap();
        let animated_path = directory.path().join("animated.gif");
        fs::write(&animated_path, &animated).unwrap();
        assert_eq!(preview_of(&animated_path, &cache).unwrap(), animated);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_resizes_still_gifs() {
        let directory = tempfile::tempdir().unwrap();
        let cache = Mutex::new(PreviewCache::default());
        let mut out = Vec::new();
        image::codecs::gif::GifEncoder::new(&mut out)
            .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                1700,
                1700,
                image::Rgba([0, 255, 0, 255]),
            )))
            .unwrap();
        let still = directory.path().join("still.gif");
        fs::write(&still, &out).unwrap();
        assert_preview_size(
            &preview_of(&still, &cache).unwrap(),
            (1600, 1600),
            image::ImageFormat::Jpeg,
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn preview_cache_reuses_until_the_file_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("photo.png");
        image::RgbImage::from_fn(2000, 1000, |x, y| image::Rgb([x as u8, y as u8, 0]))
            .save(&path)
            .unwrap();
        let cache = Mutex::new(PreviewCache::default());
        let first = preview_of(&path, &cache).unwrap();
        assert_eq!(cache.lock().unwrap().entries.len(), 1);
        // 同じ鍵なら作り直さず、キャッシュの中身をそのまま返す
        cache.lock().unwrap().entries[0].1 = b"cached".to_vec();
        assert_eq!(preview_of(&path, &cache).unwrap(), b"cached");
        cache.lock().unwrap().entries[0].1 = first;
        // 外部で画像が差し替えられ更新日時が変わったら、作り直す
        std::thread::sleep(std::time::Duration::from_millis(20));
        image::RgbImage::from_fn(1000, 2000, |x, y| image::Rgb([y as u8, x as u8, 255]))
            .save(&path)
            .unwrap();
        assert_preview_size(
            &preview_of(&path, &cache).unwrap(),
            (800, 1600),
            image::ImageFormat::Jpeg,
        );
    }
    #[test]
    fn preview_runs_one_image_at_a_time() {
        use std::sync::atomic::Ordering;
        let directory = tempfile::tempdir().unwrap();
        let cache = Mutex::new(PreviewCache::default());
        let paths: Vec<PathBuf> = (0..4)
            .map(|index| {
                let path = directory.path().join(format!("{index}.png"));
                image::RgbImage::from_fn(2400, 1200, |x, y| {
                    image::Rgb([x as u8, y as u8, index as u8])
                })
                .save(&path)
                .unwrap();
                path
            })
            .collect();
        std::thread::scope(|scope| {
            for path in &paths {
                let cache = &cache;
                scope.spawn(move || preview_of(path, cache).unwrap());
            }
        });
        // 同時に作っていた数の最大値が1なら、1枚ずつ処理されている
        assert_eq!(PREVIEW_PEAK.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn preview_cache_stays_within_its_count_limit() {
        let mut cache = PreviewCache::default();
        for index in 0..PREVIEW_CACHE_COUNT + 3 {
            let key = PreviewKey {
                path: PathBuf::from(format!("{index}.png")),
                modified: UNIX_EPOCH,
                len: 1,
            };
            cache.insert(key, vec![0; 1024]);
        }
        assert_eq!(cache.entries.len(), PREVIEW_CACHE_COUNT);
        assert_eq!(cache.bytes, PREVIEW_CACHE_COUNT * 1024);
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
