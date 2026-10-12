import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, type GraphArticle } from '../../src/lib/workspace/graph.ts';
const article = (path: string, fields: Partial<GraphArticle> = {}): GraphArticle => ({ path, title: '', tags: [], links: [], ...fields });

test('graph uses titles or filenames, optional tags, and deduplicates reciprocal and self links', () => {
  const graph = buildGraph([
    article('notes/a.md', { title: 'ノートA', tags: ['共通', ' 共通 ', 'two words', ''], links: ['b.md', 'a.md', '[[b]]'] }),
    article('notes/b.md', { tags: ['共通', 'B'], links: ['a.md'] }),
    article('README.md', { links: ['notes/a.md'] }),
  ]);
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 6);
  assert.equal(graph.nodes.find((node) => node.path === 'notes/a.md')?.label, 'ノートA');
  assert.equal(graph.nodes.find((node) => node.path === 'notes/b.md')?.label, 'b');
  assert.equal(graph.nodes.find((node) => node.path === 'README.md')?.label, 'README');
  assert.equal(graph.nodes.find((node) => node.id === 'tag:共通')?.degree, 2);
  assert.equal(graph.nodes.find((node) => node.path === 'notes/a.md')?.degree, 4);
});

test('graph resolves encoded relative paths, fragments, and wiki filenames and paths', () => {
  const graph = buildGraph([
    article('notes/a.md', { links: ['my%20note.md?x=1#part', '../other/b.md', '[[unique]]', '[[other/b.md#heading]]', '[[my%20note]]'] }),
    article('notes/my note.md'),
    article('other/b.md'),
    article('deep/unique.md'),
  ]);
  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.every((edge) => edge.source === 'article:notes/a.md'));
});

test('graph ignores external, broken, outside-workspace, image and blog route targets', () => {
  const graph = buildGraph([
    article('notes/a.md', {
      links: [
        'https://example.com/b.md',
        '//example.com/b.md',
        '../../b.md',
        'missing.md',
        '#x',
        '%ZZ.md',
        '/posts/b',
        'image.png',
        '[[../../b]]',
        '[[https://example.com/b]]',
        '[[/b]]',
        '[[%ZZ]]',
      ],
    }),
    article('b.md'),
  ]);
  assert.deepEqual(graph.edges, []);
});

test('wiki links prefer the same directory and do not choose an ambiguous filename', () => {
  const articles = [
    article('elsewhere/a.md', { links: ['[[shared]]'] }),
    article('one/shared.md', { tags: ['old'] }),
    article('two/shared.md', { links: ['[[shared]]'] }),
    article('one/a.md', { links: ['[[shared]]'] }),
  ];
  const graph = buildGraph(articles);
  assert.equal(graph.edges.filter((edge) => edge.kind === 'link').length, 1);
  assert.ok(graph.edges.some((edge) => edge.source === 'article:one/a.md' && edge.target === 'article:one/shared.md'));
  const next = buildGraph(articles.filter((doc) => doc.path !== 'one/shared.md'));
  assert.equal(next.nodes.length, 3);
  assert.ok(next.nodes.every((node) => node.id !== 'tag:old'));
  assert.equal(next.edges.length, 2);
});
