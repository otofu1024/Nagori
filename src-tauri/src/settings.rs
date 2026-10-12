use crate::files::{self, Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::Manager;

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
    // オンの時、本文の幅はウィンドウの空きに合わせて決める。editor_widthは手動の値として残す。古い設定はオフで読む
    pub auto_editor_width: bool,
    pub blog_features: bool,
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
            auto_editor_width: false,
            blog_features: true,
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

fn serialize_ranged<S: serde::Serializer, const MIN: u16, const MAX: u16, const INITIAL: u16>(
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

// 字体はsansとserifだけを受け付け、それ以外はsansへ戻す
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
            let time = time
                .as_f64()
                .filter(|time| time.is_finite() && *time >= 0.0)?;
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
                root.is_empty() || paths.len() > 1000 || paths.iter().any(|path| path.is_empty())
            })
        {
            return Err(Error::new("INVALID", "設定値が範囲外です。"));
        }
        Ok(())
    }
}

// 保存された設定を読む。ファイルがなければ初期値を返す
pub fn read(app: &tauri::AppHandle) -> Result<Settings> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::new("SETTINGS", e.to_string()))?
        .join("settings.json");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = files::read_limited(&path, 64 * 1024)?;
    let settings: Settings =
        serde_json::from_slice(&bytes).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
    settings.validate()?;
    Ok(settings)
}

pub fn save(app: tauri::AppHandle, settings: Settings) -> Result<()> {
    use std::io::Write;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::new("SETTINGS", e.to_string()))?;
    std::fs::create_dir_all(&directory)?;
    let bytes =
        serde_json::to_vec_pretty(&settings).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
    if bytes.len() > 64 * 1024 {
        return Err(Error::new("LIMIT", "設定サイズの上限を超えています。"));
    }
    let mut temporary = tempfile::NamedTempFile::new_in(&directory)?;
    temporary.write_all(&bytes)?;
    temporary.flush()?;
    temporary
        .persist(directory.join("settings.json"))
        .map_err(|e| Error::from(e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests;
