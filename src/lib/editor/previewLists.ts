import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { children } from './markdown.ts';
import type { DecorationContext } from './previewState.ts';

// 箇条書きの記号は入れ子の深さで変える。4段目以降は1段目から繰り返す。
const bulletGlyphs = ['•', '◦', '▪'];
export function bulletGlyph(depth: number): string {
  return bulletGlyphs[(depth - 1) % bulletGlyphs.length];
}
// 項目を囲むリストの数。1段目が1になる。
export function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent: SyntaxNode | null = node; parent; parent = parent.parent)
    if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth++;
  return depth;
}
class TaskWidget extends WidgetType {
  readonly position: number;
  readonly checked: boolean;
  readonly disabled: boolean;
  constructor(position: number, checked: boolean, disabled: boolean) {
    super();
    this.position = position;
    this.checked = checked;
    this.disabled = disabled;
  }
  eq(other: TaskWidget) {
    return this.position === other.position && this.checked === other.checked && this.disabled === other.disabled;
  }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.disabled = this.disabled;
    input.setAttribute('aria-label', 'タスクを完了にする');
    input.addEventListener('mousedown', (e) => e.preventDefault());
    input.addEventListener('change', () => {
      if (view.state.readOnly || view.composing) return;
      view.dispatch({ changes: { from: this.position + 1, to: this.position + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input' });
      view.focus();
    });
    return input;
  }
}

export function decorateLists(node: SyntaxNode, context: DecorationContext) {
  const { state, text, active, ranges, mark, hide, listLine } = context;
  if (node.name === 'ListItem') {
    // 項目の最初の行と、その直下の段落の行に字下げを付ける。入れ子の項目の行は、その項目が付ける。
    const marker = node.getChild('ListMark'),
      markerLine = marker ? state.doc.lineAt(marker.from).number : 0,
      ordered = !!marker && /^\d/.test(text.slice(marker.from, marker.to));
    const task = marker?.nextSibling?.name === 'Task';
    const lines = new Set<number>(markerLine ? [markerLine] : []);
    for (const paragraph of children(node))
      if (paragraph.name === 'Paragraph')
        for (let n = state.doc.lineAt(paragraph.from).number; n <= state.doc.lineAt(paragraph.to).number; n++) lines.add(n);
    const depth = listDepth(node),
      extra = ordered && task ? ' --nagori-list-extra: 23px;' : '';
    for (const n of lines) {
      const current = state.doc.line(n),
        leading = /^[ \t]+/.exec(current.text);
      // 字下げは深さで決めるので、本文の空白は見せない。
      if (leading) hide(current.from, current.from + leading[0].length);
      const className =
        'nagori-list-line' +
        (n === markerLine ? ' nagori-list-first' : '') +
        (n === markerLine && task && !ordered ? ' nagori-list-task' : '');
      listLine(n, className, `--nagori-list-depth: ${depth};${extra}`);
    }
  }
  if (node.name === 'ListMark') {
    const current = state.doc.lineAt(node.from),
      symbol = text.slice(node.from, node.to),
      isActive = active(current);
    // 記号の後ろの1文字は、記号と本文の間隔として字下げの幅に含める
    const end = text[node.to] === ' ' ? node.to + 1 : node.to;
    // カーソルのある行は、記号を幅の決まった枠に入れずにそのまま見せる。
    // 枠に入れると、記号の直後で変換した未確定文字をWebKitが枠の中へ入れ、枠の幅で1文字ずつ折り返すため。
    if (isActive) return;
    if (/^\d/.test(symbol)) mark(node.from, end, 'nagori-list-slot');
    // タスクの行は、チェックボックスが記号の位置に出るので、箇条書きの点は隠す
    else if (node.nextSibling?.name === 'Task') hide(node.from, end);
    else
      mark(node.from, end, 'nagori-list-slot nagori-hidden nagori-bullet', {
        'data-bullet': bulletGlyph(listDepth(node)),
        'aria-hidden': 'true',
      });
  }
  if (node.name === 'TaskMarker') {
    const current = state.doc.lineAt(node.from);
    if (!active(current)) {
      ranges.push(
        Decoration.replace({ widget: new TaskWidget(node.from, /x/i.test(text.slice(node.from, node.to)), state.readOnly) }).range(
          node.from,
          node.to,
        ),
      );
      // チェックボックスの後ろの空白は、字下げの幅に含めるため隠す
      if (text[node.to] === ' ') hide(node.to, node.to + 1);
    }
  }
}
