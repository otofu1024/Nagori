import { isolateHistory } from '@codemirror/commands';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { clipboardImage } from './image.ts';
import { frontMatter, intersects, markdownParser, walk } from './markdown.ts';

export function linkPaste(state: EditorState, clipboard: string) {
  const selection = state.selection.main, label = state.doc.sliceString(selection.from, selection.to), url = clipboard.trim();
  if (state.readOnly || state.selection.ranges.length !== 1 || selection.empty || /[\r\n\[\]]/.test(label) ||
    !/^(?:https?:\/\/|mailto:)\S+$/i.test(url) || /[\u0000-\u001f\u007f]/.test(url)) return null;
  try { new URL(url); } catch { return null; }
  const text = state.doc.toString(), front = frontMatter(text);
  let blocked = !!front && intersects(front, selection);
  walk(markdownParser.parse(text).topNode, node => {
    if (!intersects(node, selection)) return false;
    if (/^(?:Link|Image|Autolink|LinkReference|InlineCode|FencedCode|CodeBlock|MathBlock|MathUnclosed|DisplayMath|InlineMath|HTMLBlock|HTMLTag)$/.test(node.name)) blocked = true;
  });
  if (blocked) return null;
  const target = url.replace(/[<>\\]/g, c => c === '<' ? '%3C' : c === '>' ? '%3E' : '%5C');
  const insert = `[${label.replace(/\\/g, '\\\\')}](<${target}>)`;
  // 周囲の記号をまたぐ選択では、リンクとして解析できた場合だけ置き換える。
  let valid = false;
  walk(markdownParser.parse(text.slice(0, selection.from) + insert + text.slice(selection.to)).topNode, node => {
    if (node.name === 'Link' && node.from === selection.from && node.to === selection.from + insert.length) valid = true;
  });
  return valid ? { changes: { from: selection.from, to: selection.to, insert }, selection: { anchor: selection.from + insert.length }, userEvent: 'input.paste', annotations: isolateHistory.of('full') } : null;
}

export function pasteMarkdown(event: ClipboardEvent, editor: EditorView, markdown: boolean, onImage?: (image: File) => void, blocked = false): boolean {
  const data = event.clipboardData;
  const editable = !blocked && !editor.state.readOnly && !editor.composing && !editor.compositionStarted;
  // 画像だけの時は既存の画像取り込みへ渡し、文字もある時は文字を優先する。
  const image = clipboardImage(data);
  if (image && onImage) {
    event.preventDefault();
    if (editable) onImage(image);
    return true;
  }
  if (!editable || !markdown) return false;
  const plan = linkPaste(editor.state, data?.getData('text/plain') ?? '');
  if (!plan) return false;
  event.preventDefault(); editor.dispatch(plan);
  return true;
}
