export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link';
export interface EditorApi {
  getText(): string;
  replaceText(text: string): void;
  insertText(text: string): void;
  focus(): void;
  isComposing(): boolean;
  format(kind: FormatKind): void;
  find(): void;
  refreshImages(): void;
}
