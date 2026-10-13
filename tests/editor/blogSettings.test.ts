import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { livePreview } from '../../src/lib/editor/livePreview.ts';
import { previewOnlyMode, type Options } from '../../src/lib/editor/previewState.ts';
import { PropertiesWidget, BlogHeaderWidget } from '../../src/lib/editor/previewProperties.ts';
import { LinkCardWidget, TalkWidget } from '../../src/lib/editor/previewBlog.ts';
import { readBlogCharacters } from '../../src/lib/editor/blogCharacters.ts';
import { blogThemeCss } from '../../src/lib/editor/blogTheme.ts';

const text = '---\ntitle: 記事\n---\n\n本文\n\nhttps://example.com\n\n> [!NAGORI]\n> 本文\n\n末尾';
const options: Options = {
  resolveImage: async () => 'blob:approved',
  onLink: () => {},
  properties: true,
  blogMode: true,
  blogLinkCards: {
    'https://example.com': { url: 'https://example.com', hostname: 'example.com', title: '記事', description: '', image: '' },
  },
  blogCharacters: readBlogCharacters(
    "export const CHARACTERS = {NAGORI:{name:'なごり',defaultExpression:'normal',expressions:{normal:{src:'/normal.png',label:'通常',aliases:[]}}}};",
  ),
};
function widgets(state: EditorState) {
  const result: unknown[] = [];
  for (const set of state.facet(EditorView.decorations))
    if (typeof set !== 'function')
      set.between(0, state.doc.length, (_from, _to, value) => {
        if (value.spec.widget) result.push(value.spec.widget);
      });
  return result;
}

test('見出し、リンクカード、吹き出しを個別に切り替え、本文、選択、Undoを保つ', () => {
  for (const [key, Widget] of [
    ['blogArticleHeader', BlogHeaderWidget],
    ['blogLinkCardsEnabled', LinkCardWidget],
    ['blogCharactersEnabled', TalkWidget],
  ] as const) {
    const compartment = new Compartment();
    let state = EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [history(), markdown({ base: commonmarkLanguage }), compartment.of(livePreview(options))],
    });
    state = state.update({
      changes: { from: text.length, insert: '変更' },
      selection: { anchor: text.length + 2 },
      userEvent: 'input',
    }).state;
    const edited = state.doc.toString(),
      selection = state.selection,
      depth = undoDepth(state);
    for (const previewOnly of [false, true]) {
      state = state.update({ effects: previewOnlyMode.of(previewOnly) }).state;
      for (const enabled of [false, true]) {
        state = state.update({ effects: compartment.reconfigure(livePreview({ ...options, [key]: enabled })) }).state;
        assert.equal(
          widgets(state).some((widget) => widget instanceof Widget),
          enabled,
          key,
        );
        if (key === 'blogArticleHeader' && !enabled) {
          const list = widgets(state).find((widget) => widget instanceof PropertiesWidget) as PropertiesWidget;
          assert.ok(list);
          assert.equal(list.options.blogMode, false);
        }
        for (const Other of [BlogHeaderWidget, LinkCardWidget, TalkWidget])
          if (Other !== Widget) assert.ok(widgets(state).some((widget) => widget instanceof Other));
        assert.equal(state.doc.toString(), edited);
        assert.ok(state.selection.eq(selection));
        assert.equal(undoDepth(state), depth);
      }
    }
    state = state.update({ effects: previewOnlyMode.of(false) }).state;
    assert.equal(
      undo({
        state,
        dispatch: (tr) => {
          state = tr.state;
        },
      }),
      true,
    );
    assert.equal(state.doc.toString(), text);
    assert.equal(
      redo({
        state,
        dispatch: (tr) => {
          state = tr.state;
        },
      }),
      true,
    );
    assert.equal(state.doc.toString(), edited);
  }
});

test('カードがオフでもURLはリンクで描き、新しいURLの情報を取得しない', () => {
  let count = 0;
  const state = EditorState.create({
    doc: text,
    selection: { anchor: text.length },
    extensions: [
      markdown({ base: commonmarkLanguage }),
      livePreview({
        ...options,
        blogLinkCardsEnabled: false,
        blogLinkCards: {},
        fetchLinkCard: async () => {
          count++;
          return null;
        },
      }),
    ],
  });
  const links: string[] = [];
  for (const set of state.facet(EditorView.decorations))
    if (typeof set !== 'function')
      set.between(0, text.length, (_from, _to, value) => {
        if (value.spec.class === 'nagori-link') links.push(value.spec.attributes?.['data-href']);
      });
  assert.ok(links.includes('https://example.com'));
  assert.equal(count, 0);
  assert.ok(!widgets(state).some((widget) => widget instanceof LinkCardWidget));
});

test('本文のテーマをオフにすると、記事の見出し内も含めCSSを外す', () => {
  const source = { template: '.article-header h1{color:red}', theme: '.prose{color:blue}' };
  assert.ok(blogThemeCss(source, true).includes('.nagori-blog-header .article-header h1'));
  assert.equal(blogThemeCss(source, false), '');
  assert.equal(blogThemeCss(null, true), '');
});
