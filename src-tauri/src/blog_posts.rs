use crate::files::{self, Entry, Error, Result};
use std::{fs, io::Read, path::Path};

// 日付と本文は画面から独立したblogNewPost.tsで組み立てる。
pub fn create(root: &Path, date: &str, text: &str) -> Result<Entry> {
    create_with_suffix(root, date, text, || {
        let mut bytes = [0u8; 3];
        fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
        Ok(format!("{:02x}{:02x}{:02x}", bytes[0], bytes[1], bytes[2]))
    })
}

fn create_with_suffix(
    root: &Path,
    date: &str,
    text: &str,
    mut suffix: impl FnMut() -> Result<String>,
) -> Result<Entry> {
    files::validate_blog(root)?;
    if !regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$")
        .unwrap()
        .is_match(date)
    {
        return Err(Error::new("INVALID", "公開日が不正です。"));
    }
    if text.len() > files::DOCUMENT_LIMIT {
        return Err(Error::new("LIMIT", "文書の上限は2MiBです。"));
    }
    loop {
        let slug = format!("{}-{}", date.replace('-', ""), suffix()?);
        let directory = format!("{}/{slug}", files::BLOG_DIRECTORY);
        let parent = files::resolve(root, files::BLOG_DIRECTORY, false)?;
        // mkdirの排他的な作成で、既存のフォルダやリンクを上書きしない。
        match fs::create_dir(parent.join(&slug)) {
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
            Ok(()) => {}
        }
        let path = format!("{directory}/index.md");
        let result = files::resolve(root, &path, true).and_then(|path| {
            files::create_bytes(&path, text.as_bytes()).and_then(|_| files::entry(root, &path))
        });
        if result.is_err() {
            // 書き込みに失敗した時は、作成した空のフォルダだけを片付ける。
            let _ = fs::remove_dir(parent.join(&slug));
        }
        return result;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn blog() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join(files::BLOG_DIRECTORY)).unwrap();
        fs::create_dir_all(root.path().join("src/theme")).unwrap();
        fs::write(root.path().join("src/theme/theme.css"), "").unwrap();
        fs::write(root.path().join("src/config.ts"), "").unwrap();
        root
    }
    #[test]
    fn creates_article_without_changing_bytes() {
        let root = blog();
        let text = "---\ntitle: \"記号\\\"\\\\\"\n---\n\nここから本文を書きます。\n";
        let entry = create(root.path(), "2026-10-14", text).unwrap();
        assert!(
            regex::Regex::new(r"^src/content/blog/20261014-[0-9a-f]{6}/index\.md$")
                .unwrap()
                .is_match(&entry.path)
        );
        assert_eq!(
            fs::read_to_string(root.path().join(entry.path)).unwrap(),
            text
        );
    }
    #[test]
    fn collision_retries_without_overwriting() {
        let root = blog();
        let existing = root.path().join("src/content/blog/20261014-abcdef");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("index.md"), "既存").unwrap();
        let mut names = ["abcdef", "012345"].into_iter();
        let entry = create_with_suffix(root.path(), "2026-10-14", "新規", || {
            Ok(names.next().unwrap().into())
        })
        .unwrap();
        assert_eq!(entry.path, "src/content/blog/20261014-012345/index.md");
        assert_eq!(
            fs::read_to_string(existing.join("index.md")).unwrap(),
            "既存"
        );
    }
    #[test]
    fn rejects_path_in_date_and_symlink_parent() {
        let root = blog();
        assert_eq!(
            create(root.path(), "../../escape", "").unwrap_err().code,
            "INVALID"
        );
        let outside = tempfile::tempdir().unwrap();
        fs::remove_dir(root.path().join(files::BLOG_DIRECTORY)).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(files::BLOG_DIRECTORY))
            .unwrap();
        assert!(create(root.path(), "2026-10-14", "").is_err());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}
