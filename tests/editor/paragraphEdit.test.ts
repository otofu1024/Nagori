import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { paragraphNewline } from '../../src/lib/editor/paragraphEdit.ts';
import { editorKeymap } from '../../src/lib/editor/keymap.ts';
import { markdownExtensions, markdownParser } from '../../src/lib/editor/markdown.ts';

function editor(text: string, at = text.length, settings = { blogMode: true, indent: true, plain: false }) {
  let state = EditorState.create({
    doc: text,
    selection: { anchor: at },
    extensions: [
      history(),
      ...(settings.plain ? [] : [markdown({ base: commonmarkLanguage, extensions: markdownExtensions })]),
      editorKeymap({
        get plain() {
          return settings.plain;
        },
        get indentParagraphs() {
          return settings.blogMode && settings.indent;
        },
        previewOnly: false,
        composition: false,
        linkDialog: false,
        view: undefined,
        onSave() {},
        apply() {},
      }),
    ],
  });
  const dispatch = (tr: Transaction) => {
    state = tr.state;
  };
  const target = {
    get state() {
      return state;
    },
    dispatch,
    composing: false,
    compositionStarted: false,
  } as unknown as EditorView;
  const enter = () => {
    for (const binding of state.facet(keymap).flat()) if (binding.key === 'Enter' && binding.run?.(target)) return true;
    return false;
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    target,
    enter,
    settings,
  };
}

test('段落のEnterは全角や半角の字下げを半角スペースにして引き継がない', () => {
  for (const plain of [false, true])
    for (const blogMode of [false, true]) {
      for (const text of ['　段落', '  段落', '\t段落']) {
        // Markdownでタブから始まる行はコードなので、段落だけを対象にする。
        if (!plain && text.startsWith('\t')) continue;
        const value = editor(text, text.length, { plain, blogMode, indent: false });
        assert.equal(value.enter(), true);
        assert.equal(value.state.doc.toString(), text + '\n');
      }
    }
});

test('ブログだけで全角スペースを1つ入れ、設定を開き直さずに切り替える', () => {
  for (const blogMode of [false, true])
    for (const plain of [false, true]) {
      const value = editor('　段落', 3, { plain, blogMode, indent: true });
      value.enter();
      assert.equal(value.state.doc.toString(), '　段落\n' + (blogMode && !plain ? '　' : ''));
      assert.equal(value.state.doc.line(2).text.includes(' '), false);
    }
  const value = editor('段落');
  value.settings.indent = false;
  value.enter();
  assert.equal(value.state.doc.toString(), '段落\n');
  value.dispatch(
    value.state.update({ changes: { from: value.state.doc.length, insert: '次' }, selection: { anchor: value.state.doc.length + 1 } }),
  );
  value.settings.indent = true;
  value.enter();
  assert.equal(value.state.doc.toString(), '段落\n次\n　');
});

test('空行は字下げせず、途中で分けた行は字下げし、既存の全角スペースは重ねない', () => {
  for (const [text, at, expected] of [
    ['', 0, '\n'],
    ['\n', 1, '\n\n'],
    ['　', 1, '　\n'],
    ['  ', 2, '  \n'],
    ['　前後', 2, '　前\n　後'],
    ['前　後', 1, '前\n　後'],
    ['段落', 0, '\n　段落'],
  ] as const) {
    const value = editor(text, at);
    value.enter();
    assert.equal(value.state.doc.toString(), expected);
  }
  const value = editor('段落');
  value.enter();
  value.enter();
  assert.equal(value.state.doc.toString(), '段落\n　\n');
});

