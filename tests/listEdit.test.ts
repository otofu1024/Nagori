import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { moveList } from '../src/lib/listEdit.ts';
import { markdownParser, markdownExtensions, walk } from '../src/lib/markdown.ts';

function edit(text: string, from: number, to = from, outdent = false) {
  let state = EditorState.create({ doc: text, selection: { anchor: from, head: to }, extensions: history() });
  const handled = moveList({ state, dispatch: transaction => { state = transaction.state; } }, outdent);
  return { state, text: state.doc.toString(), handled };
}

test('箇条書き・番号付き・タスクは前の兄弟の本文位置まで字下げし、番号を保つ', () => {
  for (const [text, expected] of [
    ['- 前\n- 後', '- 前\n  - 後'], ['10. 前\n23. 後', '10. 前\n    23. 後'],
    ['9) 前\n20) 後', '9) 前\n   20) 後'], ['- [ ] 前\n- [x] 後', '- [ ] 前\n  - [x] 後'],
    ['-   前\n- 後', '-   前\n    - 後'], ['- 前\n-', '- 前\n  -'],
  ]) {
    const result = edit(text, text.length);
    assert.equal(result.handled, true); assert.equal(result.text, expected);
    let depth = 0;
    walk(markdownParser.parse(result.text).topNode, node => { if (node.name === 'ListItem' && node.from > result.text.indexOf('\n')) { for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === 'ListItem') depth++; } });
    assert.equal(depth, 1, expected);
  }
});

test('複数の項目と子・継続行をまとめて動かし、選択の向きを保つ', () => {
  const text = '- 前\n- 親\n  - 子\n    継続\n- 次\n- 後';
  const from = text.indexOf('親'), to = text.indexOf('- 後');
  const result = edit(text, to, from);
  assert.equal(result.text, '- 前\n  - 親\n    - 子\n      継続\n  - 次\n- 後');
  assert.ok(result.state.selection.main.anchor > result.state.selection.main.head);
  assert.equal(edit(result.text, result.text.indexOf('親'), result.text.indexOf('- 後'), true).text, text);
});

test('子だけを選ぶと親と後の兄弟は動かず、親の段へ戻せる', () => {
  const text = '10. 親\n    - 一\n    - 二\n      - 孫\n11. 後';
  assert.equal(edit(text, text.indexOf('二'), undefined, true).text, '10. 親\n    - 一\n- 二\n  - 孫\n11. 後');
  assert.equal(edit(text, text.indexOf('二')).text, '10. 親\n    - 一\n      - 二\n        - 孫\n11. 後');
});

test('引用記号・空行を保ち、タブの桁数に合わせて字下げを解除する', () => {
  const quote = '> - 前\n> - 親\n>   - 子';
  assert.equal(edit(quote, quote.indexOf('親')).text, '> - 前\n>   - 親\n>     - 子');
  const tab = '- 親\n\t- 子\n\t\t- 孫';
  assert.equal(edit(tab, tab.indexOf('子'), undefined, true).text, '- 親\n- 子\n    - 孫');
  const loose = '- 前\n\n- 後\n\n  継続';
  assert.equal(edit(loose, loose.indexOf('後')).text, '- 前\n\n  - 後\n\n    継続');
});

test('浅い段の解除と兄弟のない字下げはキーを消費し、リスト外と読み取り専用は扱わない', () => {
  for (const text of ['- 一', '1. 一', '- [ ] 一']) {
    assert.deepEqual([edit(text, text.length).handled, edit(text, text.length).text], [true, text]);
    assert.deepEqual([edit(text, text.length, undefined, true).handled, edit(text, text.length, undefined, true).text], [true, text]);
  }
  for (const text of ['本文', '```\n- コード\n```', '---\n- metadata\n---']) assert.equal(edit(text, text.indexOf('-') < 0 ? 0 : text.indexOf('-') + 2).handled, false);
  const state = EditorState.create({ doc: '- 前\n- 後', extensions: EditorState.readOnly.of(true) });
  assert.equal(moveList({ state, dispatch: () => assert.fail('変更しない') }), false);
});

test('字下げは1回のUndoで選択も戻り、直前の入力が残る', () => {
  let state = EditorState.create({ doc: '- 前\n- 後', extensions: history() });
  state = state.update({ changes: { from: state.doc.length, insert: '入力' }, selection: EditorSelection.cursor(state.doc.length + 2), userEvent: 'input.type' }).state;
  const before = state.doc.toString(), selection = state.selection;
  const dispatch = (transaction: Transaction) => { state = transaction.state; };
  assert.equal(moveList({ state, dispatch }), true);
  const after = state.doc.toString();
  assert.equal(undo({ state, dispatch }), true); assert.equal(state.doc.toString(), before); assert.ok(state.selection.eq(selection));
  assert.equal(redo({ state, dispatch }), true); assert.equal(state.doc.toString(), after);
});

test('Enterでの標準の項目継続と空項目の終了を保つ', () => {
  for (const [text, expected] of [['- 項目', '- 項目\n- '], ['- ', ''], ['2. 項目', '2. 項目\n3. ']]) {
    let state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: markdown({ extensions: markdownExtensions }) });
    assert.equal(insertNewlineContinueMarkup({ state, dispatch: transaction => { state = transaction.state; } }), true);
    assert.equal(state.doc.toString(), expected);
  }
});

test('Markdownの構文木を再利用し、字下げのたびに全文を解析しない', () => {
  let state = EditorState.create({ doc: '- 前\n- 後\n  - 子', selection: { anchor: 6 }, extensions: markdown({ extensions: markdownExtensions }) });
  assert.ok(ensureSyntaxTree(state, state.doc.length, 1000));
  const parse = markdownParser.parse;
  markdownParser.parse = () => assert.fail('全文を解析しない');
  try {
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    assert.equal(moveList({ state, dispatch }), true);
    assert.equal(state.doc.toString(), '- 前\n  - 後\n    - 子');
    assert.equal(moveList({ state, dispatch }, true), true);
    assert.equal(state.doc.toString(), '- 前\n- 後\n  - 子');
  } finally { markdownParser.parse = parse; }
});
