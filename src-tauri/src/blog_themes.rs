// 画面とMCPで共用するテーマの置き換え。呼び出し側はワークスペースの保存ロックを持つ。
use crate::{
    files::{self, Error, Result},
    trash,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub const THEME_PATH: &str = "src/theme/theme.css";
pub const HISTORY_LIMIT: usize = 30;
pub const PRESETS: [(&str, &str); 4] = [
    (
        "standard",
        include_str!("../../src/lib/blogThemes/standard.css"),
    ),
    ("mono", include_str!("../../src/lib/blogThemes/mono.css")),
    ("washi", include_str!("../../src/lib/blogThemes/washi.css")),
    ("dusk", include_str!("../../src/lib/blogThemes/dusk.css")),
];
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub saved_at: u64,
    pub preset: Option<&'static str>,
    pub theme: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
}
struct StoredCustom {
    item: CustomTheme,
    bytes: Vec<u8>,
}
#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub baseline: String,
    pub preset: Option<&'static str>,
    pub current: Option<String>,
    pub customs: Vec<CustomTheme>,
    pub history: Vec<HistoryItem>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub baseline: String,
    pub cleanup_errors: Vec<String>,
}
pub fn identify(bytes: &[u8]) -> Option<&'static str> {
    PRESETS
        .iter()
        .find(|(_, css)| css.as_bytes() == bytes)
        .map(|(id, _)| *id)
}
fn directory(base: &Path, root: &Path) -> Result<PathBuf> {
    let root = fs::canonicalize(root)?;
    // 保存先がブログの中に入る指定や、リンクを介した指定も拒否する。
    let ancestor = base
        .ancestors()
        .find(|path| path.exists())
        .ok_or_else(|| Error::new("INVALID", "履歴の保存先がありません。"))?;
    if base.starts_with(&root) || fs::canonicalize(ancestor)?.starts_with(&root) {
        return Err(Error::new(
            "INVALID",
            "テーマの履歴はブログの外に保存してください。",
        ));
    }
    fs::create_dir_all(base)?;
    let base = fs::canonicalize(base)?;
    if base.starts_with(&root) {
        return Err(Error::new(
            "INVALID",
            "テーマの履歴はブログの外に保存してください。",
        ));
    }
    let directory = trash::workspace_dir(&base, &root);
    match fs::symlink_metadata(&directory) {
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err(Error::new(
                "SYMLINK",
                "履歴のフォルダは通常のフォルダにしてください。",
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&directory)?,
        Err(error) => return Err(error.into()),
    }
    Ok(directory)
}
fn timestamp(id: &str) -> Option<u64> {
    let pieces: Vec<_> = id.split('-').collect();
    if pieces.len() != 3
        || pieces[0].len() != 32
        || pieces[1].len() != 8
        || pieces[2].len() != 16
        || !pieces
            .iter()
            .all(|s| s.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return None;
    }
    let millis = u64::try_from(u128::from_str_radix(pieces[0], 16).ok()? / 1_000_000).ok()?;
    (millis <= 8_640_000_000_000_000).then_some(millis)
}
fn custom_number(id: &str) -> Option<u64> {
    let number = id.strip_prefix("custom-")?.parse::<u64>().ok()?;
    (number > 0 && id == format!("custom-{number}")).then_some(number)
}
fn customs(directory: &Path) -> Result<Vec<StoredCustom>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory)? {
        let name = entry?.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".css")) else {
            continue;
        };
        let Some(number) = custom_number(id) else {
            continue;
        };
        let path = files::resolve(directory, &format!("{id}.css"), false)?;
        entries.push(StoredCustom {
            item: CustomTheme {
                id: id.into(),
                name: format!("カスタム{number}"),
            },
            bytes: files::read_limited(&path, files::DOCUMENT_LIMIT)?,
        });
    }
    entries.sort_by_key(|entry| custom_number(&entry.item.id).unwrap());
    Ok(entries)
}
fn theme_id(bytes: &[u8], customs: &[StoredCustom]) -> Option<String> {
    identify(bytes).map(str::to_owned).or_else(|| {
        customs
            .iter()
            .find(|entry| entry.bytes == bytes)
            .map(|entry| entry.item.id.clone())
    })
}
fn save_custom(directory: &Path, bytes: &[u8], customs: &mut Vec<StoredCustom>) -> Result<String> {
    if let Some(id) = theme_id(bytes, customs) {
        return Ok(id);
    }
    let counter = files::resolve(directory, "custom-counter", true)?;
    let previous = if counter.exists() {
        Some(files::read_limited(&counter, 64)?)
    } else {
        None
    };
    let used = previous
        .as_ref()
        .map(|bytes| {
            std::str::from_utf8(bytes)
                .ok()
                .and_then(|text| text.parse::<u64>().ok())
                .ok_or_else(|| Error::new("INVALID", "カスタムテーマの番号を読み込めません。"))
        })
        .transpose()?
        .unwrap_or(0);
    let highest = customs
        .iter()
        .filter_map(|entry| custom_number(&entry.item.id))
        .max()
        .unwrap_or(0);
    let number = used
        .max(highest)
        .checked_add(1)
        .ok_or_else(|| Error::new("LIMIT", "カスタムテーマの番号が上限に達しました。"))?;
    // CSSの保存や削除に失敗しても、使った番号を次の保存で使い回さない。
    let next = number.to_string();
    if let Some(previous) = previous {
        files::save_bytes(
            directory,
            "custom-counter",
            next.as_bytes(),
            &files::baseline(&previous),
        )?;
    } else {
        files::create_bytes(&counter, next.as_bytes())?;
    }
    let id = format!("custom-{number}");
    files::create_bytes(&directory.join(format!("{id}.css")), bytes)?;
    customs.push(StoredCustom {
        item: CustomTheme {
            id: id.clone(),
            name: format!("カスタム{number}"),
        },
        bytes: bytes.to_vec(),
    });
    Ok(id)
}
fn history(directory: &Path, customs: &[StoredCustom]) -> Result<Vec<HistoryItem>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".css")) else {
            continue;
        };
        let Some(saved_at) = timestamp(id) else {
            continue;
        };
        let path = files::resolve(directory, &format!("{id}.css"), false)?;
        let bytes = files::read_limited(&path, files::DOCUMENT_LIMIT)?;
        entries.push(HistoryItem {
            id: id.into(),
            saved_at,
            preset: identify(&bytes),
            theme: theme_id(&bytes, customs),
        });
    }
    entries.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(entries)
}
pub fn read(root: &Path, base: &Path) -> Result<Snapshot> {
    snapshot(root, base, true)
}
fn snapshot(root: &Path, base: &Path, auto_save: bool) -> Result<Snapshot> {
    files::validate_blog(root)?;
    let bytes = files::read_limited(
        &files::resolve(root, THEME_PATH, false)?,
        files::DOCUMENT_LIMIT,
    )?;
    let directory = directory(base, root)?;
    let mut customs = customs(&directory)?;
    let current = if auto_save {
        Some(save_custom(&directory, &bytes, &mut customs)?)
    } else {
        theme_id(&bytes, &customs)
    };
    Ok(Snapshot {
        baseline: files::baseline(&bytes),
        preset: identify(&bytes),
        current,
        history: history(&directory, &customs)?,
        customs: customs.into_iter().map(|entry| entry.item).collect(),
    })
}
// 生のCSSを受ける入口。将来のMCPも、検証後にこの処理を呼ぶ。
pub fn replace(root: &Path, base: &Path, bytes: &[u8], expected: &str) -> Result<Saved> {
    replace_with(root, base, bytes, expected, || {})
}
fn replace_with(
    root: &Path,
    base: &Path,
    bytes: &[u8],
    expected: &str,
    staged: impl FnOnce(),
) -> Result<Saved> {
    files::validate_blog(root)?;
    if bytes.len() > files::DOCUMENT_LIMIT {
        return Err(Error::new("LIMIT", "テーマの上限は2MiBです。"));
    }
    if std::str::from_utf8(bytes).is_err() || bytes.contains(&0) {
        return Err(Error::new("ENCODING", "UTF-8のCSSを指定してください。"));
    }
    let path = files::resolve(root, THEME_PATH, false)?;
    let before = files::read_limited(&path, files::DOCUMENT_LIMIT)?;
    if files::baseline(&before) != expected {
        return Err(Error::new("CONFLICT", "ディスクの内容が変更されています。"));
    }
    if files::readonly(&path)? {
        return Err(Error::new("PERMISSION", "theme.cssが読み取り専用です。"));
    }
    let directory = directory(base, root)?;
    let mut customs = customs(&directory)?;
    save_custom(&directory, &before, &mut customs)?;
    let entries = history(&directory, &customs)?;
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| Error::new("IO", error.to_string()))?
        .as_nanos();
    let id = format!(
        "{nanos:032x}-{:08x}-{:016x}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    );
    let archive = directory.join(format!("{id}.css"));
    // 履歴の書き込みに失敗した時はtheme.cssを置き換えない。
    files::create_bytes(&archive, &before)?;
    staged();
    let saved = match files::save_bytes(root, THEME_PATH, bytes, expected) {
        Ok(saved) => saved,
        Err(error) => {
            let _ = fs::remove_file(&archive);
            return Err(error);
        }
    };
    // 置き換えが済んだ後の整理の失敗は、保存の失敗と区別して返す。
    let mut cleanup_errors = Vec::new();
    for entry in entries.iter().skip(HISTORY_LIMIT - 1) {
        let removed = files::resolve(&directory, &format!("{}.css", entry.id), false)
            .and_then(|path| fs::remove_file(path).map_err(Error::from));
        if let Err(error) = removed {
            cleanup_errors.push(error.message);
        }
    }
    Ok(Saved {
        baseline: saved.baseline,
        cleanup_errors,
    })
}
pub fn apply(root: &Path, base: &Path, preset: &str, expected: &str) -> Result<Saved> {
    if let Some((_, css)) = PRESETS.iter().find(|(id, _)| *id == preset) {
        return replace(root, base, css.as_bytes(), expected);
    }
    if custom_number(preset).is_none() {
        return Err(Error::new("INVALID", "テーマを選んでください。"));
    }
    let directory = directory(base, root)?;
    let bytes = files::read_limited(
        &files::resolve(&directory, &format!("{preset}.css"), false)?,
        files::DOCUMENT_LIMIT,
    )?;
    replace(root, base, &bytes, expected)
}
pub fn delete_custom(root: &Path, base: &Path, id: &str) -> Result<Snapshot> {
    files::validate_blog(root)?;
    if custom_number(id).is_none() {
        return Err(Error::new("INVALID", "カスタムテーマを選んでください。"));
    }
    let directory = directory(base, root)?;
    fs::remove_file(files::resolve(&directory, &format!("{id}.css"), false)?)?;
    // 今使っている内容を消した直後は登録し直さず、次に設定を開く時に保存する。
    snapshot(root, base, false)
}
pub fn restore(root: &Path, base: &Path, id: &str, expected: &str) -> Result<Saved> {
    if timestamp(id).is_none() {
        return Err(Error::new("INVALID", "テーマの履歴を選んでください。"));
    }
    let directory = directory(base, root)?;
    let bytes = files::read_limited(
        &files::resolve(&directory, &format!("{id}.css"), false)?,
        files::DOCUMENT_LIMIT,
    )?;
    replace(root, base, &bytes, expected)
}

#[cfg(test)]
#[path = "blog_themes/tests.rs"]
mod tests;
