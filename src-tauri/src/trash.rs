// アプリ内のゴミ箱。削除した項目はワークスペースのフォルダではなく、アプリのデータの場所へ移す。
// 項目ごとにフォルダを作り、その中へ元の項目(item)と記録(record.json)を置く。
// 記録が壊れた項目や、項目が欠けた記録は一覧と整理の対象から外すだけにし、ほかの項目には影響させない。
use crate::files::{self, Entry, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const RECORD_LIMIT: usize = 64 * 1024;
const RECORD: &str = "record.json";
const ITEM: &str = "item";
// macOSのゴミ箱へ送る時だけ、項目を元の名前に変えて置く一時フォルダ
const SENDING: &str = ".sending";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    // ワークスペース基準の元の相対パス
    pub path: String,
    pub name: String,
    pub kind: String,
    pub deleted_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

// 記録にはワークスペースのルートも残し、ほかのワークスペースの項目として扱わないようにする
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    root: String,
    #[serde(flatten)]
    item: TrashItem,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .unwrap_or(0)
}

// 項目の名前は時刻・プロセス・連番で作り、同じ名前の項目が衝突しないようにする
fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or(0);
    format!(
        "{nanos:x}-{:x}-{:x}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    )
}

// フォルダ名にする文字だけを残す。idはフォルダ名になるため、16進数とハイフンに限る
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

// ワークスペースごとの名前は「フォルダ名-ルートのハッシュ」にし、同名のフォルダ同士を分ける
pub fn workspace_dir(base: &Path, root: &Path) -> PathBuf {
    let name: String = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(40)
        .collect();
    let digest = Sha256::digest(root.as_os_str().as_encoded_bytes());
    let hash: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    base.join(format!("{name}-{hash}"))
}

// フォルダの大きさ。シンボリックリンクはたどらず、リンク自体の大きさは数えない
fn size(path: &Path) -> io::Result<u64> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        let mut total = 0;
        for item in fs::read_dir(path)? {
            total += size(&item?.path())?;
        }
        Ok(total)
    } else if metadata.file_type().is_symlink() {
        Ok(0)
    } else {
        Ok(metadata.len())
    }
}

// シンボリックリンクはたどらず、リンクのまま複製する。通常のファイルとフォルダ以外は扱わない
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(from)?;
    if metadata.file_type().is_symlink() {
        std::os::unix::fs::symlink(fs::read_link(from)?, to)
    } else if metadata.is_dir() {
        fs::create_dir(to)?;
        for item in fs::read_dir(from)? {
            let item = item?;
            copy_tree(&item.path(), &to.join(item.file_name()))?;
        }
        Ok(())
    } else if metadata.is_file() {
        fs::copy(from, to).map(|_| ())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "通常のファイルとフォルダ以外は移動できません。",
        ))
    }
}

fn remove_tree(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

// 別のボリュームへ移す時は、同じフォルダに複製を作り、名前を変えてから元を消す。
// 複製が途中で失敗したら複製を消し、元の項目は触らない。
fn copy_then_remove(from: &Path, to: &Path) -> Result<()> {
    let directory = tempfile::Builder::new()
        .prefix(".nagori-save-")
        .tempdir_in(to.parent().unwrap())?;
    let staged = directory.path().join("item");
    let result = copy_tree(from, &staged)
        .map_err(Error::from)
        .and_then(|_| files::rename_exclusive(&staged, to).map_err(Error::from));
    if let Err(error) = result {
        let _ = remove_tree(&staged);
        return Err(error);
    }
    remove_tree(from)?;
    Ok(())
}

// 上書きしないで移す。同じボリュームなら名前を変え、別のボリュームなら複製してから元を消す
fn move_exclusive(from: &Path, to: &Path) -> Result<()> {
    match files::rename_exclusive(from, to) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::EXDEV) => copy_then_remove(from, to),
        Err(error) => Err(error.into()),
    }
}

