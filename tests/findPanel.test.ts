import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, showPanel, type ViewUpdate } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { SearchQuery, setSearchQuery, getSearchQuery, openSearchPanel } from '@codemirror/search';
import { findExtension, findReplaceBlocked, searchSummary, navigateMatch, replaceMatches } from '../src/lib/findPanel.ts';

function editor(text: string, query: { search: string; replace?: string; regexp?: boolean; caseSensitive?: boolean }) {
  let state = EditorState.create({ doc: text, extensions: [history(), findExtension(() => false)] });
  state = state.update({ effects: setSearchQuery.of(new SearchQuery({ literal: true, caseSensitive: true, ...query })) }).state;
  const transactions: Transaction[] = [];
  const view = {
    get state() { return state; }, composing: false, plugin: () => null,
    dispatch: (...specs: Parameters<EditorState['update']>) => {
      const tr = specs[0] instanceof Transaction ? specs[0] : state.update(...specs);
      state = tr.state; transactions.push(tr);
    },
  } as unknown as EditorView;
  return { view, transactions };
}

test('文字どおりの検索は大文字小文字を区別し、切り替えで区別を外せる', () => {
  const { view } = editor('Cat cat CAT a.b aXb \\n', { search: 'cat' });
  assert.equal(searchSummary(view.state).total, 1);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'cat', caseSensitive: false, literal: true })) });
  assert.equal(searchSummary(view.state).total, 3);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'a.b', caseSensitive: true, literal: true })) });
  assert.equal(searchSummary(view.state).total, 1);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '\\n', literal: true })) });
  assert.equal(searchSummary(view.state).total, 1);
});

test('現在位置と前後の移動は文末で折り返す', () => {
  const { view } = editor('a cat b cat', { search: 'cat' });
  navigateMatch(view);
  assert.equal(searchSummary(view.state).current, 1);
  navigateMatch(view); assert.equal(searchSummary(view.state).current, 2);
  navigateMatch(view); assert.equal(searchSummary(view.state).current, 1);
  navigateMatch(view, true); assert.equal(searchSummary(view.state).current, 2);
});

test('入力中は今の一致の先頭から絞り込み、一致がなくなっても選択を保つ', () => {
  for (const regexp of [false, true]) {
    const { view, transactions } = editor('autumn12 autumn12', { search: '', regexp });
    for (const search of ['a', 'au', 'aut', 'autu', 'autum', 'autumn', 'autumn1', 'autumn12']) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, regexp, literal: true })) });
      assert.ok(navigateMatch(view, false, true));
      assert.equal(view.state.selection.main.from, 0);
      assert.equal(view.state.selection.main.to, search.length);
      assert.equal(searchSummary(view.state).current, 1);
      assert.ok(transactions.at(-1)!.isUserEvent('select.search'));
    }
    const selected = view.state.selection;
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'autumn123', regexp, literal: true })) });
    assert.equal(navigateMatch(view, false, true), false);
    assert.ok(view.state.selection.eq(selected));
    assert.equal(view.state.doc.toString(), 'autumn12 autumn12');
    assert.equal(undo(view), false);
  }
});

test('重なる文字列の一致も後ろから選べる', () => {
  const { view } = editor('ababa', { search: 'aba' });
  view.dispatch({ selection: { anchor: 5 } });
  navigateMatch(view, true);
  assert.equal(view.state.selection.main.from, 2);
  assert.equal(view.state.selection.main.to, 5);
  navigateMatch(view, true);
  assert.equal(view.state.selection.main.from, 2);
});

