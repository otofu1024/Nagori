import test from 'node:test';
import { renderMath } from '../../src/lib/editor/mathjax.ts';
import { readMathStats, resetMathStats } from '../../src/lib/editor/mathStats.ts';
import { MAX_MATH_LENGTH, mathExpressions, type MathExpression } from '../../src/lib/editor/markdownMath.ts';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorView, type WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { frontMatter, markdownParser, markdownExtensions, walk, touches } from '../../src/lib/editor/markdown.ts';
import { references, linkTarget, linkMarkdown, codeDisplay } from '../../src/lib/editor/markdownInline.ts';
import { formatPlan } from '../../src/lib/editor/markdownFormat.ts';
import { livePreview } from '../../src/lib/editor/livePreview.ts';
import { previewOnlyMode, compositionMode } from '../../src/lib/editor/previewState.ts';
import { buildPreview } from '../../src/lib/editor/previewDecorations.ts';

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
