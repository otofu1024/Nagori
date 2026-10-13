use super::*;
fn setup() -> (tempfile::TempDir, tempfile::TempDir) {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("src")).unwrap();
    fs::write(
        root.path().join(CONFIG),
        "// 見本\nexport const CHARACTERS = {};\n",
    )
    .unwrap();
    (root, tempfile::tempdir().unwrap())
}
fn png() -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    ::image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut bytes, ::image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn request(root: &Path) -> SaveRequest {
    SaveRequest {
        text: "// 見本\nexport const CHARACTERS = { NAGORI: {} };\n".into(),
        baseline: files::open(root, CONFIG).unwrap().baseline,
        images: vec![],
        removed_images: vec![],
    }
}
#[test]
fn copies_original_bytes_and_requires_overwrite_baseline() {
    let (root, base) = setup();
    let data = png();
    let path = "public/images/nagori/通常.PNG";
    assert_eq!(image_baseline(root.path(), path).unwrap(), None);
    assert!(!root.path().join("public").exists());
    let mut input = request(root.path());
    input.images.push(ImageUpload {
        path: path.into(),
        data: data.clone(),
        baseline: None,
    });
    save(root.path(), base.path(), input).unwrap();
    assert_eq!(fs::read(root.path().join(path)).unwrap(), data);
    let mut input = request(root.path());
    input.images.push(ImageUpload {
        path: path.into(),
        data: data.clone(),
        baseline: None,
    });
    assert_eq!(
        save(root.path(), base.path(), input).unwrap_err().code,
        "CONFLICT"
    );
    let mut input = request(root.path());
    input.images.push(ImageUpload {
        path: path.into(),
        data: data.clone(),
        baseline: image_baseline(root.path(), path).unwrap(),
    });
    save(root.path(), base.path(), input).unwrap();
}
#[test]
fn rejects_conflicts_bad_images_and_unsafe_paths_before_writing() {
    let (root, base) = setup();
    let mut input = request(root.path());
    fs::write(root.path().join(CONFIG), "外で変更").unwrap();
    input.images.push(ImageUpload {
        path: "public/images/new/a.png".into(),
        data: png(),
        baseline: None,
    });
    assert_eq!(
        save(root.path(), base.path(), input).unwrap_err().code,
        "CONFLICT"
    );
    assert!(!root.path().join("public").exists());
    let mut input = request(root.path());
    input.images.push(ImageUpload {
        path: "public/images/new/a.png".into(),
        data: vec![1, 2],
        baseline: None,
    });
    assert!(save(root.path(), base.path(), input).is_err());
    for path in [
        "../image.png",
        "public/images/../../../a.png",
        "public/a.png",
        "public/images/a.txt",
    ] {
        assert!(image_baseline(root.path(), path).is_err());
    }
    fs::create_dir(root.path().join("public")).unwrap();
    std::os::unix::fs::symlink(base.path(), root.path().join("public/images")).unwrap();
    assert_eq!(
        image_baseline(root.path(), "public/images/a.png")
            .unwrap_err()
            .code,
        "SYMLINK"
    );
}
#[test]
fn deleted_image_goes_to_recoverable_trash_after_save() {
    let (root, base) = setup();
    let path = "public/images/nagori/normal.png";
    let mut input = request(root.path());
    input.images.push(ImageUpload {
        path: path.into(),
        data: png(),
        baseline: None,
    });
    save(root.path(), base.path(), input).unwrap();
    let mut input = request(root.path());
    input.text = "export const CHARACTERS = {};".into();
    input.removed_images.push(path.into());
    let saved = save(root.path(), base.path(), input).unwrap();
    assert!(saved.cleanup_errors.is_empty());
    assert!(!root.path().join(path).exists());
    let items = trash::list(base.path(), root.path()).unwrap();
    assert_eq!(items[0].path, path);
    trash::restore(base.path(), root.path(), &items[0].id).unwrap();
    assert_eq!(fs::read(root.path().join(path)).unwrap(), png());
}

#[test]
fn failed_config_write_rolls_back_new_and_overwritten_images() {
    let (root, base) = setup();
    let path = "public/images/nagori/normal.png";
    let mut initial = request(root.path());
    initial.images.push(ImageUpload {
        path: path.into(),
        data: png(),
        baseline: None,
    });
    save(root.path(), base.path(), initial).unwrap();
    let original_config = fs::read(root.path().join(CONFIG)).unwrap();
    let original_image = fs::read(root.path().join(path)).unwrap();
    let mut replacement = std::io::Cursor::new(Vec::new());
    ::image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut replacement, ::image::ImageFormat::Png)
        .unwrap();
    let mut input = request(root.path());
    input.text = "改行\rを含む".into();
    input.images = vec![
        ImageUpload {
            path: path.into(),
            data: replacement.into_inner(),
            baseline: image_baseline(root.path(), path).unwrap(),
        },
        ImageUpload {
            path: "public/images/nagori/new.png".into(),
            data: png(),
            baseline: None,
        },
    ];
    assert_eq!(
        save(root.path(), base.path(), input).unwrap_err().code,
        "NEWLINES"
    );
    assert_eq!(fs::read(root.path().join(CONFIG)).unwrap(), original_config);
    assert_eq!(fs::read(root.path().join(path)).unwrap(), original_image);
    assert!(!root.path().join("public/images/nagori/new.png").exists());
    assert!(trash::list(base.path(), root.path()).unwrap().is_empty());
}
