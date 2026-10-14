import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blogTagCandidates,
  createBlogPost,
  japanDate,
  newPostDialogRequests,
  newPostErrors,
  newPostMarkdown,
} from '../../src/lib/workspace/blogNewPost.ts';
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
    { ...input, category: 'unknown' },
    { ...input, category: '' },
  ]) {
    assert(Object.values(newPostErrors(invalid, categories)).some(Boolean));
    await assert.rejects(createBlogPost(storage, invalid));
  }
  await assert.rejects(createBlogPost({ ...storage, config: async () => null }, input));
  assert.equal(writes, 0);
});
for (const empty of [
  { name: '説明が空', description: '', tags: reference[0].tags },
  { name: 'タグが空', description: reference[0].description, tags: [] },
  { name: '説明とタグが両方空', description: '', tags: [] },
]) {
  test(empty.name + 'でも記事を作成できる', async () => {
    const values = { ...reference[0], description: empty.description, tags: empty.tags };
    let expected = reference[0].markdown;
    if (!empty.description) expected = expected.replace('description: "短い説明"', 'description: ""');
    if (!empty.tags.length) expected = expected.replace('tags:\n  - "日記"\n  - "Astro"', 'tags: []');
    assert(Object.values(newPostErrors(values, categories)).every((error) => !error));
    const entry = { path: 'src/content/blog/20261014-abcdef/index.md', name: 'index.md', kind: 'markdown' as const };
    const result = await createBlogPost(
      {
        config: async () => config,
        create: async (date, text) => {
          assert.equal(date, '2026-10-14');
          assert.equal(text, expected);
          return entry;
        },
      },
      values,
      new Date('2026-10-13T15:00:00Z'),
    );
    assert.equal(result, entry);
    if (!empty.description) assert.equal(newPostMarkdown({ ...values, description: '　\t' }, '2026-10-14'), expected);
  });
}
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

test('閉じた時のイベントが再表示後に届いても、次の読み込みを取り消さない', () => {
  let open = true;
  const requests = newPostDialogRequests(() => open);
  const first = requests.start();
  open = false;
  // closeイベントの到着前に、次のダイアログを開いて読み込みを始める。
  open = true;
  const second = requests.start();
  requests.closed();
  assert.equal(requests.isCurrent(first), false);
  assert.equal(requests.isCurrent(second), true);
  // 現在のダイアログを閉じた場合は、残っている読み込みを取り消す。
  open = false;
  requests.closed();
  assert.equal(requests.isCurrent(second), false);
});

test('カテゴリ候補の反映を待ってから入力を有効化する', async () => {
  const requests = newPostDialogRequests(() => true);
  const current = requests.start();
  let renderComplete!: () => void;
  const rendered = new Promise<void>((resolve) => {
    renderComplete = resolve;
  });
  let enabled = false;
  const finishing = requests
    .rendered(current, () => rendered)
    .then((ready) => {
      enabled = ready;
    });
  await Promise.resolve();
  assert.equal(enabled, false);
  renderComplete();
  await finishing;
  assert.equal(enabled, true);
});

test('候補の反映中に閉じて開き直した場合は、前の読み込みで入力を有効化しない', async () => {
  const requests = newPostDialogRequests(() => true);
  const first = requests.start();
  let renderComplete!: () => void;
  const rendered = new Promise<void>((resolve) => {
    renderComplete = resolve;
  });
  const finishing = requests.rendered(first, () => rendered);
  const second = requests.start();
  renderComplete();
  assert.equal(await finishing, false);
  assert.equal(await requests.rendered(second, async () => {}), true);
});
