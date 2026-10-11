import type { Text } from '@codemirror/state';

// ワークスペース全体の検索の結果。Rust側のsearch::SearchResultと同じ形
export type SearchMatch = { line: number; column: number; preview: string; ranges: Array<[number, number]> };
export type SearchFile = { path: string; name: string; matches: SearchMatch[] };
export type SearchResponse = { results: SearchFile[]; truncated: boolean };
// 開く先。行と位置はエディタの文書に合わせ、長さはUTF-16の単位で持つ
export type SearchHit = { path: string; line: number; column: number; length: number };

// 1ファイルの一致の上限。Rust側のFILE_LIMITと同じ値
export const FILE_LIMIT = 50;
export const DEBOUNCE_MS = 200;

// 空の時は検索しない。2文字未満の英数字だけの時も検索しない（1文字の日本語は検索する）
export function shouldSearch(query: string) {
  if (!query) return false;
  return !(query.length < 2 && /^[A-Za-z0-9]*$/.test(query));
}

// 一致を画面の上から順に並べ、ファイルごとにまとめる。indexは↑↓で選ぶ順番
export function groupMatches(results: SearchFile[]) {
  let index = 0;
  return results.map((file) => ({
    file,
    rows: file.matches.map((match) => ({ match, index: index++ })),
  }));
}

export function matchCount(results: SearchFile[]) {
  return results.reduce((count, file) => count + file.matches.length, 0);
}

// 一致した部分だけを印を付けて返す。previewの位置はUTF-16の単位なので、文字列の切り出しと同じ数え方で分ける
export function segments(preview: string, ranges: Array<[number, number]>) {
  const parts: Array<{ text: string; hit: boolean }> = [];
  let position = 0;
  for (const [from, to] of ranges) {
    if (from < position || to > preview.length || from >= to) continue;
    if (from > position) parts.push({ text: preview.slice(position, from), hit: false });
    parts.push({ text: preview.slice(from, to), hit: true });
    position = to;
  }
  if (position < preview.length) parts.push({ text: preview.slice(position), hit: false });
  return parts;
}

// 開く先の行と位置から、エディタの文書の範囲を求める。行の末尾を超える位置は行の末尾に寄せる
export function matchSpan(doc: Text, line: number, column: number, length: number) {
  if (line < 1 || line > doc.lines) return null;
  const info = doc.line(line);
  const from = Math.min(info.to, info.from + Math.max(0, column));
  const to = Math.min(info.to, from + Math.max(0, length));
  return { from, to };
}

export function hitOf(path: string, match: SearchMatch): SearchHit {
  const [from, to] = match.ranges[0] ?? [0, 0];
  return { path, line: match.line, column: match.column, length: to - from };
}

// 新しい問い合わせの結果だけを採る。古い問い合わせの結果が後から来ても捨てる
export function latestOnly() {
  let current = 0;
  return {
    start() {
      return ++current;
    },
    cancel() {
      current++;
    },
    isCurrent(id: number) {
      return id === current;
    },
  };
}
