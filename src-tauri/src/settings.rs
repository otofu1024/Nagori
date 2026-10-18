use crate::files::{self, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::{Mutex, PoisonError};
use tauri::Manager;

// 終了した時に開いていたウィンドウ。フォルダと、そのウィンドウで最後に開いていたファイル
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    pub project: String,
    pub file: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // 移行前の設定の項目。ウィンドウごとの状態になったので、新しい保存では書かない。openWindowsがない時だけ読む
    pub last_project: Option<String>,
    pub last_file: Option<String>,
    // 終了した時に開いていたウィンドウ。nullは移行前の設定で、その時はlastProjectとlastFileを読む
    pub open_windows: Option<Vec<OpenWindow>>,
    pub theme: String,
    pub font_size: u8,
    // キーはワークスペースのルートの絶対パス、値はそのルートで最近開いたファイルの相対パス（新しい順）
    pub recent_files: BTreeMap<String, Vec<String>>,
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
    pub blog_article_header: bool,
    pub blog_link_cards_enabled: bool,
    pub blog_characters_enabled: bool,
    pub blog_body_theme: bool,
    pub blog_indent_on_enter: bool,
    // キーはワークスペースのルートの絶対パス、その中のキーはワークスペース基準の相対パス、値は最後にNagoriで開いた時刻（Unixのミリ秒）
    #[serde(deserialize_with = "deserialize_recent_opened")]
    pub recent_opened_at: BTreeMap<String, BTreeMap<String, u64>>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            last_project: None,
            last_file: None,
            open_windows: None,
            theme: "system".into(),
            font_size: 19,
            recent_files: BTreeMap::new(),
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
            blog_article_header: true,
            blog_link_cards_enabled: true,
            blog_characters_enabled: true,
            blog_body_theme: true,
            blog_indent_on_enter: true,
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

// 最近開いた時刻は、ルートごとに、時刻が数でない項目を捨て、上限を超えたら古いものから捨てる
const RECENT_OPENED_LIMIT: usize = 200;
fn deserialize_recent_opened<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, BTreeMap<String, u64>>, D::Error> {
    let roots = BTreeMap::<String, BTreeMap<String, serde_json::Value>>::deserialize(deserializer)?;
    Ok(roots
        .into_iter()
        .map(|(root, entries)| (root, recent_opened(entries)))
        .collect())
}

fn recent_opened(entries: BTreeMap<String, serde_json::Value>) -> BTreeMap<String, u64> {
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
    opened.into_iter().collect()
}

// ワークスペースのルートごとに持つ項目。保存は項目の丸ごとではなく、変わったルートだけを送り、保存されている値へルートごとに重ねる
const ROOT_KEYED: [&str; 3] = ["starred", "recentFiles", "recentOpenedAt"];

impl Settings {
    pub fn validate(&self) -> Result<()> {
        if !["system", "light", "dark"].contains(&self.theme.as_str())
            || !(12..=32).contains(&self.font_size)
            || self.recent_files.len() > 100
            || self
                .recent_files
                .iter()
                .any(|(root, files)| root.is_empty() || files.len() > 100)
            || self.recent_opened_at.len() > 100
            || self.recent_opened_at.keys().any(|root| root.is_empty())
            || self
                .open_windows
                .as_ref()
                .is_some_and(|windows| windows.len() > 100)
            || self.starred.len() > 100
            || self.starred.iter().any(|(root, paths)| {
                root.is_empty() || paths.len() > 1000 || paths.iter().any(|path| path.is_empty())
            })
        {
            return Err(Error::new("INVALID", "設定値が範囲外です。"));
        }
        Ok(())
    }
    // 開き直すウィンドウの一覧。openWindowsがない移行前の設定は、lastProjectがあれば1つだけ開く
    pub fn restored_windows(&self) -> Vec<OpenWindow> {
        match &self.open_windows {
            Some(windows) => windows.clone(),
            None => self
                .last_project
                .iter()
                .map(|project| OpenWindow {
                    project: project.clone(),
                    file: self.last_file.clone(),
                })
                .collect(),
        }
    }
}

// 設定ファイルの読み書きを1つずつに直列化する。ウィンドウごとの保存が互いの変更を消さないように、読み直してから書く
static WRITE_LOCK: Mutex<()> = Mutex::new(());

// 保存された設定を読む。ファイルがなければ初期値を返す
pub fn read(app: &tauri::AppHandle) -> Result<Settings> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = files::read_limited(&path, 64 * 1024)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
    from_stored(value)
}

