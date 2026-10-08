import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { DEBOUNCE_MS, FILE_LIMIT, groupMatches, hitOf, latestOnly, matchCount, matchSpan, segments, shouldSearch, type SearchFile } from '../src/lib/workspaceSearch.ts';

const files: SearchFile[] = [
  { path: 'a/one.md', name: 'one.md', matches: [{ line: 1, column: 0, preview: 'note', ranges: [[0, 4]] }, { line: 3, column: 2, preview: 'x note', ranges: [[2, 6]] }] },
  { path: 'two.txt', name: 'two.txt', matches: [{ line: 7, column: 5, preview: 'hello note', ranges: [[6, 10]] }] },
];

test('検索は空の時と2文字未満の英数字だけの時に行わない', () => {
  assert.equal(shouldSearch(''), false);
  assert.equal(shouldSearch('a'), false);
  assert.equal(shouldSearch('9'), false);
  assert.equal(shouldSearch('ab'), true);
  assert.equal(shouldSearch('あ'), true);
  assert.equal(shouldSearch('a b'), true);
  assert.equal(shouldSearch('-'), true);
});

test('結果はファイルごとにまとめ、↑↓の順番は画面の並びと同じにする', () => {
  const groups = groupMatches(files);
  assert.deepEqual(groups.map((group) => group.file.path), ['a/one.md', 'two.txt']);
  assert.deepEqual(groups.flatMap((group) => group.rows.map((row) => row.index)), [0, 1, 2]);
  assert.equal(matchCount(files), 3);
  assert.equal(matchCount([]), 0);
});

test('抜粋は一致の部分だけを印を付けて分け、UTF-16の位置で切る', () => {
  assert.deepEqual(segments('say note!', [[4, 8]]), [
    { text: 'say ', hit: false },
    { text: 'note', hit: true },
    { text: '!', hit: false },
  ]);
  assert.deepEqual(segments('note and note', [[0, 4], [9, 13]]), [
    { text: 'note', hit: true },
    { text: ' and ', hit: false },
    { text: 'note', hit: true },
  ]);
  // 😀は2単位なので、後ろの一致の位置は文字数とずれる
  const preview = '😀note';
  assert.deepEqual(segments(preview, [[2, 6]]), [
    { text: '😀', hit: false },
    { text: 'note', hit: true },
  ]);
  // 範囲が前後に重なったり外へ出たりする時は無視する
  assert.deepEqual(segments('abc', [[1, 9], [0, 1]]), [
    { text: 'a', hit: true },
    { text: 'bc', hit: false },
  ]);
});

test('開く先の範囲は行と列から求め、行の末尾を超えない', () => {
  const doc = EditorState.create({ doc: 'first\nあいう note\nlast' }).doc;
  // 2行目の先頭から4単位目が「note」の先頭（あいう の3単位＋空白の1単位）
  const span = matchSpan(doc, 2, 4, 4);
  assert.deepEqual(span, { from: doc.line(2).from + 4, to: doc.line(2).from + 8 });
  assert.equal(doc.sliceString(span!.from, span!.to), 'note');
  assert.deepEqual(matchSpan(doc, 2, 40, 9), { from: doc.line(2).to, to: doc.line(2).to });
  assert.equal(matchSpan(doc, 0, 0, 1), null);
  assert.equal(matchSpan(doc, 4, 0, 1), null);
});

test('開く先の情報は一致の位置と長さを持つ', () => {
  assert.deepEqual(hitOf('two.txt', files[1].matches[0]), { path: 'two.txt', line: 7, column: 5, length: 4 });
});

test('新しい問い合わせの結果だけを採り、取り消した結果は捨てる', () => {
  const gate = latestOnly();
  const first = gate.start();
  const second = gate.start();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.cancel();
  assert.equal(gate.isCurrent(second), false);
});

test('表示の上限と待ち時間の定数', () => {
  assert.equal(FILE_LIMIT, 50);
  assert.equal(DEBOUNCE_MS, 200);
});
