import test from 'node:test';
import { renderMath } from '../src/lib/mathjax.ts';
import { readMathStats, resetMathStats } from '../src/lib/mathStats.ts';
import { MAX_MATH_LENGTH, mathExpressions, type MathExpression } from '../src/lib/markdownMath.ts';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorView, type WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { frontMatter, markdownParser, markdownExtensions, walk, references, linkTarget, formatPlan, linkMarkdown, touches, codeDisplay } from '../src/lib/markdown.ts';
import { livePreview, previewOnlyMode, compositionMode, buildPreview } from '../src/lib/livePreview.ts';

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
test('見出し1〜3だけに線を付け、Setextでは最後に表示する行へ付ける', () => {
  const text = '# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六\n\n七\n八\n===\n\n九\n---\n\n本文';
  const rules = (state: EditorState) => decorationRanges(state).filter(range => range.spec.class === 'nagori-heading-rule').map(range => range.from);
  const expected = ['# 一', '## 二', '### 三', '八', '九'].map(part => text.indexOf(part));
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
  for (const effect of [previewOnlyMode.of(true), previewOnlyMode.of(false), compositionMode.of(true), compositionMode.of(false)]) state = state.update({ effects: effect }).state;
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
test('IME cancel restores editing selection preview while Preview retains rendering', () => {
  const text = '**太字**\n\n入力';
  let state = editor(text, text.length);
  state = state.update({ effects: compositionMode.of(true) }).state;
  assert.ok(decorationRanges(state, true).some(r => r.from === 0 && r.to === 2));
  state = state.update({ effects: compositionMode.of(false), selection: { anchor: 3 } }).state;
  assert.ok(!decorationRanges(state, true).some(r => r.from === 0 && r.to === 2));
  assert.equal(state.doc.toString(), text);
  assert.equal(undo({ state, dispatch: () => {} }), false);
  state = state.update({ effects: previewOnlyMode.of(true) }).state;
  for (const active of [true, false]) {
    state = state.update({ effects: compositionMode.of(active) }).state;
    assert.ok(decorationRanges(state, true).some(r => r.from === 0 && r.to === 2));
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
    const widget = decorationRanges(state, true).find(r => r.spec.widget)!.spec.widget as WidgetType;
    return { widget, value };
  });
  const other = decorationRanges(editor('- 項目\n\n改行\n続き &amp; \\*\n\n末尾'), true).filter(r => r.spec.widget).map(r => r.spec.widget as WidgetType);
  const sameText = decorationRanges(editor('`a` &#97;\n\n末尾'), true).filter(r => r.spec.widget).map(r => r.spec.widget as WidgetType);
  const anotherCode = decorationRanges(editor('`a`\n\n末尾'), true).find(r => r.spec.widget)!.spec.widget as WidgetType;
  const saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => ({ className: '', textContent: '' }) };
  try {
    for (const { widget, value } of widgets) {
      const span = widget.toDOM(null as unknown as EditorView);
      assert.equal(span.className, 'nagori-code');
      assert.equal(span.textContent, value);
      assert.equal(widget.ignoreEvent(null as unknown as Event), false);
    }
    assert.deepEqual(other.map(widget => {
      const span = widget.toDOM(null as unknown as EditorView);
      assert.equal(span.className, 'nagori-list-marker');
      return span.textContent;
    }), [' ', '&', '*']);
    assert.equal(sameText[0].eq(sameText[1]), false);
    assert.equal(sameText[0].eq(anotherCode), true);
    assert.equal(sameText[0].eq(widgets[0].widget), false);
  } finally {
    if (saved === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = saved;
  }
});
test('Inline Codeはカーソルと選択で記号を見せ、Previewでは置き換えを保つ', () => {
  const text = '前 `npm run build` 後\n\n末尾', from = text.indexOf('`'), to = text.lastIndexOf('`') + 1;
  let state = editor(text);
  const replaced = () => decorationRanges(state, true).some(r => r.from === from + 1 && r.to === to - 1 && r.spec.widget);
  assert.equal(replaced(), true);
  for (const selection of [EditorSelection.cursor(from + 2), EditorSelection.range(from, to)]) {
    state = state.update({ selection }).state;
    assert.equal(replaced(), false);
    assert.ok(decorationRanges(state, true).some(r => r.from === from + 1 && r.to === to - 1 && r.spec.class === 'nagori-code'));
    assert.ok(!decorationRanges(state, true).some(r => r.from === from && r.to === from + 1));
    state = state.update({ effects: previewOnlyMode.of(true) }).state;
    assert.equal(replaced(), true);
    state = state.update({ effects: previewOnlyMode.of(false) }).state;
  }
  state = state.update({ selection: { anchor: text.length } }).state;
  assert.equal(replaced(), true);
  assert.equal(state.doc.toString(), text);
  assert.equal(undo({ state, dispatch: () => {} }), false);
});
test('装飾の付け外しとコードの空白を保ち、複数段落とタスクの本文にも付ける', () => {
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
  assert.equal(applied('one\n\ntwo', 0, 8, 'italic').text, '*one*\n\n*two*');
  assert.ok(formatPlan('---\nx: y\n---\n', { from: 4, to: 8 }, 'bold').reason);
  assert.equal(codeDisplay(' a\n b '), 'a  b');
  assert.ok(!formatPlan('- [ ] task', { from: 6, to: 10 }, 'bold').reason);
  assert.equal(applied('- [ ] task', 2, 10, 'bold').text, '- [ ] **task**');
});
test('tables/images replace only inactive blocks and raw HTML is never decorated', () => {
  const text = '| **a** | b |\n|---|---|\n| x | y |\n\n![alt](assets/a.png)\n\n<script>alert(1)</script>\n\nend';
  const inactive = decorationRanges(editor(text)); assert.ok(inactive.some(r => r.spec.block && r.spec.widget));
  const active = decorationRanges(editor(text, 4)); assert.ok(!active.some(r => r.from === 0 && r.spec.block));
  const htmlStart = text.indexOf('<script>'), htmlEnd = text.indexOf('</script>') + 9;
  assert.ok(!inactive.some(r => r.from >= htmlStart && r.to <= htmlEnd));
});
test('隠す記号はreplaceを使わず本文に残すmarkで表し、変換中は位置だけを写す', () => {
  const text = '前 **太字** 後\n\n末尾';
  const hidden = (state: EditorState) => decorationRanges(state, true).filter(r => r.spec.class === 'nagori-hidden').map(r => [r.from, r.to]);
  const replaced = (state: EditorState) => decorationRanges(state, true).filter(r => r.spec.widget || (!r.spec.class && r.from !== r.to));
  let state = editor(text, 0);
  assert.deepEqual(hidden(state), [[2, 4], [6, 8]]);
  assert.deepEqual(replaced(state), []);
  assert.equal(state.doc.toString(), text);
  // 変換中は装飾を作り直さず、未確定文字の分だけ位置を送る
  state = state.update({ effects: compositionMode.of(true) }).state;
  state = state.update({ changes: { from: 0, insert: 'か' }, userEvent: 'input.type.compose' }).state;
  assert.deepEqual(hidden(state), [[3, 5], [7, 9]]);
  state = state.update({ effects: compositionMode.of(false) }).state;
  assert.deepEqual(hidden(state), [[3, 5], [7, 9]]);
  // カーソルや選択が触れた時は記号を見せる
  for (const selection of [EditorSelection.cursor(4), EditorSelection.range(2, 8)]) {
    assert.deepEqual(hidden(state.update({ selection }).state), []);
  }
});
test('見出しの記号と引用の記号も同じmarkで隠し、フェンスと下線は行の高さを0にする', () => {
  const text = '# 見出し\n\n> 引用\n\n前\n===\n\n```ts\ncode\n```\n\n末尾';
  const state = editor(text, text.length);
  const hidden = decorationRanges(state, true).filter(r => r.spec.class === 'nagori-hidden').map(r => [r.from, r.to]);
  assert.ok(hidden.some(([from, to]) => from === 0 && to === 2));
  assert.ok(hidden.some(([from, to]) => from === text.indexOf('>') && to === text.indexOf('>') + 2));
  const lines = decorationRanges(state, true).filter(r => r.spec.class === 'nagori-hidden-line').map(r => r.from);
  assert.deepEqual(lines, [text.indexOf('==='), text.indexOf('```ts'), text.lastIndexOf('```')]);
  assert.equal(state.doc.toString(), text);
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
test('math source reveal, Preview and IME preserve source and undo', () => {
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
  for (const active of [true, false]) { state = state.update({ effects: previewOnlyMode.of(active) }).state; if (active) assert.ok(decorationRanges(state, true).some(r => r.from === mathAt + 3 && r.spec.widget)); }
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


test('Preview keeps all syntax rendered through cursor/search selections and blocks edits without losing undo', () => {
  let locked = EditorState.create({ doc: '**locked**', extensions: [livePreview(options), EditorState.readOnly.of(true), EditorView.editable.of(false)] });
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
  const source = '# Heading\n\n**bold** *italic* ~~strike~~ `code` [link](a.md)\n\n> quote\n\n- [ ] task\n\n| h |\n|---|\n| c |\n\n![alt](a.png)\n\n$x^2$\n\n---\n\n```js\ncode\n```';
  let state = editor(source, 0).update({ changes: { from: source.length, insert: '\nend' } }).state;
  const edited = state.doc.toString(), selection = state.selection;
  state = state.update({ effects: previewOnlyMode.of(true) }).state;
  assert.equal(state.readOnly, true);
  assert.equal(state.facet(EditorView.editable), false);
  assert.ok(state.selection.eq(selection));
  const baseline = decorationRanges(state, true).map(r => ({ from: r.from, to: r.to, class: r.spec.class, block: r.spec.block, widget: !!r.spec.widget }));
  assert.ok(baseline.some(r => r.from === 0 && r.to === 2));
  for (const marker of ['**bold**', '*italic*', '~~strike~~', '`code`', '[link]', '| h |', '![alt]', '$x^2$', '- [ ]', '---', '```']) {
    const at = edited.indexOf(marker);
    state = state.update({ selection: EditorSelection.range(at, at + marker.length) }).state;
    assert.deepEqual(decorationRanges(state, true).map(r => ({ from: r.from, to: r.to, class: r.spec.class, block: r.spec.block, widget: !!r.spec.widget })), baseline, marker);
  }
  const task = decorationRanges(state, true).find(r => r.from === edited.indexOf('[ ]'))!.spec.widget as { disabled: boolean };
  assert.equal(task.disabled, true);
  for (const userEvent of ['input', 'input.paste', 'input.drop', 'input.format', 'delete', 'undo']) {
    state = state.update(state.replaceSelection('changed'), { userEvent }).state;
    assert.equal(state.doc.toString(), edited);
  }
  assert.equal(undo({ state, dispatch: tr => { state = tr.state; } }), false);
  const lastSelection = state.selection;
  state = state.update({ effects: previewOnlyMode.of(false) }).state;
  assert.equal(state.readOnly, false);
  assert.equal(state.facet(EditorView.editable), true);
  assert.ok(state.selection.eq(lastSelection));
  assert.ok(!decorationRanges(state, true).some(r => r.from === edited.indexOf('```') && r.to > r.from));
  assert.ok(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), source);
});

test('数式の計測は無効時に記録せず、全mount撤去後の再表示で再処理が起きる', async () => {
  const flag = globalThis as { __NAGORI_MATH_STATS__?: boolean };
  // 最小限のDOM代替。MathWidgetのtoDOMとdestroyが触る範囲だけ用意する。
  const makeElement = () => {
    const el = { className: '', textContent: '', tabIndex: 0, isConnected: true, classList: { add() {} }, title: '',
      setAttribute() {}, addEventListener() {}, append() {}, replaceChildren() {} };
    return el as unknown as HTMLElement;
  };
  const saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: makeElement, getElementById: () => ({ textContent: '' }), fonts: { ready: Promise.resolve() } };
  try {
    const source = '$x^2$\n\n$y$\n';
    const widgets = (state: EditorState) => decorationRanges(state, true).filter(r => r.spec.widget).map(r => r.spec.widget as { toDOM(view: unknown): HTMLElement; destroy(el: HTMLElement): void });
    const view = { state: { field: () => false }, requestMeasure() {} };
    const settle = () => new Promise(resolve => setTimeout(resolve, 300));

    // 無効時は描画しても数えない
    flag.__NAGORI_MATH_STATS__ = false; resetMathStats();
    await renderMath([{ from: 0, expression: 'x', display: false }]);
    assert.deepEqual(readMathStats(), { renderStarts: 0, discards: 0 });

    // 有効時: 同じ本文のContextで、mountを増やしても描画は1回
    flag.__NAGORI_MATH_STATS__ = true; resetMathStats();
    const state = editor(source, source.length);
    const [first, second] = widgets(state);
    const a = first.toDOM(view), b = second.toDOM(view);
    await settle();
    assert.deepEqual(readMathStats(), { renderStarts: 1, discards: 0 });

    // 一部だけ撤去しても破棄されない
    first.destroy(a); await settle();
    assert.deepEqual(readMathStats(), { renderStarts: 1, discards: 0 });

    // 全mount撤去で破棄され、本文不変のまま再表示すると再処理される
    second.destroy(b);
    assert.equal(readMathStats().discards, 1);
    const c = first.toDOM(view); await settle();
    assert.deepEqual(readMathStats(), { renderStarts: 2, discards: 1 });
    first.destroy(c);
    assert.equal(readMathStats().discards, 2);
  } finally {
    delete flag.__NAGORI_MATH_STATS__; resetMathStats();
    (globalThis as { document?: unknown }).document = saved;
    if (saved === undefined) delete (globalThis as { document?: unknown }).document;
  }
});

// 適用した結果の本文を返す補助
function applied(text: string, from: number, to: number, kind: 'bold' | 'italic' | 'strike' | 'code') {
  const plan = formatPlan(text, { from, to }, kind);
  if (plan.reason) return { reason: plan.reason };
  return { text: text.slice(0, plan.from) + plan.text + text.slice(plan.to), selected: (text.slice(0, plan.from) + plan.text + text.slice(plan.to)).slice(plan.selection.from, plan.selection.to) };
}

test('複数段落は本文ごとに囲み、ソフト改行と選択外の空白を保つ', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['strike', '~~']] as const) {
    const source = '前 一つ目の段落\n\n二つ目の段落 後';
    const result = applied(source, 2, source.length - 2, kind);
    assert.equal(result.text, `前 ${mark}一つ目の段落${mark}\n\n${mark}二つ目の段落${mark} 後`);
    assert.equal(result.selected, `一つ目の段落${mark}\n\n${mark}二つ目の段落`);
    assert.equal(applied(' one\n two \r\n\r\n three ', 0, 22, kind).text, ` ${mark}one\n two${mark} \r\n\r\n ${mark}three${mark} `);
  }
});

