import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownParser, markdownExtensions } from '../src/lib/markdown.ts';
import { moveTable, tableCellWidth, setTableCell, escapeTableCell, insertTableRow, deleteTableRow, insertTableColumn, deleteTableColumn, applyTableCommand, tableShape, tableCellSource } from '../src/lib/tableEdit.ts';

function edit(text: string, anchor: number, direction: Parameters<typeof moveTable>[1]) {
  let state = EditorState.create({ doc: text, selection: { anchor }, extensions: history() });
  const handled = moveTable({ state, dispatch: transaction => { state = transaction.state; } }, direction);
  return { state, text: state.doc.toString(), selected: state.sliceDoc(state.selection.main.from, state.selection.main.to), handled };
}
const table = '| 一 | 二 |\n| :--- | ---: |\n| 三 | 四 |\n| 五 | 六 |';

test('TabとShift＋Tabは本文を選び、区切り行を飛ばして前後のセルへ移る', () => {
  assert.equal(edit(table, table.indexOf('一'), 'next').selected, '二');
  assert.equal(edit(table, table.indexOf('二'), 'next').selected, '三');
  assert.equal(edit(table, table.indexOf('三'), 'previous').selected, '二');
  assert.equal(edit(table, table.indexOf('六'), 'previous').selected, '五');
  assert.equal(edit(table, table.indexOf('一'), 'previous').selected, '一');
  assert.equal(edit(table, table.indexOf(':---'), 'next').selected, '三');
  assert.equal(edit(table, table.indexOf(':---'), 'previous').selected, '一');
});

test('Enterは次の行の同じ列へ移り、末尾では同じ列の空セルへ移る', () => {
  assert.equal(edit(table, table.indexOf('二'), 'down').selected, '四');
  assert.equal(edit(table, table.indexOf('四'), 'down').selected, '六');
  const result = edit(table, table.indexOf('六'), 'down');
  assert.equal(result.text.split('\n').length, 5); assert.equal(result.selected, '');
  const last = result.text.lastIndexOf('\n');
  assert.ok(result.state.selection.main.from > result.text.indexOf('|', last + 2));
  assert.equal(edit(result.text, result.state.selection.main.head, 'previous').selected, '');
});

test('最後のセルでTabを押すと空行を足し、その先頭のセルへ移る', () => {
  const result = edit(table, table.indexOf('六'), 'next');
  assert.equal(result.text.split('\n').length, 5); assert.equal(result.selected, '');
  assert.equal(result.text.slice(result.state.selection.main.from - 2, result.state.selection.main.from), '| ');
  assert.equal(edit('| a | b |\n| --- | --- |', 6, 'next').text.split('\n').length, 3);
});

test('日本語を2桁で数え、最大の幅へそろえて左右中央の寄せ方を保つ', () => {
  const text = '| 列 | abcdef | 中 |\n| :--- | ---: | :---: |\n| 長い本文 | x | y |';
  const result = edit(text, text.indexOf('列'), 'next');
  assert.equal(result.text, '| 列       | abcdef | 中    |\n| :------- | -----: | :---: |\n| 長い本文 | x      | y     |');
  assert.equal(result.selected, 'abcdef');
  assert.equal(tableCellWidth('Ａあ漢ｶa'), 8); assert.equal(tableCellWidth('e\u0301'), 1);
  const spaces = '| 　本文　 | b |\n| --- | --- |\n| c | d |';
  assert.ok(edit(spaces, spaces.indexOf('本'), 'next').text.includes('　本文　'));
});

test('エスケープしたパイプをセル内に保ち、空セル・省略セルを移動できる', () => {
  const text = '| a\\|b | | c |\n| --- | --- | --- |\n| d |';
  const first = edit(text, text.indexOf('a'), 'next');
  assert.equal(first.selected, ''); assert.ok(first.text.includes('a\\|b'));
  const second = edit(first.text, first.state.selection.main.head, 'next'); assert.equal(second.selected, 'c');
  const third = edit(second.text, second.state.selection.main.head, 'next'); assert.equal(third.selected, 'd');
  assert.equal(edit(text, text.length - 1, 'down').selected, '');
  assert.equal(edit('| a | b |\n| --- | --- |\n|', 25, 'next').handled, true);
  const even = '| a\\\\| b |\n| --- | --- |\n| c | d |';
  assert.equal(edit(even, even.indexOf('a'), 'next').selected, 'b');
});

