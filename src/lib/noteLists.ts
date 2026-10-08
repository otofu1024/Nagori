// ノートの一覧（すべてのノート・スター付き・最近編集・ゴミ箱）の並びと表示を決める。画面には出さない純粋な処理。
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

// 最近編集: 更新日時の新しい順に、Markdownの記事を最大件数まで並べる。日時が取れない記事は外す
export function recentlyEdited(entries: Entry[], limit = RECENT_NOTE_LIMIT): NoteItem[] {
  const notes = entries
    .filter((entry): entry is Entry & { modified: number } => entry.kind === 'markdown' && typeof entry.modified === 'number')
    .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path, 'ja'))
    .slice(0, limit);
  return withParentLabels(notes);
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
