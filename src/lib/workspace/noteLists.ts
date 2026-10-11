// ノートの一覧（すべてのノート・スター付き・最近見たノート・ゴミ箱）の並びと表示を決める。画面には出さない純粋な処理。
import { containsPath, parentPath, renamedPath, type Entry } from './navigation.ts';

// Rust側のTrashItemと同じ形。deletedAtはミリ秒、sizeはバイト
export type TrashItem = {
  id: string;
  path: string;
  name: string;
  kind: 'directory' | 'markdown' | 'image' | 'other';
  deletedAt: number;
  size?: number;
};

export type NoteItem = Entry & { parent: string };

export const RECENT_NOTE_LIMIT = 30;

// 同じ名前の記事が他にあれば、親フォルダの相対パスを添える。直下の記事には「プロジェクト直下」と添える
export function withParentLabels<T extends Entry>(items: T[]): Array<T & { parent: string }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return items.map((item) => ({
    ...item,
    parent: (counts.get(item.name) ?? 0) > 1 ? parentPath(item.path) || 'プロジェクト直下' : '',
  }));
}

// すべてのノート: Markdownの記事を名前の順に並べる。大文字小文字は同一視し、同じ並びのときはパスで確定する
export function allNotes(entries: Entry[]): NoteItem[] {
  const notes = entries
    .filter((entry) => entry.kind === 'markdown')
    .sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base', numeric: true }) || a.path.localeCompare(b.path, 'ja'));
  return withParentLabels(notes);
}

// 開いた時刻の記録は、この件数までを新しい順に残す
export const OPENED_LIMIT = 200;

// 最近見たノート: 更新日時と最後に開いた時刻のうち新しい方の順に、Markdownの記事を最大件数まで並べる。
// 開いただけの記事も入る。どちらも取れない記事は外す。並べた日時は新しい方で置き換える
export function recentlyEdited(entries: Entry[], opened: Record<string, number> = {}, limit = RECENT_NOTE_LIMIT): NoteItem[] {
  const notes = entries
    .filter((entry) => entry.kind === 'markdown')
    .flatMap((entry) => {
      const at = Math.max(entry.modified ?? -Infinity, opened[entry.path] ?? -Infinity);
      return Number.isFinite(at) ? [{ ...entry, modified: at }] : [];
    })
    .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path, 'ja'))
    .slice(0, limit);
  return withParentLabels(notes);
}

// 記事を開いた時刻を記録する。新しい順に OPENED_LIMIT 件までを残す
export function recordOpened(opened: Record<string, number>, path: string, now: number = Date.now()): Record<string, number> {
  const next = { ...opened, [path]: now };
  return Object.fromEntries(Object.entries(next).sort(([, a], [, b]) => b - a).slice(0, OPENED_LIMIT));
}

// 名前変更・移動に合わせて、開いた時刻の記録のパスを更新する
export function renameOpened(opened: Record<string, number>, old: string, next: string): Record<string, number> {
  return Object.fromEntries(Object.entries(opened).map(([path, at]) => [renamedPath(path, old, next), at]));
}

// 削除（ゴミ箱へ移動）に合わせて、対象とその配下の記録を外す
export function removeOpened(opened: Record<string, number>, path: string): Record<string, number> {
  return Object.fromEntries(Object.entries(opened).filter(([item]) => !containsPath(path, item)));
}

// スター付き: 設定に保存した順（新しい順）を保ち、今の索引にないものや記事でないものは出さない
export function starredNotes(paths: string[], entries: Entry[]): NoteItem[] {
  const byPath = new Map(entries.filter((entry) => entry.kind === 'markdown').map((entry) => [entry.path, entry]));
  const notes = [...new Set(paths)].flatMap((path) => {
    const entry = byPath.get(path);
    return entry ? [entry] : [];
  });
  return withParentLabels(notes);
}

// スターの付け外し。付けた記事を先頭に置き、同じ記事が重ならないようにする
export function setStarred(starred: Record<string, string[]>, root: string, path: string, on: boolean): Record<string, string[]> {
  const rest = (starred[root] ?? []).filter((item) => item !== path);
  return { ...starred, [root]: on ? [path, ...rest] : rest };
}

// 名前変更・移動に合わせて、スターの相対パスを更新する
export function renameStarred(starred: Record<string, string[]>, root: string, old: string, next: string): Record<string, string[]> {
  if (!starred[root]) return starred;
  return { ...starred, [root]: starred[root].map((path) => renamedPath(path, old, next)) };
}

// 削除（ゴミ箱へ移動）に合わせて、対象とその配下のスターを外す
export function removeStarred(starred: Record<string, string[]>, root: string, path: string): Record<string, string[]> {
  if (!starred[root]) return starred;
  return { ...starred, [root]: starred[root].filter((item) => !containsPath(path, item)) };
}

const DAY = 86_400_000;

// 更新日時の表示。今日は時刻を付け、昨日は日付だけ、同じ年は月日、それ以外は年も付ける
export function formatNoteDate(ms: number, now: number = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now);
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / DAY);
  if (days === 0) return `今日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (days === 1) return '昨日';
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === today.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`;
}
