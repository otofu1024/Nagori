// ワークスペース全体の本文検索。対象・除外・文字コードの判定は、開く処理と同じ決まりに従う
use crate::files::{self, Error, Result, DOCUMENT_LIMIT};
use regex::RegexBuilder;
use serde::Serialize;
use std::path::Path;

// 全体で数える一致の上限。これを超える一致があった時だけ打ち切りとして返す
pub const TOTAL_LIMIT: usize = 500;
// 1ファイルで返す一致の上限
pub const FILE_LIMIT: usize = 50;
// 抜粋に残す、一致の前後の文字数
const CONTEXT: usize = 80;
const QUERY_LIMIT: usize = 1000;
// 正規表現のコンパイルに使うサイズの上限。大きすぎるものは拒む
const PATTERN_LIMIT: usize = 1 << 20;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub results: Vec<FileMatches>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct FileMatches {
    pub path: String,
    pub name: String,
    pub matches: Vec<Match>,
}

// 一致は1つにつき1行。同じ行に複数あれば、その数だけ並ぶ
#[derive(Debug, Serialize)]
pub struct Match {
    // 1始まりの行番号
    pub line: usize,
    // 行の先頭からの位置（UTF-16の単位、0始まり）。エディタの位置と同じ数え方
    pub column: usize,
    pub preview: String,
    // previewの中の一致の位置（UTF-16の単位）
    pub ranges: Vec<[usize; 2]>,
}

// 検索語を正規表現として解釈するか、文字どおりに扱うかを決めて検索する
pub fn run(root: &Path, query: &str, case_sensitive: bool, regexp: bool) -> Result<SearchResult> {
    if query.is_empty() {
        return Ok(SearchResult {
            results: vec![],
            truncated: false,
        });
    }
    if query.chars().count() > QUERY_LIMIT {
        return Err(Error::new("LIMIT", "検索語が長すぎます。"));
    }
    let pattern = if regexp {
        query.to_owned()
    } else {
        regex::escape(query)
    };
    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .size_limit(PATTERN_LIMIT)
        .dfa_size_limit(PATTERN_LIMIT)
        .build()
        .map_err(|error| match error {
            regex::Error::CompiledTooBig(_) => Error::new("REGEX", "正規表現が大きすぎます。"),
            _ => Error::new("REGEX", "正規表現が正しくありません。"),
        })?;

    let mut results = vec![];
    let mut total = 0;
    let mut truncated = false;
    'files: for entry in files::index(root)? {
        // 画像と、テキストとして開けないものは対象外
        if !matches!(entry.kind.as_str(), "markdown" | "other") {
            continue;
        }
        let Some(text) = read_text(root, &entry.path) else {
            continue;
        };
        let mut matches = vec![];
        'lines: for (index, line) in text.split('\n').enumerate() {
            for found in regex.find_iter(line) {
                // 空の一致は行の位置を示すだけなので数えない
                if found.is_empty() {
                    continue;
                }
                if total == TOTAL_LIMIT {
                    truncated = true;
                    if !matches.is_empty() {
                        results.push(file_matches(&entry.path, &entry.name, matches));
                    }
                    break 'files;
                }
                if matches.len() == FILE_LIMIT {
                    break 'lines;
                }
                let (preview, range) = excerpt(line, found.start(), found.end());
                matches.push(Match {
                    line: index + 1,
                    column: utf16_len(&line[..found.start()]),
                    preview,
                    ranges: vec![range],
                });
                total += 1;
            }
        }
        if !matches.is_empty() {
            results.push(file_matches(&entry.path, &entry.name, matches));
        }
    }
    Ok(SearchResult { results, truncated })
}

fn file_matches(path: &str, name: &str, matches: Vec<Match>) -> FileMatches {
    FileMatches {
        path: path.to_owned(),
        name: name.to_owned(),
        matches,
    }
}

// 開く処理と同じ判定で、テキストとして読めた本文だけを返す。読めないファイルと大きすぎるファイルは飛ばす
fn read_text(root: &Path, path: &str) -> Option<String> {
    let absolute = files::resolve(root, path, false).ok()?;
    let bytes = files::read_limited(&absolute, DOCUMENT_LIMIT).ok()?;
    files::text_of(&bytes)
}

