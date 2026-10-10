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

// 表の原文を行ごとに分けた形。セルの原文は前後の空白ごと残し、変えたセルと追加した行・列だけを作り直す。
export type TableLine = { indent: string; leading: boolean; cells: string[]; trailing: string | null };
export type TableModel = { newline: string; lines: TableLine[] };
export type TableCommand = 'row-above' | 'row-below' | 'row-delete' | 'column-left' | 'column-right' | 'column-delete';
export type TableTarget = { row: number; column: number };

// 区切りでない | で分ける。\| は分けない
function splitPipes(text: string): string[] {
  const parts: string[] = [];
  let start = 0, escaped = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && !escaped) { parts.push(text.slice(start, i)); start = i + 1; }
    escaped = !escaped && text[i] === '\\';
  }
  parts.push(text.slice(start));
  return parts;
}

function parseLine(text: string): TableLine {
  const indent = /^[ \t]*/.exec(text)![0], parts = splitPipes(text.slice(indent.length));
  // 先頭と末尾の | の有無を覚えておき、書き戻す時に同じ形を保つ
  const leading = parts.length > 1 && parts[0] === '';
  const trailing = parts.length > 1 && parts.at(-1)!.trim() === '' ? parts.at(-1)! : null;
  return { indent, leading, cells: parts.slice(leading ? 1 : 0, trailing !== null ? -1 : undefined), trailing };
}

function renderLine(line: TableLine): string {
  return line.indent + (line.leading ? '|' : '') + line.cells.join('|') + (line.trailing !== null ? '|' + line.trailing : '');
}

export function parseTable(source: string): TableModel {
  return { newline: source.includes('\r\n') ? '\r\n' : '\n', lines: source.split(/\r?\n/).map(parseLine) };
}

function renderTable(model: TableModel): string {
  return model.lines.map(renderLine).join(model.newline);
}

// 論理の行番号(0が見出し、区切り行を除く)から、原文の行番号へ変える
function lineIndex(row: number): number {
  return row === 0 ? 0 : row + 1;
}

// 表示の行数と列数。列数は見出しのセル数で決める
export function tableShape(source: string): { rows: number; columns: number } {
  const model = parseTable(source);
  return { rows: model.lines.length - 1, columns: model.lines[0].cells.length };
}

// セルの原文を前後の空白を除いて返す
export function tableCellSource(source: string, row: number, column: number): string {
  return parseTable(source).lines[lineIndex(row)]?.cells[column]?.trim() ?? '';
}

// マスに入れる値を Markdown の表のセルにする。改行は空白にし、| は \| にする。\| はそのまま残す
export function escapeTableCell(value: string): string {
  let escaped = '', previous = false;
  for (const character of value.replace(/\r?\n/g, ' ').trim()) {
    escaped += character === '|' && !previous ? '\\|' : character;
    previous = !previous && character === '\\';
  }
  return escaped;
}

// 1つのマスの原文を書き換える。ほかのセルと記号は変えない
export function setTableCell(source: string, row: number, column: number, value: string): string {
  const model = parseTable(source), line = model.lines[lineIndex(row)];
  if (!line) return source;
  while (line.cells.length <= column) line.cells.push('');
  // 空の値は空のままにし、Enterや追加で空白を入れない
  const text = escapeTableCell(value);
  line.cells[column] = text ? ` ${text} ` : '';
  return renderTable(model);
}

// 行を追加する。見出しの上には入れず、区切り行の上にも入れない
export function insertTableRow(source: string, row: number, where: 'above' | 'below'): string {
  const model = parseTable(source);
  if (where === 'above' && row === 0) return source;
  const reference = model.lines[lineIndex(row)];
  if (!reference) return source;
  const columns = model.lines[0].cells.length;
  const added: TableLine = { indent: reference.indent, leading: reference.leading, cells: Array.from({ length: columns }, () => ''), trailing: reference.trailing === null ? null : '' };
  // 見出しの下に入れる時も、区切り行の前には入れない
  const index = Math.max(2, where === 'above' ? lineIndex(row) : lineIndex(row) + 1);
  model.lines.splice(index, 0, added);
  return renderTable(model);
}

// 行を削除する。見出しは消せない
export function deleteTableRow(source: string, row: number): string {
  const model = parseTable(source);
  if (row === 0 || !model.lines[lineIndex(row)]) return source;
  model.lines.splice(lineIndex(row), 1);
  return renderTable(model);
}

// 列を追加する。区切り行には揃えを付けない新しい列を入れる
export function insertTableColumn(source: string, column: number, where: 'left' | 'right'): string {
  const model = parseTable(source), at = where === 'left' ? column : column + 1;
  model.lines.forEach((line, index) => {
    while (line.cells.length < at) line.cells.push('');
    line.cells.splice(at, 0, index === 1 ? ' --- ' : '');
  });
  return renderTable(model);
}

// 列を削除する。列が1つだけの表では消さない
export function deleteTableColumn(source: string, column: number): string {
  const model = parseTable(source);
  if (model.lines[0].cells.length <= 1 || column >= model.lines[0].cells.length) return source;
  for (const line of model.lines) if (column < line.cells.length) line.cells.splice(column, 1);
  return renderTable(model);
}

// 表の操作をまとめて行う。戻り値は書き換え後の原文と、操作の後にフォーカスするマスの位置
export function applyTableCommand(source: string, command: TableCommand, row: number, column: number): { source: string; target: TableTarget } | null {
  const shape = tableShape(source);
  if (command === 'row-above' || command === 'row-below') {
    if (command === 'row-above' && row === 0) return null;
    const next = insertTableRow(source, row, command === 'row-above' ? 'above' : 'below');
    if (next === source) return null;
    return { source: next, target: { row: command === 'row-above' ? row : row + 1, column } };
  }
  if (command === 'row-delete') {
    if (row === 0) return null;
    const next = deleteTableRow(source, row);
    if (next === source) return null;
    return { source: next, target: { row: Math.min(row, shape.rows - 2), column } };
  }
  if (command === 'column-left' || command === 'column-right') {
    // 左に入れると、今のマスは1つ右へずれる
    const next = insertTableColumn(source, column, command === 'column-left' ? 'left' : 'right');
    return { source: next, target: { row, column: command === 'column-left' ? column + 1 : column } };
  }
  if (shape.columns <= 1) return null;
  return { source: deleteTableColumn(source, column), target: { row, column: Math.min(column, shape.columns - 2) } };
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
