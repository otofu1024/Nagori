import test from 'node:test';
import assert from 'node:assert/strict';

import { candidates, localLink, renamedPath } from '../../src/lib/workspace/navigation.ts';

test('paths, fuzzy matching and recent list remain scoped', () => {
  const entries = [
    { path: 'posts/hello.md', name: 'hello.md', kind: 'markdown' as const },
    { path: 'assets/photo.png', name: 'photo.png', kind: 'image' as const },
  ];
  assert.equal(candidates(entries, 'p/hm', [])[0].path, 'posts/hello.md');
  assert.equal(candidates(entries, '', ['assets/photo.png'])[0].kind, 'image');
  assert.equal(renamedPath('post/a.md', 'post', 'blog'), 'blog/a.md');
  assert.equal(localLink('posts/a.md', '../b.md'), 'b.md');
  assert.throws(() => localLink('a.md', '../escape.md'));
  assert.throws(() => localLink('a.md', 'javascript:alert(1)'));
});

test('Quick Openの候補に、Markdown・画像に加えてテキストファイルも含める', () => {
  const entries = [
    { path: 'posts/hello.md', name: 'hello.md', kind: 'markdown' as const },
    { path: 'config.json', name: 'config.json', kind: 'other' as const },
    { path: 'src', name: 'src', kind: 'directory' as const },
    { path: 'link.md', name: 'link.md', kind: 'symlink' as const },
  ];
  assert.deepEqual(
    candidates(entries, 'json', []).map((e) => e.path),
    ['config.json'],
  );
  assert.deepEqual(
    candidates(entries, 'o', [])
      .map((e) => e.path)
      .sort(),
    ['config.json', 'posts/hello.md'],
  );
  assert.deepEqual(
    candidates(entries, '', ['config.json', 'src']).map((e) => e.path),
    ['config.json'],
  );
});
