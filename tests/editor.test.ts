import test from 'node:test';
import { renderMath } from '../src/lib/mathjax.ts';
import { MAX_MATH_LENGTH, mathExpressions, type MathExpression } from '../src/lib/markdownMath.ts';
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


test('math syntax includes inline, display, blank-line blocks and table cells without consuming following prose', () => {
  const source = 'Inline $x_1+\\frac{1}{2}$ and \\(y^2\\).\n\n$$z^2$$\n\n\\[w^2\\]\n\n$$\n\\begin{aligned}\na&=b+c\\\\\n\n&=d\n\\end{aligned}\n$$  \n\n\\[\n\\begin{matrix}a&b\\\\c&d\\end{matrix}\n\\]\n\n| h | math |\n|---|---|\n| x | $x^2$ |\n\nend';
  const nodes: string[] = []; walk(markdownParser.parse(source).topNode, node => { if (/^(InlineMath|DisplayMath|MathBlock)$/.test(node.name)) nodes.push(node.name); });
  assert.deepEqual(nodes, ['InlineMath', 'InlineMath', 'DisplayMath', 'DisplayMath', 'MathBlock', 'MathBlock', 'InlineMath']);
  const state = editor(source), ranges = decorationRanges(state);
  assert.equal(ranges.filter(r => r.spec.widget && !r.spec.block).length, 2);
  assert.equal(ranges.filter(r => r.spec.widget && r.spec.block).length, 5); // Four display expressions and a table.
  assert.equal(state.doc.toString(), source);
});
test('table math source selection reveals exactly the targeted expression', () => {
  const source = '| h | math |\n|---|---|\n| first | $x^2$ |\n| second | **$\\sqrt{x}$** |\n\nend';
  for (const expression of ['$x^2$', '$\\sqrt{x}$']) {
    const at = source.indexOf(expression), state = editor(source, at);
    const ranges = decorationRanges(state, true);
    assert.ok(!ranges.some(r => r.spec.widget && r.from <= at && r.to > at));
    const other = source.indexOf(expression === '$x^2$' ? '$\\sqrt{x}$' : '$x^2$');
    assert.ok(ranges.some(r => r.spec.widget && r.from === other));
    assert.equal(state.selection.main.head, at);
    assert.equal(state.doc.toString(), source);
  }
});
test('math leaves currency, escaped dollars, code, HTML blocks and front matter as source', () => {
  for (const source of [
    'Costs $5 and $10, then $20.00.', '\\$x$', '$ x $', '$x $', '$x$2',
    '`$x$`\n\n```tex\n$$\nx\n$$\n\\(y\\)\n```',
    '    $x$\n\n<div>\n$x$\n\\[x\\]\n</div>',
    '---\nmath: $x$\n---\n\nend',
    '$$\nx\nnot closed',
    '$x\ny$'
  ]) {
    const state = editor(source), math: string[] = [];
    walk(syntaxTree(state).topNode, node => { if (/^(InlineMath|DisplayMath|MathBlock)$/.test(node.name)) math.push(node.name); });
    assert.deepEqual(math, [], source);
    assert.equal(state.doc.toString(), source);
  }
});
test('math source reveal, source mode and IME preserve source and undo', () => {
  const source = '入力\n\n$x^2$\n\n$$\ny^2\n$$\n\nend', mathAt = source.indexOf('$');
  let state = editor(source);
  assert.ok(decorationRanges(state, true).some(r => r.from === mathAt && r.spec.widget));
  state = state.update({ selection: { anchor: mathAt + 2 } }).state;
  assert.ok(!decorationRanges(state, true).some(r => r.from === mathAt && r.spec.widget));
  state = state.update({ selection: EditorSelection.range(mathAt - 1, mathAt + 1) }).state;
  assert.ok(!decorationRanges(state, true).some(r => r.from === mathAt && r.spec.widget));
  assert.ok(formatPlan(source, { from: mathAt + 1, to: mathAt + 2 }, 'bold').reason);
  state = state.update({ selection: { anchor: 0 } }).state;
  const before = decorationRanges(state, true);
  state = state.update({ effects: compositionMode.of(true) }).state;
  state = state.update({ changes: { from: 0, insert: '日本語' }, selection: { anchor: 3 }, userEvent: 'input.type.compose' }).state;
  for (const range of before) assert.equal(decorationRanges(state, true).find(r => r.from === range.from + 3 && r.to === range.to + 3)?.spec.widget, range.spec.widget);
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({ effects: compositionMode.of(false) }).state;
  for (const active of [true, false]) { state = state.update({ effects: previewMode.of(active) }).state; if (active) assert.equal(decorationRanges(state, true).length, 0); }
  assert.equal(state.doc.toString(), '日本語' + source);
  assert.ok(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), source);
});


