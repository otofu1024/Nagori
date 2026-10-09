import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { continueList } from '../src/lib/listEdit.ts';
import { markdownExtensions } from '../src/lib/markdown.ts';

// Editor.svelte と同じ言語設定で、カーソル位置の Enter を実行する。
function enter(text: string, at = text.length) {
  let state = EditorState.create({ doc: text, selection: { anchor: at }, extensions: markdown({ base: commonmarkLanguage, extensions: markdownExtensions }) });
  const handled = continueList({ state, dispatch: transaction => { state = transaction.state; } });
  return { handled, text: state.doc.toString(), head: state.selection.main.head };
}

test('箇条書きとタスクの次の行へ同じ記号を入れ、タスクは未完了の記号にする', () => {
  for (const [text, expected] of [
    ['- 前', '- 前\n- '], ['* 前', '* 前\n* '], ['+ 前', '+ 前\n+ '],
    ['- [ ] 前', '- [ ] 前\n- [ ] '], ['- [x] 前', '- [x] 前\n- [ ] '],
    ['  - 前', '  - 前\n  - '], ['- 親\n  - 子', '- 親\n  - 子\n  - '],
  ]) {
    const result = enter(text);
    assert.equal(result.handled, true, text);
    assert.equal(result.text, expected, text);
    assert.equal(result.head, expected.length, text);
  }
});

test('番号付きは次の番号を入れ、後続の項目も振り直す', () => {
  const result = enter('1. 前\n2. 後', '1. 前'.length);
  assert.equal(result.handled, true);
  assert.equal(result.text, '1. 前\n2. \n3. 後');
  assert.equal(enter('9. 前').text, '9. 前\n10. ');
});

test('引用の中のリストは引用記号と記号を引き継ぐ', () => {
  assert.equal(enter('> - 前').text, '> - 前\n> - ');
  assert.equal(enter('> 1. 前').text, '> 1. 前\n> 2. ');
  assert.equal(enter('> - [ ] 前').text, '> - [ ] 前\n> - [ ] ');
});

test('空の項目では記号を消してリストを抜け、字下げされていれば1段戻す', () => {
  assert.equal(enter('- 前\n- ').text, '- 前\n');
  assert.equal(enter('- 前\n- 後\n- ').text, '- 前\n- 後\n');
  assert.equal(enter('1. 前\n2. ').text, '1. 前\n');
  assert.equal(enter('- [ ] 前\n- [ ] ').text, '- [ ] 前\n');
  assert.equal(enter('- 親\n  - ').text, '- 親\n- ');
});

test('リスト以外の行は既存の動きに任せ、項目の途中で押したEnterは次の項目に続きを移す', () => {
  assert.equal(enter('普通の文').handled, false);
  assert.equal(enter('- 前後', '- 前'.length).text, '- 前\n- 後');
});