// 保存された形のままの設定を、移行してから読む
fn from_stored(mut value: Value) -> Result<Settings> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| Error::new("SETTINGS", "設定の形式が正しくありません。"))?;
    migrate_recent(object);
    let settings: Settings =
        serde_json::from_value(value).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
    settings.validate()?;
    Ok(settings)
}

// 移行前の設定は、最近見たノートを全ウィンドウで1つだけ持っていた。lastProjectがあればそのルートの記録として移し、なければ捨てる
fn migrate_recent(object: &mut Map<String, Value>) {
    let root = object
        .get("lastProject")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if matches!(object.get("recentFiles"), Some(Value::Array(_))) {
        let files = object.remove("recentFiles").unwrap_or(Value::Null);
        object.insert(
            "recentFiles".to_owned(),
            keyed_by_root(root.as_deref(), files),
        );
    }
    // 移行前は、時刻のマップが1つだけだった。新しい形ではルートの中にマップが入る
    let legacy_opened = matches!(
        object.get("recentOpenedAt"),
        Some(Value::Object(entries)) if entries.values().any(|time| !time.is_object())
    );
    if legacy_opened {
        let opened = object.remove("recentOpenedAt").unwrap_or(Value::Null);
        object.insert(
            "recentOpenedAt".to_owned(),
            keyed_by_root(root.as_deref(), opened),
        );
    }
}

// ルートが分からない古い記録は、ルートなしの空の記録にする
fn keyed_by_root(root: Option<&str>, value: Value) -> Value {
    let mut keyed = Map::new();
    if let Some(root) = root {
        keyed.insert(root.to_owned(), value);
    }
    Value::Object(keyed)
}

// 送られた項目だけを、いま保存されている設定へ重ねて書く。送られなかった項目は、ほかのウィンドウの変更をそのまま残す
pub fn update(app: &tauri::AppHandle, patch: Map<String, Value>) -> Result<Settings> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let path = settings_path(app)?;
    let current = if path.exists() {
        let bytes = files::read_limited(&path, 64 * 1024)?;
        serde_json::from_slice(&bytes).map_err(|e| Error::new("SETTINGS", e.to_string()))?
    } else {
        serde_json::to_value(Settings::default())
            .map_err(|e| Error::new("SETTINGS", e.to_string()))?
    };
    let settings = merge(current, patch)?;
    save(app, &settings)?;
    Ok(settings)
}

// 現在の設定に項目を重ね、読み込みと同じ規則で整えてから確かめる。範囲外の値は保存させない。
// ルートごとの項目は、送られたルートだけを差し替え、nullのルートは外す。ほかのルートは残す
pub fn merge(mut current: Value, patch: Map<String, Value>) -> Result<Settings> {
    let object = current
        .as_object_mut()
        .ok_or_else(|| Error::new("SETTINGS", "設定の形式が正しくありません。"))?;
    migrate_recent(object);
    let mut patch = patch;
    for key in ROOT_KEYED {
        match patch.remove(key) {
            Some(Value::Object(roots)) => apply_roots(object, key, roots),
            // 型が違う値は、読み込みの検査で拒否する
            Some(value) => {
                object.insert(key.to_owned(), value);
            }
            None => {}
        }
    }
    object.extend(patch);
    from_stored(current)
}

// ルートごとの項目を重ねる。nullのルートは外し、送られなかったルートは残す
fn apply_roots(object: &mut Map<String, Value>, key: &str, roots: Map<String, Value>) {
    let entry = object
        .entry(key)
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    if let Value::Object(saved) = entry {
        for (root, value) in roots {
            if value.is_null() {
                saved.remove(&root);
            } else {
                saved.insert(root, value);
            }
        }
    }
}

// 別のウィンドウへ知らせる値。ルートごとの項目は、送ったルートの保存後の値を送り、外したルートはnullにする
pub fn broadcast_values(stored: &Value, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut values = Map::new();
    for (key, sent) in patch {
        let Some(saved) = stored.get(key.as_str()) else {
            continue;
        };
        let value = match sent.as_object() {
            Some(roots) if ROOT_KEYED.contains(&key.as_str()) => Value::Object(
                roots
                    .keys()
                    .map(|root| {
                        let value = saved.get(root.as_str()).cloned().unwrap_or(Value::Null);
                        (root.clone(), value)
                    })
                    .collect(),
            ),
            _ => saved.clone(),
        };
        values.insert(key.clone(), value);
    }
    values
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| Error::new("SETTINGS", e.to_string()))?
        .join("settings.json"))
}

fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<()> {
    use std::io::Write;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::new("SETTINGS", e.to_string()))?;
    std::fs::create_dir_all(&directory)?;
    let bytes =
        serde_json::to_vec_pretty(settings).map_err(|e| Error::new("SETTINGS", e.to_string()))?;
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
