import type { BlockKind } from './blockEdit.ts';

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link';
export type EditorContextState = { plain: boolean; editable: boolean; block: boolean; heading: boolean; revision: number };
export type EditorContextMenu = EditorContextState & { x: number; y: number; position: number };
export interface EditorApi {
  replaceText(text: string): void;
  insertText(text: string): void;
  focus(): void;
  isComposing(): boolean;
  format(kind: FormatKind): void;
  block(kind: BlockKind, revision: number): void;
  contextState(): EditorContextState;
  find(): void;
  refreshImages(): void;
  goToHeading(index: number): void;
  // 行・列（0始まりのUTF-16）・長さで範囲を選び、画面の中央へ寄せる
  revealRange(line: number, column: number, length: number): void;
}
