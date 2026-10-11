import test from 'node:test';
import { renderMath } from '../../src/lib/editor/katex.ts';
import { readMathStats, resetMathStats } from '../../src/lib/editor/mathStats.ts';
import { MAX_MATH_LENGTH, type MathExpression } from '../../src/lib/editor/markdownMath.ts';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';

import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { markdownParser, markdownExtensions } from '../../src/lib/editor/markdown.ts';
import { livePreview } from '../../src/lib/editor/livePreview.ts';

import { options, editor, decorationRanges } from './previewFixture.ts';

function expressions(values: string[]): MathExpression[] {
  return values.map((expression, from) => ({ expression, from, to: from + 1, source: '$$' + expression + '$$', display: true }));
}

test('KaTeX AMS/mathtools/macros/tags are scoped to one document', async () => {
  const values = [
    String.raw`\newcommand{\RR}{\mathbb{R}}`,
    String.raw`\RR`,
    String.raw`\begin{aligned}a&=b+c\\&=d\end{aligned}`,
    String.raw`\begin{matrix}a&b\\c&d\end{matrix}`,
    String.raw`f(x)=\begin{cases}x&x>0\\-x&x\le0\end{cases}`,
    String.raw`x^2\tag{A}`,
    String.raw`a\bmod b + x\pmod{n} + x\mod n`,
    String.raw`\underbracket{x+y}`,
    String.raw`|x|+\left|x\right|+\big|x\big|`,
    String.raw`\begin{equation}x=1\end{equation}`,
    String.raw`\begin{align}a&=b\\c&=d\end{align}`,
  ];
  const rendered = await renderMath(expressions(values));
  assert.ok(rendered);
  for (const [position, result] of rendered.expressions) {
    assert.equal(result.error, undefined, values[position]);
    assert.match(result.html!, /class="katex"/);
    assert.match(result.html!, /class="katex-mathml"/);
    assert.match(result.html!, /<math /);
  }
  assert.match(rendered.expressions.get(5)!.html!, /class="katex-tag"/);
  assert.match(rendered.expressions.get(9)!.html!, /<span>\(1\)<\/span>/);
  assert.match(rendered.expressions.get(10)!.html!, /<span>\(2\)<\/span>/);
  assert.match(rendered.expressions.get(10)!.html!, /<span>\(3\)<\/span>/);
  assert.match(rendered.expressions.get(10)!.html!, /<mtext>\(3\)<\/mtext>/);
  assert.doesNotMatch(rendered.expressions.get(10)!.html!, /class[ =]+"(?:mml-)?eqn-num"/);
  const next = await renderMath(expressions([String.raw`\RR`, String.raw`\begin{equation}y=2\end{equation}`]));
  assert.ok(next);
  assert.ok(next.expressions.get(0)!.error);
  assert.match(next.expressions.get(1)!.html!, /<span>\(1\)<\/span>/);
  const repeated = await renderMath(expressions([String.raw`\RR`, String.raw`\newcommand{\RR}{\mathbb{R}}`, String.raw`\RR`]));
  assert.ok(repeated);
  assert.ok(repeated.expressions.get(0)!.error);
  assert.equal(repeated.expressions.get(2)!.error, undefined);
});

test('numbered environments keep explicit tags and skip starred/notag rows', async () => {
  const values = [
    String.raw`\begin{equation*}x=1\end{equation*}`,
    String.raw`\begin{equation}x=2\tag{A}\end{equation}`,
    String.raw`\begin{align}a&=1\notag\\b&=2\end{align}`,
    String.raw`\begin{equation}c=3\end{equation}`,
  ];
  const rendered = await renderMath(expressions(values));
  assert.ok(rendered);
  assert.doesNotMatch(rendered.expressions.get(0)!.html!, /<span>\(1\)<\/span>/);
  assert.doesNotMatch(rendered.expressions.get(1)!.html!, /<mtext>\(1\)<\/mtext>/);
  assert.match(rendered.expressions.get(1)!.html!, /class="katex-tag"/);
  assert.match(rendered.expressions.get(2)!.html!, /<span>\(1\)<\/span>/);
  assert.match(rendered.expressions.get(3)!.html!, /<span>\(2\)<\/span>/);
});

