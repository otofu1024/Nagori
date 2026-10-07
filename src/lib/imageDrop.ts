import { EditorView, dropCursor } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';

const types = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const extensions = /\.(png|jpe?g|gif|webp)$/i;
// ファイルへのページ移動を止め、エディタ内のドロップ処理にはイベントを渡す
export function preventFileNavigation(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
}

export type ImageDropState = {
  plain: boolean; readonly: boolean; busy: boolean; saving: boolean;
  composing: boolean; previewOnly: boolean; saved: boolean;
};

export function imageDropReason(state: ImageDropState): string | null {
  if (state.plain) return '画像はMarkdownの記事にドロップしてください。';
  if (!state.saved) return '記事を保存してから画像をドロップしてください。';
  if (state.readonly || state.previewOnly) return '編集可能なMarkdownを開いてください。';
  if (state.composing) return '日本語の変換を確定してから画像をドロップしてください。';
  if (state.busy || state.saving) return 'ファイルの処理が終わってから画像をドロップしてください。';
  return null;
}

export function validateDroppedImages(files: readonly File[]): void {
  for (const file of files) {
    if (!(types.has(file.type) || (!file.type && extensions.test(file.name)))) {
      throw new Error('取り込める画像はPNG、JPEG、GIF、WebPです。');
    }
    if (file.size > 20 * 1024 * 1024) throw new Error('画像は20MiB以下にしてください。');
  }
}

// 全ファイルを確認してから順にコピーし、記法をまとめて返す
export async function importDroppedImages(files: readonly File[], copy: (bytes: Uint8Array) => Promise<{ markdown: string }>): Promise<string> {
  validateDroppedImages(files);
  const markdown: string[] = [];
  for (const file of files) markdown.push((await copy(new Uint8Array(await file.arrayBuffer()))).markdown);
  return markdown.join('\n');
}

export function imageDrop(options: {
  state: () => ImageDropState;
  importImages: (files: File[]) => Promise<string | null>;
  notify: (reason: string) => void;
}) {
  return [dropCursor(), EditorView.domEventHandlers({
    dragover(event) {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
      return false;
    },
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      const reason = imageDropReason({ ...options.state(), composing: options.state().composing || view.composing });
      if (reason) { options.notify(reason); return true; }
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return true;
      const doc = view.state.doc;
      void options.importImages(files).then(text => {
        if (!text) return;
        // コピー中に記事や変換状態が変わった時は、古い位置へ挿入しない
        if (!view.dom.isConnected || view.state.doc !== doc || view.composing || imageDropReason(options.state())) {
          options.notify('編集状態が変わったため、画像の記法を挿入しませんでした。');
          return;
        }
        view.dispatch({ changes: { from: position, insert: text }, selection: { anchor: position + text.length }, userEvent: 'input.drop', annotations: isolateHistory.of('full') });
        view.focus();
      }).catch(error => options.notify(String(error instanceof Error ? error.message : error)));
      return true;
    },
  })];
}
