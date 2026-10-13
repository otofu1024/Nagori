use super::*;
use std::{net::TcpListener, thread};
fn blog() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("src/content/blog")).unwrap();
    fs::create_dir_all(dir.path().join("src/theme")).unwrap();
    fs::write(dir.path().join("src/theme/theme.css"), "").unwrap();
    fs::write(dir.path().join("src/config.ts"), "").unwrap();
    dir
}
#[test]
fn metadata_matches_template_rules() {
    let html = r#"<META PROPERTY='og:title' CONTENT='最初 &amp; 次'><meta property="og:title" content="無視"><meta name=description content=' A   B &#x1f600; '><meta property='og:image' content='../image.png'><title>普通の<b>題</b></title>"#;
    let (preview, image) = preview_from_html("https://www.example.com/a/b", html).unwrap();
    assert_eq!(preview.title, "最初 & 次");
    assert_eq!(preview.description, "A B 😀");
    assert_eq!(preview.hostname, "example.com");
    assert_eq!(image, "https://www.example.com/image.png");
    assert_eq!(
        shorten(&"あ".repeat(141), 140),
        format!("{}…", "あ".repeat(140))
    );
    let fallback = fallback("https://www.example.com/a?q=1").unwrap();
    assert_eq!(fallback.description, "/a");
    assert!(fallback.image.is_empty());
}
#[test]
fn fetches_local_html_once_sorts_cache_and_reuses_build_images() {
    let root = blog();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/preview", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        stream.read(&mut request).unwrap();
        let html = "<title>ローカルの見本</title><meta name='description' content='取得の確認'>";
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len()).unwrap();
    });
    let fetcher = Fetcher::default();
    let preview = fetcher.fetch(root.path(), &url).unwrap().unwrap();
    server.join().unwrap();
    assert_eq!(preview.title, "ローカルの見本");
    assert!(preview.fetched_at.is_some());
    assert_eq!(
        fetcher.fetch(root.path(), &url).unwrap().unwrap().title,
        preview.title
    );
    save(
        root.path(),
        "https://z.example/",
        &fallback("https://z.example/").unwrap(),
    )
    .unwrap();
    save(
        root.path(),
        "https://a.example/",
        &fallback("https://a.example/").unwrap(),
    )
    .unwrap();
    let text = fs::read_to_string(root.path().join(CACHE_FILE)).unwrap();
    assert!(text.find("https://a.example/") < text.find("https://z.example/"));
    assert_eq!(load(root.path()).len(), 3);
    let dir = directory(root.path(), IMAGE_DIR).unwrap();
    let hash = format!("{:x}", Sha256::digest(url.as_bytes()));
    fs::write(dir.join(format!("{}.webp", &hash[..16])), b"already-built").unwrap();
    assert_eq!(
        save_image(root.path(), &url, "https://unused.example/image").unwrap(),
        format!("/link-cards/{}.webp", &hash[..16])
    );
}
#[test]
fn offline_stays_a_link_and_invalid_schemes_are_rejected() {
    let root = blog();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    drop(listener);
    let fetcher = Fetcher::default();
    assert!(fetcher.fetch(root.path(), &url).unwrap().is_none());
    assert!(fetcher.fetch(root.path(), &url).unwrap().is_none());
    assert!(!root.path().join(CACHE_FILE).exists());
    assert!(fetcher.fetch(root.path(), "file:///etc/passwd").is_err());
}
#[test]
fn image_conversion_uses_webp_and_width_without_enlargement() {
    for (width, height) in [(960, 480), (960, 1920), (100, 200)] {
        let source = image::DynamicImage::new_rgba8(width, height);
        let mut bytes = std::io::Cursor::new(Vec::new());
        source
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(bytes.get_ref()).unwrap();
        let output = crate::image::link_card(file).unwrap();
        assert_eq!(
            image::guess_format(&output).unwrap(),
            image::ImageFormat::WebP
        );
        let output = image::load_from_memory(&output).unwrap();
        assert_eq!(output.width(), width.min(480));
        assert_eq!(
            output.height(),
            if width > 480 {
                height * 480 / width
            } else {
                height
            }
        );
    }
}
#[cfg(unix)]
#[test]
fn cache_cannot_follow_a_symlink() {
    let root = blog();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("src/data")).unwrap();
    assert!(save(
        root.path(),
        "https://example.com",
        &fallback("https://example.com").unwrap()
    )
    .is_err());
    assert!(!outside.path().join("link-cards.json").exists());
}

#[test]
fn sorting_matches_javascript_utf16_order() {
    let root = blog();
    let supplementary = "https://example.com/😀";
    let bmp = "https://example.com/\u{e000}";
    save(root.path(), bmp, &fallback(bmp).unwrap()).unwrap();
    save(
        root.path(),
        supplementary,
        &fallback(supplementary).unwrap(),
    )
    .unwrap();
    let text = fs::read_to_string(root.path().join(CACHE_FILE)).unwrap();
    assert!(text.find(supplementary) < text.find(bmp));
}

#[test]
fn unsuccessful_responses_use_fallback_without_persisting_and_image_size_is_bounded() {
    for response in [
        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    ] {
        let root = blog();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/a", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0;4096]; stream.read(&mut request).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
        });
        let fetcher = Fetcher::default();
        let preview = fetcher.fetch(root.path(), &url).unwrap().unwrap();
        server.join().unwrap();
        assert_eq!(preview.description, "/a");
        assert!(preview.fetched_at.is_none());
        assert!(load(root.path()).is_empty());
        assert_eq!(fetcher.fetch(root.path(), &url).unwrap().unwrap().title, preview.title);
    }
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/large-image", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        stream.read(&mut request).unwrap();
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 5242881\r\nConnection: close\r\n\r\n").unwrap();
    });
    assert!(download(&url, true).is_err());
    server.join().unwrap();
}

#[test]
fn local_page_and_image_are_saved_in_the_build_cache_format() {
    let root = blog();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/preview", listener.local_addr().unwrap());
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(960, 480)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let server = thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let count = stream.read(&mut request).unwrap();
            let image = String::from_utf8_lossy(&request[..count]).starts_with("GET /image.png ");
            let html = b"<meta property='og:title' content='Local preview'><meta property='og:image' content='/image.png'>";
            let (content_type, body) = if image {
                ("image/png", png.get_ref().as_slice())
            } else {
                ("text/html", html.as_slice())
            };
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(body).unwrap();
        }
    });
    let preview = Fetcher::default()
        .fetch(root.path(), &url)
        .unwrap()
        .unwrap();
    server.join().unwrap();
    let hash = format!("{:x}", Sha256::digest(url.as_bytes()));
    assert_eq!(preview.image, format!("/link-cards/{}.webp", &hash[..16]));
    let bytes = fs::read(
        root.path()
            .join("public")
            .join(preview.image.trim_start_matches('/')),
    )
    .unwrap();
    assert_eq!(
        image::guess_format(&bytes).unwrap(),
        image::ImageFormat::WebP
    );
    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (480, 240));
    assert_eq!(load(root.path())[&url].image, preview.image);
    assert!(load(root.path())[&url].fetched_at.is_some());
}