fn write_record(directory: &Path, record: &Record) -> Result<()> {
    let bytes =
        serde_json::to_vec_pretty(record).map_err(|e| Error::new("TRASH", e.to_string()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary.write_all(&bytes)?;
    temporary.flush()?;
    temporary
        .persist(directory.join(RECORD))
        .map_err(|e| Error::from(e.error))?;
    Ok(())
}

// 記録と項目の両方がそろった時だけ、ゴミ箱の項目として扱う
fn load(directory: &Path, root: &Path) -> Option<Record> {
    let id = directory.file_name()?.to_str()?;
    if !valid_id(id) {
        return None;
    }
    let bytes = files::read_limited(&directory.join(RECORD), RECORD_LIMIT).ok()?;
    let record: Record = serde_json::from_slice(&bytes).ok()?;
    if record.root != root.to_str()? || record.item.id != id {
        return None;
    }
    fs::symlink_metadata(directory.join(ITEM)).ok()?;
    Some(record)
}

fn find(base: &Path, root: &Path, id: &str) -> Result<Record> {
    if !valid_id(id) {
        return Err(Error::new("INVALID", "ゴミ箱の項目が不正です。"));
    }
    load(&workspace_dir(base, root).join(id), root)
        .ok_or_else(|| Error::new("MISSING", "ゴミ箱に該当する項目がありません。"))
}

// ワークスペースのフォルダの項目を、アプリ内のゴミ箱へ移す
pub fn move_to_trash(base: &Path, root: &Path, path: &str) -> Result<TrashItem> {
    let absolute = files::resolve(root, path, false)?;
    if absolute == root {
        return Err(Error::new(
            "INVALID",
            "プロジェクトのルートは削除できません。",
        ));
    }
    let info = files::entry(root, &absolute)?;
    let item = TrashItem {
        id: new_id(),
        path: info.path,
        name: info.name,
        kind: info.kind,
        deleted_at: now_ms(),
        size: Some(size(&absolute)?),
    };
    let root_text = root
        .to_str()
        .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないパスです。"))?;
    let directory = workspace_dir(base, root).join(&item.id);
    fs::create_dir_all(&directory)?;
    // 記録を先に置き、項目が移った後で失敗しても記録のない項目が残らないようにする
    let record = Record {
        root: root_text.to_owned(),
        item: item.clone(),
    };
    let result = write_record(&directory, &record)
        .and_then(|_| move_exclusive(&absolute, &directory.join(ITEM)));
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&directory);
        return Err(error);
    }
    Ok(item)
}