function expressions(values: string[]): MathExpression[] { return values.map((expression, from) => ({ expression, from, to: from + 1, source: '$$' + expression + '$$', display: true })); }
test('MathJax AMS/mathtools/macros/tags/forward refs are scoped to one document', async () => {
  const values = [
    '\\eqref{future}',
    '\\begin{equation}x=1\\label{future}\\end{equation}',
    '\\newcommand{\\RR}{\\mathbb{R}}', '\\RR',
    '\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}',
    '\\begin{matrix}a&b\\\\c&d\\end{matrix}',
    'f(x)=\\begin{cases}x&x>0\\\\-x&x\\le0\\end{cases}',
    '\\begin{multlined}a+b\\\\+c+d\\end{multlined}',
    'x^2\\tag{A}', 'a\\bmod b + x\\pmod{n} + x\\mod n', '\\underbracket{x+y}', '|x|+\\left|x\\right|+\\big|x\\big|'
  ];
  const rendered = await renderMath(expressions(values)); assert.ok(rendered);
  for (const [position, result] of rendered.expressions) { assert.equal(result.error, undefined, values[position]); assert.match(result.html!, /<mjx-container/); assert.match(result.html!, /<mjx-assistive-mml/); assert.match(result.html!, /<math /); }
  assert.match(rendered.expressions.get(0)!.html!, /MathJax_ref/); assert.doesNotMatch(rendered.expressions.get(0)!.html!, /mjx-c3F/);
  assert.match(rendered.expressions.get(1)!.html!, /id="mjx-eqn:future"/);
  assert.match(rendered.css, /@font-face/);
  const next = await renderMath(expressions(['\\RR', '\\ref{future}', '\\begin{equation}y=2\\end{equation}'])); assert.ok(next);
  assert.ok(next.expressions.get(0)!.error); assert.match(next.expressions.get(1)!.html!, /mjx-c3F/); // Undefined reference stays MathJax's ?? marker.
  assert.match(next.expressions.get(2)!.html!, /mjx-c31/); // Counter starts at 1 for each new document.
  const repeated = await renderMath(expressions(['\\RR', '\\newcommand{\\RR}{\\mathbb{R}}', '\\RR'])); assert.ok(repeated);
  assert.ok(repeated.expressions.get(0)!.error); assert.equal(repeated.expressions.get(2)!.error, undefined); assert.match(repeated.expressions.get(2)!.html!, /<mjx-container/);
});
test('MathJax refuses HTML/network/undefined commands and bounds macro expansion', async () => {
  const values = [
    String.raw`\mmlToken{mi}[style="font-size:999999px;position:fixed;inset:0;background:red"]{x}`,
    String.raw`\mmlToken{mi}[href="javascript:alert(1)"]{x}`, String.raw`\mmlToken{mi}[href="https://example.invalid/x"]{x}`,
    String.raw`\mmlToken{mi}[fontsize="999999px"]{x}`, String.raw`\mmlToken{mi}[scriptlevel="-999"]{x}`,
    String.raw`\mmlToken{mi}[mathcolor="red;position:fixed;inset:0"]{x}`, String.raw`\mmlToken{mi}[mathbackground="red;position:fixed;inset:0"]{x}`,
    String.raw`\mmlToken{mi}[fontfamily="serif;position:fixed;inset:0"]{x}`, String.raw`\mmlToken{mi}[fontweight="bold;position:fixed"]{x}`, String.raw`\mmlToken{mi}[fontstyle="italic;position:fixed"]{x}`,
    String.raw`\mmlToken{mo}[lspace="999999%"]{x}`, String.raw`a\mmlToken{mo}[lspace="infinity"]{x}b`, String.raw`\mmlToken{mi}[class="nagori-math"]{x}`, String.raw`\mmlToken{mi}[id="nagori-mathjax-style"]{x}`,
    '\\href{javascript:alert(1)}{x}', '\\includegraphics{https://example.invalid/x}', '\\htmlStyle{color:red}{x}', '\\require{html}', '\\def\\a{\\a}\\a', '\\frac{1}{', '\\unknownNagoriCommand', '\\rule{999999em}{999999em}', '\\kern100000px x'];
  const rendered = await renderMath(expressions(values)); assert.ok(rendered);
  for (const [position, result] of rendered.expressions) { assert.ok(result.error, values[position]); assert.equal(result.html, undefined); }
  assert.equal(await renderMath(expressions(['x']), () => false), null);
  let activeChecks = 0; assert.equal(await renderMath(expressions(['x']), () => ++activeChecks === 1), null); assert.equal(activeChecks, 2);
  await assert.rejects(() => renderMath(expressions(new Array(513).fill('x'))));
  assert.doesNotMatch(markdownParser.parse('$' + 'x'.repeat(MAX_MATH_LENGTH + 1) + '$').toString(), /InlineMath/);
});
test('display blocks in quotes/lists strip structural prefixes only from render input', () => {
  for (const source of ['> $$\n> x^2\n> $$\n\nend', '- $$\n  x^2\n  $$\n\nend', '> - \\[\n>   x^2\n>   \\]\n\nend']) {
    const tree = markdownParser.parse(source), math = mathExpressions(tree, source);
    assert.equal(math.length, 1, tree.toString()); assert.equal(math[0].expression, 'x^2');
    const state = editor(source); assert.equal(state.doc.toString(), source);
    assert.ok(decorationRanges(state, true).some(r => r.from === math[0].from && r.spec.widget));
  }
});