test('外側のパイプがなくても扱い、引用とリストの前置きを保つ', () => {
  assert.equal(edit('a | b\n--- | ---\nc | d', 0, 'next').selected, 'b');
  for (const prefix of ['> ', '  ']) {
    const text = '- 項目\n\n' + ['| a | b |', '| --- | --- |', '| c | d |'].map(line => prefix + line).join('\n');
    const result = edit(text, text.indexOf('d'), 'down');
    assert.equal(result.text.split('\n').at(-1)!.startsWith(prefix + '| '), true);
    assert.equal(result.text.split('\n').slice(0, 2).join('\n'), '- 項目\n');
  }
  const extra = '| a | b |\n| --- | --- |\n| c | d | 残す |';
  const result = edit(extra, extra.indexOf('c'), 'next');
  assert.ok(result.text.includes('残す')); assert.equal(result.text.split('\n')[0].split('|').length, 4);
});

test('表以外・コード・Front Matterと読み取り専用では扱わない', () => {
  for (const text of ['本文', '```\n' + table + '\n```', '---\n' + table + '\n---']) assert.equal(edit(text, 0, 'next').handled, false);
  const state = EditorState.create({ doc: table, extensions: EditorState.readOnly.of(true) });
  assert.equal(moveTable({ state, dispatch: () => assert.fail('変更しない') }, 'next'), false);
});

test('整形と行追加は1回のUndoで戻り、選択と直前の入力を保つ', () => {
  let state = EditorState.create({ doc: table, selection: { anchor: table.indexOf('六') }, extensions: history() });
  state = state.update({ changes: { from: state.selection.main.head, insert: '追記' }, userEvent: 'input.type' }).state;
  const before = state.doc.toString(), selection = state.selection;
  const dispatch = (transaction: Transaction) => { state = transaction.state; };
  moveTable({ state, dispatch }, 'next'); const after = state.doc.toString();
  assert.equal(undo({ state, dispatch }), true); assert.equal(state.doc.toString(), before); assert.ok(state.selection.eq(selection));
  assert.equal(redo({ state, dispatch }), true); assert.equal(state.doc.toString(), after);
});

test('通常本文は解析し直さずに返し、パイプのない表の省略セルも扱う', () => {
  let state = EditorState.create({ doc: '| a | b |\n| --- | --- |\nc\n\n普通の本文', extensions: markdown({ extensions: markdownExtensions }) });
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1000));
  const parse = markdownParser.parse;
  markdownParser.parse = () => assert.fail('全文を解析しない');
  try {
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    state = state.update({ selection: { anchor: state.doc.length } }).state;
    assert.equal(moveTable({ state, dispatch }, 'down'), false);
    state = state.update({ selection: { anchor: state.doc.toString().indexOf('c\n') } }).state;
    assert.equal(moveTable({ state, dispatch }, 'next'), true);
    assert.equal(state.selection.main.empty, true);
    assert.ok(state.doc.toString().includes('| c   |     |'));
    assert.equal(moveTable({ state, dispatch }, 'previous'), true);
    assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), 'c');
    const long = '通常の本文\n\n'.repeat(2000) + '| a | b |\n| --- | --- |\nc';
    state = EditorState.create({ doc: long, selection: { anchor: long.length }, extensions: markdown({ extensions: markdownExtensions }) });
    assert.ok(ensureSyntaxTree(state, state.doc.length, 1000));
    assert.equal(moveTable({ state, dispatch }, 'next'), true);
    assert.ok(state.doc.toString().endsWith('| c   |     |'));
  } finally { markdownParser.parse = parse; }
});

const sample = '| 見出し | 数値 |\n| :--- | ---: |\n| a | 1 |\n| b | 2 |';