pub fn list(base: &Path, root: &Path) -> Result<Vec<TrashItem>> {
    let directory = workspace_dir(base, root);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut items: Vec<TrashItem> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| load(&entry.path(), root))
        .map(|record| record.item)
        .collect();
    items.sort_by(|a, b| {
        b.deleted_at
            .cmp(&a.deleted_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

// 元の親フォルダが無ければ、プロジェクトの中だけで1つずつ作る
fn ensure_directory(root: &Path, relative_parent: &str) -> Result<PathBuf> {
    let mut current = String::new();
    for part in Path::new(relative_parent).components() {
        let Component::Normal(name) = part else {
            return Err(Error::new("INVALID", "元の場所が不正です。"));
        };
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(
            name.to_str()
                .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないファイル名です。"))?,
        );
        let path = files::resolve(root, &current, true)?;
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => {
                return Err(Error::new(
                    "EXISTS",
                    "元の場所に同じ名前のファイルがあるため復元できません。",
                ))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir(&path)?,
            Err(e) => return Err(e.into()),
        }
    }
    files::resolve(root, relative_parent, false)
}

// 同じ名前があれば「名前 (復元).拡張子」「名前 (復元 2).拡張子」の順に空きを探す
fn restore_name(parent: &Path, name: &str, directory: bool) -> Result<String> {
    match fs::symlink_metadata(parent.join(name)) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(name.to_owned()),
        Err(e) => return Err(e.into()),
        Ok(_) => {}
    }
    let (stem, suffix) = if directory {
        (name.to_owned(), String::new())
    } else {
        let path = Path::new(name);
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(name)
            .to_owned();
        let suffix = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        (stem, suffix)
    };
    for number in 1..=10_000 {
        let candidate = if number == 1 {
            format!("{stem} (復元){suffix}")
        } else {
            format!("{stem} (復元 {number}){suffix}")
        };
        match fs::symlink_metadata(parent.join(&candidate)) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(candidate),
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }
    }
    Err(Error::new("EXISTS", "復元先の名前の空きが見つかりません。"))
}

// 元の場所へ戻す。戻し先はプロジェクトの中に限り、既存の項目は上書きしない
pub fn restore(base: &Path, root: &Path, id: &str) -> Result<Entry> {
    let record = find(base, root, id)?;
    let original = Path::new(&record.item.path);
    if original.file_name().and_then(|n| n.to_str()) != Some(record.item.name.as_str()) {
        return Err(Error::new("INVALID", "ゴミ箱の記録が不正です。"));
    }
    let parent = original.parent().unwrap_or(Path::new(""));
    let parent = parent
        .to_str()
        .ok_or_else(|| Error::new("INVALID", "UTF-8で表現できないパスです。"))?;
    let parent_dir = ensure_directory(root, parent)?;
    let name = restore_name(
        &parent_dir,
        &record.item.name,
        record.item.kind == "directory",
    )?;
    let target = parent_dir.join(&name);
    files::resolve(root, &files::relative(root, &target)?, true)?;
    let directory = workspace_dir(base, root).join(id);
    move_exclusive(&directory.join(ITEM), &target)?;
    // 項目はもう戻っているので、記録の片付けに失敗しても復元は成功とする
    let _ = fs::remove_dir_all(&directory);
    files::entry(root, &target)
}

// 項目をmacOSのゴミ箱へ送ってから、記録を片付ける
fn delete_with(
    base: &Path,
    root: &Path,
    id: &str,
    send: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    // 前回の送信が途中で止まっていれば、先に item へ戻してから確かめる
    if valid_id(id) {
        unstage(&workspace_dir(base, root).join(id))?;
    }
    let record = find(base, root, id)?;
    let directory = workspace_dir(base, root).join(id);
    // ゴミ箱でも元の名前が分かるように、送る前に項目の名前を変える
    let staging = directory.join(SENDING);
    fs::create_dir(&staging)?;
    let staged = staging.join(&record.item.name);
    fs::rename(directory.join(ITEM), &staged)?;
    if let Err(error) = send(&staged) {
        // 送れなかった項目は item へ戻し、一覧から消えないようにする
        fs::rename(&staged, directory.join(ITEM))?;
        let _ = fs::remove_dir(&staging);
        return Err(error);
    }
    let _ = fs::remove_dir_all(&directory);
    Ok(())
}

// 送る途中で止まった項目を item へ戻す。送る前の一時フォルダが無ければ何もしない
fn unstage(directory: &Path) -> Result<()> {
    let staging = directory.join(SENDING);
    let entries = match fs::read_dir(&staging) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        fs::rename(entry?.path(), directory.join(ITEM))?;
    }
    fs::remove_dir(&staging)?;
    Ok(())
}

fn os_trash(path: &Path) -> Result<()> {
    ::trash::delete(path).map_err(|e| Error::new("TRASH", e.to_string()))
}

pub fn delete(base: &Path, root: &Path, id: &str) -> Result<()> {
    delete_with(base, root, id, os_trash)
}

// 今のワークスペースの項目を、すべてmacOSのゴミ箱へ送る。1つ失敗しても残りは続け、最初の失敗を返す
fn empty_with(base: &Path, root: &Path, send: impl Fn(&Path) -> Result<()>) -> Result<()> {
    let mut failure = None;
    for item in list(base, root)? {
        if let Err(error) = delete_with(base, root, &item.id, &send) {
            failure.get_or_insert(error);
        }
    }
    failure.map_or(Ok(()), Err)
}

pub fn empty(base: &Path, root: &Path) -> Result<()> {
    empty_with(base, root, os_trash)
}

// 保存期限より前の項目をmacOSのゴミ箱へ送る。失敗は無視し、ワークスペースを開く処理は止めない
fn purge_expired_with(
    base: &Path,
    root: &Path,
    now: u64,
    retention_ms: u64,
    send: impl Fn(&Path) -> Result<()>,
) {
    let cutoff = now.saturating_sub(retention_ms);
    let Ok(items) = list(base, root) else { return };
    for item in items.iter().filter(|item| item.deleted_at < cutoff) {
        let _ = delete_with(base, root, &item.id, &send);
    }
}

// 保存期限は設定のtrashRetentionDays。Noneは無期限なので何もしない
pub fn purge_expired(base: &Path, root: &Path, retention_days: Option<u16>) {
    let Some(days) = retention_days else { return };
    purge_expired_with(base, root, now_ms(), days as u64 * DAY_MS, os_trash);
}

#[cfg(test)]
mod tests {
    use super::*;

    // テストではmacOSのゴミ箱を使わず、項目を消すだけにする
    fn discard(path: &Path) -> Result<()> {
        remove_tree(path).map_err(Error::from)
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temporary = tempfile::tempdir().unwrap();
        let base = temporary.path().join("app/trash");
        let root = temporary.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        (temporary, base, root)
    }

