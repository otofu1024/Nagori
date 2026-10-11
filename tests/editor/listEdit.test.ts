import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { markdown, commonmarkLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { moveList, continueList } from '../../src/lib/editor/listEdit.ts';
import { markdownParser, markdownExtensions, walk } from '../../src/lib/editor/markdown.ts';
import { bulletGlyph, buildPreview, listDepth } from '../../src/lib/editor/livePreview.ts';


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

test('Front Matterがあっても、リストの次の行へ記号を引き継ぐ', () => {
  const front = '---\ntitle: "t"\ndraft: false\n---\n\n## 見出し\n　段落です。\n\n';
  for (const [text, expected] of [
    ['- a\n- a', '- a\n- a\n- '],
    ['1. a\n2. a', '1. a\n2. a\n3. '],
    ['- [ ] a\n- [ ] a', '- [ ] a\n- [ ] a\n- [ ] '],
    ['> - a\n> - a', '> - a\n> - a\n> - '],
  ]) {
    const plain = enter(text), withFront = enter(front + text);
    assert.equal(plain.handled, true, text);
    assert.equal(plain.text, expected, text);
    assert.equal(withFront.handled, true, front + text);
    assert.equal(withFront.text, front + expected, front + text);
  }
});

test('閉じのないFront Matterは本文として扱い、空の項目も抜けられる', () => {
  const unclosed = '---\n\n- a\n- ';
  assert.equal(enter(unclosed).handled, true);
  assert.equal(enter(unclosed).text, '---\n\n- a\n');
  assert.equal(enter('---\n\n- a\n- a').text, '---\n\n- a\n- a\n- ');
});


// 行の装飾と、記号の範囲を集める。カーソルは末尾の空行に置き、すべての項目を表示用に変える。
function preview(text: string) {
  const state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: markdown({ base: commonmarkLanguage, extensions: markdownExtensions }) });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const decorations: DecorationSet = buildPreview(state, { resolveImage: async () => '', onLink: () => {} });
  const marks: { from: number; to: number; className: string; bullet?: string }[] = [];
  const lines: { line: number; className: string; style: string }[] = [];
  decorations.between(0, text.length, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string> };
    if (value instanceof Decoration && value.spec.class && from === to) lines.push({ line: state.doc.lineAt(from).number, className: spec.class, style: spec.attributes?.style ?? '' });
    else if (spec.class) marks.push({ from, to, className: spec.class, bullet: spec.attributes?.['data-bullet'] });
  });
  return { state, marks, lines };
}

test('箇条書きの記号は深さで変わり、4段目以降は1段目から繰り返す', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(bulletGlyph), ['•', '◦', '▪', '•', '◦', '▪', '•']);
});

test('リストの深さは囲むリストの数で数える', () => {
  const tree = ensureSyntaxTree(EditorState.create({ doc: '- 親\n  - 子\n    1. 孫', extensions: markdown({ base: commonmarkLanguage, extensions: markdownExtensions }) }), 20, 5000)!;
  const depths: number[] = [];
  walk(tree.topNode, node => { if (node.name === 'ListItem') depths.push(listDepth(node)); });
  assert.deepEqual(depths, [1, 2, 3]);
});

test('入れ子の箇条書きは深さに応じた記号を隠した記号へ付ける', () => {
  const { marks } = preview('- 親\n  - 子\n    - 孫\n      - 曾孫\n');
  assert.deepEqual(marks.filter(mark => mark.bullet).map(mark => mark.bullet), ['•', '◦', '▪', '•']);
  for (const mark of marks.filter(mark => mark.bullet)) assert.match(mark.className, /nagori-hidden/);
});

test('番号付きとタスクは記号を変えず、字下げの幅だけを付ける', () => {
  const ordered = preview('1. 親\n   2. 子\n');
  assert.equal(ordered.marks.filter(mark => mark.bullet).length, 0);
  assert.equal(ordered.marks.filter(mark => mark.className.includes('nagori-list-slot')).length, 2);
  const task = preview('- [ ] 親\n');
  assert.ok(task.lines.some(line => line.className.includes('nagori-list-task')));
  const ordered_task = preview('1. [ ] 親\n');
  assert.ok(ordered_task.lines.some(line => line.style.includes('--nagori-list-extra: 23px')));
});

test('行の字下げは項目の深さを CSS 変数で渡し、折り返しの位置を本文にそろえる', () => {
  const { lines } = preview('- 親\n  - 子\n');
  assert.deepEqual(lines.map(line => [line.line, line.className.includes('nagori-list-first'), line.style]), [
    [1, true, '--nagori-list-depth: 1;'], [2, true, '--nagori-list-depth: 2;'],
  ]);
});