test('リスト・タスク・引用・見出しの記号を囲まず、本文だけに付ける', () => {
  for (const [source, expected] of [
    ['- 一\n- 二\n- 三', '- *一*\n- *二*\n- *三*'],
    ['1. 一\n2. 二', '1. *一*\n2. *二*'],
    ['- [ ] 一\n- [x] 二', '- [ ] *一*\n- [x] *二*'],
    ['# 見出し #\n\n段落\n\n小見出し\n====', '# *見出し* #\n\n*段落*\n\n*小見出し*\n===='],
    ['> 一\n> 二\n\n> 三', '> *一*\n> *二*\n\n> *三*'],
    ['- 一\n  続き\n- 二', '- *一\n  続き*\n- *二*'],
  ]) assert.equal(applied(source, 0, source.length, 'italic').text, expected);
  for (const [source, from, to] of [['# 見出し', 0, 1], ['見出し\n====', 4, 8], ['- [ ] 本文', 2, 5], ['> 本文', 0, 1]] as const) {
    assert.ok(formatPlan(source, { from, to }, 'bold').reason);
  }
  const quoted = '> **一\n> 二**\n\n**三**';
  assert.equal(applied(quoted, 0, quoted.length, 'bold').text, '> 一\n> 二\n\n三');
});

test('装飾できないブロックと区間だけを飛ばし、全区間で付けられない時は従来の理由を返す', () => {
  for (const blocked of ['```md\nコード\n```', '    コード', '$$\nx^2\n$$', '<div>HTML</div>', '| 列 |\n|---|\n| 値 |', '[参照]: /path']) {
    const source = `前\n\n${blocked}\n\n後`;
    assert.equal(applied(source, 0, source.length, 'bold').text, `**前**\n\n${blocked}\n\n**後**`);
    assert.ok(formatPlan(blocked, { from: 0, to: blocked.length }, 'bold').reason);
  }
  const front = '---\ntitle: 記事\n---\n\n本文';
  assert.equal(applied(front, 0, front.length, 'bold').text, '---\ntitle: 記事\n---\n\n**本文**');
  assert.equal(applied('*ab* c\n\n後', 2, 9, 'bold').text, '*ab* c\n\n**後**');
  assert.equal(formatPlan('*ab* c', { from: 2, to: 6 }, 'bold').reason, 'ほかの装飾の境界をまたぐ選択には適用できません');
  assert.equal(applied('前 $x$\n\n後', 0, 9, 'bold').text, '前 $x$\n\n**後**');
});

