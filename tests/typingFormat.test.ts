import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorState, Transaction } from '@codemirror/state';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { markdownExtensions, markdownParser, walk } from '../src/lib/markdown.ts';
import { buildPreview } from '../src/lib/livePreview.ts';
import { typingFormat, typingFormatPlan, discardEmptyTypingFormat } from '../src/lib/typingFormat.ts';

const create = (doc: string, anchor: number) => EditorState.create({ doc, selection: { anchor }, extensions: [history(), typingFormat(), markdown({ base: commonmarkLanguage, extensions: markdownExtensions })] });
const apply = (state: EditorState, kind: 'bold' | 'italic') => {
  const plan = typingFormatPlan(state, kind);
  assert.ok(plan);
  const tr = state.update(plan);
  assert.equal(tr.annotation(Transaction.userEvent), 'input.format');
  return tr.state.update({ selection: tr.state.selection, userEvent: 'input.format' }).state;
};
const type = (state: EditorState, insert: string) => state.update(state.replaceSelection(insert), { userEvent: 'input.type' }).state;
const back = (state: EditorState, forward = false) => {
  assert.ok((forward ? redo : undo)({ state, dispatch: tr => { state = tr.state; } }));
  return state;
};
const textAndHead = (state: EditorState, text: string, head: number) => {
  assert.equal(state.doc.toString(), text); assert.equal(state.selection.main.head, head);
};

test('選択なしの太字と斜体は記号の間から入力し、1回のUndoとRedoで戻る', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*']] as const) {
    const initial = create('前 後', 2), opened = apply(initial, kind);
    textAndHead(opened, `前 ${mark}${mark}後`, 2 + mark.length);
    textAndHead(back(opened), '前 後', 2);
    const redone = back(back(opened), true);
    textAndHead(redone, opened.doc.toString(), opened.selection.main.head);
    const filled = type(redone, '入力');
    assert.equal(filled.doc.toString(), `前 ${mark}入力${mark}後`);
    assert.equal(discardEmptyTypingFormat(filled, true), null);
    assert.ok(markdownParser.parse(filled.doc.toString()).toString().includes(kind === 'bold' ? 'StrongEmphasis' : 'Emphasis'));
  }
});

test('閉じる直前と開く直後は本文を変えずに外へ出て、カーソルをUndoとRedoで戻す', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['bold', '__'], ['italic', '_']] as const) {
    const source = `${mark}本文${mark}`;
    for (const [at, outside] of [[mark.length, 0], [mark.length + 2, source.length]]) {
      const exited = apply(create(source, at), kind);
      textAndHead(exited, source, outside);
      const restored = back(exited); textAndHead(restored, source, at);
      textAndHead(back(restored, true), source, outside);
      assert.equal(undoDepth(exited), 1);
    }
  }
});

test('装飾の途中では前半を閉じ後半を開き直し、間に打つ文字は装飾の外になる', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['bold', '__'], ['italic', '_']] as const) {
    const source = `${mark}前半後半${mark}`, at = mark.length + 2;
    const closed = apply(create(source, at), kind);
    const splitMark = kind === 'bold' ? '**' : '*';
    textAndHead(closed, `${splitMark}前半${splitMark}${splitMark}後半${splitMark}`, at + mark.length);
    textAndHead(back(closed), source, at);
    const filled = type(closed, '普通');
    const nodes: [number, number][] = [];
    walk(markdownParser.parse(filled.doc.toString()).topNode, node => { if (node.name === (kind === 'bold' ? 'StrongEmphasis' : 'Emphasis')) nodes.push([node.from, node.to]); });
    assert.equal(nodes.length, 2);
    assert.ok(nodes.every(([from, to]) => !(from < at + mark.length && to > at + mark.length + 2)));
  }
});

test('空の記号の真ん中で同じ操作をすると外れ、1回のUndoで戻る', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*']] as const) {
    const opened = apply(create('前 後', 2), kind), removed = apply(opened, kind);
    textAndHead(removed, '前 後', 2);
    textAndHead(back(removed), `前 ${mark}${mark}後`, 2 + mark.length);
    assert.equal(undoDepth(removed), 2);
  }
});

test('自動削除は移動先を保ちUndoに積まず、直前の入力を1回で戻す', () => {
  for (const kind of ['bold', 'italic'] as const) {
    let state = type(create('前 後', 2), '入力');
    const source = state.doc.toString();
    state = apply(state, kind);
    assert.equal(discardEmptyTypingFormat(state), null);
    state = state.update({ selection: { anchor: state.doc.length } }).state;
    const cleanup = discardEmptyTypingFormat(state);
    assert.ok(cleanup);
    const tr = state.update(cleanup);
    assert.equal(tr.annotation(Transaction.addToHistory), false);
    textAndHead(tr.state, source, source.length);
    assert.equal(undoDepth(tr.state), 1);
    textAndHead(back(tr.state), '前 後', 2);
  }
});

test('フォーカスを失った時と選択を作った時も空の記号を消す', () => {
  const state = apply(create('前 後', 2), 'bold');
  assert.ok(discardEmptyTypingFormat(state, true));
  textAndHead(state.update(discardEmptyTypingFormat(state, true)!).state, '前 後', 2);
  const selected = state.update({ selection: { anchor: 2, head: 4 } }).state;
  assert.ok(discardEmptyTypingFormat(selected));
});

test('手で書いた空の記号と、一度文字を入力した記号は自動で消さない', () => {
  for (const source of ['前 **** 後', '前 ** 後']) assert.equal(discardEmptyTypingFormat(create(source, 0), true), null);
  let state = type(apply(create('前 後', 2), 'bold'), '本文');
  state = state.update({ changes: { from: 4, to: 6 }, selection: { anchor: 0 } }).state;
  assert.equal(discardEmptyTypingFormat(state, true), null);
});

