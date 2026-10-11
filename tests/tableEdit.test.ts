import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownParser, markdownExtensions } from '../src/lib/markdown.ts';
import { moveTable, tableCellWidth } from '../src/lib/tableEdit.ts';

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