test('検索欄と置換欄の入力、Enter、前後ボタンは入力欄を全選択しない', () => {
  const element = () => ({
    children: [] as ReturnType<typeof element>[], value: '', textContent: '', hidden: false, disabled: false,
    attributes: {} as Record<string, string>, selectCalls: 0,
    oninput: null as (() => void) | null, onclick: null as (() => void) | null,
    onkeydown: null as ((event: object) => void) | null,
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    append(...children: ReturnType<typeof element>[]) { this.children.push(...children); },
    addEventListener() {},
    focus() { dom.activeElement = this; }, select() { this.selectCalls++; },
  });
  const dom = { createElement: element, activeElement: null as ReturnType<typeof element> | null };
  const saved = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom });
  try {
    const { view } = editor('autumn12 autumn12', { search: '' });
    openSearchPanel(view);
    const create = view.state.facet(showPanel).find(panel => panel)!;
    const panel = create(view), root = panel.dom as unknown as ReturnType<typeof element>;
    const [input, count, , , toggle, previous, next] = root.children[0].children;
    const replacement = root.children[1].children[0];
    Object.defineProperty(view, 'root', { value: dom });
    Object.defineProperty(view, 'plugin', { value: () => ({ specs: [create], panels: [panel] }) });
    const dispatch = view.dispatch;
    view.dispatch = (...specs) => {
      dispatch(...specs);
      panel.update?.({ transactions: [], docChanged: false } as unknown as ViewUpdate);
    };
    panel.mount!();
    assert.equal(input.selectCalls, 1);
    assert.equal(count.attributes['aria-live'], 'polite');
    for (const char of 'autumn12') {
      input.value += char; input.oninput!();
      assert.equal(getSearchQuery(view.state).search, input.value);
      assert.equal(view.state.selection.main.from, 0);
      assert.equal(view.state.selection.main.to, input.value.length);
      assert.equal(input.selectCalls, 1);
    }
    for (const shiftKey of [false, true]) {
      root.onkeydown!({ key: 'Enter', target: input, shiftKey, preventDefault() {} });
      assert.equal(input.selectCalls, 1);
    }
    next.onclick!(); previous.onclick!();
    assert.equal(input.selectCalls, 1);
    toggle.onclick!();
    for (const char of 'winter34') {
      replacement.value += char; replacement.oninput!();
      assert.equal(getSearchQuery(view.state).replace, replacement.value);
      assert.equal(replacement.selectCalls, 0);
    }
    assert.equal(input.value, 'autumn12');
    assert.equal(replacement.value, 'winter34');
  } finally {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'document');
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: saved });
  }
});

test('不正な正規表現と空の検索は本文とUndoを変更しない', () => {
  for (const search of ['[', '(', '\\', '']) {
    const { view } = editor('元の本文', { search, regexp: true, replace: '変更' });
    assert.equal(searchSummary(view.state).invalid, !!search);
    assert.equal(searchSummary(view.state).total, 0);
    assert.equal(navigateMatch(view), false);
    assert.equal(replaceMatches(view, true), 0);
    assert.equal(view.state.doc.toString(), '元の本文');
    assert.equal(undo(view), false);
  }
});

test('正規表現のグループ参照はCodeMirrorの規則で全置換する', () => {
  const { view, transactions } = editor('cat12 CAT34 cat56', { search: '(cat)(\\d+)', replace: '$2-$1-$&-$$', regexp: true, caseSensitive: false });
  assert.equal(replaceMatches(view, true), 3);
  assert.equal(view.state.doc.toString(), '12-cat-cat12-$ 34-CAT-CAT34-$ 56-cat-cat56-$');
  assert.equal(transactions.filter(tr => tr.docChanged).length, 1);
  assert.ok(undo(view)); assert.equal(view.state.doc.toString(), 'cat12 CAT34 cat56');
  assert.ok(redo(view)); assert.equal(view.state.doc.toString(), '12-cat-cat12-$ 34-CAT-CAT34-$ 56-cat-cat56-$');
});

test('文字列検索では置換のドル記号とバックスラッシュをそのまま挿入する', () => {
  const { view } = editor('猫 猫', { search: '猫', replace: '$1 $& \\n' });
  assert.equal(replaceMatches(view, true), 2);
  assert.equal(view.state.doc.toString(), '$1 $& \\n $1 $& \\n');
});

