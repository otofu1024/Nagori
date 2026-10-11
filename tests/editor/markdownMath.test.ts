import test from 'node:test';
import { mathExpressions } from '../../src/lib/editor/markdownMath.ts';
import assert from 'node:assert/strict';

import { syntaxTree } from '@codemirror/language';
import { markdownParser, walk } from '../../src/lib/editor/markdown.ts';

import { editor, decorationRanges } from './previewFixture.ts';

test('math syntax includes inline, display, blank-line blocks and table cells without consuming following prose', () => {
  const source =
    'Inline $x_1+\\frac{1}{2}$ and \\(y^2\\).\n\n$$z^2$$\n\n\\[w^2\\]\n\n$$\n\\begin{aligned}\na&=b+c\\\\\n\n&=d\n\\end{aligned}\n$$  \n\n\\[\n\\begin{matrix}a&b\\\\c&d\\end{matrix}\n\\]\n\n| h | math |\n|---|---|\n| x | $x^2$ |\n\nend';
  const nodes: string[] = [];
  walk(markdownParser.parse(source).topNode, (node) => {
    if (/^(InlineMath|DisplayMath|MathBlock)$/.test(node.name)) nodes.push(node.name);
  });
  assert.deepEqual(nodes, ['InlineMath', 'InlineMath', 'DisplayMath', 'DisplayMath', 'MathBlock', 'MathBlock', 'InlineMath']);
  const state = editor(source),
    ranges = decorationRanges(state);
  assert.equal(ranges.filter((r) => r.spec.widget && !r.spec.block).length, 2);
  assert.equal(ranges.filter((r) => r.spec.widget && r.spec.block).length, 5); // Four display expressions and a table.
  assert.equal(state.doc.toString(), source);
});

test('math leaves currency, escaped dollars, code, HTML blocks and front matter as source', () => {
  for (const source of [
    'Costs $5 and $10, then $20.00.',
    '\\$x$',
    '$ x $',
    '$x $',
    '$x$2',
    '`$x$`\n\n```tex\n$$\nx\n$$\n\\(y\\)\n```',
    '    $x$\n\n<div>\n$x$\n\\[x\\]\n</div>',
    '---\nmath: $x$\n---\n\nend',
    '$$\nx\nnot closed',
    '$x\ny$',
  ]) {
    const state = editor(source),
      math: string[] = [];
    walk(syntaxTree(state).topNode, (node) => {
      if (/^(InlineMath|DisplayMath|MathBlock)$/.test(node.name)) math.push(node.name);
    });
    assert.deepEqual(math, [], source);
    assert.equal(state.doc.toString(), source);
  }
});

test('display blocks in quotes/lists strip structural prefixes only from render input', () => {
  for (const source of ['> $$\n> x^2\n> $$\n\nend', '- $$\n  x^2\n  $$\n\nend', '> - \\[\n>   x^2\n>   \\]\n\nend']) {
    const tree = markdownParser.parse(source),
      math = mathExpressions(tree, source);
    assert.equal(math.length, 1, tree.toString());
    assert.equal(math[0].expression, 'x^2');
    const state = editor(source);
    assert.equal(state.doc.toString(), source);
    assert.ok(decorationRanges(state, true).some((r) => r.from === math[0].from && r.spec.widget));
  }
});