    fn set_deleted_at(base: &Path, root: &Path, id: &str, value: u64) {
        let path = workspace_dir(base, root).join(id).join(RECORD);
        let mut record: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        record["deletedAt"] = value.into();
        fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();
    }

    #[test]
    fn moved_items_leave_the_workspace_and_are_listed_with_their_details() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "本文").unwrap();
        let item = move_to_trash(&base, &root, "a.md").unwrap();
        assert!(!root.join("a.md").exists());
        assert_eq!(item.path, "a.md");
        assert_eq!(item.name, "a.md");
        assert_eq!(item.kind, "markdown");
        assert_eq!(item.size, Some("本文".len() as u64));
        let listed = list(&base, &root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, item.id);
        // ワークスペースには何も作らない
        let names: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(names.is_empty());
        // 項目の本体はアプリのデータの場所にある
        assert!(workspace_dir(&base, &root)
            .join(&item.id)
            .join(ITEM)
            .is_file());
    }

    #[test]
    fn folders_move_with_children_and_report_total_size() {
        let (_temporary, base, root) = fixture();
        fs::create_dir_all(root.join("notes/deep")).unwrap();
        fs::write(root.join("notes/a.md"), "12345").unwrap();
        fs::write(root.join("notes/deep/b.png"), "678").unwrap();
        let item = move_to_trash(&base, &root, "notes").unwrap();
        assert_eq!(item.kind, "directory");
        assert_eq!(item.size, Some(8));
        assert!(!root.join("notes").exists());
        let moved = workspace_dir(&base, &root).join(&item.id).join(ITEM);
        assert_eq!(fs::read(moved.join("deep/b.png")).unwrap(), b"678");
    }

    #[test]
    fn copy_fallback_keeps_the_original_when_copying_fails() {
        let (_temporary, _base, root) = fixture();
        let from = root.join("folder");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("ok.md"), "ok").unwrap();
        // FIFOは複製できないため、途中で失敗させる
        let fifo =
            std::ffi::CString::new(from.join("pipe").as_os_str().as_encoded_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        let to = root.join("copied");
        assert!(copy_then_remove(&from, &to).is_err());
        assert_eq!(fs::read(from.join("ok.md")).unwrap(), b"ok");
        assert!(!to.exists());
        assert!(no_staging_files(&root));
    }

    #[test]
    fn copy_fallback_moves_folders_and_symlinks_without_following_them() {
        let (_temporary, _base, root) = fixture();
        let from = root.join("folder");
        fs::create_dir_all(from.join("inner")).unwrap();
        fs::write(from.join("inner/a.md"), "a").unwrap();
        std::os::unix::fs::symlink("/etc", from.join("link")).unwrap();
        let to = root.join("copied");
        copy_then_remove(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read(to.join("inner/a.md")).unwrap(), b"a");
        assert_eq!(fs::read_link(to.join("link")).unwrap(), Path::new("/etc"));
        assert!(no_staging_files(&root));
    }

    #[test]
    fn restore_returns_items_and_adds_a_suffix_on_conflict() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "1").unwrap();
        let first = move_to_trash(&base, &root, "a.md").unwrap();
        fs::write(root.join("a.md"), "2").unwrap();
        let restored = restore(&base, &root, &first.id).unwrap();
        assert_eq!(restored.name, "a (復元).md");
        assert_eq!(restored.path, "a (復元).md");
        assert_eq!(restored.kind, "markdown");
        assert_eq!(fs::read_to_string(root.join("a (復元).md")).unwrap(), "1");
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "2");
        assert!(list(&base, &root).unwrap().is_empty());

        fs::write(root.join("a.md"), "3").unwrap();
        let second = move_to_trash(&base, &root, "a.md").unwrap();
        fs::write(root.join("a.md"), "4").unwrap();
        fs::write(root.join("a (復元).md"), "5").unwrap();
        let again = restore(&base, &root, &second.id).unwrap();
        assert_eq!(again.name, "a (復元 2).md");
    }

    #[test]
    fn restore_recreates_missing_parents_and_folder_names_have_no_extension() {
        let (_temporary, base, root) = fixture();
        fs::create_dir_all(root.join("docs/2026")).unwrap();
        fs::write(root.join("docs/2026/post.md"), "x").unwrap();
        let file = move_to_trash(&base, &root, "docs/2026/post.md").unwrap();
        fs::remove_dir_all(root.join("docs")).unwrap();
        restore(&base, &root, &file.id).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("docs/2026/post.md")).unwrap(),
            "x"
        );

        fs::create_dir_all(root.join("draft.v2")).unwrap();
        fs::write(root.join("draft.v2/a.md"), "y").unwrap();
        let folder = move_to_trash(&base, &root, "draft.v2").unwrap();
        fs::create_dir(root.join("draft.v2")).unwrap();
        let restored = restore(&base, &root, &folder.id).unwrap();
        assert_eq!(restored.name, "draft.v2 (復元)");
        assert_eq!(
            fs::read_to_string(root.join("draft.v2 (復元)/a.md")).unwrap(),
            "y"
        );
    }

    #[test]
    fn restore_never_writes_outside_the_workspace() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "x").unwrap();
        let item = move_to_trash(&base, &root, "a.md").unwrap();
        let path = workspace_dir(&base, &root).join(&item.id).join(RECORD);
        let mut record: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        record["path"] = "../escaped.md".into();
        fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(restore(&base, &root, &item.id).is_err());
        assert!(!root.parent().unwrap().join("escaped.md").exists());
        assert!(!root.join("escaped.md").exists());
        // 元の項目は残り、一覧からも消えない
        assert_eq!(list(&base, &root).unwrap().len(), 1);
    }

    #[test]
    fn broken_or_incomplete_records_only_drop_their_own_item() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("good.md"), "g").unwrap();
        fs::write(root.join("broken.md"), "b").unwrap();
        fs::write(root.join("gone.md"), "x").unwrap();
        let good = move_to_trash(&base, &root, "good.md").unwrap();
        let broken = move_to_trash(&base, &root, "broken.md").unwrap();
        let gone = move_to_trash(&base, &root, "gone.md").unwrap();
        let dir = |id: &str| workspace_dir(&base, &root).join(id);
        fs::write(dir(&broken.id).join(RECORD), "{ 壊れた記録").unwrap();
        fs::remove_file(dir(&gone.id).join(ITEM)).unwrap();
        let listed = list(&base, &root).unwrap();
        assert_eq!(
            listed.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            [good.id.as_str()]
        );
        assert!(restore(&base, &root, &broken.id).is_err());
        assert!(restore(&base, &root, "../../etc").is_err());
        assert!(delete_with(&base, &root, &good.id, discard).is_ok());
        assert!(list(&base, &root).unwrap().is_empty());
    }

    #[test]
    fn items_are_named_after_their_original_name_when_sent_to_the_os_trash() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("record.json"), "y").unwrap();
        fs::create_dir(root.join("item")).unwrap();
        let file = move_to_trash(&base, &root, "a.md").unwrap();
        let record = move_to_trash(&base, &root, "record.json").unwrap();
        let folder = move_to_trash(&base, &root, "item").unwrap();
        let seen = std::cell::RefCell::new(vec![]);
        for id in [&file.id, &record.id, &folder.id] {
            delete_with(&base, &root, id, |path| {
                seen.borrow_mut()
                    .push(path.file_name().unwrap().to_string_lossy().into_owned());
                discard(path)
            })
            .unwrap();
        }
        assert_eq!(*seen.borrow(), ["a.md", "record.json", "item"]);
        assert!(list(&base, &root).unwrap().is_empty());
        assert!(!workspace_dir(&base, &root).join(&file.id).exists());
    }

    #[test]
    fn a_failed_send_puts_the_item_back_and_keeps_it_listed() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "x").unwrap();
        let item = move_to_trash(&base, &root, "a.md").unwrap();
        let result = delete_with(&base, &root, &item.id, |_| {
            Err(Error::new("TRASH", "送れません"))
        });
        assert_eq!(result.unwrap_err().code, "TRASH");
        let directory = workspace_dir(&base, &root).join(&item.id);
        assert!(directory.join(ITEM).is_file());
        assert!(!directory.join(SENDING).exists());
        assert_eq!(list(&base, &root).unwrap().len(), 1);
    }

    #[test]
    fn an_interrupted_send_is_recovered_on_the_next_delete() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "x").unwrap();
        let item = move_to_trash(&base, &root, "a.md").unwrap();
        let directory = workspace_dir(&base, &root).join(&item.id);
        fs::create_dir(directory.join(SENDING)).unwrap();
        fs::rename(directory.join(ITEM), directory.join(SENDING).join("a.md")).unwrap();
        let seen = std::cell::RefCell::new(vec![]);
        delete_with(&base, &root, &item.id, |path| {
            seen.borrow_mut().push(path.to_string_lossy().into_owned());
            discard(path)
        })
        .unwrap();
        assert_eq!(seen.borrow().len(), 1);
        assert!(seen.borrow()[0].ends_with("/a.md"));
        assert!(list(&base, &root).unwrap().is_empty());
    }

    #[test]
    fn purge_removes_only_items_older_than_thirty_days() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("old.md"), "o").unwrap();
        fs::write(root.join("new.md"), "n").unwrap();
        let old = move_to_trash(&base, &root, "old.md").unwrap();
        let new = move_to_trash(&base, &root, "new.md").unwrap();
        let now = now_ms();
        let retention = 30 * DAY_MS;
        set_deleted_at(&base, &root, &old.id, now - retention - 1000);
        set_deleted_at(&base, &root, &new.id, now - retention + 60_000);
        purge_expired_with(&base, &root, now, retention, discard);
        let listed = list(&base, &root).unwrap();
        assert_eq!(
            listed.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            [new.id.as_str()]
        );
    }

    #[test]
    fn purge_follows_the_saved_retention_and_skips_unlimited() {
        let (_temporary, base, root) = fixture();
        fs::write(root.join("a.md"), "a").unwrap();
        let item = move_to_trash(&base, &root, "a.md").unwrap();
        let now = now_ms();
        // 10日前に削除した項目は、7日の設定では整理し、30日の設定では残す
        set_deleted_at(&base, &root, &item.id, now - 10 * DAY_MS);
        purge_expired_with(&base, &root, now, 30 * DAY_MS, discard);
        assert_eq!(list(&base, &root).unwrap().len(), 1);
        purge_expired_with(&base, &root, now, 7 * DAY_MS, discard);
        assert!(list(&base, &root).unwrap().is_empty());
        // 無期限の設定では、公開のpurge_expiredは古い項目にも触らない
        fs::write(root.join("b.md"), "b").unwrap();
        let old = move_to_trash(&base, &root, "b.md").unwrap();
        set_deleted_at(&base, &root, &old.id, 0);
        purge_expired(&base, &root, None);
        assert_eq!(list(&base, &root).unwrap().len(), 1);
    }

    #[test]
    fn empty_sends_every_item_and_keeps_going_after_a_failure() {
        let (_temporary, base, root) = fixture();
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(root.join(name), "x").unwrap();
            move_to_trash(&base, &root, name).unwrap();
        }
        let calls = std::cell::Cell::new(0);
        let result = empty_with(&base, &root, |path| {
            calls.set(calls.get() + 1);
            if calls.get() == 1 {
                return Err(Error::new("TRASH", "送れません"));
            }
            discard(path)
        });
        assert_eq!(result.unwrap_err().code, "TRASH");
        assert_eq!(calls.get(), 3);
        assert_eq!(list(&base, &root).unwrap().len(), 1);
    }

    #[test]
    fn each_workspace_keeps_its_own_trash() {
        let (temporary, base, root) = fixture();
        let other = temporary.path().join("elsewhere/workspace");
        fs::create_dir_all(&other).unwrap();
        let other = fs::canonicalize(other).unwrap();
        assert_ne!(workspace_dir(&base, &root), workspace_dir(&base, &other));
        fs::write(root.join("a.md"), "x").unwrap();
        move_to_trash(&base, &root, "a.md").unwrap();
        assert_eq!(list(&base, &root).unwrap().len(), 1);
        assert!(list(&base, &other).unwrap().is_empty());
        assert!(workspace_dir(&base, &root)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("workspace-"));
    }

    #[test]
    fn workspace_items_outside_the_project_and_excluded_paths_are_refused() {
        let (_temporary, base, root) = fixture();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "x").unwrap();
        assert_eq!(
            move_to_trash(&base, &root, ".git/config").unwrap_err().code,
            "EXCLUDED"
        );
        assert_eq!(
            move_to_trash(&base, &root, "../x").unwrap_err().code,
            "OUTSIDE"
        );
        assert_eq!(move_to_trash(&base, &root, "").unwrap_err().code, "INVALID");
        assert!(root.join(".git/config").exists());
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
}
