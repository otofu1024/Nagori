import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blogThemeCss, proseSelectors } from '../../src/lib/editor/blogTheme.ts';

test('maps every supported prose selector and keeps all rules inside the editor host', () => {
  for (const [source, target] of Object.entries(proseSelectors)) {
    const css = blogThemeCss({ template: '', theme: `:where(${source}){color:#123456}` });
    assert.ok(css.includes(`${target}{color:#123456`), source);
  }
  const css = blogThemeCss({
    template:
      '@layer template {.article-layout{grid-template-columns:minmax(0,740px) minmax(180px,240px)} .prose h2,.prose h4{border-bottom:1px solid}}',
    theme: `@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+JP");
      :root{--color-bg:#fff;--color-text:#123456;--font-sans:"Test",sans-serif;--surface:red}
      body,.sidebar{background:red} .prose .talk,.prose .link-card{color:red}
      :where(.prose h2,.prose h3){font-size:1.5rem}
      @media(max-width:600px){.prose a:not(.link-card):hover{color:blue}}
      .prose{position:fixed;line-height:2.2} .prose h2,.sidebar{color:green}`,
  });
  assert.ok(css.startsWith('@import'));
  assert.ok(css.includes('--editor-width:740px'));
  assert.ok(css.includes('--text:var(--color-text)'));
  assert.ok(css.includes('.nagori-link:hover{color:blue;'));
  assert.ok(css.includes('.nagori-h2,.editor-host[data-blog-theme] .cm-content .nagori-h3{font-size:1.5rem;'));
  assert.ok(css.includes('.nagori-h2{color:green;'));
  for (const excluded of ['.sidebar', 'body{', '.talk', '.link-card', 'position:fixed', '--surface:red'])
    assert.ok(!css.includes(excluded), excluded);
  assert.equal(blogThemeCss(null), '');
});

test('ignores unsupported selectors, imports and nested rules rather than broadening scope', () => {
  const css = blogThemeCss({
    template: '',
    theme: `@import url("https://example.com/global.css");
    :where(.prose h2)::before{color:red} .prose h2 + body{color:red}
    .prose :is(h2,h3){color:red} .prose h2{color:blue;.sidebar{color:red}}
    @keyframes bad {from{color:red}}`,
  });
  assert.ok(!css.includes('example.com'));
  assert.ok(!css.includes('color:red'));
  assert.ok(css.includes('.nagori-h2{color:blue;'));
});

test('separates code block edges and handles multiline values and whitespace before colons', () => {
  const css = blogThemeCss({
    template: '.prose pre{padding:1rem;margin:1.75rem 0;border:1px solid}',
    theme: ':root{--font-sans : "Test",\n sans-serif} .prose {font-size : 18px;line-height:2}',
  });
  assert.ok(css.includes('.nagori-code-first{padding:1rem;padding-bottom:0;'));
  assert.ok(css.includes('.nagori-code-last{padding:1rem;padding-top:0;'));
  assert.ok(css.includes('--font-sans:"Test",\n sans-serif;'));
  assert.ok(css.includes('font-size:18px;--editor-font-size:18px;'));
});

test('blog block classes preserve source text and leave generic decorations unchanged', async () => {
  const { editor, options } = await import('./previewFixture.ts');
  const { buildPreview } = await import('../../src/lib/editor/previewDecorations.ts');
  const text = '本文\n\n> 引用\n> 続き\n\n- 項目\n\n```js\nconst one = 1;\nconst two = 2;\n```\n\n終わり';
  const state = editor(text);
  const classes = (blogMode: boolean) => {
    const found: { from: number; class: string }[] = [];
    buildPreview(state, { ...options, blogMode }).between(0, text.length, (from, _to, value) => {
      if (value.spec.class) found.push({ from, class: value.spec.class });
    });
    return found;
  };
  const blog = classes(true),
    generic = classes(false);
  assert.deepEqual(
    blog.filter((d) => d.class === 'nagori-paragraph').map((d) => d.from),
    [0, text.indexOf('終わり')],
  );
  assert.ok(blog.some((d) => d.class === 'nagori-code-first' && d.from === text.indexOf('const one')));
  assert.ok(blog.some((d) => d.class === 'nagori-code-last' && d.from === text.indexOf('const two')));
  assert.ok(blog.some((d) => d.class === 'nagori-quote-first' && d.from === text.indexOf('> 引用')));
  assert.ok(blog.some((d) => d.class === 'nagori-quote-last' && d.from === text.indexOf('> 続き')));
  assert.ok(!generic.some((d) => /nagori-(?:paragraph|code-first|code-last|quote-first|quote-last)/.test(d.class)));
  assert.equal(state.doc.toString(), text);
});
