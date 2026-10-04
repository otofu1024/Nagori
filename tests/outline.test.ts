import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownExtensions, markdownParser } from '../src/lib/markdown.ts';
import { extractHeadings, currentHeading } from '../src/lib/outline.ts';
import { restoredScrollTop } from '../src/lib/scrollRestore.ts';

function headings(text: string) {
  return extractHeadings(markdownParser.parse(text), EditorState.create({ doc: text }).doc);
}

test('ATXとSetextの見出し1〜4を本文順に取り出し、移動先は見出し行の末尾にする', () => {
  const text = '# 一 ##\n本文\n\n二\n===\n三\n---\n### 四\n#### 五\n##### 対象外\n###### 対象外';
  const result = headings(text);
  assert.deepEqual(result.map(h => [h.level, h.text]), [[1, '一'], [1, '二'], [2, '三'], [3, '四'], [4, '五']]);
  for (const heading of result) assert.equal(heading.lineEnd, text.indexOf('\n', heading.from));
});

test('コード、Front Matter、HTMLブロックと普通の段落は見出しにしない', () => {
  assert.deepEqual(headings('---\ntitle: 記事\n---\n\n```md\n# コード\n```\n\n    ## コード\n\n<div>\n# HTML\n</div>\n\n本文 # 文字'), []);
});

test('引用とリストの中の見出し、重複、空の見出しを保持する', () => {
  const result = headings('> ## 同じ\n\n- ### 同じ\n\n#\n');
  assert.deepEqual(result.map(h => [h.level, h.text]), [[2, '同じ'], [3, '同じ'], [1, '']]);
});

test('装飾とリンクの記号を外し、入れ子の表示テキストを残す', () => {
  assert.equal(headings('# **太字と*斜体*** ~~削除~~ [**表示**](https://example.com "説明") ![画像](a.png)\n')[0].text,
    '太字と斜体 削除 表示 画像');
  assert.equal(headings('# [表示][ref] [省略][]\n\n[ref]: https://example.com\n[省略]: other.md')[0].text, '表示 省略');
});

test('コードの中の記号と数式を残し、エスケープと文字参照を整える', () => {
  assert.equal(headings('# `` **literal** `code` `` \\*文字\\* &amp; $x_1$ \\(y^2\\) <https://example.com>')[0].text,
    '**literal** `code` *文字* & $x_1$ \\(y^2\\) https://example.com');
});

test('複数行のSetext見出しの空白をまとめ、文書末尾の見出しを取り出す', () => {
  assert.deepEqual(headings('一行目\n二行目\n===\n\n#### 最後').map(h => h.text), ['一行目 二行目', '最後']);
});

test('CodeMirrorの構文木でも長文の末尾まで見出しを取り出せる', () => {
  const text = '# 最初\n\n' + '段落の本文\n\n'.repeat(3000) + '## 最後';
  const state = EditorState.create({ doc: text, extensions: [markdown({ base: commonmarkLanguage, extensions: markdownExtensions })] });
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  assert.ok(tree);
  assert.deepEqual(extractHeadings(tree, state.doc).map(h => h.text), ['最初', '最後']);
});

test('本文上端以前の最後の見出しを選び、末尾の余白でも最後の節を維持する', () => {
  const result = headings('前文\n\n# 最初\n本文\n## 次\n本文');
  assert.equal(currentHeading([], 0), -1);
  assert.equal(currentHeading(result, 0), -1);
  assert.equal(currentHeading(result, result[0].from), 0);
  assert.equal(currentHeading(result, result[1].from - 1), 0);
  assert.equal(currentHeading(result, result[1].from), 1);
  assert.equal(currentHeading(result, 10000), 1);
});

test('CodeMirrorの差分更新後に追加、字下げ、削除した見出しを反映する', () => {
  let state = EditorState.create({ doc: '# 最初\n\n## 次\n本文', extensions: [markdown({ base: commonmarkLanguage, extensions: markdownExtensions })] });
  state = state.update({ changes: { from: 0, insert: '### 追加\n\n' } }).state;
  state = state.update({ changes: { from: 8, insert: '#' } }).state;
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  assert.ok(tree);
  assert.deepEqual(extractHeadings(tree, state.doc).map(h => [h.level, h.text]), [[3, '追加'], [2, '最初'], [2, '次']]);
  const next = state.doc.line(5).from;
  state = state.update({ changes: { from: next, to: state.doc.line(5).to, insert: '見出しを削除' } }).state;
  const after = ensureSyntaxTree(state, state.doc.length, 1000);
  assert.ok(after);
  assert.deepEqual(extractHeadings(after, state.doc).map(h => h.text), ['追加', '最初']);
});

test('半画面の末尾余白があっても表示切替と高さ変更後の末尾へ合わせる', () => {
  const before = { clientHeight: 600, scrollHeight: 2000 + 300, scrollTop: 1700 };
  const preview = { clientHeight: 600, scrollHeight: 1900 + 300 };
  assert.equal(restoredScrollTop(before, preview), 1600);
  const resized = { clientHeight: 800, scrollHeight: 1900 + 400 };
  assert.equal(restoredScrollTop({ ...preview, scrollTop: 1600 }, resized), 1500);
  assert.equal(restoredScrollTop({ ...before, scrollTop: 1000 }, preview), 1000);
});