// 一致の前後を文字数で切った抜粋と、その中の一致の位置を返す。切った所には「…」を付ける
fn excerpt(line: &str, start: usize, end: usize) -> (String, [usize; 2]) {
    let before = line[..start]
        .char_indices()
        .rev()
        .nth(CONTEXT - 1)
        .map_or(0, |(index, _)| index);
    let after = line[end..]
        .char_indices()
        .nth(CONTEXT)
        .map_or(line.len(), |(index, _)| end + index);
    let lead = if before > 0 { "…" } else { "" };
    let trail = if after < line.len() { "…" } else { "" };
    let preview = format!("{lead}{}{trail}", &line[before..after]);
    let from = utf16_len(lead) + utf16_len(&line[before..start]);
    let to = from + utf16_len(&line[start..end]);
    (preview, [from, to])
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // 位置はUTF-16の単位なので、抜粋の一致の部分を同じ単位で切り出して確かめる
    fn utf16_slice(text: &str, range: [usize; 2]) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[range[0]..range[1]]).unwrap()
    }

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn paths(result: &SearchResult) -> Vec<&str> {
        result
            .results
            .iter()
            .map(|file| file.path.as_str())
            .collect()
    }

    #[test]
    fn case_is_ignored_unless_requested() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "Note\nnote\nNOTE\n").unwrap();
        let loose = run(dir.path(), "note", false, false).unwrap();
        assert_eq!(loose.results[0].matches.len(), 3);
        let strict = run(dir.path(), "note", true, false).unwrap();
        let lines: Vec<usize> = strict.results[0].matches.iter().map(|m| m.line).collect();
        assert_eq!(lines, vec![2]);
    }

    #[test]
    fn plain_query_treats_metacharacters_literally() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "a.c\nabc\n[x]\n").unwrap();
        let result = run(dir.path(), "a.c", false, false).unwrap();
        assert_eq!(result.results[0].matches.len(), 1);
        assert_eq!(result.results[0].matches[0].line, 1);
        let bracket = run(dir.path(), "[x]", false, false).unwrap();
        assert_eq!(bracket.results[0].matches[0].line, 3);
    }

    #[test]
    fn regexp_mode_matches_patterns_and_rejects_invalid_ones() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "id 123\nid 45\nnone\n").unwrap();
        let result = run(dir.path(), r"\d{3}", false, true).unwrap();
        let lines: Vec<usize> = result.results[0].matches.iter().map(|m| m.line).collect();
        assert_eq!(lines, vec![1]);
        let error = run(dir.path(), "(", false, true).unwrap_err();
        assert_eq!(error.code, "REGEX");
        assert_eq!(error.message, "正規表現が正しくありません。");
        // 同じ文字列でも、文字どおりの検索では不正にならない
        assert!(run(dir.path(), "(", false, false)
            .unwrap()
            .results
            .is_empty());
    }

    #[test]
    fn oversized_pattern_is_refused() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "x\n").unwrap();
        let error = run(dir.path(), r"\w{1,1000}\w{1,1000}\w{1,1000}", false, true).unwrap_err();
        assert_eq!(error.code, "REGEX");
    }

    #[test]
    fn empty_and_too_long_queries() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "x\n").unwrap();
        let empty = run(dir.path(), "", false, false).unwrap();
        assert!(empty.results.is_empty() && !empty.truncated);
        let long = "a".repeat(QUERY_LIMIT + 1);
        assert_eq!(
            run(dir.path(), &long, false, false).unwrap_err().code,
            "LIMIT"
        );
    }

    #[test]
    fn excluded_folders_images_and_links_are_not_searched() {
        let dir = workspace();
        let root = dir.path();
        fs::write(root.join("visible.md"), "needle\n").unwrap();
        for folder in [".git", "node_modules"] {
            fs::create_dir(root.join(folder)).unwrap();
            fs::write(root.join(folder).join("hidden.md"), "needle\n").unwrap();
        }
        fs::write(root.join("picture.png"), "needle\n").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("visible.md"), root.join("link.md")).unwrap();
        }
        let result = run(root, "needle", false, false).unwrap();
        assert_eq!(paths(&result), vec!["visible.md"]);
    }

    #[test]
    fn large_binary_and_non_utf8_files_are_skipped() {
        let dir = workspace();
        let root = dir.path();
        fs::write(root.join("ok.txt"), "needle\n").unwrap();
        let mut large = b"needle\n".to_vec();
        large.resize(DOCUMENT_LIMIT + 1, b'a');
        fs::write(root.join("large.md"), large).unwrap();
        fs::write(root.join("latin1.md"), b"needle \xff\n").unwrap();
        fs::write(root.join("binary.bin"), b"needle\0\n").unwrap();
        let result = run(root, "needle", false, false).unwrap();
        assert_eq!(paths(&result), vec!["ok.txt"]);
    }

    #[test]
    fn japanese_text_and_positions_use_utf16_units() {
        let dir = workspace();
        // 「😀」はUTF-16で2単位なので、後ろの一致の位置は文字数とずれる
        fs::write(dir.path().join("a.md"), "あいうnote\n😀note\n").unwrap();
        let result = run(dir.path(), "note", false, false).unwrap();
        let matches = &result.results[0].matches;
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].column, 3);
        assert_eq!(matches[1].line, 2);
        assert_eq!(matches[1].column, 2);
        assert_eq!(
            utf16_slice(&matches[1].preview, matches[1].ranges[0]),
            "note"
        );
        let japanese = run(dir.path(), "いう", false, false).unwrap();
        assert_eq!(japanese.results[0].matches[0].column, 1);
        // 1文字の日本語も検索できる
        assert_eq!(
            run(dir.path(), "あ", false, false).unwrap().results.len(),
            1
        );
    }

    #[test]
    fn line_numbers_follow_crlf_documents() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "one\r\ntwo needle\r\nthree\r\n").unwrap();
        let result = run(dir.path(), "needle", false, false).unwrap();
        let found = &result.results[0].matches[0];
        assert_eq!(found.line, 2);
        assert_eq!(found.column, 4);
        assert_eq!(utf16_slice(&found.preview, found.ranges[0]), "needle");
    }

    #[test]
    fn long_lines_are_cut_around_the_match() {
        let (preview, range) = excerpt(
            &format!("{}needle{}", "a".repeat(300), "b".repeat(300)),
            300,
            306,
        );
        assert!(preview.starts_with('…') && preview.ends_with('…'));
        assert_eq!(utf16_slice(&preview, range), "needle");
        assert_eq!(preview.chars().filter(|c| *c == 'a').count(), CONTEXT);
        assert_eq!(preview.chars().filter(|c| *c == 'b').count(), CONTEXT);
        // 短い行は切らず、記号も付けない
        let (short, short_range) = excerpt("say needle", 4, 10);
        assert_eq!(short, "say needle");
        assert_eq!(short_range, [4, 10]);
    }

    #[test]
    fn long_lines_keep_multibyte_context_intact() {
        let line = format!("{}needle{}", "あ".repeat(200), "い".repeat(200));
        let start = line.find("needle").unwrap();
        let (preview, range) = excerpt(&line, start, start + 6);
        assert_eq!(utf16_slice(&preview, range), "needle");
    }

    #[test]
    fn per_file_limit_is_applied() {
        let dir = workspace();
        fs::write(dir.path().join("many.md"), "hit\n".repeat(FILE_LIMIT + 10)).unwrap();
        let result = run(dir.path(), "hit", false, false).unwrap();
        assert_eq!(result.results[0].matches.len(), FILE_LIMIT);
        assert!(!result.truncated);
    }

    #[test]
    fn total_limit_marks_result_truncated() {
        let dir = workspace();
        let root = dir.path();
        // 1ファイル50件の11ファイルで551件になるため、501件目で打ち切る
        for index in 0..11 {
            fs::write(
                root.join(format!("f{index}.md")),
                "hit\n".repeat(FILE_LIMIT),
            )
            .unwrap();
        }
        let result = run(root, "hit", false, false).unwrap();
        let total: usize = result.results.iter().map(|file| file.matches.len()).sum();
        assert_eq!(total, TOTAL_LIMIT);
        assert!(result.truncated);
    }

    #[test]
    fn exactly_the_total_limit_is_not_truncated() {
        let dir = workspace();
        let root = dir.path();
        for index in 0..10 {
            fs::write(
                root.join(format!("f{index}.md")),
                "hit\n".repeat(FILE_LIMIT),
            )
            .unwrap();
        }
        let result = run(root, "hit", false, false).unwrap();
        let total: usize = result.results.iter().map(|file| file.matches.len()).sum();
        assert_eq!(total, TOTAL_LIMIT);
        assert!(!result.truncated);
    }

    #[test]
    fn empty_matches_are_ignored() {
        let dir = workspace();
        fs::write(dir.path().join("a.md"), "abc\n").unwrap();
        let result = run(dir.path(), "x*", false, true).unwrap();
        assert!(result.results.is_empty());
    }
}
