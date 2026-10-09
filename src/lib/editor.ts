import type { BlockKind } from './blockEdit.ts';

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link';
export type EditorContextState = { plain: boolean; editable: boolean; block: boolean; heading: boolean; revision: number };
export type EditorContextMenu = EditorContextState & { x: number; y: number; position: number };
export interface EditorApi {
  replaceText(text: string): void;
  insertText(text: string): void;
  focus(): void;
  isComposing(): boolean;
  // 変換の状態が残っていた時に、変換が終わったものとして装飾と保存を戻す
  endComposition(): void;
  format(kind: FormatKind): void;
  block(kind: BlockKind, revision: number, position: number): void;
  // 位置を省くと現在の選択の先頭で判定する
  contextState(position?: number): EditorContextState;
  find(): void;
  refreshImages(): void;
  goToHeading(index: number): void;
  // 行・列（0始まりのUTF-16）・長さで範囲を選び、画面の中央へ寄せる
  revealRange(line: number, column: number, length: number): void;
}