test('リストと引用の記号、コードの字下げ、Front Matterと見出しの動きを保つ', () => {
  for (const [text, at, expected] of [
    ['- 項目', 4, '- 項目\n- '],
    ['2. 項目', 5, '2. 項目\n3. '],
    ['> 引用', 4, '> 引用\n> '],
    ['- [x] 項目', 8, '- [x] 項目\n- [ ] '],
    ['```js\n  const a = 1;\n```', 20, '```js\n  const a = 1;\n  \n```'],
    ['    コード', 7, '    コード\n    '],
    ['# 見出し', 5, '# 見出し\n'],
    ['---\ntitle: 記事\n---', 13, '---\ntitle: 記事\n\n---'],
  ] as const) {
    const value = editor(text, at);
    value.enter();
    assert.equal(value.state.doc.toString(), expected, text);
  }
});

test('見出し、区切り線、リンクの定義の行では空白を足さずに改行する', () => {
  // 標準の改行は、後ろの段落の全角スペースの字下げを数えて半角スペースを足していた
  for (const [text, at, expected] of [
    ['# 至高の芸術\n　みなさんこんばんわ。', 7, '# 至高の芸術\n\n　みなさんこんばんわ。'],
    ['見出し\n===\n　本文', 3, '見出し\n\n===\n　本文'],
    ['---\n　本文', 3, '---\n\n　本文'],
    ['[a]: https://example.com\n　本文', 24, '[a]: https://example.com\n\n　本文'],
  ] as const) {
    const value = editor(text, at);
    value.enter();
    assert.equal(value.state.doc.toString(), expected, text);
  }
});

test('表のEnterは次の行のセルへ移り、全角スペースを入れない', () => {
  const text = '| 列 |\n| --- |\n| 値 |';
  const value = editor(text);
  value.enter();
  assert.equal(value.state.doc.toString(), '| 列  |\n| --- |\n| 値  |\n|     |');
  assert.equal(value.state.doc.toString().includes('　'), false);
});

test('日本語変換中と読み取り専用では処理せず、複数カーソルとUndoを保つ', () => {
  const value = editor('前\n後');
  value.dispatch(
    value.state.update({
      changes: { from: value.state.doc.length, insert: '入力' },
      selection: { anchor: value.state.doc.length + 2 },
      userEvent: 'input.type',
    }),
  );
  const before = value.state.doc.toString(),
    selected = value.state.selection;
  value.enter();
  assert.equal(value.state.doc.toString(), before + '\n　');
  assert.equal(undo(value.target), true);
  assert.equal(value.state.doc.toString(), before);
  assert.ok(value.state.selection.eq(selected));
  assert.equal(redo(value.target), true);
  assert.equal(value.state.doc.toString(), before + '\n　');
  const deps = {
    plain: false,
    indentParagraphs: true,
    previewOnly: false,
    composition: true,
    linkDialog: false,
    view: undefined,
    onSave() {},
    apply() {},
  };
  const binding = EditorState.create({ extensions: editorKeymap(deps) })
    .facet(keymap)
    .flat()
    .find((binding) => binding.key === 'Enter')!;
  assert.equal(binding.run!(value.target), false);
  deps.composition = false;
  for (const flag of ['composing', 'compositionStarted'] as const) {
    assert.equal(binding.run!({ ...value.target, [flag]: true }), false);
  }
  const readonly = EditorState.create({ doc: '段落', extensions: EditorState.readOnly.of(true) });
  assert.equal(paragraphNewline({ state: readonly, dispatch: () => assert.fail('変更しない') }, true), false);
  let state = EditorState.create({
    doc: '前\n後',
    selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
    extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: commonmarkLanguage, extensions: markdownExtensions })],
  });
  paragraphNewline(
    {
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    },
    true,
  );
  assert.equal(state.doc.toString(), '前\n　\n後\n　');
  assert.equal(state.selection.ranges.length, 2);
});

test('段落の構文木を再利用し、Enterのたびに全文を解析しない', () => {
  const value = editor('　段落');
  ensureSyntaxTree(value.state, value.state.doc.length, 1000);
  const parse = markdownParser.parse;
  markdownParser.parse = () => assert.fail('全文を解析しない');
  try {
    value.enter();
  } finally {
    markdownParser.parse = parse;
  }
  assert.equal(value.state.doc.toString(), '　段落\n　');
});
