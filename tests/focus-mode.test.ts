import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { markdownExtensions } from '../src/lib/markdown.ts';
import { compositionMode } from '../src/lib/livePreview.ts';
import { focusBlock, focusSpans, focusMode, followsTyping, centeredScrollTop } from '../src/lib/focusMode.ts';

const editor = (doc: string, head = 0) => EditorState.create({ doc, selection: { anchor: head }, extensions: [markdown({ base: commonmarkLanguage, extensions: markdownExtensions })] });

test('段落・見出し・リスト項目・引用・コード・表・数式をブロック単位で保つ', () => {
  for (const block of ['段落\n続き', '# 見出し', '見出し\n====', '- 項目\n  続き', '- [ ] 項目\n  続き', '> 引用\n> 続き', '> 引用\n>\n> 別の段落', '```js\nコード\n```', '    コード\n    続き', '| 列 |\n|---|\n| 値 |', '$$\nx^2\n$$']) {
    const doc = `前\n\n${block}\n\n後`, state = editor(doc);
    for (let pos = 3; pos <= 3 + block.length; pos++) assert.deepEqual(focusBlock(state, pos), { from: 3, to: 3 + block.length }, `${block}, ${pos}`);
  }
  const state = editor('- 一\n  - 内側\n  - 二\n- 外側');
  assert.deepEqual(focusBlock(state, 9), { from: 4, to: 10 });
  assert.deepEqual(focusBlock(state, state.doc.length), { from: 17, to: 21 });
  assert.deepEqual(focusBlock(editor('前\n\n後'), 2), { from: 2, to: 2 });
});

test('選択が触れる両端のブロックを含め、間のブロックも薄くしない', () => {
  const source = '段落\n続き\n\n# 見出し\n\n- 一\n  続き\n- 二\n\n後';
  let state = editor(source).update({ selection: EditorSelection.range(2, source.indexOf('- 二')) }).state;
  assert.deepEqual(focusSpans(state), [{ from: 0, to: source.indexOf('\n\n後') }]);
  state = state.update({ selection: EditorSelection.range(source.length, 2) }).state;
  assert.deepEqual(focusSpans(state), [{ from: 0, to: source.length }]);
});

test('入力とキー移動だけを追い、クリックとドロップは追わない', () => {
  const state = editor('本文');
  for (const userEvent of ['input', 'input.type', 'input.paste', 'delete', 'select', 'select.keyboard', 'undo', 'redo']) assert.equal(followsTyping(state.update({ selection: { anchor: 1 }, userEvent })), true, userEvent);
  for (const userEvent of ['select.pointer', 'select.pointer.mouse', 'select.search', 'select.search.matches', 'input.drop', undefined]) assert.equal(followsTyping(state.update({ selection: { anchor: 1 }, userEvent })), false, userEvent);
  assert.equal(centeredScrollTop(100, 410, 10, 600), 200);
  assert.equal(centeredScrollTop(0, 50, 10, 600), 0);
  assert.equal(centeredScrollTop(200, 310, 10, 600), 200);
});

test('両方オフは拡張なし、plainの集中モードは無効', () => {
  assert.deepEqual(focusMode(false, false), []);
  assert.deepEqual(focusMode(true, false, true), []);
  const state = EditorState.create({ extensions: focusMode(true, true, true) });
  assert.equal(state.facet(EditorView.scrollHandler).length, 1);
  assert.equal(state.facet(EditorView.editorAttributes).length, 0);
});

test('Mod+Shift+JとMod+Shift+Tは既存のCodeMirrorのキーと重複しない', () => {
  const normalize = (key: string) => key.toLowerCase().split('-').sort().join('-');
  const keys = [...defaultKeymap, ...historyKeymap, ...searchKeymap].flatMap(binding => [binding.key, binding.mac, binding.win, binding.linux].filter((key): key is string => !!key)).map(normalize);
  assert.ok(!keys.includes(normalize('Mod-Shift-j')));
  assert.ok(!keys.includes(normalize('Mod-Shift-t')));
});

test('100KiBの同じ段落内の移動はDOMを作り直さず、IME中と手動スクロールは追従しない', () => {
  const source = '先頭の段落\n続き\n\n' + '別の段落\n\n'.repeat(18000);
  const extension = focusMode(true, true) as { create(view: unknown): any }[];
  const plugin = extension[0];
  let state = editor(source);
  let measures = 0;
  const classes = new Set<string>();
  const child = { childNodes: [], classList: { contains: () => false, toggle(name: string, value: boolean) { if (value) classes.add(name); else classes.delete(name); }, remove(name: string) { classes.delete(name); } } };
  const scrollDOM = Object.assign(new EventTarget(), { scrollTop: 0, clientHeight: 600, getBoundingClientRect: () => ({ top: 10 }) });
  let measuring = false;
  const view = { state, visibleRanges: [{ from: 0, to: 30 }], composing: false, scrollDOM, contentDOM: { children: [child] }, posAtDOM: () => 0, requestMeasure(request: any) { measures++; measuring = true; const result = request.read(view); measuring = false; request.write(result); }, coordsAtPos: () => { assert.ok(measuring, 'レイアウトはrequestMeasureのreadで読む'); return { top: 400, bottom: 420 }; }, plugin: () => mode };
  const mode = plugin.create(view);
  const update = (spec: Parameters<EditorState['update']>[0]) => {
    const tr = state.update(spec); state = tr.state; view.state = state;
    mode.update({ state, view, changes: tr.changes, transactions: [tr], docChanged: tr.docChanged, selectionSet: !!tr.selection, viewportChanged: false, geometryChanged: false });
  };
  assert.ok(classes.has('nagori-focus-active'));
  const decorations = mode.decorations;
  update({ selection: { anchor: 1 }, userEvent: 'select' });
  assert.equal(mode.decorations, decorations);
  assert.equal(mode.follow, true);
  const handler = EditorState.create({ extensions: extension as any }).facet(EditorView.scrollHandler)[0];
  assert.equal(handler(view as unknown as EditorView, state.selection.main, { x: 'nearest', y: 'nearest', xMargin: 5, yMargin: 5 }), true);
  assert.equal(scrollDOM.scrollTop, 100);
  update({ selection: { anchor: 2 }, userEvent: 'select' });
  scrollDOM.dispatchEvent(new Event('wheel'));
  assert.equal(mode.follow, false);
  update({ selection: { anchor: 3 }, userEvent: 'select' });
  scrollDOM.dispatchEvent(new Event('pointerdown'));
  assert.equal(mode.follow, false);
  update({ effects: compositionMode.of(true) });
  const beforeComposition = measures;
  update({ changes: { from: 3, insert: '変換' }, userEvent: 'input.type.compose' });
  assert.equal(mode.follow, false);
  assert.equal(measures, beforeComposition);
  update({ effects: compositionMode.of(false) });
  assert.equal(measures, beforeComposition + 1);
  update({ selection: { anchor: source.length }, userEvent: 'select' });
  assert.equal(measures, beforeComposition + 2);
  mode.destroy();
  assert.equal(classes.size, 0);
});
