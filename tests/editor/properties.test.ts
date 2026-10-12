import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, RangeSet, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { markdownExtensions } from '../../src/lib/editor/markdown.ts';
import { livePreview } from '../../src/lib/editor/livePreview.ts';
import { PropertiesWidget, propertiesSource, propertyKind } from '../../src/lib/editor/previewProperties.ts';
import { compositionMode, previewOnlyMode } from '../../src/lib/editor/previewState.ts';
import { patchFrontMatter, readProperties } from '../../src/lib/workspace/frontMatter.ts';
import { syntaxTree } from '@codemirror/language';
import { extractHeadings } from '../../src/lib/workspace/outline.ts';

const text = '---\n# 注記\ntitle: 日本語 # タイトル\ntags: [a, b]\ndraft: false\nother: {nested: true}\n---\n\n\n本文\n次';
const create = (doc = text, properties = true) =>
  EditorState.create({
    doc,
    extensions: [
      history(),
      markdown({ extensions: markdownExtensions }),
      livePreview({ properties, resolveImage: async () => '', onLink: () => {} }),
    ],
  });
function widgets(state: EditorState) {
  const found: { from: number; to: number; widget: PropertiesWidget }[] = [];
  for (const set of state.facet(EditorView.decorations))
    if (typeof set !== 'function')
      set.between(0, state.doc.length, (from, to, decoration) => {
        if (decoration.spec.widget instanceof PropertiesWidget) found.push({ from, to, widget: decoration.spec.widget });
      });
  return found;
}
test('Front Matterを置き換え、順序と型、空行を保つ', () => {
  const state = create();
  const [range] = widgets(state);
  assert.equal(range.from, 0);
  assert.equal(range.to, text.indexOf('本文'));
  assert.deepEqual(
    range.widget.properties.map((p) => p.key),
    ['title', 'tags', 'draft', 'other'],
  );
  assert.equal(range.widget.properties.at(-1)?.editable, false);
  assert.equal(state.doc.toString(), text);
  const recursive = readProperties('---\nother: &a {self: *a}\n---\n本文')?.properties[0];
  assert.equal(recursive?.editable, false);
  assert.equal(recursive?.source, '{self: *a}');
  assert.equal(widgets(create(text, false)).length, 0);
  for (const doc of ['本文', '---\ntitle: [\n---\n本文', '---\ntitle: a\ntitle: b\n---\n本文', '---\n- a\n---\n本文'])
    assert.equal(widgets(create(doc)).length, 0);
});
test('プロパティ直後の見出しの行装飾を隠さず、目次にも取り出す', () => {
  for (const gap of ['', '\n', '\n\n']) {
    const doc = '---\ntitle: 記事\n---\n' + gap + '## Markdownを楽に編集したい\n\n本文';
    let state = create(doc);
    for (const previewOnly of [false, true]) {
      state = state.update({ effects: previewOnlyMode.of(previewOnly) }).state;
      const rendered: string[] = [];
      // DOMを組み立てる時と同じ走査で、置き換えに隠された行装飾も検出する。
      RangeSet.spans(
        state.facet(EditorView.decorations).filter((set) => typeof set !== 'function'),
        0,
        state.doc.length,
        {
          span() {},
          point(from, _to, decoration) {
            if (from === doc.indexOf('##') && decoration.spec.class) rendered.push(decoration.spec.class);
          },
        },
      );
      assert.ok(rendered.includes('nagori-heading nagori-h2'));
      assert.deepEqual(
        extractHeadings(syntaxTree(state), state.doc).map((heading) => [heading.level, heading.text]),
        [[2, 'Markdownを楽に編集したい']],
      );
      assert.equal(state.doc.toString(), doc);
    }
  }
});
test('ソースを開いて編集し、本文へ移ると再表示する。Previewは読み取り専用', () => {
  let state = create();
  state = state.update({ effects: propertiesSource.of(true), selection: { anchor: text.indexOf('日本語') } }).state;
  assert.equal(widgets(state).length, 0);
  state = state.update({
    changes: { from: text.indexOf('日本語'), to: text.indexOf('日本語') + 3, insert: '別タイトル' },
    userEvent: 'input',
  }).state;
  state = state.update({ selection: { anchor: state.doc.length } }).state;
  assert.equal(widgets(state)[0].widget.properties[0].value, '別タイトル');
  state = state.update({ effects: previewOnlyMode.of(true) }).state;
  assert.equal(widgets(state)[0].widget.readonly, true);
  assert.equal(state.update({ changes: patchFrontMatter(state.doc.toString(), 'title', '変更') }).newDoc.toString(), state.doc.toString());
});
test('編集はコメントを保持しUndoで表示も戻る。変換中はウィジェットを保つ', () => {
  let state = create();
  state = state.update({
    changes: patchFrontMatter(text, 'title', '更新'),
    annotations: Transaction.userEvent.of('input.properties'),
  }).state;
  assert.equal(widgets(state)[0].widget.properties[0].value, '更新');
  assert.ok(state.doc.toString().includes('# 注記') && state.doc.toString().includes('# タイトル'));
  assert.ok(
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), text);
  assert.equal(widgets(state)[0].widget.properties[0].value, '日本語');
  const original = widgets(state)[0].widget;
  state = state.update({ effects: compositionMode.of(true) }).state;
  assert.equal(widgets(state)[0].widget, original);
  state = state.update({ effects: compositionMode.of(false) }).state;
  assert.equal(widgets(state)[0].widget.properties[0].value, '日本語');
});
test('本文の先頭でカーソルを隠れたYAMLに置かず、Backspaceで消さない', () => {
  let state = create();
  state = state.update({ selection: { anchor: 0 } }).state;
  const end = widgets(state)[0].to;
  assert.equal(state.selection.main.head, end);
  state = state.update({ changes: { from: 0, to: end }, userEvent: 'delete.backward' }).state;
  assert.equal(state.doc.toString(), text);
});
test('既存項目と未知の文字を編集でき、空値や空配列の項目も追加できる', () => {
  let source = '---\ncustom: text\nother: {nested: true}\ntags: false\n---\n本文';
  const apply = (key: string, value: string | string[] | boolean | number) => {
    source = patchFrontMatter(source, key, value).reduceRight(
      (doc, change) => doc.slice(0, change.from) + change.insert + doc.slice(change.to),
      source,
    );
  };
  apply('custom', '新しい文字');
  apply('title', '');
  apply('coverTitleLines', []);
  apply('draft', false);
  assert.deepEqual(
    readProperties(source)?.properties.map((p) => p.key),
    ['custom', 'other', 'tags', 'title', 'coverTitleLines', 'draft'],
  );
  assert.throws(() => patchFrontMatter(source, 'other', '上書き'));
  assert.ok(
    source.includes('custom: 新しい文字') &&
      source.includes('title: ""') &&
      source.includes('coverTitleLines: []') &&
      source.includes('draft: false'),
  );
});

