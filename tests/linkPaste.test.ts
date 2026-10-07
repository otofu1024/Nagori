import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { linkPaste, pasteMarkdown } from '../src/lib/linkPaste.ts';
import { markdownParser, walk } from '../src/lib/markdown.ts';
import type { EditorView } from '@codemirror/view';

function plan(text: string, url: string, from = 0, to = text.length) {
  const doc = EditorState.create({ doc: text }).doc;
  return linkPaste(EditorState.create({ doc, selection: { anchor: from, head: to === text.length ? doc.length : to } }), url);
}

test('単一行の選択へHTTP・HTTPS・mailtoを貼り、括弧を含むURLを安全に囲む', () => {
  for (const url of ['http://example.com', 'https://example.com/a)b(c', 'mailto:editor@example.com', ' HTTPS://example.com/a?x=1 \n']) {
    const result = plan('表示する文字', url)!;
    assert.ok(result); assert.equal(result.changes.insert, `[表示する文字](<${url.trim()}>)`);
    assert.equal(result.selection.anchor, result.changes.insert.length);
    assert.ok(markdownParser.parse(result.changes.insert).toString().includes('Link('));
  }
});

test('複数行・角括弧・空選択・URL以外は通常の貼り付けへ戻す', () => {
  for (const text of ['一\n二', '一\r\n二', '[一]', '一]二', '一[二']) assert.equal(plan(text, 'https://example.com'), null);
  assert.equal(plan('本文', 'https://example.com', 1, 1), null);
  for (const url of ['ftp://example.com', 'javascript:alert(1)', 'https://example.com/a b', 'https://one\nhttps://two', 'https://', 'https://[broken', 'mailto:', '本文', 'https://example.com/\u0000']) assert.equal(plan('文字', url), null);
});

test('既存のリンク・参照リンク・コード・画像・保護ブロックでは通常の貼り付けへ戻す', () => {
  for (const text of ['[本文](https://old)', '[本文][ref]\n\n[ref]: /old', '`本文`', '```\n本文\n```', '    本文', '![本文](image.png)', '---\ntitle: 本文\n---', '$$\n本文\n$$', '$本文$']) {
    const from = text.indexOf('本文'); assert.equal(plan(text, 'https://example.com', from, from + 2), null, text);
  }
});

test('選択外のMarkdownを保ち、装飾を含む文字とバックスラッシュを囲める', () => {
  const result = plan('**前** 本文 `後`', 'https://example.com', 6, 8)!;
  assert.equal(result.changes.from, 6); assert.equal(result.changes.to, 8);
  assert.equal(result.changes.insert, '[本文](<https://example.com>)');
  assert.equal(plan('**太字**', 'https://example.com', 2, 6)!.changes.insert, '[太字**](<https://example.com>)');
  const slash = plan('末尾\\', 'https://example.com/<x>\\')!;
  assert.equal(slash.changes.insert, '[末尾\\\\](<https://example.com/%3Cx%3E%5C>)');
  let link = false; walk(markdownParser.parse(slash.changes.insert).topNode, node => { if (node.name === 'Link') link = true; }); assert.ok(link);
});

test('URL貼り付けは1回のUndoで選択も戻り、直前の入力を保つ', () => {
  let state = EditorState.create({ doc: '本文', extensions: history() });
  state = state.update({ changes: { from: 2, insert: '追記' }, userEvent: 'input.type' }).state;
  state = state.update({ selection: { anchor: 2, head: 0 } }).state;
  const before = state.doc.toString(), selection = state.selection;
  state = state.update(linkPaste(state, 'https://example.com')!).state;
  const after = state.doc.toString(), dispatch = (transaction: Transaction) => { state = transaction.state; };
  assert.equal(undo({ state, dispatch }), true); assert.equal(state.doc.toString(), before); assert.ok(state.selection.eq(selection));
  assert.equal(redo({ state, dispatch }), true); assert.equal(state.doc.toString(), after);
});

test('画像だけならplainでも既存の画像取り込みへ渡す', () => {
  const image = new File(['画像'], 'image.png', { type: 'image/png' });
  let pasted: File | undefined, prevented = false, changed = false;
  const event = { clipboardData: { getData: () => '', items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }] }, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
  const editor = { state: EditorState.create({ doc: '本文', selection: { anchor: 0, head: 2 } }), composing: false, compositionStarted: false, dispatch: () => { changed = true; } } as unknown as EditorView;
  assert.equal(pasteMarkdown(event, editor, false, file => { pasted = file; }), true);
  assert.equal(pasted, image); assert.ok(prevented); assert.equal(changed, false);
});

test('文字とPNGが両方ある時はURLの文字を優先して選択をリンクにする', () => {
  const image = new File(['画像'], 'image.png', { type: 'image/png' });
  let state = EditorState.create({ doc: '本文', selection: { anchor: 0, head: 2 } }), prevented = false;
  const event = { clipboardData: { getData: () => 'https://example.com', items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }] }, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
  const editor = { state, composing: false, compositionStarted: false, dispatch: (plan: TransactionSpec) => { state = state.update(plan).state; } } as unknown as EditorView;
  assert.equal(pasteMarkdown(event, editor, true, () => assert.fail('画像として取り込まない')), true);
  assert.ok(prevented); assert.equal(state.doc.toString(), '[本文](<https://example.com>)');
  assert.equal(state.selection.main.head, state.doc.length);
});

test('文字とPNGが両方ある時はURL以外とplainのURLを通常どおり貼る', () => {
  const image = new File(['画像'], 'image.png', { type: 'image/png' });
  for (const [text, markdown] of [['コピーした文章', true], ['https://example.com', false]] as const) {
    const event = { clipboardData: { getData: () => text, items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }] }, preventDefault: () => assert.fail('通常の貼り付けを妨げない') } as unknown as ClipboardEvent;
    const editor = { state: EditorState.create({ doc: '本文', selection: { anchor: 0, head: 2 } }), composing: false, compositionStarted: false, dispatch: () => assert.fail('リンクとして変更しない') } as unknown as EditorView;
    assert.equal(pasteMarkdown(event, editor, markdown, () => assert.fail('画像として取り込まない')), false);
    assert.equal(editor.state.doc.toString(), '本文');
  }
});

test('plain・Preview・読み取り専用・IME開始と変換中はURLを書き換えない', () => {
  const event = { clipboardData: { getData: () => 'https://example.com', items: [] }, preventDefault: () => assert.fail('通常の貼り付けを妨げない') } as unknown as ClipboardEvent;
  const base = { state: EditorState.create({ doc: '本文', selection: { anchor: 0, head: 2 } }), composing: false, compositionStarted: false, dispatch: () => assert.fail('変更しない') };
  assert.equal(pasteMarkdown(event, base as unknown as EditorView, false), false);
  assert.equal(pasteMarkdown(event, base as unknown as EditorView, true, undefined, true), false);
  for (const flag of ['composing', 'compositionStarted']) assert.equal(pasteMarkdown(event, { ...base, [flag]: true } as unknown as EditorView, true), false);
  assert.equal(pasteMarkdown(event, { ...base, state: EditorState.create({ doc: '本文', selection: { anchor: 0, head: 2 }, extensions: EditorState.readOnly.of(true) }) } as unknown as EditorView, true), false);
});
