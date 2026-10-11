import { containsPath, parentPath, type Entry } from './navigation.ts';

// サイドバー内の移動で使う独自のデータの型。Finderからのファイルのドロップ（Files）とは見分ける
export const DRAG_TYPE = 'application/x-nagori-path';
// 閉じたフォルダの上に止めた時、開くまでの時間（ミリ秒）
export const HOLD_OPEN_MS = 600;

// ドラッグ中の項目。dataTransferはdragover中に読めないため、モジュールで持つ
let source: Entry | null = null;

export function dragSource(): Entry | null {
  return source;
}
export function beginDrag(event: DragEvent, entry: Entry): void {
  source = entry;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(DRAG_TYPE, entry.path);
}
export function endDrag(): void {
  source = null;
}
// サイドバー内のドラッグか。Finderからのファイルは対象にしない
export function isInternalDrag(event: DragEvent): boolean {
  return !!source && !!event.dataTransfer?.types.includes(DRAG_TYPE);
}

// 項目を移せない時の理由。移せればnull。同じ名前の確認は移動の処理（Rust側）で行う
export function moveBlock(entry: Entry, toDirectory: string): string | null {
  if (parentPath(entry.path) === toDirectory) return '同じ場所です。';
  if (containsPath(entry.path, toDirectory)) return '自分自身や配下のフォルダへは移動できません。';
  return null;
}

// ゴミ箱へ移せる項目か。シンボリックリンクは対象にしない
export function canTrash(entry: Entry): boolean {
  return entry.kind !== 'symlink';
}

// ワークスペースの名前の上へ離した項目を、一番上へ移せるか。移せなければnull
export function rootDrop(event: DragEvent): Entry | null {
  const entry = dragSource();
  return entry && isInternalDrag(event) && !moveBlock(entry, '') ? entry : null;
}