test('全区間が同じ装飾内ならすべて外し、混在時は付ける操作へそろえる', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['strike', '~~'], ['code', '`']] as const) {
    const source = `${mark}一${mark}\n\n${mark}二${mark}`;
    assert.equal(applied(source, 0, source.length, kind).text, '一\n\n二');
    const partial = applied(source, mark.length, source.length - mark.length, kind);
    assert.equal(partial.text, '一\n\n二');
    const mixed = `${mark}一${mark}\n\n二`;
    assert.equal(applied(mixed, 0, mixed.length, kind).text, source);
  }
  const source = 'a **b** c\n\nd **e** f';
  assert.equal(applied(source, 0, source.length, 'bold').text, '**a b c**\n\n**d e f**');
  const skipped = '**一**\n\n数式 $x$\n\n**二**';
  assert.equal(applied(skipped, 0, skipped.length, 'bold').text, '一\n\n数式 $x$\n\n二');
});

test('Inline Codeは行ごとに付け、装飾を含む行だけを飛ばす', () => {
  const source = '一\n二\n\n- 三\n- **太字**\n- a`b';
  assert.equal(applied(source, 0, source.length, 'code').text, '`一`\n`二`\n\n- `三`\n- **太字**\n- ``a`b``');
  assert.equal(formatPlan('**太字**\n*斜体*', { from: 0, to: 11 }, 'code').reason, '装飾を含む範囲はInline Codeにできません');
});

