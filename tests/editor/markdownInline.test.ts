import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownParser } from '../../src/lib/editor/markdown.ts';
import { linkMarkdown } from '../../src/lib/editor/markdownInline.ts';

test('safe link generation handles spaces/brackets and rejects dangerous schemes', () => {
  const value = linkMarkdown('a [label]', 'assets/a (1).md');
  assert.match(markdownParser.parse(value).toString(), /Link/);
  assert.throws(() => linkMarkdown('x', 'javascript:alert(1)'));
  assert.throws(() => linkMarkdown('x', 'file:///etc/passwd'));
  assert.throws(() => linkMarkdown('x', 'foo\nbar'));
});
