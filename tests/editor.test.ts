import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { frontMatter, markdownParser, markdownExtensions, walk, references, linkTarget, formatPlan, linkMarkdown, touches, codeDisplay } from '../src/lib/markdown.ts';
import { livePreview, previewMode, compositionMode, buildPreview } from '../src/lib/livePreview.ts';

const options = { resolveImage: async () => 'blob:approved', onLink: () => {} };
function editor(text: string, anchor = text.length) {
  let state = EditorState.create({ doc: text, selection: { anchor }, extensions: [history(), markdown({ base: commonmarkLanguage, extensions: markdownExtensions, completeHTMLTags: false, pasteURLAsLink: false }), livePreview(options)] });
  ensureSyntaxTree(state, text.length, 1000);
  state = state.update({ selection: { anchor } }).state;
  return state;
}
function decorationRanges(state: EditorState, rendered = false) {
  const result: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  const sets = rendered ? state.facet(EditorView.decorations) : [buildPreview(state, options)];
  for (const set of sets) if (typeof set !== 'function') set.between(0, state.doc.length, (from, to, value) => { result.push({ from, to, spec: value.spec }); });
  return result;
}
test('front matter including empty block stays source while following Markdown parses', () => {
  for (const text of ['---\n---\n\n**ok**', '---\ntitle: **source**\n---\n\n**ok**']) {
    assert.ok(frontMatter(text));
    let strong = 0; walk(markdownParser.parse(text).topNode, n => { if (n.name === 'StrongEmphasis') strong++; }); assert.equal(strong, 1);
    const state = editor(text); assert.equal(state.doc.toString(), text);
    assert.ok(!decorationRanges(state).some(r => r.from < frontMatter(text)!.to));
  }
  assert.equal(frontMatter('---\nnot closed'), null);
});
test('reference definitions resolve first label, missing references stay source', () => {
  const text = '[a][ok] [a][missing] [ok][] [ok]\n\n[OK]: /local.md\n[ok]: /other.md';
  const tree = markdownParser.parse(text), refs = references(tree, text), targets: (string | null)[] = [];
  walk(tree.topNode, n => { if (n.name === 'Link') targets.push(linkTarget(n, text, refs)); });
  assert.deepEqual(targets, ['/local.md', null, '/local.md', '/local.md']);
  const raw = '[a][missing]\n\nend';
  assert.ok(!decorationRanges(editor(raw)).some(r => r.from < 12 && r.spec.widget === undefined));
});
test('selection boundaries reveal nested syntax; display modes never mutate document or history', () => {
  const text = '**outer *inner***\n\nlast';
  const closed = decorationRanges(editor(text)); assert.ok(closed.some(r => r.from === 0 && r.to === 2));
  const selected = decorationRanges(editor(text, 10)); assert.ok(!selected.some(r => r.from === 0 && r.to === 2));
  assert.equal(touches({ from: 2, to: 8 }, { from: 8, to: 8 }), true);
  let state = editor(text).update({ changes: { from: text.length, insert: '!' } }).state;
  for (const effect of [previewMode.of(true), previewMode.of(false), compositionMode.of(true), compositionMode.of(false)]) state = state.update({ effects: effect }).state;
  assert.equal(state.doc.toString(), text + '!');
  assert.ok(undo({ state, dispatch: tr => { state = tr.state; } })); assert.equal(state.doc.toString(), text);
  const composed = editor(text).update({ effects: compositionMode.of(true) }).state; assert.ok(decorationRanges(composed, true).length > 0);
  assert.equal(syntaxTree(editor('~~strike~~')).toString().includes('Strikethrough'), true);
  assert.equal(syntaxTree(editor('www.example.com')).toString().includes('Autolink'), false);
});
test('IME retains other previews, maps their positions, and renders committed syntax without changing undo', () => {
  const text = '入力: \n\n# 見出し\n\n**太字**\n\n| h |\n|---|\n| c |\n\n![alt](assets/a.png)';
  const at = '入力: '.length, insert = '`日本語` ';
  let state = editor(text, at);
  const before = decorationRanges(state, true);
  assert.ok(before.some(r => r.spec.widget && r.spec.block));
  assert.ok(before.some(r => r.from === text.indexOf('**')));
  state = state.update({ effects: compositionMode.of(true) }).state;
  assert.deepEqual(decorationRanges(state, true), before);
  state = state.update({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: 'input.type.compose' }).state;
  const during = decorationRanges(state, true);
  for (const original of before) {
    const mapped = during.find(r => r.from === original.from + insert.length && r.to === original.to + insert.length);
    assert.ok(mapped, `missing preview at ${original.from}`);
    assert.equal(mapped.spec.widget, original.spec.widget);
  }
  assert.ok(!during.some(r => r.from < at + insert.length));
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({ effects: compositionMode.of(false) }).state;
  assert.ok(decorationRanges(state, true).some(r => r.spec.widget && r.from === at + 1 && r.to === at + 4));
  assert.equal(state.doc.toString(), text.slice(0, at) + insert + text.slice(at));
  assert.ok(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), text);
});
test('IME cancel restores normal selection preview and explicit source mode stays source', () => {
  const text = '**太字**\n\n入力';
  let state = editor(text, text.length);
  state = state.update({ effects: compositionMode.of(true) }).state;
  assert.ok(decorationRanges(state, true).some(r => r.from === 0 && r.to === 2));
  state = state.update({ effects: compositionMode.of(false), selection: { anchor: 3 } }).state;
  assert.ok(!decorationRanges(state, true).some(r => r.from === 0 && r.to === 2));
  assert.equal(state.doc.toString(), text);
  assert.equal(undo({ state, dispatch: () => {} }), false);
  state = state.update({ effects: previewMode.of(true) }).state;
  for (const active of [true, false]) {
    state = state.update({ effects: compositionMode.of(active) }).state;
    assert.equal(decorationRanges(state, true).length, 0);
  }
});
test('format apply/remove is one source change, mixed selections are disabled', () => {
  for (const kind of ['bold', 'italic', 'strike'] as const) {
    const text = 'before plain after'; const plan = formatPlan(text, { from: 7, to: 12 }, kind); assert.ok(!plan.reason);
    const wrapped = text.slice(0, plan.from) + plan.text + text.slice(plan.to);
    const removed = formatPlan(wrapped, plan.selection, kind); assert.ok(!removed.reason);
    assert.equal(wrapped.slice(0, removed.from) + removed.text + wrapped.slice(removed.to), text);
  }
  for (const plain of ['a`b', '`edge', ' spaced ']) {
    const plan = formatPlan(plain, { from: 0, to: plain.length }, 'code'); assert.ok(!plan.reason);
    const remove = formatPlan(plan.text, { from: 0, to: plan.text.length }, 'code'); assert.equal(remove.text, plain);
  }
  assert.ok(formatPlan('**bold** plain', { from: 3, to: 13 }, 'bold').reason);
  assert.ok(formatPlan('one\n\ntwo', { from: 0, to: 8 }, 'italic').reason);
  assert.ok(formatPlan('---\nx: y\n---\n', { from: 4, to: 8 }, 'bold').reason);
  assert.equal(codeDisplay(' a\n b '), 'a  b');
  assert.ok(!formatPlan('- [ ] task', { from: 6, to: 10 }, 'bold').reason);
  assert.ok(formatPlan('- [ ] task', { from: 2, to: 10 }, 'bold').reason);
});
test('tables/images replace only inactive blocks and raw HTML is never decorated', () => {
  const text = '| **a** | b |\n|---|---|\n| x | y |\n\n![alt](assets/a.png)\n\n<script>alert(1)</script>\n\nend';
  const inactive = decorationRanges(editor(text)); assert.ok(inactive.some(r => r.spec.block && r.spec.widget));
  const active = decorationRanges(editor(text, 4)); assert.ok(!active.some(r => r.from === 0 && r.spec.block));
  const htmlStart = text.indexOf('<script>'), htmlEnd = text.indexOf('</script>') + 9;
  assert.ok(!inactive.some(r => r.from >= htmlStart && r.to <= htmlEnd));
});
test('safe link generation handles spaces/brackets and rejects dangerous schemes', () => {
  const value = linkMarkdown('a [label]', 'assets/a (1).md'); assert.match(markdownParser.parse(value).toString(), /Link/);
  assert.throws(() => linkMarkdown('x', 'javascript:alert(1)'));
  assert.throws(() => linkMarkdown('x', 'file:///etc/passwd'));
  assert.throws(() => linkMarkdown('x', 'foo\nbar'));
});
