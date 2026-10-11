import test from 'node:test';

import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';

import { undo } from '@codemirror/commands';
import { EditorView, type WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { frontMatter, markdownParser, walk, touches } from '../../src/lib/editor/markdown.ts';
import { references, linkTarget } from '../../src/lib/editor/markdownInline.ts';
import { formatPlan } from '../../src/lib/editor/markdownFormat.ts';
import { livePreview } from '../../src/lib/editor/livePreview.ts';
import { previewOnlyMode, compositionMode } from '../../src/lib/editor/previewState.ts';

import { options, editor, decorationRanges } from './previewFixture.ts';

test('見出し1〜3だけに線を付け、Setextでは最後に表示する行へ付ける', () => {
  const text = '# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六\n\n七\n八\n===\n\n九\n---\n\n本文';
  const rules = (state: EditorState) =>
    decorationRanges(state)
      .filter((range) => range.spec.class === 'nagori-heading-rule')
      .map((range) => range.from);
  const expected = ['# 一', '## 二', '### 三', '八', '九'].map((part) => text.indexOf(part));
  let state = editor(text);
  assert.deepEqual(rules(state), expected);
  for (const part of ['七', '八', '===']) {
    state = state.update({ selection: { anchor: text.indexOf(part) } }).state;
    assert.deepEqual(rules(state), [expected[0], expected[1], expected[2], text.indexOf('==='), expected[4]]);
  }
  state = state.update({ effects: previewOnlyMode.of(true) }).state;
  assert.deepEqual(rules(state), expected);
  assert.equal(state.doc.toString(), text);
  assert.equal(undo({ state, dispatch: () => {} }), false);
});

test('front matter including empty block stays source while following Markdown parses', () => {
  for (const text of ['---\n---\n\n**ok**', '---\ntitle: **source**\n---\n\n**ok**']) {
    assert.ok(frontMatter(text));
    let strong = 0;
    walk(markdownParser.parse(text).topNode, (n) => {
      if (n.name === 'StrongEmphasis') strong++;
    });
    assert.equal(strong, 1);
    const state = editor(text);
    assert.equal(state.doc.toString(), text);
    assert.ok(!decorationRanges(state).some((r) => r.from < frontMatter(text)!.to));
  }
  assert.equal(frontMatter('---\nnot closed'), null);
});

test('reference definitions resolve first label, missing references stay source', () => {
  const text = '[a][ok] [a][missing] [ok][] [ok]\n\n[OK]: /local.md\n[ok]: /other.md';
  const tree = markdownParser.parse(text),
    refs = references(tree, text),
    targets: (string | null)[] = [];
  walk(tree.topNode, (n) => {
    if (n.name === 'Link') targets.push(linkTarget(n, text, refs));
  });
  assert.deepEqual(targets, ['/local.md', null, '/local.md', '/local.md']);
  const raw = '[a][missing]\n\nend';
  assert.ok(!decorationRanges(editor(raw)).some((r) => r.from < 12 && r.spec.widget === undefined));
});

test('selection boundaries reveal nested syntax; display modes never mutate document or history', () => {
  const text = '**outer *inner***\n\nlast';
  const closed = decorationRanges(editor(text));
  assert.ok(closed.some((r) => r.from === 0 && r.to === 2));
  const selected = decorationRanges(editor(text, 10));
  assert.ok(!selected.some((r) => r.from === 0 && r.to === 2));
  assert.equal(touches({ from: 2, to: 8 }, { from: 8, to: 8 }), true);
  let state = editor(text).update({ changes: { from: text.length, insert: '!' } }).state;
  for (const effect of [previewOnlyMode.of(true), previewOnlyMode.of(false), compositionMode.of(true), compositionMode.of(false)])
    state = state.update({ effects: effect }).state;
  assert.equal(state.doc.toString(), text + '!');
  assert.ok(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), text);
  const composed = editor(text).update({ effects: compositionMode.of(true) }).state;
  assert.ok(decorationRanges(composed, true).length > 0);
  assert.equal(syntaxTree(editor('~~strike~~')).toString().includes('Strikethrough'), true);
  assert.equal(syntaxTree(editor('www.example.com')).toString().includes('Autolink'), false);
});

