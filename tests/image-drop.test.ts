import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo, isolateHistory } from '@codemirror/commands';
import { imageDropReason, importDroppedImages, validateDroppedImages, preventFileNavigation, type ImageDropState } from '../src/lib/imageDrop.ts';

const editable: ImageDropState = { plain: false, readonly: false, busy: false, saving: false, composing: false, previewOnly: false, saved: true };

test('window全体でファイルの標準ドロップを止め、文字列とイベントの伝播を保つ', () => {
  const target = new EventTarget();
  for (const type of ['dragover', 'drop']) {
    target.addEventListener(type, event => preventFileNavigation(event as DragEvent));
    for (const types of [['Files'], ['Files', 'text/uri-list'], ['text/plain'], [], null]) {
      const event = Object.assign(new Event(type, { cancelable: true }), { dataTransfer: types ? { types } : null });
      const file = types?.includes('Files') ?? false;
      assert.equal(target.dispatchEvent(event), !file);
      assert.equal(event.defaultPrevented, file);
      assert.equal(event.cancelBubble, false);
    }
  }
});

test('画像を取り込めない状態ごとに理由を返す', () => {
  assert.equal(imageDropReason(editable), null);
  for (const key of ['plain', 'readonly', 'busy', 'saving', 'composing', 'previewOnly'] as const) {
    assert.ok(imageDropReason({ ...editable, [key]: true }), key);
  }
  assert.ok(imageDropReason({ ...editable, saved: false }));
});

test('画像以外と上限超過をコピー前に拒否する', async () => {
  const image = new File(['png'], '画像.png', { type: 'image/png' });
  const invalid = new File(['pdf'], '文書.pdf', { type: 'application/pdf' });
  let copied = 0;
  await assert.rejects(importDroppedImages([image, invalid], async () => { copied++; return { markdown: '' }; }), /PNG/);
  assert.equal(copied, 0);
  assert.throws(() => validateDroppedImages([{ type: 'image/png', size: 20 * 1024 * 1024 + 1 } as File]), /20MiB/);
  assert.doesNotThrow(() => validateDroppedImages([{ type: 'image/png', size: 20 * 1024 * 1024 } as File]));
  for (const [name, type] of [['a.png', 'image/png'], ['a.jpeg', 'image/jpeg'], ['a.gif', 'image/gif'], ['a.webp', 'image/webp'], ['a.JPG', '']]) {
    assert.doesNotThrow(() => validateDroppedImages([new File(['x'], name, { type })]));
  }
  assert.throws(() => validateDroppedImages([new File(['x'], '偽.png', { type: 'text/plain' })]), /PNG/);
});

test('複数画像を順に取り込み、ドロップ位置への挿入を1回のUndoで戻す', async () => {
  const files = [new File(['一'], '一.png', { type: 'image/png' }), new File(['二'], '二.webp', { type: 'image/webp' })];
  const seen: string[] = [];
  const text = await importDroppedImages(files, async bytes => {
    seen.push(new TextDecoder().decode(bytes));
    return { markdown: `![](<assets/pasted-image-${seen.length}.png>)` };
  });
  assert.deepEqual(seen, ['一', '二']);
  assert.equal(text, '![](<assets/pasted-image-1.png>)\n![](<assets/pasted-image-2.png>)');
  let state = EditorState.create({ doc: '前後', extensions: [history()] });
  state = state.update({ changes: { from: 1, insert: text }, userEvent: 'input.drop', annotations: isolateHistory.of('full') }).state;
  assert.equal(state.doc.toString(), `前${text}後`);
  assert.ok(undo({ state, dispatch: tr => { state = tr.state; } }));
  assert.equal(state.doc.toString(), '前後');
});

test('コピー失敗時は記法を返さず、後続画像も取り込まない', async () => {
  let calls = 0;
  await assert.rejects(importDroppedImages([1, 2, 3].map(n => new File(['x'], `${n}.png`, { type: 'image/png' })), async () => {
    if (++calls === 2) throw new Error('破損画像');
    return { markdown: '画像' };
  }), /破損画像/);
  assert.equal(calls, 2);
});
