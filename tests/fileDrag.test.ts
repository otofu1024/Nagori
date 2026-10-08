import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDrag, canTrash, DRAG_TYPE, dragSource, endDrag, isInternalDrag, moveBlock, rootDrop } from '../src/lib/fileDrag.ts';
import type { Entry } from '../src/lib/navigation.ts';

const folder = (path: string): Entry => ({ path, name: path.split('/').at(-1)!, kind: 'directory' });
const note = (path: string): Entry => ({ path, name: path.split('/').at(-1)!, kind: 'markdown' });

// DragEventの必要な部分だけを持つ偽物。dataTransferの型と書き込みを記録する
function fakeEvent(types: string[] = []) {
  const written = new Map<string, string>();
  const dataTransfer = {
    types: [...types],
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type: string, value: string) {
      written.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
  };
  return { event: { dataTransfer } as unknown as DragEvent, written, dataTransfer };
}

test('移動の可否は、同じ場所・自分自身・配下のフォルダだけ拒む', () => {
  // 同じ場所へは移さない。一番上の項目を一番上へ移すのも同じ場所
  assert.ok(moveBlock(note('Posts/a.md'), 'Posts'));
  assert.ok(moveBlock(note('a.md'), ''));
  assert.ok(moveBlock(folder('Posts'), ''));
  // 自分自身と、その下のフォルダには移さない
  assert.ok(moveBlock(folder('Posts'), 'Posts'));
  assert.ok(moveBlock(folder('Posts'), 'Posts/Sub'));
  // 名前が前方一致するだけの別のフォルダへは移せる
  assert.equal(moveBlock(folder('Posts'), 'Posts2'), null);
  assert.equal(moveBlock(note('Posts/a.md'), 'Archive'), null);
  assert.equal(moveBlock(note('Posts/Sub/a.md'), ''), null);
  assert.equal(moveBlock(folder('Posts/Sub'), 'Archive'), null);
});

test('ゴミ箱へ移せるのは記事とフォルダで、シンボリックリンクは対象にしない', () => {
  assert.equal(canTrash(note('a.md')), true);
  assert.equal(canTrash(folder('Posts')), true);
  assert.equal(canTrash({ path: 'link', name: 'link', kind: 'symlink' }), false);
});

test('ドラッグの種類は独自の型で見分け、Finderからのファイルとは混ざらない', () => {
  const { event, written, dataTransfer } = fakeEvent();
  assert.equal(dragSource(), null);
  beginDrag(event, folder('Posts'));
  assert.equal(dragSource()?.path, 'Posts');
  assert.equal(dataTransfer.effectAllowed, 'move');
  assert.equal(written.get(DRAG_TYPE), 'Posts');
  // 独自の型が付いたドラッグだけを、サイドバー内の移動として扱う
  assert.equal(isInternalDrag({ dataTransfer: { types: [DRAG_TYPE] } } as unknown as DragEvent), true);
  assert.equal(isInternalDrag({ dataTransfer: { types: ['Files'] } } as unknown as DragEvent), false);
  endDrag();
  assert.equal(dragSource(), null);
  assert.equal(isInternalDrag({ dataTransfer: { types: [DRAG_TYPE] } } as unknown as DragEvent), false);
});

test('一番上へのドロップは、ワークスペース名の上で移せるものだけを返す', () => {
  const { event } = fakeEvent();
  beginDrag(event, note('Posts/a.md'));
  const dragging = { dataTransfer: { types: [DRAG_TYPE] } } as unknown as DragEvent;
  assert.equal(rootDrop(dragging)?.path, 'Posts/a.md');
  endDrag();
  beginDrag(fakeEvent().event, note('a.md'));
  assert.equal(rootDrop(dragging), null);
  endDrag();
});
