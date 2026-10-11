import { Annotation, ChangeSet, StateEffect, StateField, Transaction, type ChangeDesc, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { frontMatter, inlineContent, markdownParser, walk } from './markdown.ts';

type Kind = 'bold' | 'italic';
type EmptyFormat = { from: number; to: number; mark: string; kind: Kind };
const names = { bold: 'StrongEmphasis', italic: 'Emphasis' };
const mapEmpty = (items: EmptyFormat[], changes: ChangeDesc) => items.map(item => ({ ...item, from: changes.mapPos(item.from, 1), to: changes.mapPos(item.to, -1) }));
const setEmpty = StateEffect.define<EmptyFormat[]>({ map(items, changes) {
  const mapped = mapEmpty(items, changes).filter(item => item.to - item.from >= item.mark.length * 2);
  return mapped.length ? mapped : undefined;
} });
// 本文を変えないカーソル移動も、通常のUndoとRedoで戻す。
const cursorHistory = StateEffect.define<null>();
export const typingCleanup = Annotation.define<boolean>();

function emptyFormats(state: EditorState, items: EmptyFormat[]) {
  const empty: EmptyFormat[] = [];
  for (const item of [...items].sort((a, b) => (a.to - a.from) - (b.to - b.from))) {
    const size = item.mark.length;
    if (item.to - item.from < size * 2 || state.doc.sliceString(item.from, item.from + size) !== item.mark || state.doc.sliceString(item.to - size, item.to) !== item.mark) continue;
    let at = item.from + size;
    // 空の入力モードを入れ子にした場合は、内側の記号も本文として数えない。
    for (const child of empty.filter(child => child.from >= at && child.to <= item.to - size).sort((a, b) => a.from - b.from || b.to - a.to)) {
      if (child.from < at) continue;
      if (state.doc.sliceString(at, child.from)) break;
      at = child.to;
    }
    if (at === item.to - size) empty.push(item);
  }
  return empty;
}

const pending = StateField.define<EmptyFormat[]>({
  create: () => [],
  update(items, tr) {
    items = mapEmpty(items, tr.changes);
    for (const effect of tr.effects) if (effect.is(setEmpty)) items = effect.value;
    return emptyFormats(tr.state, items);
  },
});

export function discardEmptyTypingFormat(state: EditorState, blur = false): TransactionSpec | null {
  const range = state.selection.main;
  const removed = state.field(pending).filter(item => blur || !range.empty || range.head < item.from + item.mark.length || range.head > item.to - item.mark.length);
  const outer = removed.filter(item => !removed.some(parent => parent !== item && parent.from <= item.from && parent.to >= item.to));
  if (!outer.length) return null;
  return { changes: outer.map(({ from, to }) => ({ from, to })), annotations: [Transaction.addToHistory.of(false), typingCleanup.of(true)], userEvent: 'input.format' };
}

export function typingFormat(blocked: () => boolean = () => false): Extension {
  return [pending, invertedEffects.of(tr => {
    const effects: StateEffect<unknown>[] = tr.effects.some(effect => effect.is(cursorHistory)) ? [cursorHistory.of(null)] : [];
    const before = tr.startState.field(pending);
    if (tr.docChanged && before.length) effects.push(setEmpty.of(before));
    return effects;
  }), ViewPlugin.fromClass(class {
    queued = false;
    blurred = false;
    destroyed = false;
    view: EditorView;
    constructor(view: EditorView) { this.view = view; }
    update(update: { docChanged: boolean; selectionSet: boolean; focusChanged: boolean }) {
      if (update.docChanged || update.selectionSet || update.focusChanged) this.schedule();
    }
    schedule(blur = false) {
      this.blurred ||= blur;
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        const blur = this.blurred; this.blurred = false;
        if (this.destroyed || blocked() || this.view.composing || this.view.compositionStarted) return;
        const cleanup = discardEmptyTypingFormat(this.view.state, blur || !this.view.hasFocus);
        if (cleanup) this.view.dispatch(cleanup);
      });
    }
    destroy() { this.destroyed = true; }
  }, { eventHandlers: { blur() { this.schedule(true); } } })];
}

export function typingFormatPlan(state: EditorState, kind: Kind): TransactionSpec | null {
  const range = state.selection.main;
  if (!range.empty || state.readOnly) return null;
  const pos = range.head, text = state.doc.toString(), front = frontMatter(text);
  if (front && pos < front.to) return null;
  const nodes: SyntaxNode[] = [];
  walk(markdownParser.parse(text).topNode, node => {
    if (node.from <= pos && node.to >= pos) nodes.push(node);
    else return false;
  });
  if (nodes.some(node => /^(?:FencedCode|CodeBlock|HTMLBlock|LinkReference|MathBlock|MathUnclosed)$/.test(node.name)
    || (/^(?:InlineCode|InlineMath|DisplayMath|HTMLTag|Autolink|Image|URL|LinkTitle|LinkLabel)$/.test(node.name) && pos > node.from && pos < node.to)
    || ((node.name === 'Link' || node.name === 'Image') && pos > inlineContent(node).to && pos < node.to))) return null;

  const items = state.field(pending), mark = kind === 'bold' ? '**' : '*';
  let changes: { from: number; to?: number; insert?: string }[] = [], anchor = pos;
  let added: EmptyFormat | undefined;
  const empty = items.find(item => item.kind === kind && pos >= item.from + item.mark.length && pos <= item.to - item.mark.length);
  const rawEmpty = text.slice(pos - mark.length, pos + mark.length) === mark + mark && text[pos - mark.length - 1] !== '*' && text[pos + mark.length] !== '*';
  const enclosing = nodes.filter(node => node.name === names[kind] && pos >= inlineContent(node).from && pos <= inlineContent(node).to).at(-1);
  if (empty) {
    changes = [{ from: empty.from, to: empty.from + empty.mark.length }, { from: empty.to - empty.mark.length, to: empty.to }];
    anchor = pos - empty.mark.length;
  } else if (rawEmpty) {
    changes = [{ from: pos - mark.length, to: pos + mark.length }]; anchor = pos - mark.length;
  } else if (enclosing) {
    const content = inlineContent(enclosing), delimiter = text.slice(enclosing.from, content.from);
    if (pos === content.from) anchor = enclosing.from;
    else if (pos === content.to) anchor = enclosing.to;
    else {
      // 内側の装飾も閉じて開き直し、記号の交差を避ける。
      const inner = nodes.filter(node => node.from > enclosing.from && node.to < enclosing.to && /^(?:StrongEmphasis|Emphasis|Strikethrough)$/.test(node.name));
      const marks = inner.map(node => text.slice(node.from, inlineContent(node).from));
      // アンダースコアは単語の途中で閉じられないため、この分割だけアスタリスクへそろえる。
      const close = [...marks].reverse().join('') + mark, open = mark + marks.join('');
      changes = [...(delimiter === mark ? [] : [{ from: enclosing.from, to: content.from, insert: mark }]),
        { from: pos, insert: close + open }, ...(delimiter === mark ? [] : [{ from: content.to, to: enclosing.to, insert: mark }])];
      anchor = pos + close.length;
    }
  } else {
    changes = [{ from: pos, insert: mark + mark }]; anchor = pos + mark.length;
    added = { from: pos, to: pos + mark.length * 2, mark, kind };
  }
  const mapped = mapEmpty(items, ChangeSet.of(changes, text.length));
  if (added) mapped.push(added);
  return { changes, selection: { anchor }, effects: [...(changes.length ? [] : [cursorHistory.of(null)]), setEmpty.of(mapped)], annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true };
}
