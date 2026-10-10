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

// 表の原文を行とマスに分ける。位置は、渡した本文の中の絶対位置で返す。表示・書き戻し・行列の操作は、すべてこの結果を使う。
// 見出しの行が0、区切り行が1、本文が2以降で、表示の行番号と原文の行の対応は行の種類で決まる。
export type TableCellSpan = { from: number; to: number; contentFrom: number; contentTo: number; raw: string };
export type TableRowSpan = { kind: 'header' | 'delimiter' | 'body'; from: number; to: number; indent: string; leading: boolean; trailing: string | null; cells: TableCellSpan[] };
export type TableCommand = 'row-above' | 'row-below' | 'row-delete' | 'column-left' | 'column-right' | 'column-delete';
export type TableTarget = { row: number; column: number };

// 本文の from から to までの表を、行ごとのマスの範囲にする。区切りでない | で分け、\| は分けない
export function tableCells(text: string, from: number, to: number): TableRowSpan[] {
  const source = text.slice(from, to), rows: TableRowSpan[] = [];
  let lineStart = 0;
  source.split(/\r?\n/).forEach((line, index) => {
    const base = from + lineStart;
    lineStart += line.length;
    if (source.startsWith('\r\n', lineStart)) lineStart += 2; else if (source.startsWith('\n', lineStart)) lineStart += 1;
    const indent = /^[ \t]*/.exec(line)![0], body = indent.length;
    const pipes: number[] = [];
    let escaped = false;
    for (let i = body; i < line.length; i++) {
      if (line[i] === '|' && !escaped) pipes.push(i);
      escaped = !escaped && line[i] === '\\';
    }
    // 区切りの間の部分。先頭が | なら先頭の空の部分を、末尾が | なら末尾の空白の部分を、マスの外として扱う
    const segments: { from: number; to: number }[] = [];
    let start = body;
    for (const pipe of pipes) { segments.push({ from: start, to: pipe }); start = pipe + 1; }
    segments.push({ from: start, to: line.length });
    const leading = pipes.length > 0 && pipes[0] === body;
    const last = segments.at(-1)!;
    const trailing = pipes.length > 0 && line.slice(last.from, last.to).trim() === '' ? line.slice(last.from, last.to) : null;
    const cells = segments.slice(leading ? 1 : 0, trailing !== null ? -1 : undefined).map(segment => {
      const raw = line.slice(segment.from, segment.to), lead = raw.length - raw.trimStart().length, content = raw.trim();
      const contentFrom = base + segment.from + lead;
      return { from: base + segment.from, to: base + segment.to, contentFrom, contentTo: contentFrom + content.length, raw };
    });
    rows.push({ kind: index === 0 ? 'header' : index === 1 ? 'delimiter' : 'body', from: base, to: base + line.length, indent, leading, trailing, cells });
  });
  return rows;
}

// 表の原文を行ごとに分けた形。セルの原文は前後の空白ごと残し、変えたセルと追加した行・列だけを作り直す。
export type TableLine = { indent: string; leading: boolean; cells: string[]; trailing: string | null };
export type TableModel = { newline: string; lines: TableLine[] };

// 区切り行を含む原文の行番号。論理の行番号(0が見出し)から変える
function lineIndex(row: number): number {
  return row === 0 ? 0 : row + 1;
}

export function parseTable(source: string): TableModel {
  return {
    newline: source.includes('\r\n') ? '\r\n' : '\n',
    lines: tableCells(source, 0, source.length).map(row => ({ indent: row.indent, leading: row.leading, cells: row.cells.map(cell => cell.raw), trailing: row.trailing })),
  };
}

function renderLine(line: TableLine): string {
  return line.indent + (line.leading ? '|' : '') + line.cells.join('|') + (line.trailing !== null ? '|' + line.trailing : '');
}

function renderTable(model: TableModel): string {
  return model.lines.map(renderLine).join(model.newline);
}

// 表示の行数（見出しを含む）と列数。列数は見出しのセル数で決める
export function tableShape(source: string): { rows: number; columns: number } {
  const model = parseTable(source);
  return { rows: model.lines.length - 1, columns: model.lines[0].cells.length };
}

