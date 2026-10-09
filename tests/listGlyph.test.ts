import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { bulletGlyph, buildPreview, listDepth } from '../src/lib/livePreview.ts';
import { markdownExtensions, walk } from '../src/lib/markdown.ts';

// 行の装飾と、記号の範囲を集める。カーソルは末尾の空行に置き、すべての項目を表示用に変える。
function preview(text: string) {
  const state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: markdown({ base: commonmarkLanguage, extensions: markdownExtensions }) });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const decorations: DecorationSet = buildPreview(state, { resolveImage: async () => '', onLink: () => {} });
  const marks: { from: number; to: number; className: string; bullet?: string }[] = [];
  const lines: { line: number; className: string; style: string }[] = [];
  decorations.between(0, text.length, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string> };
    if (value instanceof Decoration && value.spec.class && from === to) lines.push({ line: state.doc.lineAt(from).number, className: spec.class, style: spec.attributes?.style ?? '' });
    else if (spec.class) marks.push({ from, to, className: spec.class, bullet: spec.attributes?.['data-bullet'] });
  });
  return { state, marks, lines };
}

test('箇条書きの記号は深さで変わり、4段目以降は1段目から繰り返す', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(bulletGlyph), ['•', '◦', '▪', '•', '◦', '▪', '•']);
});

test('リストの深さは囲むリストの数で数える', () => {
  const tree = ensureSyntaxTree(EditorState.create({ doc: '- 親\n  - 子\n    1. 孫', extensions: markdown({ base: commonmarkLanguage, extensions: markdownExtensions }) }), 20, 5000)!;
  const depths: number[] = [];
  walk(tree.topNode, node => { if (node.name === 'ListItem') depths.push(listDepth(node)); });
  assert.deepEqual(depths, [1, 2, 3]);
});

test('入れ子の箇条書きは深さに応じた記号を隠した記号へ付ける', () => {
  const { marks } = preview('- 親\n  - 子\n    - 孫\n      - 曾孫\n');
  assert.deepEqual(marks.filter(mark => mark.bullet).map(mark => mark.bullet), ['•', '◦', '▪', '•']);
  for (const mark of marks.filter(mark => mark.bullet)) assert.match(mark.className, /nagori-hidden/);
});

test('番号付きとタスクは記号を変えず、字下げの幅だけを付ける', () => {
  const ordered = preview('1. 親\n   2. 子\n');
  assert.equal(ordered.marks.filter(mark => mark.bullet).length, 0);
  assert.equal(ordered.marks.filter(mark => mark.className.includes('nagori-list-slot')).length, 2);
  const task = preview('- [ ] 親\n');
  assert.ok(task.lines.some(line => line.className.includes('nagori-list-task')));
  const ordered_task = preview('1. [ ] 親\n');
  assert.ok(ordered_task.lines.some(line => line.style.includes('--nagori-list-extra: 23px')));
});

test('行の字下げは項目の深さを CSS 変数で渡し、折り返しの位置を本文にそろえる', () => {
  const { lines } = preview('- 親\n  - 子\n');
  assert.deepEqual(lines.map(line => [line.line, line.className.includes('nagori-list-first'), line.style]), [
    [1, true, '--nagori-list-depth: 1;'], [2, true, '--nagori-list-depth: 2;'],
  ]);
});
