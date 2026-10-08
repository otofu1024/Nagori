import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allNotes,
  formatNoteDate,
  recentlyEdited,
  recordOpened,
  renameOpened,
  removeOpened,
  OPENED_LIMIT,
  removeStarred,
  renameStarred,
  setStarred,
  starredNotes,
  withParentLabels,
} from '../src/lib/noteLists.ts';
import type { Entry } from '../src/lib/navigation.ts';

const md = (path: string, modified?: number): Entry => ({ path, name: path.split('/').at(-1)!, kind: 'markdown', modified });
const dir = (path: string): Entry => ({ path, name: path.split('/').at(-1)!, kind: 'directory' });

test('すべてのノートはMarkdownの記事だけを名前の順に並べ、大文字小文字を同一視する', () => {
  const entries: Entry[] = [
    md('b.md'), dir('草稿'), { path: '画像.png', name: '画像.png', kind: 'image' },
    md('A.md'), md('10.md'), md('2.md'),
  ];
  // 数字は文字より前、数字の並びは数の大きさで比べる
  assert.deepEqual(allNotes(entries).map(note => note.path), ['2.md', '10.md', 'A.md', 'b.md']);
  // 同じ名前の並びはパスで確定する
  assert.deepEqual(allNotes([md('z/a.md'), md('a/a.md')]).map(note => note.path), ['a/a.md', 'z/a.md']);
});

test('同じ名前の記事は親フォルダを添え、直下の記事には「プロジェクト直下」と添える', () => {
  const notes = allNotes([md('記事.md'), md('草稿/記事.md'), md('公開/草稿/記事.md'), md('別.md')]);
  // 並びはパスの順（日本語の読み順）で確定する
  assert.deepEqual(notes.map(note => [note.path, note.parent]), [
    ['記事.md', 'プロジェクト直下'], ['公開/草稿/記事.md', '公開/草稿'], ['草稿/記事.md', '草稿'], ['別.md', ''],
  ]);
  assert.deepEqual(withParentLabels([md('一.md')]).map(note => note.parent), ['']);
});

test('最近編集は更新日時の新しい順に並べ、日時のない記事は外し、最大30件にする', () => {
  const entries: Entry[] = [md('古い.md', 100), md('新しい.md', 300), md('日時なし.md'), dir('フォルダ'), md('中.md', 200)];
  assert.deepEqual(recentlyEdited(entries).map(note => note.path), ['新しい.md', '中.md', '古い.md']);
  const many = Array.from({ length: 35 }, (_, index) => md(`${index}.md`, index));
  const latest = recentlyEdited(many);
  assert.equal(latest.length, 30);
  assert.equal(latest[0].path, '34.md');
  assert.equal(latest.at(-1)!.path, '5.md');
  assert.equal(recentlyEdited(many, {}, 3).length, 3);
});

test('スター付きは保存した順（新しい順）を保ち、今の索引にない記事や記事以外は出さない', () => {
  const entries: Entry[] = [md('a.md'), md('b.md'), dir('b.md'), md('草稿/c.md')];
  const notes = starredNotes(['草稿/c.md', 'gone.md', 'a.md', 'a.md', 'b.md'], entries);
  assert.deepEqual(notes.map(note => note.path), ['草稿/c.md', 'a.md', 'b.md']);
  assert.deepEqual(starredNotes([], entries), []);
  assert.deepEqual(starredNotes(['b.md'], [dir('b.md')]), []);
});

test('スターを付けると先頭に置き、外すと取り除く。ほかのワークスペースの設定は変えない', () => {
  const start = { '/w/one': ['a.md'], '/w/two': ['z.md'] };
  const added = setStarred(start, '/w/one', 'b.md', true);
  assert.deepEqual(added['/w/one'], ['b.md', 'a.md']);
  assert.deepEqual(added['/w/two'], ['z.md']);
  assert.deepEqual(setStarred(added, '/w/one', 'a.md', true)['/w/one'], ['a.md', 'b.md']);
  assert.deepEqual(setStarred(added, '/w/one', 'a.md', false)['/w/one'], ['b.md']);
  assert.deepEqual(start, { '/w/one': ['a.md'], '/w/two': ['z.md'] });
});