test('IME retains other previews, maps their positions, and renders committed syntax without changing undo', () => {
  const text = '入力: \n\n# 見出し\n\n**太字**\n\n| h |\n|---|\n| c |\n\n![alt](assets/a.png)';
  const at = '入力: '.length,
    insert = '`日本語` ';
  let state = editor(text, at);
  const before = decorationRanges(state, true);
  assert.ok(before.some((r) => r.spec.widget && r.spec.block));
  assert.ok(before.some((r) => r.from === text.indexOf('**')));
  state = state.update({ effects: compositionMode.of(true) }).state;
  assert.deepEqual(decorationRanges(state, true), before);
  state = state.update({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: 'input.type.compose' }).state;
  const during = decorationRanges(state, true);
  for (const original of before) {
    const mapped = during.find((r) => r.from === original.from + insert.length && r.to === original.to + insert.length);
    assert.ok(mapped, `missing preview at ${original.from}`);
    assert.equal(mapped.spec.widget, original.spec.widget);
  }
  assert.ok(!during.some((r) => r.from < at + insert.length));
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({ effects: compositionMode.of(false) }).state;
  assert.ok(decorationRanges(state, true).some((r) => r.spec.widget && r.from === at + 1 && r.to === at + 4));
  assert.equal(state.doc.toString(), text.slice(0, at) + insert + text.slice(at));
  assert.ok(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), text);
});

test('IME cancel restores editing selection preview while Preview retains rendering', () => {
  const text = '**太字**\n\n入力';
  let state = editor(text, text.length);
  state = state.update({ effects: compositionMode.of(true) }).state;
  assert.ok(decorationRanges(state, true).some((r) => r.from === 0 && r.to === 2));
  state = state.update({ effects: compositionMode.of(false), selection: { anchor: 3 } }).state;
  assert.ok(!decorationRanges(state, true).some((r) => r.from === 0 && r.to === 2));
  assert.equal(state.doc.toString(), text);
  assert.equal(undo({ state, dispatch: () => {} }), false);
  state = state.update({ effects: previewOnlyMode.of(true) }).state;
  for (const active of [true, false]) {
    state = state.update({ effects: compositionMode.of(active) }).state;
    assert.ok(decorationRanges(state, true).some((r) => r.from === 0 && r.to === 2));
  }
});

test('Inline Codeの置き換えWidgetにコードのクラスを付け、ほかの文字Widgetのクラスを保つ', () => {
  const samples = [
    ['`npm run build`', 'npm run build'],
    ['# `見出し`', '見出し'],
    ['**`太字`**', '太字'],
    ['[`リンク`](https://example.com)', 'リンク'],
    ['``a`b``', 'a`b'],
    ['` a\n b `', 'a  b'],
    ['`' + 'long code '.repeat(50) + '`', 'long code '.repeat(50)],
  ];
  const widgets = samples.map(([source, value]) => {
    const state = editor(source + '\n\n末尾');
    const widget = decorationRanges(state, true).find((r) => r.spec.widget)!.spec.widget as WidgetType;
    return { widget, value };
  });
  const other = decorationRanges(editor('- 項目\n\n改行\n続き &amp; \\*\n\n末尾'), true)
    .filter((r) => r.spec.widget)
    .map((r) => r.spec.widget as WidgetType);
  const sameText = decorationRanges(editor('`a` &#97;\n\n末尾'), true)
    .filter((r) => r.spec.widget)
    .map((r) => r.spec.widget as WidgetType);
  const anotherCode = decorationRanges(editor('`a`\n\n末尾'), true).find((r) => r.spec.widget)!.spec.widget as WidgetType;
  const saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => ({ className: '', textContent: '' }) };
  try {
    for (const { widget, value } of widgets) {
      const span = widget.toDOM(null as unknown as EditorView);
      assert.equal(span.className, 'nagori-code');
      assert.equal(span.textContent, value);
      assert.equal(widget.ignoreEvent(null as unknown as Event), false);
    }
    assert.deepEqual(
      other.map((widget) => {
        const span = widget.toDOM(null as unknown as EditorView);
        assert.equal(span.className, 'nagori-list-marker');
        return span.textContent;
      }),
      [' ', '&', '*'],
    );
    assert.equal(sameText[0].eq(sameText[1]), false);
    assert.equal(sameText[0].eq(anotherCode), true);
    assert.equal(sameText[0].eq(widgets[0].widget), false);
  } finally {
    if (saved === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = saved;
  }
});

