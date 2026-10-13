use crate::files::{self, Error, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant},
};
use url::Url;

const CACHE_FILE: &str = "src/data/link-cards.json";
const IMAGE_DIR: &str = "public/link-cards";
const MAX_HTML_LENGTH: usize = 1_000_000;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    pub hostname: String,
    pub title: String,
    pub description: String,
    pub image: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
}
pub type Cache = BTreeMap<String, Preview>;
struct SortedCache<'a>(&'a Cache);
impl Serialize for SortedCache<'_> {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut entries: Vec<_> = self.0.iter().collect();
        // Object.keys(...).sort()と同じUTF-16の順序で保存する。
        entries.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
        let mut output = serializer.serialize_map(Some(entries.len()))?;
        for (key, value) in entries {
            output.serialize_entry(key, value)?;
        }
        output.end()
    }
}
// ponytail: 取得は1つのロックで直列化する。待ち時間が問題になった時にURLごとのロックへ分ける。
#[derive(Default)]
pub struct Fetcher {
    recent: Mutex<BTreeMap<(PathBuf, String), (Instant, Option<Preview>)>>,
}
fn invalid() -> Error {
    Error::new("LINK_CARD", "リンクカードを取得できませんでした。")
}
fn http_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || value
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '<' | '>'))
    {
        return Err(invalid());
    }
    Ok(url)
}
pub fn load(root: &Path) -> Cache {
    files::resolve(root, CACHE_FILE, false)
        .ok()
        .and_then(|path| files::read_limited(&path, 8 * 1024 * 1024).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
fn directory(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut at = String::new();
    for part in relative.split('/') {
        if !at.is_empty() {
            at.push('/');
        }
        at.push_str(part);
        let path = files::resolve(root, &at, true)?;
        if !path.exists() {
            fs::create_dir(&path)?;
        }
        files::resolve(root, &at, false)?;
    }
    files::resolve(root, relative, false)
}
fn save(root: &Path, url: &str, preview: &Preview) -> Result<()> {
    let mut cache = load(root);
    cache.insert(url.to_owned(), preview.clone());
    let parent = directory(root, "src/data")?;
    let destination = files::resolve(root, CACHE_FILE, true)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temporary, &SortedCache(&cache)).map_err(|_| invalid())?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(destination)
        .map_err(|error| Error::from(error.error))?;
    Ok(())
}
fn decode_html(value: &str) -> String {
    let decimal = Regex::new(r"&#(\d+);").unwrap();
    let hex = Regex::new(r"(?i)&#x([\da-f]+);").unwrap();
    let decoded = decimal.replace_all(value, |m: &regex::Captures| {
        m[1].parse()
            .ok()
            .and_then(char::from_u32)
            .unwrap_or('\u{fffd}')
            .to_string()
    });
    let decoded = hex.replace_all(&decoded, |m: &regex::Captures| {
        u32::from_str_radix(&m[1], 16)
            .ok()
            .and_then(char::from_u32)
            .unwrap_or('\u{fffd}')
            .to_string()
    });
    let mut value = decoded.into_owned();
    for (pattern, replacement) in [
        (r"(?i)&quot;", "\""),
        (r"(?i)&#39;|&apos;", "'"),
        (r"(?i)&lt;", "<"),
        (r"(?i)&gt;", ">"),
        (r"(?i)&amp;", "&"),
        (r"(?i)&nbsp;", " "),
    ] {
        value = Regex::new(pattern)
            .unwrap()
            .replace_all(&value, replacement)
            .into_owned();
    }
    Regex::new(r"\s+")
        .unwrap()
        .replace_all(&value, " ")
        .trim()
        .to_owned()
}
fn read_metadata(html: &str) -> BTreeMap<String, String> {
    let mut metadata = BTreeMap::new();
    let attributes =
        Regex::new(r#"([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#).unwrap();
    for tag in Regex::new(r"(?i)<meta\b[^>]*>").unwrap().find_iter(html) {
        let attrs: BTreeMap<_, _> = attributes
            .captures_iter(tag.as_str())
            .map(|m| {
                (
                    m[1].to_lowercase(),
                    decode_html(
                        m.get(2)
                            .or_else(|| m.get(3))
                            .or_else(|| m.get(4))
                            .unwrap()
                            .as_str(),
                    ),
                )
            })
            .collect();
        let key = attrs
            .get("property")
            .filter(|v| !v.is_empty())
            .or_else(|| attrs.get("name"))
            .cloned()
            .unwrap_or_default()
            .to_lowercase();
        if let Some(content) = attrs.get("content").filter(|v| !v.is_empty()) {
            if !key.is_empty() {
                metadata.entry(key).or_insert_with(|| content.clone());
            }
        }
    }
    if let Some(title) = Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>")
        .unwrap()
        .captures(html)
    {
        metadata.insert(
            "title".into(),
            decode_html(&Regex::new(r"<[^>]*>").unwrap().replace_all(&title[1], "")),
        );
    }
    metadata
}
// JavaScriptのsliceと同じくUTF-16の文字数で切る。
fn shorten(value: &str, maximum: usize) -> String {
    let units: Vec<_> = value.encode_utf16().collect();
    if units.len() <= maximum {
        return value.to_owned();
    }
    format!(
        "{}…",
        String::from_utf16_lossy(&units[..maximum]).trim_end()
    )
}
fn fallback(url: &str) -> Result<Preview> {
    let parsed = http_url(url)?;
    let hostname = parsed
        .host_str()
        .unwrap()
        .strip_prefix("www.")
        .unwrap_or(parsed.host_str().unwrap())
        .to_owned();
    Ok(Preview {
        url: url.into(),
        title: hostname.clone(),
        hostname,
        description: if parsed.path() == "/" {
            String::new()
        } else {
            parsed.path().into()
        },
        image: String::new(),
        fetched_at: None,
    })
}
struct Response {
    body: Vec<u8>,
    url: String,
    content_type: String,
}
// macOS標準のcurlを引数で呼び、シェルは使わない。リダイレクト先もHTTP(S)だけに限る。
fn download(url: &str, image: bool) -> Result<Response> {
    http_url(url)?;
    let file = tempfile::NamedTempFile::new()?;
    let mut command = Command::new("/usr/bin/curl");
    command
        .args([
            "--silent",
            "--show-error",
            "--location",
            "--fail",
            "--max-time",
            "8",
            "--proto",
            "=http,https",
            "--proto-redir",
            "=http,https",
            "--max-redirs",
            "20",
            "--user-agent",
            "Mozilla/5.0 (compatible; nagori-link-preview/1.0)",
            "--header",
            if image {
                "accept: image/*"
            } else {
                "accept: text/html,application/xhtml+xml"
            },
            "--output",
        ])
        .arg(file.path())
        .args(["--write-out", "%{url_effective}\n%{content_type}"]);
    if image {
        command.args(["--max-filesize", &MAX_IMAGE_BYTES.to_string()]);
    }
    let output = command.arg("--url").arg(url).output()?;
    // 接続失敗やタイムアウトは呼び出し側で普通のリンクのままにする。
    if !output.status.success() {
        return Err(Error::new(
            if matches!(output.status.code(), Some(5 | 6 | 7 | 28 | 35)) {
                "OFFLINE"
            } else {
                "LINK_CARD"
            },
            "リンクカードを取得できませんでした。",
        ));
    }
    let info = String::from_utf8(output.stdout).map_err(|_| invalid())?;
    let (final_url, content_type) = info.split_once('\n').ok_or_else(invalid)?;
    http_url(final_url)?;
    let mut body = Vec::new();
    // HTMLはUTF-16で100万文字まで読むため、UTF-8の最大長ぶんだけ読み、後で文字数を切る。
    fs::File::open(file.path())?
        .take(if image {
            MAX_IMAGE_BYTES as u64 + 1
        } else {
            MAX_HTML_LENGTH as u64 * 4
        })
        .read_to_end(&mut body)?;
    if image && body.len() > MAX_IMAGE_BYTES {
        return Err(invalid());
    }
    Ok(Response {
        body,
        url: final_url.into(),
        content_type: content_type.into(),
    })
}
fn save_image(root: &Path, url: &str, image_url: &str) -> Result<String> {
    let hash = format!("{:x}", Sha256::digest(url.as_bytes()));
    let name = format!("{}.webp", &hash[..16]);
    let public_path = format!("/link-cards/{name}");
    let relative = format!("{IMAGE_DIR}/{name}");
    if files::resolve(root, &relative, false).is_ok_and(|path| path.is_file()) {
        return Ok(public_path);
    }
    let response = download(image_url, true)?;
    let mut input = tempfile::tempfile()?;
    input.write_all(&response.body)?;
    let bytes = crate::image::link_card(input)?;
    directory(root, IMAGE_DIR)?;
    let destination = files::resolve(root, &relative, true)?;
    let mut temporary = tempfile::NamedTempFile::new_in(destination.parent().unwrap())?;
    temporary.write_all(&bytes)?;
    temporary
        .persist(destination)
        .map_err(|error| Error::from(error.error))?;
    Ok(public_path)
}
fn preview_from_html(url: &str, html: &str) -> Result<(Preview, String)> {
    let parsed = http_url(url)?;
    let hostname = parsed.host_str().unwrap();
    let metadata = read_metadata(html);
    let choose = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| metadata.get(*key).filter(|value| !value.is_empty()))
            .map(String::as_str)
            .unwrap_or("")
    };
    let title = choose(&["og:title", "twitter:title", "title"]);
    let raw_image = choose(&["og:image", "twitter:image"]);
    let image = if raw_image.is_empty() {
        String::new()
    } else {
        parsed.join(raw_image).map_err(|_| invalid())?.to_string()
    };
    let preview = Preview {
        url: url.into(),
        hostname: hostname.strip_prefix("www.").unwrap_or(hostname).into(),
        title: shorten(if title.is_empty() { hostname } else { title }, 140),
        description: shorten(
            choose(&["og:description", "twitter:description", "description"]),
            220,
        ),
        image: String::new(),
        fetched_at: None,
    };
    Ok((preview, image))
}
impl Fetcher {
    pub fn fetch(&self, root: &Path, url: &str) -> Result<Option<Preview>> {
        http_url(url)?;
        files::validate_blog(root)?;
        let mut recent = self.recent.lock().map_err(|_| invalid())?;
        if let Some(preview) = load(root).get(url) {
            return Ok(Some(preview.clone()));
        }
        recent.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        let key = (root.to_owned(), url.to_owned());
        if let Some((_, value)) = recent.get(&key) {
            return Ok(value.clone());
        }
        let result = (|| {
            let response = download(url, false)?;
            if !response.content_type.contains("text/html")
                && !response.content_type.contains("application/xhtml+xml")
            {
                return Err(invalid());
            }
            let html = String::from_utf8_lossy(&response.body);
            let units: Vec<_> = html.encode_utf16().take(MAX_HTML_LENGTH).collect();
            let (mut preview, remote_image) =
                preview_from_html(&response.url, &String::from_utf16_lossy(&units))?;
            if !remote_image.is_empty() {
                preview.image = save_image(root, url, &remote_image).unwrap_or_default();
            }
            // ISO 8601のUTC時刻はOSのdateで作る。取得と同じくシェルを通さない。
            let date = Command::new("/bin/date")
                .args(["-u", "+%Y-%m-%dT%H:%M:%S.000Z"])
                .output()?;
            if !date.status.success() {
                return Err(invalid());
            }
            preview.fetched_at = Some(String::from_utf8_lossy(&date.stdout).trim().into());
            // ビルドと同じく、保存に失敗しても取得できたプレビューは表示する。
            let _ = save(root, url, &preview);
            Ok(preview)
        })();
        let value = match result {
            Ok(preview) => Some(preview),
            Err(error) if error.code == "OFFLINE" => None,
            Err(_) => Some(fallback(url)?),
        };
        recent.insert(key, (Instant::now(), value.clone()));
        Ok(value)
    }
}
#[cfg(test)]
#[path = "link_cards/tests.rs"]
mod tests;
