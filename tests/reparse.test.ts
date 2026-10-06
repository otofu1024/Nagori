import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet } from '@codemirror/state';
import { formatPlan, markdownParser, reparse } from '../src/lib/markdown.ts';

const kinds = ['bold', 'italic', 'strike', 'code', 'link'] as const;

test('段落内の編集を差分解析した木でも、装飾の判定は全文解析と同じになる', () => {
  let text = '# 記事\n\nこれは長い文章です。**太字**と*斜体*があります。\n\n- 一つ目\n- 二つ目\n\n次の段落 `code` です。\n';
  let tree = markdownParser.parse(text);
  for (const insert of ['追記', '**', '*強調*', '`', 'x']) {
    const at = text.indexOf('長い');
    const changes = ChangeSet.of({ from: at, insert }, text.length);
    text = text.slice(0, at) + insert + text.slice(at);
    tree = reparse(tree, text, changes);
    const start = text.indexOf('文章');
    for (const kind of kinds) {
      for (const [from, to] of [[start, start + 2], [start - 2, start + 4], [text.indexOf('次の'), text.indexOf('次の') + 2]]) {
        assert.deepEqual(formatPlan(text, { from, to }, kind, tree), formatPlan(text, { from, to }, kind), `${insert} ${kind} ${from}-${to}`);
      }
    }
  }
});

test('CodeMirror側など別の解析器の木を渡しても、全文解析にして判定する', () => {
  const text = 'これは文章です。\n';
  const foreign = markdownParser.configure([]).parse(text);
  assert.deepEqual(formatPlan(text, { from: 3, to: 5 }, 'bold', foreign), formatPlan(text, { from: 3, to: 5 }, 'bold'));
});
