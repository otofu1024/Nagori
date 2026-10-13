use crate::files::{
    create_bytes, markdown, open_limited, read_file_limited, readonly, relative, resolve,
    valid_name, Error, Result,
};
use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

const IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const PIXEL_LIMIT: u64 = 16_000_000;
// 記事中の画像の表示用に、長い辺をこの長さまで縮める
#[cfg(target_os = "macos")]
const PREVIEW_EDGE: u32 = 1600;
// 表示用の画像のキャッシュは件数とバイト数の両方で上限を付ける
const PREVIEW_CACHE_COUNT: usize = 64;
const PREVIEW_CACHE_BYTES: usize = 64 * 1024 * 1024;

pub struct Image {
    pub data: Vec<u8>,
    format: image::ImageFormat,
}
#[derive(Serialize)]
pub struct InsertedImage {
    pub path: String,
    pub markdown: String,
}
pub(crate) fn image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp")
    )
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
// キャラクターの画像も既存の寸法とデコードの検証を使う。
pub(crate) fn validate_import(data: Vec<u8>) -> Result<()> {
    if data.len() > IMAGE_LIMIT {
        return Err(Error::new("LIMIT", "画像は20MiB以下にしてください。"));
    }
    verify_image(&image_from_bytes(data)?)
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
#[path = "image/imageio.rs"]
mod imageio;
#[cfg(target_os = "macos")]
pub fn link_card(file: fs::File) -> Result<Vec<u8>> {
    imageio::link_card(file)
}
#[cfg(not(target_os = "macos"))]
pub fn link_card(file: fs::File) -> Result<Vec<u8>> {
    let image = image::load_from_memory(&read_file_limited(file, 5 * 1024 * 1024)?)
        .map_err(|e| Error::new("IMAGE", e.to_string()))?;
    let image = if image.width() > 480 {
        image.resize(480, u32::MAX, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut output = io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::WebP)
        .map_err(|e| Error::new("IMAGE", e.to_string()))?;
    Ok(output.into_inner())
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
    // 明示的に選んだ外部の画像でも、パスの途中のシンボリックリンクを拒否する
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
#[path = "image/tests.rs"]
mod tests;