test('別の位置で編集しても作った記号だけを追跡して消す', () => {
  let state = apply(create('前 後 ****', 2), 'bold');
  state = state.update({ changes: { from: 0, insert: '追加' }, selection: { anchor: 0 }, userEvent: 'input.type' }).state;
  const cleanup = discardEmptyTypingFormat(state);
  assert.ok(cleanup);
  assert.equal(state.update(cleanup).state.doc.toString(), '追加前 後 ****');
});

test('UndoとRedoの後の空の記号も自動削除の対象になる', () => {
  let state = apply(create('前 後', 2), 'bold');
  state = back(back(state), true);
  assert.ok(discardEmptyTypingFormat(state, true));
});

test('太字の中の斜体と斜体の中の太字をCommonMarkとして解析する', () => {
  for (const [source, at, kind] of [
    ['**前後**', 3, 'italic'], ['**前後**', 2, 'italic'], ['**前後**', 4, 'italic'],
    ['*前後*', 2, 'bold'], ['*前後*', 1, 'bold'], ['*前後*', 3, 'bold'],
  ] as const) {
    const state = type(apply(create(source, at), kind), '文字');
    const insertion = state.selection.main.head - 2, formats: string[] = [];
    walk(markdownParser.parse(state.doc.toString()).topNode, node => { if (node.from < insertion && node.to > insertion + 2 && /^(StrongEmphasis|Emphasis)$/.test(node.name)) formats.push(node.name); });
    assert.ok(formats.includes('StrongEmphasis'), state.doc.toString());
    assert.ok(formats.includes('Emphasis'), state.doc.toString());
    assert.equal(discardEmptyTypingFormat(state, true), null);
  }
});

test('空の入力モードを入れ子にしても同じキーで解除でき、未入力なら両方を消す', () => {
  for (const [outer, inner] of [['bold', 'italic'], ['italic', 'bold']] as const) {
    const state = apply(apply(create('前 後', 2), outer), inner);
    const cleanup = discardEmptyTypingFormat(state, true);
    assert.ok(cleanup);
    assert.equal(state.update(cleanup).state.doc.toString(), '前 後');
    const filled = type(state, '本文');
    assert.equal(discardEmptyTypingFormat(filled, true), null);
    const parsed = markdownParser.parse(filled.doc.toString()).toString();
    assert.ok(parsed.includes('StrongEmphasis') && parsed.includes('Emphasis'));
    assert.equal(apply(state, inner).doc.toString(), apply(create('前 後', 2), outer).doc.toString());
  }
});

test('装飾を入れ子にした途中で外側を閉じても記号が交差しない', () => {
  for (const [source, at, kind] of [['**前*左右*後**', 5, 'bold'], ['*前**左右**後*', 5, 'italic']] as const) {
    const changed = type(apply(create(source, at), kind), '普通');
    const parsed = markdownParser.parse(changed.doc.toString()).toString();
    assert.equal((parsed.match(/StrongEmphasis\(/g) ?? []).length, 2, changed.doc.toString());
    assert.equal((parsed.match(/\bEmphasis\(/g) ?? []).length, 2, changed.doc.toString());
  }
});

test('コード・Front Matter・数式・HTML・リンクの参照先では何もしない', () => {
  for (const [source, at] of [
    ['```md\nコード\n```', 8], ['    コード', 6], ['`コード`', 3],
    ['---\ntitle: 記事\n---\n\n本文', 10], ['$x^2$', 3], ['$$\nx^2\n$$', 5],
    ['<div>HTML</div>', 8], ['前 <span title="値">後', 15], ['[表示](https://example.com)', 14], ['[表示][参照]', 6], ['[参照]: /path', 8],
  ] as const) for (const kind of ['bold', 'italic'] as const) assert.equal(typingFormatPlan(create(source, at), kind), null, `${source} ${kind}`);
  const state = create('本文', 1);
  assert.equal(typingFormatPlan(state.update({ selection: { anchor: 0, head: 1 } }).state, 'bold'), null);
  assert.equal(typingFormatPlan(EditorState.create({ doc: '本文', extensions: [typingFormat(), EditorState.readOnly.of(true)] }), 'bold'), null);
});

test('Live Previewは空の記号を隠さず、入力後は太字を付けてカーソルの記号を保つ', () => {
  let state = apply(create('', 0), 'bold');
  const decorations = () => {
    const ranges: { from: number; to: number; class?: string; widget?: unknown }[] = [];
    buildPreview(state, { resolveImage: async () => '', onLink: () => {} }).between(0, state.doc.length, (from, to, value) => ranges.push({ from, to, ...value.spec }));
    return ranges;
  };
  assert.ok(!decorations().some(item => item.widget));
  state = type(state, '本文');
  assert.ok(decorations().some(item => item.class === 'nagori-bold'));
  assert.ok(!decorations().some(item => item.widget));
});

test('Editorの共通入口はplain・Preview・IME・処理中を止め、ヘッダーの記事メニューを置かない', () => {
  const editor = readFileSync(new URL('../src/lib/Editor.svelte', import.meta.url), 'utf8');
  assert.match(editor, /function apply\(kind: FormatKind\) \{\s+if \(plain\) return;/);
  assert.match(editor, /readonly \|\| busy \|\| previewOnly \|\| composition \|\| view\.composing \|\| view\.compositionStarted/);
  assert.match(editor, /format: apply/);
  assert.match(editor, /onclick=\{\(\) => apply\(kind\)\}/);
  const app = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.ok(!app.includes('document-menu') && !app.includes('記事の操作'));
});