test('マスの書き戻しは、そのマスだけを変え、ほかの行・列の空白と揃えを残す', () => {
  assert.equal(setTableCell(sample, 1, 0, '**太字**'), '| 見出し | 数値 |\n| :--- | ---: |\n| **太字** | 1 |\n| b | 2 |');
  assert.equal(setTableCell(sample, 2, 1, ''), '| 見出し | 数値 |\n| :--- | ---: |\n| a | 1 |\n| b ||');
});

test('マスの書き戻しは、| を \\| にし、既にエスケープ済みの \\| は重ねない', () => {
  assert.equal(escapeTableCell('a|b'), 'a\\|b');
  assert.equal(escapeTableCell('a\\|b'), 'a\\|b');
  assert.equal(setTableCell(sample, 1, 1, 'x|y'), '| 見出し | 数値 |\n| :--- | ---: |\n| a | x\\|y |\n| b | 2 |');
  assert.equal(tableCellSource(setTableCell(sample, 1, 1, 'x|y'), 1, 1), 'x\\|y');
});

test('マスの書き戻しは改行を空白にし、CRLFの原文では改行を CRLF のまま残す', () => {
  assert.equal(escapeTableCell('一\n二'), '一 二');
  const crlf = sample.replace(/\n/g, '\r\n');
  const next = setTableCell(crlf, 1, 0, 'x');
  assert.equal(next, crlf.replace('| a |', '| x |'));
  assert.ok(!/[^\r]\n/.test(next));
});

test('マスの書き戻しは、先頭と末尾の | がない表の形を変えない', () => {
  assert.equal(setTableCell('a | b\n--- | ---\nc | d', 1, 0, 'x'), 'a | b\n--- | ---\n x | d');
});

test('表の形は行数（見出しを含む）と列数で数える', () => {
  assert.deepEqual(tableShape(sample), { rows: 3, columns: 2 });
});

test('行の追加は見出しの下・本文の間・末尾に入れ、区切り行の前には入れない', () => {
  assert.equal(insertTableRow(sample, 0, 'below'), '| 見出し | 数値 |\n| :--- | ---: |\n|||\n| a | 1 |\n| b | 2 |');
  assert.equal(insertTableRow(sample, 1, 'above'), '| 見出し | 数値 |\n| :--- | ---: |\n|||\n| a | 1 |\n| b | 2 |');
  assert.equal(insertTableRow(sample, 2, 'below').split('\n').length, 5);
  // 空の行・マスは空白を入れない
  assert.ok(!insertTableRow(sample, 2, 'below').includes(' |  '));
  assert.equal(insertTableRow(sample, 0, 'above'), sample);
});

test('行の削除は見出しを消さず、本文の行だけを消す', () => {
  assert.equal(deleteTableRow(sample, 0), sample);
  assert.equal(deleteTableRow(sample, 1), '| 見出し | 数値 |\n| :--- | ---: |\n| b | 2 |');
});

test('列の追加は区切り行に --- を入れ、左右の位置へ入れる', () => {
  assert.equal(insertTableColumn(sample, 0, 'right'), '| 見出し || 数値 |\n| :--- | --- | ---: |\n| a || 1 |\n| b || 2 |');
  assert.equal(insertTableColumn(sample, 0, 'left'), '|| 見出し | 数値 |\n| --- | :--- | ---: |\n|| a | 1 |\n|| b | 2 |');
});

test('列の削除は列が1つの表では消さない', () => {
  assert.equal(deleteTableColumn(sample, 0), '| 数値 |\n| ---: |\n| 1 |\n| 2 |');
  assert.equal(deleteTableColumn('| a |\n| --- |\n| b |', 0), '| a |\n| --- |\n| b |');
});

test('表の操作は、見出しの行の削除と、列が1つだけの列の削除を拒み、移動先を返す', () => {
  assert.equal(applyTableCommand(sample, 'row-delete', 0, 0), null);
  assert.equal(applyTableCommand(sample, 'row-above', 0, 0), null);
  assert.equal(applyTableCommand('| a |\n| --- |\n| b |', 'column-delete', 0, 0), null);
  assert.deepEqual(applyTableCommand(sample, 'row-below', 2, 1)?.target, { row: 3, column: 1 });
  assert.deepEqual(applyTableCommand(sample, 'column-left', 1, 0)?.target, { row: 1, column: 1 });
});
