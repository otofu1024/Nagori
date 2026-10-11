import { EditorSelection, type StateCommand } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { children, markdownParser } from './markdown.ts';
import type { Tree } from '@lezer/common';
import type { SyntaxNode } from '@lezer/common';

function cells(text: string) {
  const pipes: number[] = [];
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && !escaped) pipes.push(i);
    escaped = !escaped && text[i] === '\\';
  }
  const starts = [0, ...pipes.map(i => i + 1)], ends = [...pipes, text.length];
  const result = starts.map((from, i) => ({ from, to: ends[i], text: text.slice(from, ends[i]).replace(/^[ \t]+|[ \t]+$/g, '') }));
  if (pipes.length && !result[0].text) result.shift();
  if (pipes.length && !result.at(-1)!.text) result.pop();
  return result;
}

// 列幅の計算では全角を2桁、結合文字を0桁として数える。
export function tableCellWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (/\p{Mark}/u.test(character)) continue;
    width += code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
      code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f || code >= 0xac00 && code <= 0xd7a3 ||
      code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe19 ||
      code >= 0xfe30 && code <= 0xfe6f || code >= 0xff01 && code <= 0xff60 ||
      code >= 0xffe0 && code <= 0xffe6 || code >= 0x20000 && code <= 0x3fffd) ? 2 : 1;
  }
  return width;
}

export function moveTable({ state, dispatch }: Parameters<StateCommand>[0], direction: 'next' | 'previous' | 'down'): boolean {
  if (state.readOnly) return false;
  const doc = state.doc, head = state.selection.main.head, current = doc.lineAt(head);
  const tableAt = (tree: Tree) => {
    for (let node: SyntaxNode | null = tree.resolveInner(current.to, -1); node; node = node.parent) if (node.name === 'Table') return node;
    return undefined;
  };
  // 解析済みの通常本文はその行だけで判定する。パイプのない省略セル行は表の構文で判定する。
  if (!current.text.includes('|') && syntaxTreeAvailable(state, current.to) && !tableAt(ensureSyntaxTree(state, current.to, 0)!)) return false;
  // 表の後半の行も含める。未解析の時と、言語拡張のない呼び出しだけ全文解析へ戻す。
  const tree = ensureSyntaxTree(state, doc.length, 20) ?? markdownParser.parse(doc.toString());
  const table = tableAt(tree);
  if (!table) return false;
  const rows = children(table).filter(node => /^(?:TableHeader|TableRow|TableDelimiter)$/.test(node.name)).map(node => {
    const line = doc.lineAt(node.from);
    return { node, line, prefix: line.text.slice(0, node.from - line.from), cells: cells(doc.sliceString(node.from, node.to)) };
  });
  const count = rows[0].cells.length, data = rows.filter(row => row.node.name !== 'TableDelimiter');
  const row = rows.find(row => row.line.number === current.number)!;
  let rowIndex = data.indexOf(row);
  let column = Math.min(count - 1, Math.max(0, row.cells.findIndex(cell => head <= row.node.from + cell.to)));
  if (row.cells.length && head > row.node.from + row.cells.at(-1)!.to) column = count - 1;
  // 区切り行には止まらず、前へは見出し、次へは本文へ移る。
  if (rowIndex < 0) { rowIndex = direction === 'previous' ? 0 : 1; }
  else if (direction === 'down') rowIndex++;
  else if (direction === 'next') { if (++column === count) { column = 0; rowIndex++; } }
  else if (--column < 0) { column = count - 1; rowIndex--; }
  if (rowIndex < 0) { rowIndex = 0; column = 0; }
  if (rowIndex >= data.length) {
    const last = rows.at(-1)!;
    const added = { ...last, cells: Array.from({ length: count }, () => ({ from: 0, to: 0, text: '' })) };
    rows.push(added); data.push(added);
  }
  const delimiter = rows.find(row => row.node.name === 'TableDelimiter')!;
  const widths = Array.from({ length: Math.max(count, ...rows.map(row => row.cells.length)) }, (_, i) => {
    const align = delimiter.cells[i]?.text ?? '';
    return Math.max(3 + Number(align.startsWith(':')) + Number(align.endsWith(':')), ...data.map(row => tableCellWidth(row.cells[i]?.text ?? '')));
  });
  let insert = '', anchor = 0, end = 0;
  for (const entry of rows) {
    if (insert) insert += state.lineBreak;
    insert += entry.prefix + '|';
    const total = Math.max(count, entry.cells.length);
    for (let i = 0; i < total; i++) {
      let content = entry.cells[i]?.text ?? '';
      if (entry === delimiter) {
        const left = content.startsWith(':') ? ':' : '', right = content.endsWith(':') ? ':' : '';
        content = left + '-'.repeat(widths[i] - left.length - right.length) + right;
      }
      insert += ' ';
      if (entry === data[rowIndex] && i === column) { anchor = insert.length; end = anchor + content.length; }
      insert += content + ' '.repeat(widths[i] - tableCellWidth(content)) + ' |';
    }
  }
  const from = rows[0].line.from, to = doc.lineAt(table.to).to;
  dispatch(state.update({ changes: { from, to, insert }, selection: EditorSelection.range(from + anchor, from + end), userEvent: 'input.table', annotations: isolateHistory.of('full'), scrollIntoView: true }));
  return true;
}
