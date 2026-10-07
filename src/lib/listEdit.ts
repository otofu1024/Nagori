import { countColumn, type StateCommand } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { children, markdownParser } from './markdown.ts';

// 本文の行から最も内側の項目を選び、選択された親の子は重複して動かさない。
export function moveList({ state, dispatch }: Parameters<StateCommand>[0], outdent = false): boolean {
  if (state.readOnly) return false;
  const doc = state.doc, tree = ensureSyntaxTree(state, doc.length, 20) ?? markdownParser.parse(doc.toString());
  const selected = new Map<number, SyntaxNode>();
  for (const range of state.selection.ranges) {
    const end = doc.lineAt(range.empty ? range.to : range.to - 1).number;
    for (let number = doc.lineAt(range.from).number; number <= end; number++) {
      let item: SyntaxNode | null = tree.resolveInner(doc.line(number).to, -1);
      while (item && item.name !== 'ListItem') item = item.parent;
      if (item) selected.set(item.from, item);
    }
  }
  if (!selected.size) return false;
  const roots = [...selected.values()].filter(item => {
    for (let parent = item.parent; parent; parent = parent.parent) if (parent.name === 'ListItem' && selected.has(parent.from)) return false;
    return true;
  });
  const predecessors = new Map<number, SyntaxNode>();
  if (!outdent) for (const list of new Map(roots.map(item => [item.parent!.from, item.parent!])).values()) {
    let previous: SyntaxNode | undefined;
    for (const item of children(list)) {
      if (item.name !== 'ListItem') continue;
      if (previous) predecessors.set(item.from, previous);
      if (!selected.has(item.from)) previous = item;
    }
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  const column = (item: SyntaxNode) => {
    const line = doc.lineAt(item.from);
    return countColumn(line.text.slice(0, item.from - line.from), 4);
  };
  for (const item of roots) {
    let delta: number;
    if (outdent) {
      let parent = item.parent?.parent;
      while (parent && parent.name !== 'ListItem') parent = parent.parent;
      if (!parent) continue;
      delta = column(parent) - column(item);
    } else {
      const previous = predecessors.get(item.from);
      if (!previous) continue;
      const mark = previous.getChild('ListMark')!, line = doc.lineAt(previous.from);
      const end = mark.to - line.from, spaces = /^[ \t]*/.exec(line.text.slice(end))![0];
      const afterMark = countColumn(line.text.slice(0, end), 4);
      const width = countColumn(line.text.slice(0, end) + spaces, 4) - afterMark;
      // タスクのチェック記号は本文。CommonMarkの字下げ幅はリスト記号と直後の空白で決まる。
      delta = afterMark + (width >= 1 && width <= 4 ? width : 1) - column(item);
    }
    if (!delta) continue;
    for (let number = doc.lineAt(item.from).number; number <= doc.lineAt(item.to).number; number++) {
      const line = doc.line(number);
      if (!line.text.trim()) continue;
      const quote = /^(?:[ \t]*>[ \t]?)+/.exec(line.text)?.[0] ?? '';
      const indent = /^[ \t]*/.exec(line.text.slice(quote.length))![0];
      // 引用記号を残し、タブは表示上の桁数に合わせて空白へ置き換える。
      const start = countColumn(quote, 4), width = countColumn(quote + indent, 4) - start;
      const insert = ' '.repeat(Math.max(0, width + delta));
      if (insert !== indent) changes.push({ from: line.from + quote.length, to: line.from + quote.length + indent.length, insert });
    }
  }
  if (changes.length) dispatch(state.update({ changes: changes.sort((a, b) => a.from - b.from), userEvent: 'input.indent', annotations: isolateHistory.of('full'), scrollIntoView: true }));
  return true;
}
