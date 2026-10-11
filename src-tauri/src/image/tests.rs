use super::*;
use crate::files::{create, list};
use std::time::UNIX_EPOCH;

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