test('KaTeX reports unsupported references and multlined per expression', async () => {
  const values = [
    String.raw`\eqref{future}`,
    String.raw`\ref{future}`,
    String.raw`\begin{equation}x=1\label{future}\end{equation}`,
    String.raw`\begin{multlined}a+b\\+c+d\end{multlined}`,
  ];
  const rendered = await renderMath(expressions([...values, 'x']));
  assert.ok(rendered);
  for (let i = 0; i < values.length; i++) assert.ok(rendered.expressions.get(i)!.error, values[i]);
  assert.ok(rendered.expressions.get(values.length)!.html);
});

test('KaTeX refuses unsupported commands and bounds macro expansion', async () => {
  const values = [
    String.raw`\mmlToken{mi}[style="font-size:999999px;position:fixed;inset:0;background:red"]{x}`,
    String.raw`\mmlToken{mi}[href="javascript:alert(1)"]{x}`,
    String.raw`\mmlToken{mi}[href="https://example.invalid/x"]{x}`,
    String.raw`\mmlToken{mi}[fontsize="999999px"]{x}`,
    String.raw`\mmlToken{mi}[scriptlevel="-999"]{x}`,
    String.raw`\mmlToken{mi}[mathcolor="red;position:fixed;inset:0"]{x}`,
    String.raw`\mmlToken{mi}[mathbackground="red;position:fixed;inset:0"]{x}`,
    String.raw`\mmlToken{mi}[fontfamily="serif;position:fixed;inset:0"]{x}`,
    String.raw`\mmlToken{mi}[fontweight="bold;position:fixed"]{x}`,
    String.raw`\mmlToken{mi}[fontstyle="italic;position:fixed"]{x}`,
    String.raw`\mmlToken{mo}[lspace="999999%"]{x}`,
    String.raw`a\mmlToken{mo}[lspace="infinity"]{x}b`,
    String.raw`\mmlToken{mi}[class="nagori-math"]{x}`,
    String.raw`\mmlToken{mi}[id="nagori-katex-style"]{x}`,
    '\\require{html}',
    '\\def\\a{\\a}\\a',
    '\\frac{1}{',
    '\\unknownNagoriCommand',
  ];
  const rendered = await renderMath(expressions(values));
  assert.ok(rendered);
  for (const [position, result] of rendered.expressions) {
    assert.ok(result.error, values[position]);
    assert.equal(result.html, undefined);
  }
  assert.equal(await renderMath(expressions(['x']), () => false), null);
  let activeChecks = 0;
  assert.equal(await renderMath(expressions(['x']), () => ++activeChecks === 1), null);
  assert.equal(activeChecks, 2);
  await assert.rejects(() => renderMath(expressions(new Array(513).fill('x'))));
  await assert.rejects(() => renderMath(expressions(new Array(33).fill('x'.repeat(MAX_MATH_LENGTH)))));
  assert.ok((await renderMath(expressions(['x'.repeat(MAX_MATH_LENGTH + 1)])))?.expressions.get(0)?.error);
  assert.doesNotMatch(markdownParser.parse('$' + 'x'.repeat(MAX_MATH_LENGTH + 1) + '$').toString(), /InlineMath/);
});

