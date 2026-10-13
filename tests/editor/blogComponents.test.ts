import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBlogCharacters, talkMarker } from '../../src/lib/editor/blogCharacters.ts';
import { standaloneUrl } from '../../src/lib/editor/blogLinkCards.ts';
import { markdownParser, walk } from '../../src/lib/editor/markdown.ts';
import { references } from '../../src/lib/editor/markdownInline.ts';
import { buildPreview } from '../../src/lib/editor/previewDecorations.ts';
import { LinkCardWidget, TalkWidget } from '../../src/lib/editor/previewBlog.ts';
import { editor, options } from './previewFixture.ts';
const config = `export const CHARACTERS = {
 NAGORI: {name:'なごり', defaultExpression:'normal', expressions:{ normal:{src:'/images/nagori/normal.png',label:'通常',aliases:['通常','笑顔']}}}
} as const;`;
test('CHARACTERSを実行せずに読み、表情の省略と別名と予約語をブログに合わせる', () => {
  const table = readBlogCharacters(config);
  assert.ok(table);
  for (const marker of ['[!NAGORI]', '[!nagori 通常]', '[!NAGORI 笑顔！]', '[!NAGORI　NORMAL?]']) {
    const found = talkMarker(marker + '\n本文', table);
    assert.equal(found?.expression.expression, 'normal');
    assert.equal(found?.body, '本文');
  }
  assert.equal(talkMarker('[!NAGORI 未知]\n本文', table), null);
  assert.equal(talkMarker('[!NOTE]\n本文', table), null);
  for (const invalid of [
    config.replace('NAGORI:', 'NOTE:'),
    config.replace("name:'なごり'", 'name:run()'),
    config.replace("aliases:['通常','笑顔']", "aliases:['通常','通常！']"),
    config.replace("src:'/images/nagori/normal.png'", 'src: image.src'),
  ])
    assert.equal(readBlogCharacters(invalid), null);
  assert.deepEqual(Object.keys(readBlogCharacters('export const CHARACTERS = {};')!), []);
});
test('URLだけかURLと同じラベルのリンクだけをカードの候補にする', () => {
  const candidates = (text: string) => {
    const tree = markdownParser.parse(text),
      refs = references(tree, text),
      found: string[] = [];
    walk(tree.topNode, (node) => {
      const url = standaloneUrl(node, text, refs);
      if (url) found.push(url);
    });
    return found;
  };
  assert.deepEqual(
    candidates('https://example.com\n\n[https://example.com](https://example.com)\n\n<https://example.com>'),
    Array(3).fill('https://example.com'),
  );
  assert.deepEqual(candidates('https://example.com/a\\_b'), ['https://example.com/a_b']);
  assert.deepEqual(candidates('https://example.com/?a=1&amp;b=2'), ['https://example.com/?a=1&b=2']);
  for (const text of [
    '前 https://example.com',
    '[別の名前](https://example.com)',
    'https://example.com\n次',
    '[**https://example.com**](https://example.com)',
    '![https://example.com](https://example.com)',
    'ftp://example.com',
  ])
    assert.deepEqual(candidates(text), [], text);
});
test('ブログだけでカードと吹き出しを描き、段落や引用のどの行でもカーソルを入れると記法へ戻す', () => {
  const text = '前\n\nhttps://example.com\n\n> [!NAGORI]\n> **本文**\n> 続き\n\n後';
  const settings = {
    ...options,
    blogMode: true,
    blogCharacters: readBlogCharacters(config),
    linkPreview: () => ({ url: 'https://example.com', hostname: 'example.com', title: '見本', description: '説明', image: '' }),
  };
  const widgets = (anchor: number, blogMode = true) => {
    const result: WidgetType[] = [];
    buildPreview(editor(text, anchor), { ...settings, blogMode }).between(0, text.length, (_from, _to, value) => {
      if (value.spec.widget) result.push(value.spec.widget);
    });
    return result;
  };
  type WidgetType = LinkCardWidget | TalkWidget;
  assert.equal(widgets(text.length).filter((widget) => widget instanceof LinkCardWidget).length, 1);
  assert.equal(widgets(text.length).filter((widget) => widget instanceof TalkWidget).length, 1);
  assert.ok(!widgets(text.indexOf('https')).some((widget) => widget instanceof LinkCardWidget));
  for (const line of ['[!NAGORI]', '**本文**', '続き'])
    assert.ok(!widgets(text.indexOf(line)).some((widget) => widget instanceof TalkWidget));
  assert.ok(!widgets(text.length, false).some((widget) => widget instanceof LinkCardWidget || widget instanceof TalkWidget));
});

test('未取得のURLはリンクのままにし、取得後にカードへ替えて同じURLの取得を重ねない', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { markdown, commonmarkLanguage } = await import('@codemirror/lang-markdown');
  const { EditorView } = await import('@codemirror/view');
  const { livePreview } = await import('../../src/lib/editor/livePreview.ts');
  const text = 'https://example.com\n\n後';
  let count = 0,
    finish!: (preview: import('../../src/lib/editor/blogLinkCards.ts').LinkPreview | null) => void;
  let state = EditorState.create({
    doc: text,
    selection: { anchor: text.length },
    extensions: [
      markdown({ base: commonmarkLanguage }),
      livePreview({
        ...options,
        blogMode: true,
        // キャッシュを読み終えた状態(このURLはまだない)
        blogLinkCards: {},
        fetchLinkCard: () => {
          count++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      }),
    ],
  });
  const widgets = () => {
    const result: unknown[] = [];
    for (const set of state.facet(EditorView.decorations))
      if (typeof set !== 'function')
        set.between(0, text.length, (_from, _to, value) => {
          if (value.spec.widget) result.push(value.spec.widget);
        });
    return result;
  };
  assert.equal(count, 1);
  assert.ok(!widgets().some((widget) => widget instanceof LinkCardWidget));
  state = state.update({ selection: { anchor: text.length - 1 } }).state;
  assert.equal(count, 1);
  finish({ url: 'https://example.com', hostname: 'example.com', title: '取得後', description: '', image: '' });
  await new Promise((resolve) => setImmediate(resolve));
  state = state.update({ selection: { anchor: text.length } }).state;
  assert.ok(widgets().some((widget) => widget instanceof LinkCardWidget));
  assert.equal(count, 1);
});

test('キャッシュを読み終える前は、キャッシュにあるかもしれないURLを取りに行かない', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { markdown, commonmarkLanguage } = await import('@codemirror/lang-markdown');
  const { livePreview } = await import('../../src/lib/editor/livePreview.ts');
  const { options } = await import('./previewFixture.ts');
  let count = 0;
  EditorState.create({
    doc: 'https://example.com\n\n後',
    selection: { anchor: 20 },
    extensions: [markdown({ base: commonmarkLanguage }), livePreview({ ...options, blogMode: true, blogLinkCards: null, fetchLinkCard: async () => (count++, null) })],
  });
  assert.equal(count, 0);
});
