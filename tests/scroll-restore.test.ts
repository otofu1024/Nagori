import test from 'node:test';
import assert from 'node:assert/strict';
import { isAtBottom, restoredScrollTop } from '../src/lib/scrollRestore.ts';

test('末尾にいる場合は高さが縮んでも伸びても新しい末尾へ合わせる', () => {
  const before = { scrollTop: 1000, clientHeight: 500, scrollHeight: 1500 };
  assert.equal(restoredScrollTop(before, { clientHeight: 500, scrollHeight: 1460 }), 960);
  assert.equal(restoredScrollTop(before, { clientHeight: 500, scrollHeight: 1540 }), 1040);
});

test('Live PreviewとPreviewを往復しても末尾の位置が変わらない', () => {
  let m = { scrollTop: 1000, clientHeight: 500, scrollHeight: 1500 };
  const heights = [1460, 1500]; // Previewでは記号の行が縮み、戻ると元の高さへ戻る
  for (const h of heights) {
    const next = { clientHeight: 500, scrollHeight: h };
    m = { ...next, scrollTop: restoredScrollTop(m, next) };
  }
  assert.equal(m.scrollTop, 1000);
});

test('末尾でない場合は従来どおりscrollTopを保つ', () => {
  const before = { scrollTop: 300, clientHeight: 500, scrollHeight: 1500 };
  assert.equal(isAtBottom(before), false);
  assert.equal(restoredScrollTop(before, { clientHeight: 500, scrollHeight: 1460 }), 300);
});

test('丸め誤差の範囲は末尾として扱い、短い文書では0を返す', () => {
  assert.equal(isAtBottom({ scrollTop: 999.5, clientHeight: 500, scrollHeight: 1500 }), true);
  assert.equal(restoredScrollTop({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 }, { clientHeight: 500, scrollHeight: 400 }), 0);
});
