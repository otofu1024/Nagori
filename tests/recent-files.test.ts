import test from 'node:test';
import assert from 'node:assert/strict';
import { recentPages, renamedPath, containsPath, type Entry } from '../src/lib/navigation.ts';

test('最近見たページは履歴順で重複を除き、最大5件にする', () => {
  const paths = ['6.md', '5.md', '6.md', '4.md', '3.md', '2.md', '1.md'];
  assert.deepEqual(recentPages(paths, []).map(entry => entry.path), ['6.md', '5.md', '4.md', '3.md', '2.md']);
  assert.deepEqual(recentPages([], []), []);
});

test('表示中の同名ファイルは親の相対パスで区別し、直下にも名前を添える', () => {
  const pages = recentPages(['記事.md', '草稿/記事.md', '公開/草稿/記事.md', '別.md'], []);
  assert.deepEqual(pages.map(entry => [entry.name, entry.parent]), [
    ['記事.md', 'プロジェクト直下'], ['記事.md', '草稿'], ['記事.md', '公開/草稿'], ['別.md', ''],
  ]);
  assert.equal(recentPages(['記事.md', '1.md', '2.md', '3.md', '4.md', '草稿/記事.md'], [])[0].parent, '');
});

test('種類は既存の一覧を優先し、未展開の履歴も表示する', () => {
  const entries: Entry[] = [{ path: 'リンク.md', name: 'リンク.md', kind: 'symlink' }];
  assert.deepEqual(recentPages(['リンク.md', '未展開/写真.JPG', '未展開/本文.markdown', 'メモ.txt'], entries).map(entry => entry.kind),
    ['symlink', 'image', 'markdown', 'other']);
});

test('既存の名前変更と削除の履歴更新に追従し、空になった履歴は表示しない', () => {
  const paths = ['草稿/記事.md', '記事.md'].map(path => renamedPath(path, '草稿', '公開'));
  assert.equal(recentPages(paths, [])[0].parent, '公開');
  assert.deepEqual(recentPages(paths.filter(path => !containsPath('公開', path)), []).map(entry => entry.path), ['記事.md']);
  assert.deepEqual(recentPages([], []), []);
});