test('複数段落のリンクは無効で、表示用と適用時の判定は一致する', () => {
  assert.equal(formatPlan('一\n\n二', { from: 0, to: 4 }, 'link').reason, '単一段落内を選択してください');
  for (const source of ['一\n\n二', '# 見出し\n\n- [ ] 一\n- 二', '前\n\n```\nコード\n```\n\n後', '**一**\n\n**二**', '一\n二\n\n**太字**']) {
    const tree = markdownParser.parse(source);
    for (const kind of ['bold', 'italic', 'strike', 'code', 'link'] as const) {
      assert.deepEqual(formatPlan(source, { from: 0, to: source.length }, kind, tree), formatPlan(source, { from: 0, to: source.length }, kind));
    }
  }
});

test('複数区間を1回のinput.formatで変更し、1回のUndoで選択と本文を戻す', () => {
  const source = '一\n\n```\nコード\n```\n\n二';
  let state = editor(source).update({ selection: EditorSelection.range(0, source.length) }).state;
  const plan = formatPlan(source, state.selection.main, 'bold');
  assert.equal(plan.changes?.length, 2);
  const transaction = state.update({ changes: plan.changes, selection: EditorSelection.range(plan.selection.from, plan.selection.to), userEvent: 'input.format' });
  assert.ok(transaction.isUserEvent('input.format'));
  state = transaction.state;
  assert.equal(state.doc.toString(), '**一**\n\n```\nコード\n```\n\n**二**');
  assert.ok(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), source);
  assert.deepEqual({ from: state.selection.main.from, to: state.selection.main.to }, { from: 0, to: source.length });
  assert.equal(undo({ state, dispatch: () => {} }), false);
});

