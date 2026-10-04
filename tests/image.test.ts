import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageMime } from '../src/lib/image.ts';

test('先頭のバイト列から画像のMIMEタイプを決める', () => {
  assert.equal(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  assert.equal(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageMime(new TextEncoder().encode('GIF89a')), 'image/gif');
  assert.equal(imageMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(imageMime(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ')), 'application/octet-stream');
  assert.equal(imageMime(new Uint8Array()), 'application/octet-stream');
});

test('画像だけをコピーしていた時だけ、貼り付ける画像を選ぶ', async () => {
  const { clipboardImage } = await import('../src/lib/image.ts');
  const file = { name: 'image.png' } as unknown as File;
  const item = (kind: string, type: string) => ({ kind, type, getAsFile: () => file });
  const data = (text: string, items: ReturnType<typeof item>[]) => ({ getData: (format: string) => (format === 'text/plain' ? text : ''), items });
  assert.equal(clipboardImage(data('', [item('file', 'image/png')])), file);
  assert.equal(clipboardImage(data('', [item('string', 'text/html'), item('file', 'image/webp')])), file);
  assert.equal(clipboardImage(data('説明文', [item('file', 'image/png')])), null);
  assert.equal(clipboardImage(data('', [item('file', 'image/svg+xml')])), null);
  assert.equal(clipboardImage(data('', [item('file', 'application/pdf')])), null);
  assert.equal(clipboardImage(data('', [])), null);
  assert.equal(clipboardImage(null), null);
});
