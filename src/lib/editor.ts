import type { BlockKind, ListKind } from './blockEdit.ts';

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link';
// 表の操作。table-delete は表全体を消す
export type TableCommandKind = 'row-above' | 'row-below' | 'row-delete' | 'column-left' | 'column-right' | 'column-delete' | 'table-delete';
// 表のマス。from と to は表の原文の範囲、row は見出しを0とした行、column は0始まりの列
export type TableCellRef = { from: number; to: number; row: number; column: number };
export type EditorContextState = { plain: boolean; editable: boolean; block: boolean; heading: boolean; revision: number };
export type EditorContextMenu = EditorContextState & { x: number; y: number; position: number; table?: TableCellRef & { rows: number; columns: number } };
export interface EditorApi {
  replaceText(text: string): void;
  insertText(text: string): void;
  focus(): void;
  isComposing(): boolean;
  // 変換の状態が残っていた時に、変換が終わったものとして装飾と保存を戻す
  endComposition(): void;
  format(kind: FormatKind): void;
  // 選択が触れる行を箇条書きか番号付きリストにする。すでに同じ種類なら記号を外す
  listify(kind: ListKind): void;
  block(kind: BlockKind, revision: number, position: number): void;
  // 位置を省くと現在の選択の先頭で判定する
  contextState(position?: number): EditorContextState;
  find(): void;
  refreshImages(): void;
  goToHeading(index: number): void;
  // 行・列（0始まりのUTF-16）・長さで範囲を選び、画面の中央へ寄せる
  revealRange(line: number, column: number, length: number): void;
  // 表の行・列の追加と削除、表の削除。cell を省くと、フォーカス中のマスで実行する
  tableCommand(kind: TableCommandKind, cell?: TableCellRef): void;
  // 本文の順で index 番目の表の、行・列のマスへフォーカスする
  focusTableCell(index: number, row: number, column: number): void;
  // 本文の順で index 番目の表の列の幅を、列ごとの比で変える。比は区切り行の - の数に書き、比の合計は表の文字の幅に近い約60にそろえる
  setTableColumnWidths(index: number, ratios: number[]): void;
}
