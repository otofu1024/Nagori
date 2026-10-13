import test from 'node:test';
import assert from 'node:assert/strict';
import { readBlogCategories } from '../../src/lib/editor/blogCategories.ts';

test('設定を実行せず、カテゴリのキーと表示名を読む', () => {
  assert.deepEqual(
    readBlogCategories(`throw new Error('実行しない'); export const CATEGORIES = {
    daily: {label: "日常", description: '説明'}, 'tech-notes': {label: '技術'},
    review: {label: "感想\\n記録"},
  } as const;`),
    [
      { key: 'daily', label: '日常' },
      { key: 'tech-notes', label: '技術' },
      { key: 'review', label: '感想\n記録' },
    ],
  );
  for (const source of [
    null,
    '',
    'const CATEGORIES = {tech: {label: "技術"}',
    'const CATEGORIES = makeCategories()',
    'const CATEGORIES = {}',
    'const CATEGORIES = {tech: {label: getLabel()}}',
    'const CATEGORIES = {...other}',
    'const CATEGORIES = {tech: {label: "技術"}, tech: {label: "別名"}}',
  ])
    assert.equal(readBlogCategories(source), null);
});