test('KaTeX trust:false blocks HTML and network commands, including macro expansion', async () => {
  const values = [
    String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\includegraphics{https://example.invalid/x}`,
    String.raw`\htmlStyle{position:fixed;inset:0}{x}`,
    String.raw`\htmlId{nagori-katex-style}{x}`,
    String.raw`\def\bad{\includegraphics{https://example.invalid/x}}\bad`,
  ];
  const rendered = await renderMath(expressions(values));
  assert.ok(rendered);
  for (const result of rendered.expressions.values()) {
    assert.equal(result.error, undefined);
    assert.match(result.html!, /color:#cc0000/);
    // KaTeXは拒否したコマンドを赤い文字で表示する。生の属性や画像は作らない。
    assert.doesNotMatch(result.html!, /<(?:a|img)\b|(?:href|src|id)="|style="(?:position|inset)/);
  }
  const sized = await renderMath(expressions([String.raw`\rule{999999em}{999999em}`, String.raw`\kern100000px x`]));
  assert.ok(sized);
  for (const result of sized.expressions.values()) {
    assert.equal(result.error, undefined);
    assert.match(result.html!, /20em/);
    assert.doesNotMatch(result.html!, /style="[^"]*(?:999999|100000)/);
  }
});

test('long documents include offscreen math before CodeMirror parses the tail and reuse unchanged math context', async () => {
  const text =
    '---\nmetadata: $x$\n---\n\n' +
    String.raw`$x$` +
    '\n\n' +
    'paragraph\n\n'.repeat(15000) +
    String.raw`$$\begin{equation}x=1\end{equation}$$`;
  let state = EditorState.create({
    doc: text,
    extensions: [markdown({ base: commonmarkLanguage, extensions: markdownExtensions }), livePreview(options)],
  });
  const context = () =>
    (
      decorationRanges(state, true).find((range) => range.spec.widget && range.from === text.indexOf('$x$', 20))!.spec.widget as {
        context: { expressions: MathExpression[] };
      }
    ).context;
  assert.ok(syntaxTree(state).length < text.length);
  const initial = context();
  assert.equal(initial.expressions.length, 2);
  const rendered = await renderMath(initial.expressions);
  assert.ok(rendered);
  assert.match(rendered.expressions.get(initial.expressions[1].from)!.html!, /<span>\(1\)<\/span>/);
  ensureSyntaxTree(state, 103000, 1000);
  state = state.update({ selection: { anchor: 1 } }).state;
  assert.ok(syntaxTree(state).length < text.length);
  assert.equal(context(), initial);
  state = state.update({ changes: { from: text.length, insert: '\n' } }).state;
  assert.notEqual(context(), initial);
  assert.equal(context().expressions.length, 2);
});

test('数式の計測は無効時に記録せず、全mount撤去後の再表示で再処理が起きる', async () => {
  const flag = globalThis as { __NAGORI_MATH_STATS__?: boolean };
  // 最小限のDOM代替。MathWidgetのtoDOMとdestroyが触る範囲だけ用意する。
  const makeElement = () => {
    const el = {
      className: '',
      textContent: '',
      tabIndex: 0,
      isConnected: true,
      classList: { add() {} },
      title: '',
      setAttribute() {},
      addEventListener() {},
      children: [] as unknown[],
      append(child: unknown) {
        this.children.push(child);
      },
      replaceChildren() {},
    };
    return el as unknown as HTMLElement;
  };
  const saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: makeElement,
    fonts: { ready: Promise.resolve() },
  };
  try {
    const source = '$x^2$\n\n$y$\n';
    const widgets = (state: EditorState) =>
      decorationRanges(state, true)
        .filter((r) => r.spec.widget)
        .map((r) => r.spec.widget as { toDOM(view: unknown): HTMLElement; destroy(el: HTMLElement): void });
    const view = { state: { field: () => false }, requestMeasure() {} };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    // 無効時は描画しても数えない
    flag.__NAGORI_MATH_STATS__ = false;
    resetMathStats();
    await renderMath([{ ...expressions(['x'])[0], display: false }]);
    assert.deepEqual(readMathStats(), { renderStarts: 0, discards: 0 });

    // 有効時: 同じ本文のContextで、mountを増やしても描画は1回
    flag.__NAGORI_MATH_STATS__ = true;
    resetMathStats();
    const state = editor(source, source.length);
    const [first, second] = widgets(state);
    const a = first.toDOM(view),
      b = second.toDOM(view);
    await settle();
    assert.deepEqual(readMathStats(), { renderStarts: 1, discards: 0 });

    // 一部だけ撤去しても破棄されない
    first.destroy(a);
    await settle();
    assert.deepEqual(readMathStats(), { renderStarts: 1, discards: 0 });

    // 全mount撤去で破棄され、本文不変のまま再表示すると再処理される
    second.destroy(b);
    assert.equal(readMathStats().discards, 1);
    const c = first.toDOM(view);
    await settle();
    assert.deepEqual(readMathStats(), { renderStarts: 2, discards: 1 });
    first.destroy(c);
    assert.equal(readMathStats().discards, 2);
    const invalidText = String.raw`$\unknownNagoriCommand$`;
    const invalid = widgets(editor(invalidText + '\n\n', invalidText.length + 2))[0];
    const errorNode = invalid.toDOM(view);
    await settle();
    assert.equal(errorNode.textContent, invalidText);
    assert.match(errorNode.title, /数式を表示できません/);
    assert.equal((errorNode as unknown as { children: HTMLElement[] }).children[0].textContent, '（数式エラー）');
    invalid.destroy(errorNode);
  } finally {
    delete flag.__NAGORI_MATH_STATS__;
    resetMathStats();
    (globalThis as { document?: unknown }).document = saved;
    if (saved === undefined) delete (globalThis as { document?: unknown }).document;
  }
});