test('Inline Codeはカーソルと選択で記号を見せ、Previewでは置き換えを保つ', () => {
  const text = '前 `npm run build` 後\n\n末尾',
    from = text.indexOf('`'),
    to = text.lastIndexOf('`') + 1;
  let state = editor(text);
  const replaced = () => decorationRanges(state, true).some((r) => r.from === from + 1 && r.to === to - 1 && r.spec.widget);
  assert.equal(replaced(), true);
  for (const selection of [EditorSelection.cursor(from + 2), EditorSelection.range(from, to)]) {
    state = state.update({ selection }).state;
    assert.equal(replaced(), false);
    assert.ok(decorationRanges(state, true).some((r) => r.from === from + 1 && r.to === to - 1 && r.spec.class === 'nagori-code'));
    assert.ok(!decorationRanges(state, true).some((r) => r.from === from && r.to === from + 1));
    state = state.update({ effects: previewOnlyMode.of(true) }).state;
    assert.equal(replaced(), true);
    state = state.update({ effects: previewOnlyMode.of(false) }).state;
  }
  state = state.update({ selection: { anchor: text.length } }).state;
  assert.equal(replaced(), true);
  assert.equal(state.doc.toString(), text);
  assert.equal(undo({ state, dispatch: () => {} }), false);
});

test('tables/images replace only inactive blocks and raw HTML is never decorated', () => {
  const text = '| **a** | b |\n|---|---|\n| x | y |\n\n![alt](assets/a.png)\n\n<script>alert(1)</script>\n\nend';
  const inactive = decorationRanges(editor(text));
  assert.ok(inactive.some((r) => r.spec.block && r.spec.widget));
  const active = decorationRanges(editor(text, 4));
  assert.ok(!active.some((r) => r.from === 0 && r.spec.block));
  const htmlStart = text.indexOf('<script>'),
    htmlEnd = text.indexOf('</script>') + 9;
  assert.ok(!inactive.some((r) => r.from >= htmlStart && r.to <= htmlEnd));
});

test('隠す記号はreplaceを使わず本文に残すmarkで表し、変換中は位置だけを写す', () => {
  const text = '前 **太字** 後\n\n末尾';
  const hidden = (state: EditorState) =>
    decorationRanges(state, true)
      .filter((r) => r.spec.class === 'nagori-hidden')
      .map((r) => [r.from, r.to]);
  const replaced = (state: EditorState) => decorationRanges(state, true).filter((r) => r.spec.widget || (!r.spec.class && r.from !== r.to));
  let state = editor(text, 0);
  assert.deepEqual(hidden(state), [
    [2, 4],
    [6, 8],
  ]);
  assert.deepEqual(replaced(state), []);
  assert.equal(state.doc.toString(), text);
  // 変換中は装飾を作り直さず、未確定文字の分だけ位置を送る
  state = state.update({ effects: compositionMode.of(true) }).state;
  state = state.update({ changes: { from: 0, insert: 'か' }, userEvent: 'input.type.compose' }).state;
  assert.deepEqual(hidden(state), [
    [3, 5],
    [7, 9],
  ]);
  state = state.update({ effects: compositionMode.of(false) }).state;
  assert.deepEqual(hidden(state), [
    [3, 5],
    [7, 9],
  ]);
  // カーソルや選択が触れた時は記号を見せる
  for (const selection of [EditorSelection.cursor(4), EditorSelection.range(2, 8)]) {
    assert.deepEqual(hidden(state.update({ selection }).state), []);
  }
});

