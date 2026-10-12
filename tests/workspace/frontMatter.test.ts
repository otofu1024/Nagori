import test from 'node:test';
import assert from 'node:assert/strict';
import { readProperties, patchFrontMatter } from '../../src/lib/workspace/frontMatter.ts';
const apply = (text: string, key: string, value: string | string[] | boolean | number | undefined) =>
  patchFrontMatter(text, key, value).reduceRight(
    (text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to),
    text,
  );
const values = (text: string) => Object.fromEntries(readProperties(text)!.properties.map((p) => [p.key, p.value]));
const source = `---
title: '日本語のタイトル' # タイトル
# 表紙タイトルを手動で改行したい場合だけ使用
# coverTitleLines:
#   - "1行目"
#   - "2行目"
description: "説明"
publishedAt: 2026-10-12
updatedAt: '2026-10-13' # 更新日
category: daily
tags:
  - Astro # 見本
  # タグの注記
  - 'Markdown'
draft: true # 公開前
other: { keep: 'this' }
---

## 本文
変更しない。
`;
test('YAMLの全項目を読み、本文を含めず最小限の範囲を書き換える', () => {
  assert.ok(readProperties(source));
  assert.equal(values(source).title, '日本語のタイトル');
  assert.deepEqual(values(source).tags, ['Astro', 'Markdown']);
  assert.equal(apply(source, 'title', "引用'タイトル"), source.replace("'日本語のタイトル'", "'引用''タイトル'"));
  assert.equal(apply(source, 'description', '説明\n次の行'), source.replace('"説明"', '"説明\\n次の行"'));
  assert.equal(apply(source, 'draft', false), source.replace('draft: true', 'draft: false'));
  assert.equal(apply(source, 'category', 'true'), source.replace('category: daily', 'category: "true"'));
  assert.equal(apply(source, 'tags', ['Astro', '別タグ']), source.replace("'Markdown'", "'別タグ'"));
  assert.deepEqual(patchFrontMatter(source, 'title', '日本語のタイトル'), []);
});
test('任意項目の追加と削除、CRLF、空のFront Matterを扱う', () => {
  const cover = apply(source, 'cover', './assets/表紙.jpg');
  assert.equal(values(cover).cover, './assets/表紙.jpg');
  assert.equal(apply(cover, 'cover', undefined), source);
  assert.equal(apply(source, 'updatedAt', undefined), source.replace("updatedAt: '2026-10-13' # 更新日\n", '# 更新日\n'));
  const crlf = source.replaceAll('\n', '\r\n');
  assert.equal(apply(crlf, 'draft', false), crlf.replace('draft: true', 'draft: false'));
  assert.equal(apply('---\n---\n本文', 'title', '新記事'), '---\ntitle: 新記事\n---\n本文');
  const lines = apply(source, 'coverTitleLines', ['1行目', '2行目']);
  assert.deepEqual(values(lines).coverTitleLines, ['1行目', '2行目']);
  assert.equal(apply(lines, 'coverTitleLines', undefined), source);
});
test('配列の要素数が変わってもコメントと他の項目を残す', () => {
  for (const tags of [[], ['a'], ['a', 'b', 'c']]) {
    const changed = apply(source, 'tags', tags);
    assert.deepEqual(values(changed).tags, tags);
    assert.ok(changed.includes('# タグの注記') && changed.includes('# 見本'));
    assert.ok(changed.endsWith(source.slice(source.indexOf('draft:'))));
  }
  const flow = '---\ntags: ["a", b] # 注記\n---\n本文';
  assert.equal(apply(flow, 'tags', ['x', 'b']), flow.replace('"a"', '"x"'));
  assert.equal(apply(flow, 'tags', ['x', 'b', 'c']), '---\ntags: ["x", b, c] # 注記\n---\n本文');
});
test('不正なYAMLと重複は編集を拒否し、項目名による型の制限はしない', () => {
  for (const text of [
    '---\ntitle: [\n---\n本文',
    '---\ntitle: a\ntitle: b\n---\n本文',
    '---\n- a\n---\n本文',
    '---\ntitle: a\n本文',
    '本文',
  ]) {
    assert.equal(readProperties(text), null);
    assert.throws(() => patchFrontMatter(text, 'title', 'x'));
  }
  for (const text of ['---\ntags: false\n---\n本文', '---\ntitle: true\n---\n本文']) {
    assert.ok(readProperties(text));
    assert.ok(apply(text, 'title', 'x').includes('title: x'));
  }
  assert.deepEqual(values(apply(source, 'coverTitleLines', [])).coverTitleLines, []);
  assert.deepEqual(values(apply(source, 'custom', ['', '1', '2', '3', '4', '5'])).custom, ['', '1', '2', '3', '4', '5']);
});
test('複数行スカラー、空の値、アンカーと別名を安全に扱う', () => {
  const block = '---\ndescription: | # 注記\n  1行目\n  2行目\n# 次の項目\ntitle: x\n---\n本文';
  const changed = apply(block, 'description', '新しい説明');
  assert.equal(values(changed).description, '新しい説明');
  assert.ok(changed.includes('# 注記') && changed.includes('# 次の項目'));
  assert.equal(apply('---\ncover:\n# 次\ntitle: x\n---\n本文', 'cover', './a.jpg'), '---\ncover: ./a.jpg\n# 次\ntitle: x\n---\n本文');
  assert.throws(() => apply('---\ntitle: &title hi\ndescription: *title\n---\n', 'title', 'new'));
  assert.throws(() => apply('---\ntitle: &title hi\ndescription: *title\n---\n', 'description', 'new'));
});

