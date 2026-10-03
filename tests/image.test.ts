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