test('見出しの記号と引用の記号も同じmarkで隠し、フェンスと下線は行の高さを0にする', () => {
  const text = '# 見出し\n\n> 引用\n\n前\n===\n\n```ts\ncode\n```\n\n末尾';
  const state = editor(text, text.length);
  const hidden = decorationRanges(state, true)
    .filter((r) => r.spec.class === 'nagori-hidden')
    .map((r) => [r.from, r.to]);
  assert.ok(hidden.some(([from, to]) => from === 0 && to === 2));
  assert.ok(hidden.some(([from, to]) => from === text.indexOf('>') && to === text.indexOf('>') + 2));
  const lines = decorationRanges(state, true)
    .filter((r) => r.spec.class === 'nagori-hidden-line')
    .map((r) => r.from);
  assert.deepEqual(lines, [text.indexOf('==='), text.indexOf('```ts'), text.lastIndexOf('```')]);
  assert.equal(state.doc.toString(), text);
});

test('table math source selection reveals exactly the targeted expression', () => {
  const source = '| h | math |\n|---|---|\n| first | $x^2$ |\n| second | **$\\sqrt{x}$** |\n\nend';
  for (const expression of ['$x^2$', '$\\sqrt{x}$']) {
    const at = source.indexOf(expression),
      state = editor(source, at);
    const ranges = decorationRanges(state, true);
    assert.ok(!ranges.some((r) => r.spec.widget && r.from <= at && r.to > at));
    const other = source.indexOf(expression === '$x^2$' ? '$\\sqrt{x}$' : '$x^2$');
    assert.ok(ranges.some((r) => r.spec.widget && r.from === other));
    assert.equal(state.selection.main.head, at);
    assert.equal(state.doc.toString(), source);
  }
});

test('math source reveal, Preview and IME preserve source and undo', () => {
  const source = '入力\n\n$x^2$\n\n$$\ny^2\n$$\n\nend',
    mathAt = source.indexOf('$');
  let state = editor(source);
  assert.ok(decorationRanges(state, true).some((r) => r.from === mathAt && r.spec.widget));
  state = state.update({ selection: { anchor: mathAt + 2 } }).state;
  assert.ok(!decorationRanges(state, true).some((r) => r.from === mathAt && r.spec.widget));
  state = state.update({ selection: EditorSelection.range(mathAt - 1, mathAt + 1) }).state;
  assert.ok(!decorationRanges(state, true).some((r) => r.from === mathAt && r.spec.widget));
  assert.ok(formatPlan(source, { from: mathAt + 1, to: mathAt + 2 }, 'bold').reason);
  state = state.update({ selection: { anchor: 0 } }).state;
  const before = decorationRanges(state, true);
  state = state.update({ effects: compositionMode.of(true) }).state;
  state = state.update({ changes: { from: 0, insert: '日本語' }, selection: { anchor: 3 }, userEvent: 'input.type.compose' }).state;
  for (const range of before)
    assert.equal(
      decorationRanges(state, true).find((r) => r.from === range.from + 3 && r.to === range.to + 3)?.spec.widget,
      range.spec.widget,
    );
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({ effects: compositionMode.of(false) }).state;
  for (const active of [true, false]) {
    state = state.update({ effects: previewOnlyMode.of(active) }).state;
    if (active) assert.ok(decorationRanges(state, true).some((r) => r.from === mathAt + 3 && r.spec.widget));
  }
  assert.equal(state.doc.toString(), '日本語' + source);
  assert.ok(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), source);
});