test('項目名に関係なく値から型を判定する', () => {
  const source =
    '---\ntitle: true\ndraft: words\ncount: -1.5\nday: 2026-10-12\ntime: 2026-10-12T23:45:01+09:00\nitems: [a, b]\nempty: []\nnullValue:\nmixed: [a, 1]\nanchored: &n 1\nalias: *n\ninfinity: .inf\nother: {nested: true}\n---\n本文';
  assert.deepEqual(
    readProperties(source)?.properties.map((p) => [p.key, propertyKind(p)]),
    [
      ['title', 'boolean'],
      ['draft', 'text'],
      ['count', 'number'],
      ['day', 'date'],
      ['time', 'date'],
      ['items', 'list'],
      ['empty', 'list'],
      ['nullValue', 'other'],
      ['mixed', 'other'],
      ['anchored', 'other'],
      ['alias', 'other'],
      ['infinity', 'other'],
      ['other', 'other'],
    ],
  );
});

test('区切りの末尾の空白とCRLFを扱い、直後の見出しを保つ', () => {
  const source = '\uFEFF--- \t\r\nday: 2026-02-31\r\n--- \t\r\n## 見出し\r\n本文';
  const state = create(source);
  assert.equal(widgets(state)[0].to, state.doc.toString().indexOf('##'));
  assert.equal(propertyKind(widgets(state)[0].widget.properties[0]), 'text');
  assert.deepEqual(
    extractHeadings(syntaxTree(state), state.doc).map((p) => p.text),
    ['見出し'],
  );
});
