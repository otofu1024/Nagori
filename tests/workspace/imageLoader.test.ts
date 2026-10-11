import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageLoader } from '../../src/lib/workspace/imageLoader.ts';

test('記事画像の読み込み待ちを再利用し、切り替えた記事の結果と失敗したキャッシュを破棄する', async () => {
  let path: string | undefined = 'a.md',
    calls = 0;
  let finish: (value: ArrayBuffer) => void = () => {};
  const original = (globalThis as any).window;
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      invoke: async () => {
        calls++;
        return await new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        });
      },
    },
  };
  const loader = createImageLoader(() => path);
  try {
    const first = loader.resolveImage('assets/a.png');
    const second = loader.resolveImage('assets/a.png');
    assert.equal(calls, 1);
    finish(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.match(a, /^blob:/);
    loader.releaseImages();
    const stale = loader.resolveImage('assets/a.png');
    path = 'b.md';
    finish(new ArrayBuffer(0));
    await assert.rejects(stale, /記事が切り替わりました/);
    path = undefined;
    await assert.rejects(loader.resolveImage('assets/a.png'), /記事を開いてください/);
  } finally {
    loader.releaseImages();
    (globalThis as any).window = original;
  }
});
