import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blogTagCandidates, createBlogPost, japanDate, newPostErrors, newPostMarkdown } from '../../src/lib/workspace/blogNewPost.ts';
import { readBlogCategories } from '../../src/lib/editor/blogCategories.ts';

const config = 'export const CATEGORIES = {daily: {label: "日常"}, tech: {label: "技術"}, review: {label: "感想"}} as const;';
const categories = readBlogCategories(config);
const input = { title: '記事', description: '説明', category: 'daily', tags: [] };
// テンプレートのscripts/new-post.mjsを実行して保存した出力。公開日だけ固定した。
const reference = JSON.parse(readFileSync(new URL('./fixtures/newPosts.json', import.meta.url), 'utf8'));
for (const item of reference) {
  test('テンプレートと1文字も違わない: ' + item.title, () => {
    assert.equal(newPostMarkdown(item, '2026-10-14'), item.markdown);
    assert.equal(newPostMarkdown({ ...item, title: ` ${item.title} `, description: ` ${item.description} ` }, '2026-10-14'), item.markdown);
  });
}
test('公開日は実行環境の時差によらず日本時間で日付が切り替わる', () => {
  assert.equal(japanDate(new Date('2026-10-13T14:59:59Z')), '2026-10-13');
  assert.equal(japanDate(new Date('2026-10-13T15:00:00Z')), '2026-10-14');
  assert.equal(japanDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
});
test('必須項目の空白と定義にないカテゴリではファイルを作らない', async () => {
  let writes = 0;
  const storage = {
    config: async () => config,
    create: async () => {
      writes++;
      return { path: '', name: '', kind: 'markdown' as const };
    },
  };
  for (const invalid of [
    { ...input, title: '　\t' },
    { ...input, description: ' ' },
    { ...input, category: 'unknown' },
    { ...input, category: '' },
  ]) {
    assert(Object.values(newPostErrors(invalid, categories)).some(Boolean));
    await assert.rejects(createBlogPost(storage, invalid));
  }
  await assert.rejects(createBlogPost({ ...storage, config: async () => null }, input));
  assert.equal(writes, 0);
});
test('カテゴリを読み直してから、日付とテンプレートの本文をRustへ渡す', async () => {
  const item = reference[0];
  const entry = { path: 'src/content/blog/20261014-abcdef/index.md', name: 'index.md', kind: 'markdown' as const };
  const result = await createBlogPost(
    {
      config: async () => config,
      create: async (date, text) => {
        assert.equal(date, '2026-10-14');
        assert.equal(text, item.markdown);
        return entry;
      },
    },
    item,
    new Date('2026-10-13T15:00:00Z'),
  );
  assert.equal(result, entry);
});
test('ほかの記事のタグを重複と空白を除いて候補にする', () => {
  assert.deepEqual(blogTagCandidates([{ tags: ['Astro', ' 日記 ', ''] }, { tags: ['日記', '技術'] }]), ['Astro', '技術', '日記']);
});