test('名前変更と移動はスターの相対パスに追従し、削除ではその配下のスターを外す', () => {
  const starred = { '/w': ['草稿/記事.md', '草稿/深い/件.md', '別.md'] };
  assert.deepEqual(renameStarred(starred, '/w', '草稿', '公開')['/w'], ['公開/記事.md', '公開/深い/件.md', '別.md']);
  assert.deepEqual(renameStarred(starred, '/other', '草稿', '公開'), starred);
  assert.deepEqual(removeStarred(starred, '/w', '草稿')['/w'], ['別.md']);
  assert.deepEqual(removeStarred(starred, '/w', '草稿/記事.md')['/w'], ['草稿/深い/件.md', '別.md']);
  assert.deepEqual(removeStarred({}, '/w', '草稿'), {});
});

test('日時の表示は今日・昨日・同じ年・別の年で切り替え、今日は時刻を付ける', () => {
  const now = new Date(2026, 9, 8, 15, 0).getTime();
  assert.equal(formatNoteDate(new Date(2026, 9, 8, 10, 24).getTime(), now), '今日 10:24');
  assert.equal(formatNoteDate(new Date(2026, 9, 7, 23, 59).getTime(), now), '昨日');
  assert.equal(formatNoteDate(new Date(2026, 9, 3, 9, 5).getTime(), now), '10月3日');
  assert.equal(formatNoteDate(new Date(2025, 0, 2, 9, 5).getTime(), now), '2025年1月2日');
  assert.equal(formatNoteDate(new Date(2026, 0, 1, 0, 0).getTime(), new Date(2026, 0, 1, 23, 0).getTime()), '今日 00:00');
});

test('最近編集は、更新日時と最後に開いた時刻の新しい方で並び、開いただけの記事も入る', () => {
  const entries = [
    { path: '更新.md', name: '更新.md', kind: 'markdown' as const, modified: 3000 },
    { path: '開いた.md', name: '開いた.md', kind: 'markdown' as const, modified: 1000 },
    { path: '古い.md', name: '古い.md', kind: 'markdown' as const, modified: 500 },
    { path: '開いただけ.md', name: '開いただけ.md', kind: 'markdown' as const },
    { path: '日時なし.md', name: '日時なし.md', kind: 'markdown' as const },
    { path: '画像.png', name: '画像.png', kind: 'image' as const, modified: 9000 },
  ];
  const opened = { '開いた.md': 4000, '開いただけ.md': 2000, '古い.md': 100, '索引にない.md': 9999 };
  const notes = recentlyEdited(entries, opened);
  assert.deepEqual(notes.map(note => [note.path, note.modified]), [
    ['開いた.md', 4000], ['更新.md', 3000], ['開いただけ.md', 2000], ['古い.md', 500],
  ]);
  assert.equal(recentlyEdited(entries, opened, 2).length, 2);
});

test('開いた時刻の記録は、開くたびに更新し、上限の200件を新しい順に残す', () => {
  let opened: Record<string, number> = {};
  for (let index = 0; index < OPENED_LIMIT + 5; index++) opened = recordOpened(opened, `${index}.md`, index + 1);
  assert.equal(Object.keys(opened).length, OPENED_LIMIT);
  assert.equal(opened['0.md'], undefined);
  assert.equal(opened[`${OPENED_LIMIT + 4}.md`], OPENED_LIMIT + 5);
  const again = recordOpened(opened, `${OPENED_LIMIT + 4}.md`, 1);
  assert.equal(again[`${OPENED_LIMIT + 4}.md`], 1);
});

test('名前変更は開いた時刻の記録のパスに追従し、削除では配下の記録を外す', () => {
  const opened = { '草稿/記事.md': 1, '草稿/深い/a.md': 2, '草稿2.md': 3, '別.md': 4 };
  assert.deepEqual(renameOpened(opened, '草稿', '公開'), { '公開/記事.md': 1, '公開/深い/a.md': 2, '草稿2.md': 3, '別.md': 4 });
  assert.deepEqual(removeOpened(opened, '草稿'), { '草稿2.md': 3, '別.md': 4 });
});