test('要素の追加・削除は既存の引用符、字下げ、コメントを保つ', () => {
  const original = '---\ntags: # タグ\n    - "a" # 最初\n    # 途中\n    - \'b\' # 次\n# 後\ntitle: "記事"\n---\n本文';
  assert.equal(apply(original, 'tags', ['a', 'b', 'c']), original.replace('# 後\n', '    - c\n# 後\n'));
  const removed = apply(original, 'tags', ['a']);
  assert.ok(removed.includes('    # 途中\n    # 次\n# 後'));
  assert.ok(removed.includes('    - "a" # 最初'));
  const flow = '---\ntags: [\n  "a", # 1つ目\n  \'b\' # 2つ目\n] # 一覧\ntitle: x\n---\n本文';
  const changed = apply(flow, 'tags', ['a', 'b', 'c']);
  assert.ok(changed.includes('["a", \'b\', c] # 一覧'));
  assert.ok(changed.includes('# 1つ目') && changed.includes('# 2つ目'));
  assert.ok(changed.endsWith('title: x\n---\n本文'));
  assert.throws(() => apply('---\n{title: x}\n---\n本文', 'cover', './a.jpg'));
  assert.throws(() => apply('---\n{title: x, cover: ./a.jpg}\n---\n本文', 'cover', undefined));
});

test('数字と任意名の項目を安全に編集し、YAMLの順序と型を保つ', () => {
  const text = '---\n10: text\n---\n本文';
  assert.equal(readProperties(text), null);
  let source = '---\n"10": text\ncount: 1.5 # 数字\n"2": next\n---\n本文';
  assert.deepEqual(
    readProperties(source)?.properties.map((p) => p.key),
    ['10', 'count', '2'],
  );
  assert.equal(apply(source, 'count', -2.5), source.replace('1.5', '-2.5'));
  for (const key of ['a: b', '#注記', 'true', '123', '[value]', '日本語', '__proto__']) {
    source = apply(source, key, '');
    assert.equal(values(source)[key], '');
  }
  assert.throws(() => apply(source, 'count', Infinity));
  assert.throws(() => apply(source, 'count', NaN));
  assert.throws(() => apply(source, '', 'x'));
  assert.throws(() => apply(source, 'line\nbreak', 'x'));
});
