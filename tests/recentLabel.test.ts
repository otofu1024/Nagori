import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 画面の文言を「最近見たノート」に統一したことを確かめる。設定の項目名は保存との互換のため変えない
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('サイドバーとノート一覧の表示は「最近見たノート」で、古い「最近編集」の文言は残らない', () => {
  for (const path of ['../src/App.svelte', '../src/lib/SidebarNav.svelte', '../src/lib/SettingsDialog.svelte']) {
    const source = read(path);
    assert.equal(source.includes('最近編集'), false, `${path} に古い文言が残っている`);
  }
  assert.match(read('../src/lib/SidebarNav.svelte'), /label: '最近見たノート'/);
  assert.match(read('../src/lib/SettingsDialog.svelte'), /最近見たノートの件数/);
});

test('設定の項目名recentEditedCountは変えず、保存した設定との互換を保つ', () => {
  assert.match(read('../src/lib/settings.ts'), /recentEditedCount/);
});