test('Preview keeps all syntax rendered through cursor/search selections and blocks edits without losing undo', () => {
  let locked = EditorState.create({
    doc: '**locked**',
    extensions: [livePreview(options), EditorState.readOnly.of(true), EditorView.editable.of(false)],
  });
  for (const active of [false, true, false]) {
    locked = locked.update({ effects: previewOnlyMode.of(active) }).state;
    assert.equal(locked.readOnly, true);
    assert.equal(locked.facet(EditorView.editable), false);
  }
  // An authorized image-import result may change a temporarily busy (readOnly) editor; Preview must still reject it.
  locked = locked.update({ changes: { from: locked.doc.length, insert: '\n![image](assets/a.png)' }, userEvent: 'input' }).state;
  assert.equal(locked.doc.toString(), '**locked**\n![image](assets/a.png)');
  locked = locked.update({ effects: previewOnlyMode.of(true) }).state;
  const busyText = locked.doc.toString();
  locked = locked.update({ changes: { from: locked.doc.length, insert: '\n![image](assets/b.png)' }, userEvent: 'input' }).state;
  assert.equal(locked.doc.toString(), busyText);
  const source =
    '# Heading\n\n**bold** *italic* ~~strike~~ `code` [link](a.md)\n\n> quote\n\n- [ ] task\n\n| h |\n|---|\n| c |\n\n![alt](a.png)\n\n$x^2$\n\n---\n\n```js\ncode\n```';
  let state = editor(source, 0).update({ changes: { from: source.length, insert: '\nend' } }).state;
  const edited = state.doc.toString(),
    selection = state.selection;
  state = state.update({ effects: previewOnlyMode.of(true) }).state;
  assert.equal(state.readOnly, true);
  assert.equal(state.facet(EditorView.editable), false);
  assert.ok(state.selection.eq(selection));
  const baseline = decorationRanges(state, true).map((r) => ({
    from: r.from,
    to: r.to,
    class: r.spec.class,
    block: r.spec.block,
    widget: !!r.spec.widget,
  }));
  assert.ok(baseline.some((r) => r.from === 0 && r.to === 2));
  for (const marker of ['**bold**', '*italic*', '~~strike~~', '`code`', '[link]', '| h |', '![alt]', '$x^2$', '- [ ]', '---', '```']) {
    const at = edited.indexOf(marker);
    state = state.update({ selection: EditorSelection.range(at, at + marker.length) }).state;
    assert.deepEqual(
      decorationRanges(state, true).map((r) => ({
        from: r.from,
        to: r.to,
        class: r.spec.class,
        block: r.spec.block,
        widget: !!r.spec.widget,
      })),
      baseline,
      marker,
    );
  }
  const task = decorationRanges(state, true).find((r) => r.from === edited.indexOf('[ ]'))!.spec.widget as { disabled: boolean };
  assert.equal(task.disabled, true);
  for (const userEvent of ['input', 'input.paste', 'input.drop', 'input.format', 'delete', 'undo']) {
    state = state.update(state.replaceSelection('changed'), { userEvent }).state;
    assert.equal(state.doc.toString(), edited);
  }
  assert.equal(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
    false,
  );
  const lastSelection = state.selection;
  state = state.update({ effects: previewOnlyMode.of(false) }).state;
  assert.equal(state.readOnly, false);
  assert.equal(state.facet(EditorView.editable), true);
  assert.ok(state.selection.eq(lastSelection));
  assert.ok(!decorationRanges(state, true).some((r) => r.from === edited.indexOf('```') && r.to > r.from));
  assert.ok(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), source);
});

test('複数区間を1回のinput.formatで変更し、1回のUndoで選択と本文を戻す', () => {
  const source = '一\n\n```\nコード\n```\n\n二';
  let state = editor(source).update({ selection: EditorSelection.range(0, source.length) }).state;
  const plan = formatPlan(source, state.selection.main, 'bold');
  assert.equal(plan.changes?.length, 2);
  const transaction = state.update({
    changes: plan.changes,
    selection: EditorSelection.range(plan.selection.from, plan.selection.to),
    userEvent: 'input.format',
  });
  assert.ok(transaction.isUserEvent('input.format'));
  state = transaction.state;
  assert.equal(state.doc.toString(), '**一**\n\n```\nコード\n```\n\n**二**');
  assert.ok(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), source);
  assert.deepEqual({ from: state.selection.main.from, to: state.selection.main.to }, { from: 0, to: source.length });
  assert.equal(undo({ state, dispatch: () => {} }), false);
});
