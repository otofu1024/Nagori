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
  assert.ok(!css.includes('--editor-width'));
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
  assert.ok(!css.includes('font-size:18px'));
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
  // 2行の引用は表示の上で1行につながるので、最後の印も1行目に付く
  assert.ok(blog.some((d) => d.class === 'nagori-quote-last' && d.from === text.indexOf('> 引用')));
  assert.ok(!generic.some((d) => /nagori-(?:paragraph|code-first|code-last|quote-first|quote-last)/.test(d.class)));
  assert.equal(state.doc.toString(), text);
});

test('拡大縮小の文字の大きさを上書きせず、見出しの大きさの比だけをtheme.cssに従わせる', () => {
  const css = blogThemeCss({ template: '.prose{font-size:1rem} .prose p{font-size:17px}', theme: ':where(.prose h2){font-size:1.5rem}' });
  assert.ok(!css.includes('--editor-font-size:'));
  assert.ok(!/\d(?:\.\d+)?rem\b/.test(css.replace(/@import[^\n]*/g, '')));
  assert.ok(css.includes('--blog-rem:var(--editor-font-size, 19px)'));
  assert.ok(css.includes('.nagori-h2{font-size:calc(var(--blog-rem) * 1.5);'));
  assert.ok(!css.includes('font-size:17px'));
  assert.ok(!css.includes('.cm-content{font-size'));
});

test('行間、上下の間隔、本文の幅はNagoriに従い、飾りの内側の余白はtheme.cssに従う', () => {
  const css = blogThemeCss({
    template:
      '.article-layout{grid-template-columns:minmax(0,740px) 200px} .prose{line-height:2;max-width:700px} .prose h2{margin:3.2rem 0 1rem;padding-bottom:0.45rem;border-bottom:1px solid;line-height:1.5} .prose p{margin:1.35rem 0} .prose img{margin:2rem auto} .prose blockquote{margin:2rem 0;padding:1.1rem 1.25rem}',
    theme: '',
  });
  for (const excluded of ['line-height:2', 'line-height:1.5', 'max-width', '--editor-width', 'margin:', 'margin-top', 'margin-bottom'])
    assert.ok(!css.replace(/\.nagori-hidden-line\{[^}]*\}/, '').includes(excluded), excluded);
  assert.ok(css.includes('.nagori-h2{padding-bottom:calc(var(--blog-rem) * 0.45);border-bottom:1px solid;'));
  assert.ok(css.includes('.nagori-image img{margin-inline:auto;'));
  assert.ok(css.includes('.nagori-quote-first{padding:calc(var(--blog-rem) * 1.1) calc(var(--blog-rem) * 1.25);padding-bottom:0;'));
});

test('段落の改行を1行につないだ引用でも、表示の上の最後の行に引用の最後の印を付ける', async () => {
  const { editor, options } = await import('./previewFixture.ts');
  const { buildPreview } = await import('../../src/lib/editor/previewDecorations.ts');
  const text = '前\n\n> [!NAGORI]\n> キャラクター\n\n> 段落一\n>\n> 段落二の一\n> 段落二の二\n\n終わり';
  const state = editor(text);
  const lines = (name: string) => {
    const found: number[] = [];
    buildPreview(state, { ...options, blogMode: true }).between(0, text.length, (from, _to, value) => {
      if (value.spec.class === name) found.push(state.doc.lineAt(from).number);
    });
    return found;
  };
  assert.deepEqual(lines('nagori-quote-first'), [3, 6]);
  assert.deepEqual(lines('nagori-quote-last'), [3, 8]);
});
