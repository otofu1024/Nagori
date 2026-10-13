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
  assert.ok(css.includes('.nagori-h2,.editor-host[data-blog-theme] .cm-content .nagori-h3{font-size:calc(var(--blog-rem) * 1.5);'));
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
  assert.ok(css.includes('.nagori-code-first{padding:calc(var(--blog-rem) * 1);padding-bottom:0;'));
  assert.ok(css.includes('.nagori-code-last{padding:calc(var(--blog-rem) * 1);padding-top:0;'));
  assert.ok(css.includes('--font-sans:"Test",\n sans-serif;'));
  assert.ok(css.includes('font-size:18px;'));
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

test('拡大縮小の文字の大きさを上書きせず、ブログのremを文字の大きさに比例させる', () => {
  const css = blogThemeCss({ template: '.prose{font-size:1rem}', theme: ':where(.prose h2){font-size:1.5rem}' });
  assert.ok(!css.includes('--editor-font-size:'));
  assert.ok(!/\d(?:\.\d+)?rem\b/.test(css.replace(/@import[^\n]*/g, '')));
  assert.ok(css.includes('--blog-rem:calc(var(--editor-font-size, 19px) * '));
  assert.ok(css.includes('.cm-content{font-size:calc(var(--blog-rem) * 1);'));
});

test('行や部品の箱には上下のmarginを付けず、paddingで間隔を作る', () => {
  const css = blogThemeCss({
    template: '.prose h2{margin:3.2rem 0 1rem;padding-bottom:0.45rem;border-bottom:1px solid} .prose p{margin:1.35rem 0} .prose img{margin:2rem auto} .prose a{margin:1rem}',
    theme: '',
  });
  const rule = (target: string) => css.match(new RegExp(`\\.cm-content \\${target}\\{([^}]*)\\}`))?.[1] ?? '';
  for (const target of ['.nagori-h2', '.nagori-paragraph', '.nagori-image img'])
    assert.ok(!/(?:^|;)margin(?:-top|-bottom|-block)?:/.test(rule(target)), target);
  assert.ok(rule('.nagori-h2').includes('padding-top:calc(var(--blog-rem) * 3.2);'));
  assert.ok(!rule('.nagori-h2').includes('calc(calc'));
  assert.ok(rule('.nagori-paragraph').includes('padding-top:calc(var(--blog-rem) * 1.35);padding-bottom:calc(var(--blog-rem) * 1.35);'));
  assert.ok(rule('.nagori-image img').includes('margin-inline:auto;'));
  // 行の中の文字に付く部品は、行の高さを変えないのでそのまま
  assert.ok(rule('.nagori-link').includes('margin:calc(var(--blog-rem) * 1);'));
});
