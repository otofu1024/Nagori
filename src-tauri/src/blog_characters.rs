// 構文と入力の検証はTypeScriptの共有モジュールで行い、ここではファイルの安全な入出力を扱う。
use crate::{
    files::{self, Error, Result},
    image, trash,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Component, Path},
};

const CONFIG: &str = "src/config.ts";
#[derive(Deserialize)]
pub struct ImageUpload {
    pub path: String,
    pub data: Vec<u8>,
    pub baseline: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub text: String,
    pub baseline: String,
    pub images: Vec<ImageUpload>,
    pub removed_images: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub baseline: String,
    pub cleanup_errors: Vec<String>,
}
fn validate_path(path: &str, upload: bool) -> Result<()> {
    if !path.starts_with(if upload { "public/images/" } else { "public/" })
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || (upload && !image::image_extension(Path::new(path)))
    {
        return Err(Error::new(
            "INVALID",
            "publicの下の画像を指定してください。",
        ));
    }
    for part in Path::new(path).components() {
        files::valid_name(part.as_os_str().to_str().unwrap_or(""))?;
    }
    Ok(())
}
// 保存前の確認ではフォルダを作らない。存在する親まで、リンクでないことを確かめる。
pub fn image_baseline(root: &Path, path: &str) -> Result<Option<String>> {
    validate_path(path, true)?;
    let mut traversed = std::path::PathBuf::new();
    for part in Path::new(path).components() {
        traversed.push(part);
        let relative = traversed.to_str().unwrap();
        let absolute = files::resolve(root, relative, true)?;
        if !absolute.exists() {
            return Ok(None);
        }
    }
    Ok(Some(files::baseline(&files::read_limited(
        &files::resolve(root, path, false)?,
        20 * 1024 * 1024,
    )?)))
}
fn parents(root: &Path, path: &str) -> Result<()> {
    let mut traversed = std::path::PathBuf::new();
    for part in Path::new(path).parent().unwrap().components() {
        traversed.push(part);
        let absolute = files::resolve(root, traversed.to_str().unwrap(), true)?;
        if !absolute.exists() {
            fs::create_dir(&absolute)?;
        }
        if !absolute.is_dir() {
            return Err(Error::new(
                "INVALID",
                "画像の保存先がフォルダではありません。",
            ));
        }
    }
    Ok(())
}
fn replace(root: &Path, path: &str, data: &[u8], expected: Option<&str>) -> Result<()> {
    parents(root, path)?;
    let absolute = files::resolve(root, path, true)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".nagori-save-")
        .tempfile_in(absolute.parent().unwrap())?;
    if !absolute.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(fs::Permissions::from_mode(0o644))?;
        }
    }
    if absolute.exists() {
        if files::readonly(&absolute)? {
            return Err(Error::new("PERMISSION", "画像が読み取り専用です。"));
        }
        temporary
            .as_file()
            .set_permissions(fs::metadata(&absolute)?.permissions())?;
    }
    temporary.write_all(data)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    if image_baseline(root, path)?.as_deref() != expected {
        return Err(Error::new("CONFLICT", "画像が外で変更されています。"));
    }
    if expected.is_some() {
        temporary
            .persist(&absolute)
            .map_err(|error| Error::from(error.error))?;
    } else {
        temporary
            .persist_noclobber(&absolute)
            .map_err(|error| Error::from(error.error))?;
    }
    Ok(())
}
pub fn save(root: &Path, trash_base: &Path, request: SaveRequest) -> Result<Saved> {
    let opened = files::open(root, CONFIG)?;
    if opened.baseline != request.baseline {
        return Err(Error::new("CONFLICT", "ディスクの内容が変更されています。"));
    }
    if opened.readonly {
        return Err(Error::new("PERMISSION", "config.tsが読み取り専用です。"));
    }
    let mut paths = std::collections::HashSet::new();
    let mut before = Vec::new();
    for upload in &request.images {
        validate_path(&upload.path, true)?;
        if !paths.insert(&upload.path) {
            return Err(Error::new("INVALID", "画像の保存先が重複しています。"));
        }
        image::validate_import(upload.data.clone())?;
        if image_baseline(root, &upload.path)? != upload.baseline {
            return Err(Error::new("CONFLICT", "画像が外で変更されています。"));
        }
        before.push(if upload.baseline.is_some() {
            Some(files::read_limited(
                &files::resolve(root, &upload.path, false)?,
                20 * 1024 * 1024,
            )?)
        } else {
            None
        });
    }
    for path in &request.removed_images {
        validate_path(path, false)?;
    }
    let mut committed = 0;
    let result = (|| {
        for upload in &request.images {
            replace(root, &upload.path, &upload.data, upload.baseline.as_deref())?;
            committed += 1;
        }
        files::save(root, CONFIG, &request.text, &request.baseline)
    })();
    let saved = match result {
        Ok(saved) => saved,
        Err(error) => {
            let mut failures = Vec::new();
            // config.tsの保存が失敗した時はコピー済みの画像を戻す。外で再変更された画像は上書きしない。
            for index in (0..committed).rev() {
                let upload = &request.images[index];
                let expected = files::baseline(&upload.data);
                let restored = if let Some(bytes) = &before[index] {
                    replace(root, &upload.path, bytes, Some(&expected))
                } else {
                    (|| {
                        if image_baseline(root, &upload.path)?.as_deref() != Some(&expected) {
                            return Err(Error::new("CONFLICT", "画像が外で変更されています。"));
                        }
                        fs::remove_file(files::resolve(root, &upload.path, false)?)?;
                        Ok(())
                    })()
                };
                if let Err(failure) = restored {
                    failures.push(format!("{}: {}", upload.path, failure.message));
                }
            }
            return Err(Error::new(
                error.code,
                if failures.is_empty() {
                    error.message
                } else {
                    format!(
                        "{} 画像を戻せませんでした。{}",
                        error.message,
                        failures.join("、")
                    )
                },
            ));
        }
    };
    let mut cleanup_errors = Vec::new();
    for path in request.removed_images {
        if paths.contains(&path) {
            continue;
        }
        match files::resolve(root, &path, false) {
            Err(error) if error.code == "MISSING" => continue,
            Err(error) => cleanup_errors.push(format!("{path}: {}", error.message)),
            Ok(absolute) if !absolute.is_file() => {
                cleanup_errors.push(format!("{path}: 画像のファイルではありません。"))
            }
            Ok(_) => {
                if let Err(error) = trash::move_to_trash(trash_base, root, &path) {
                    cleanup_errors.push(format!("{path}: {}", error.message));
                }
            }
        }
    }
    Ok(Saved {
        baseline: saved.baseline,
        cleanup_errors,
    })
}

#[cfg(test)]
#[path = "blog_characters/tests.rs"]
mod tests;