test('同じ装飾にかかる範囲は、中の記号を外して全体に付け直す', () => {
  const sentence = "There's something about **Autumn** that makes time";
  const from = sentence.indexOf('something'), to = sentence.indexOf(' makes');
  assert.deepEqual(applied(sentence, from, to, 'bold'), { text: "There's **something about Autumn that** makes time", selected: 'something about Autumn that' });
  // 装飾の境界を途中でまたぐ選択は、かかった装飾まで範囲を広げる
  assert.deepEqual(applied('**bold** plain', 3, 14, 'bold'), { text: '**bold plain**', selected: 'bold plain' });
  assert.deepEqual(applied('x **ab** y', 5, 10, 'bold'), { text: 'x **ab y**', selected: 'ab y' });
  // 複数の同じ装飾もまとめる
  assert.deepEqual(applied('**a** and **b**', 0, 15, 'bold'), { text: '**a and b**', selected: 'a and b' });
  assert.deepEqual(applied('a ~~b~~ c', 0, 9, 'strike'), { text: '~~a b c~~', selected: 'a b c' });
  assert.deepEqual(applied('a `b` c', 0, 7, 'code'), { text: '`a b c`', selected: 'a b c' });
});

test('同じ装飾の中だけを選ぶと外し、ほかの種類の装飾は丸ごと入る時だけ残す', () => {
  assert.deepEqual(applied('**Autumn**', 3, 5, 'bold'), { text: 'Autumn', selected: 'Autumn' });
  assert.deepEqual(applied('a *b* c', 0, 7, 'bold'), { text: '**a *b* c**', selected: 'a *b* c' });
  assert.deepEqual(applied('*a b c*', 3, 4, 'bold'), { text: '*a **b** c*', selected: 'b' });
  assert.ok(applied('*ab* c', 2, 6, 'bold').reason);
  // 選択範囲の前後の空白は外してから付ける
  assert.deepEqual(applied('one two three', 3, 8, 'bold'), { text: 'one **two** three', selected: 'two' });
  assert.deepEqual(applied('a **b** c d', 0, 10, 'italic'), { text: '*a **b** c* d', selected: 'a **b** c' });
  assert.ok(applied('a   b', 1, 4, 'bold').reason);
  assert.ok(applied('a **b** c', 0, 9, 'code').reason);
});