test('置換は選択中の一致だけを変え、次の一致へ進む', () => {
  const { view } = editor('cat cat cat', { search: 'cat', replace: '犬' });
  navigateMatch(view);
  assert.equal(replaceMatches(view), 1);
  assert.equal(view.state.doc.toString(), '犬 cat cat');
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), 'cat');
  assert.equal(searchSummary(view.state).current, 1);
  view.dispatch({ selection: { anchor: 0 } });
  assert.equal(replaceMatches(view), 0);
  assert.equal(view.state.doc.toString(), '犬 cat cat');
});

test('全置換のUndoは直前と直後の入力から独立する', () => {
  const { view } = editor('cat cat', { search: 'cat', replace: 'dog' });
  view.dispatch({ changes: { from: 7, insert: '!' }, userEvent: 'input.type' });
  assert.equal(replaceMatches(view, true), 2);
  view.dispatch({ changes: { from: 8, insert: '?' }, userEvent: 'input.type' });
  assert.ok(undo(view)); assert.equal(view.state.doc.toString(), 'dog dog!');
  assert.ok(undo(view)); assert.equal(view.state.doc.toString(), 'cat cat!');
  assert.ok(undo(view)); assert.equal(view.state.doc.toString(), 'cat cat');
});

test('読み取り専用、保存中、Preview、IME変換中は置換しない', () => {
  for (const restriction of ['readonly', 'blocked', 'composing', 'callback']) {
    const { view } = editor('cat cat', { search: 'cat', replace: 'dog' });
    if (restriction === 'readonly') view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    if (restriction === 'blocked') view.dispatch({ effects: findReplaceBlocked.of(true) });
    if (restriction === 'composing') Object.defineProperty(view, 'composing', { value: true });
    assert.equal(replaceMatches(view, true, restriction === 'callback'), 0);
    assert.equal(view.state.doc.toString(), 'cat cat');
    assert.equal(searchSummary(view.state).total, 2);
  }
});

test('空の正規表現の一致は前後へ進み、全置換が完了する', () => {
  const { view } = editor('a\nb\nc', { search: '^', regexp: true, replace: '>' });
  assert.equal(searchSummary(view.state).total, 3);
  navigateMatch(view); assert.equal(view.state.selection.main.from, 2);
  navigateMatch(view); assert.equal(view.state.selection.main.from, 4);
  navigateMatch(view); assert.equal(view.state.selection.main.from, 0);
  navigateMatch(view, true); assert.equal(view.state.selection.main.from, 4);
  assert.equal(replaceMatches(view, true), 3);
  assert.equal(view.state.doc.toString(), '>a\n>b\n>c');
  assert.ok(undo(view)); assert.equal(view.state.doc.toString(), 'a\nb\nc');
});

test('重なる一致は全置換で重複させず、plainの状態でも置換できる', () => {
  const { view } = editor('ababa', { search: 'aba', replace: 'X' });
  assert.equal(replaceMatches(view, true), 1);
  assert.equal(view.state.doc.toString(), 'Xba');
});


test('正規表現でも未選択のカーソル位置から一致を選べる', () => {
  const { view } = editor('cat cat', { search: 'cat', regexp: true, replace: 'dog' });
  navigateMatch(view);
  assert.equal(view.state.selection.main.from, 0);
  assert.equal(view.state.selection.main.to, 3);
});

test('空の一致を1件置換して次の行へ進む', () => {
  const { view } = editor('a\nb\nc', { search: '^', regexp: true, replace: '>' });
  assert.equal(replaceMatches(view), 1);
  assert.equal(view.state.doc.toString(), '>a\nb\nc');
  assert.equal(view.state.selection.main.from, 3);
});


test('本文を読み直した直後も保存中の置換を無効にする', () => {
  const { view } = editor('cat cat', { search: 'cat', replace: 'dog' });
  const state = EditorState.create({ doc: 'cat cat', extensions: [findExtension(() => false, true)] }).update({ effects: setSearchQuery.of(new SearchQuery({ search: 'cat', replace: 'dog' })) }).state;
  Object.defineProperty(view, 'state', { get: () => state });
  assert.equal(replaceMatches(view, true), 0);
  assert.equal(searchSummary(view.state).total, 2);
});
