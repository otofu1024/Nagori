import test from 'node:test';
import assert from 'node:assert/strict';
import { planOpenRequest } from '../../src/lib/workspace/openRequest.ts';

test('同じフォルダの依頼はフォルダを開き直さず、ファイルの指定だけを開く', () => {
  assert.deepEqual(planOpenRequest({ workspace: '/a', path: 'note.md', restore: false }, '/a'), { kind: 'file', path: 'note.md' });
});

test('同じフォルダでファイルの指定がなければ、何もしない', () => {
  assert.deepEqual(planOpenRequest({ workspace: '/a', path: null, restore: false }, '/a'), { kind: 'none' });
});

test('違うフォルダの依頼は、フォルダを開く', () => {
  assert.deepEqual(planOpenRequest({ workspace: '/b', path: 'note.md', restore: false }, '/a'), { kind: 'project' });
});

test('まだフォルダを開いていない窓は、依頼のフォルダを開く', () => {
  assert.deepEqual(planOpenRequest({ workspace: '/a', path: null, restore: false }, ''), { kind: 'project' });
  assert.deepEqual(planOpenRequest({ workspace: '/a', path: 'note.md', restore: true }, ''), { kind: 'project' });
});