// セルの原文を前後の空白を除いて返す
export function tableCellSource(source: string, row: number, column: number): string {
  const span = tableCells(source, 0, source.length)[lineIndex(row)]?.cells[column];
  return span ? source.slice(span.contentFrom, span.contentTo) : '';
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

// 空のマスは右クリックの表の雛形と同じ '  ' で書く
const blankCell = '  ';

// 1つのマスの原文を書き換える。ほかのセルと記号は変えない
export function setTableCell(source: string, row: number, column: number, value: string): string {
  const model = parseTable(source), line = model.lines[lineIndex(row)];
  if (!line) return source;
  while (line.cells.length <= column) line.cells.push(blankCell);
  const text = escapeTableCell(value);
  line.cells[column] = text ? ` ${text} ` : blankCell;
  return renderTable(model);
}

// 列の幅は区切り行の - の数で覚える。比の合計は、表の文字の幅に近い約60にそろえる
const dashTotal = 60;
// 列の幅の比（任意の正の数）を、区切り行の - の数にする。各列は3以上にし、比を保つ
export function columnDashes(ratios: number[]): number[] {
  const weights = ratios.map(ratio => Number.isFinite(ratio) && ratio > 0 ? ratio : 0);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return weights.map(weight => Math.max(3, Math.round(sum > 0 ? weight / sum * dashTotal : 0)));
}

// 区切り行の各列の - の数。全列が同じ（既定の --- など）時と、区切り行がない時は null にし、内容に合わせた自動の幅で表示する
export function tableColumnDashes(source: string): number[] | null {
  const delimiter = tableCells(source, 0, source.length).find(row => row.kind === 'delimiter');
  if (!delimiter) return null;
  const counts = delimiter.cells.map(cell => (cell.raw.match(/-/g) ?? []).length);
  if (counts.length === 0 || counts.every(count => count === counts[0])) return null;
  return counts;
}

// 区切り行の - の数を列の幅の比で書き換える。揃えの : は保ち、ほかの行と空白は変えない。列数と比の数が合わない時は変えない
export function setTableColumnWidths(source: string, ratios: number[]): string {
  const model = parseTable(source), delimiter = model.lines[1];
  if (!delimiter || delimiter.cells.length !== ratios.length || ratios.length !== model.lines[0].cells.length) return source;
  const dashes = columnDashes(ratios);
  delimiter.cells = delimiter.cells.map((raw, column) => {
    const content = raw.trim(), left = content.startsWith(':') ? ':' : '', right = content.length > left.length && content.endsWith(':') ? ':' : '';
    return raw.slice(0, raw.length - raw.trimStart().length) + left + '-'.repeat(dashes[column]) + right + raw.slice(raw.trimEnd().length);
  });
  return renderTable(model);
}

// 行を追加する。見出しの上には入れず、区切り行の前には入れない
export function insertTableRow(source: string, row: number, where: 'above' | 'below'): string {
  const model = parseTable(source);
  if (where === 'above' && row === 0) return source;
  const reference = model.lines[lineIndex(row)];
  if (!reference) return source;
  const columns = model.lines[0].cells.length;
  const added: TableLine = { indent: reference.indent, leading: reference.leading, cells: Array.from({ length: columns }, () => blankCell), trailing: reference.trailing === null ? null : '' };
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

// 列を追加する。区切り行には --- を入れ、ほかの行は空のマスにする
export function insertTableColumn(source: string, column: number, where: 'left' | 'right'): string {
  const model = parseTable(source), at = where === 'left' ? column : column + 1;
  model.lines.forEach((line, index) => {
    while (line.cells.length < at) line.cells.push(blankCell);
    line.cells.splice(at, 0, index === 1 ? ' --- ' : blankCell);
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

// 本文から表へ入る時のマス。↓は見出しの1列目、↑は最後の行の1列目
export function tableEntryTarget(rows: number, direction: 'down' | 'up'): TableTarget {
  return direction === 'down' ? { row: 0, column: 0 } : { row: rows - 1, column: 0 };
}

// 表の前後へ出る時のカーソル位置と、表の後ろに入れる改行。表の後ろに行がない時だけ改行を入れる。from と to は表の範囲
export function tableExitEdit(doc: string, from: number, to: number, side: 'before' | 'after'): { anchor: number; insert: string } {
  if (side === 'before') return { anchor: from > 0 ? from - (doc.slice(0, from).endsWith('\r\n') ? 2 : 1) : 0, insert: '' };
  const newline = doc.indexOf('\n', to);
  if (newline !== -1) return { anchor: newline + 1, insert: '' };
  const insert = doc.includes('\r\n') ? '\r\n' : '\n';
  return { anchor: to + insert.length, insert };
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
      // 区切り行の - の数は書き換えず、列の幅の指定を残す
      const content = entry.cells[i]?.text ?? '';
      insert += ' ';
      if (entry === data[rowIndex] && i === column) { anchor = insert.length; end = anchor + content.length; }
      // 区切り行は - の数が本文の幅より広いことがあるため、負の埋めは作らない
      insert += content + ' '.repeat(Math.max(0, widths[i] - tableCellWidth(content))) + ' |';
    }
  }
  const from = rows[0].line.from, to = doc.lineAt(table.to).to;
  dispatch(state.update({ changes: { from, to, insert }, selection: EditorSelection.range(from + anchor, from + end), userEvent: 'input.table', annotations: isolateHistory.of('full'), scrollIntoView: true }));
  return true;
}