test('long documents resolve offscreen labels before CodeMirror parses the tail and reuse unchanged math context', async () => {
  const text = '---\nmetadata: $x$\n---\n\n' + String.raw`$\eqref{tail}$` + '\n\n' + 'paragraph\n\n'.repeat(15000) + String.raw`$$\begin{equation}x=1\label{tail}\end{equation}$$`;
  let state = EditorState.create({ doc: text, extensions: [markdown({ base: commonmarkLanguage, extensions: markdownExtensions }), livePreview(options)] });
  const context = () => (decorationRanges(state, true).find(range => range.spec.widget && range.from === text.indexOf('$\\eqref'))!.spec.widget as { context: { expressions: MathExpression[] } }).context;
  assert.ok(syntaxTree(state).length < text.length);
  const initial = context();
  assert.equal(initial.expressions.length, 2); // Metadata math stays source, while the far-offscreen label is included.
  const rendered = await renderMath(initial.expressions); assert.ok(rendered);
  assert.doesNotMatch(rendered.expressions.get(initial.expressions[0].from)!.html!, /mjx-c3F/);
  ensureSyntaxTree(state, 103000, 1000);
  state = state.update({ selection: { anchor: 1 } }).state;
  assert.ok(syntaxTree(state).length < text.length);
  assert.equal(context(), initial); // Background parser advancement doesn't rescan or invalidate the rendered formulas.
  state = state.update({ changes: { from: text.length, insert: '\n' } }).state;
  assert.notEqual(context(), initial);
  assert.equal(context().expressions.length, 2);
});
