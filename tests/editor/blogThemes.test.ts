import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssLanguage } from '@codemirror/lang-css';
import { blogThemes, themeName } from '../../src/lib/blogThemes/index.ts';
import { blogThemeCss } from '../../src/lib/editor/blogTheme.ts';

const css = (id: string) => readFileSync(new URL(`../../src/lib/blogThemes/${id}.css`, import.meta.url), 'utf8');
const colors = (source: string) => Object.fromEntries([...source.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const palettes = {
  mono: ['#ffffff', '#f4f4f3', '#1b1b1b', '#5c5c5c', '#e0e0de', '#1b1b1b', '#6e6e6e', '#1b1b1b'],
  washi: ['#f6f1e4', '#fbf7ee', '#2a2420', '#665a50', '#e0d5c2', '#c23b22', '#4e6b4f', '#a8321c'],
  dusk: ['#16131a', '#211c26', '#ede5dc', '#a89ea4', '#3a3140', '#ff7b45', '#e2587e', '#ff9a66'],
};
// theme-contract.mdの変数とクラス。カテゴリーキーと長さ別の修飾クラスも含める。
const variables = new Set(['color-bg', 'color-surface', 'color-text', 'color-text-muted', 'color-border', 'color-accent', 'color-accent-secondary', 'color-link', 'color-link-hover', 'font-sans', 'og-bg', 'og-text', 'og-accent', 'astro-code-foreground', 'astro-code-background', ...['comment', 'keyword', 'string', 'string-expression', 'constant', 'function', 'parameter', 'punctuation', 'link'].map(name => `astro-code-token-${name}`)].map(name => `--${name}`));
const classes = new Set(('skip-link site-header brand site-nav active hero hero-copy hero-title-rule hero-cta section-heading page-header post-row post-row-link post-main post-meta category-label post-arrow auto-cover auto-cover-title medium long auto-cover-category empty-state article article-header article-description article-dates tag-list article-cover article-footer article-pagination__link article-pagination__link--previous article-pagination__link--next article-list-link article-toc is-active article-toc__heading article-toc__divider article-toc__list--root article-toc__list--nested article-toc__number article-toc__text article-toc__arrow article-toc__reading-time article-toc__reading-label prose link-card link-card--with-image link-card__title link-card__description link-card__site link-card__image talk talk__character talk__bubble search-form search-input-row search-status search-results search-result about-grid author-note author-label not-found error-code primary-link site-footer footer-links footer-meta brand-mark section-mark auto-cover-mark article-toc__mark article-toc__leaf article-toc__reading-leaf daily tech review').split(' '));

test('テーマの一覧とカスタムの項目名', () => {
  assert.deepEqual(blogThemes.map(theme => theme.name), ['標準', 'モノクロ', '和紙', '夕闇']);
  assert.equal(themeName(null), '未登録');
  assert.equal(themeName('custom-1'), 'カスタム1');
  assert.equal(themeName('custom-12'), 'カスタム12');
  assert.equal(themeName('custom-0'), '未登録');
});
for (const theme of blogThemes) {
  test(`${theme.name}は契約の変数とクラスだけを使い、CSSとして読める`, () => {
    const source = css(theme.id), parsed = cssLanguage.parser.parse(source);
    parsed.iterate({ enter: node => {
      assert.ok(!node.type.isError, source.slice(node.from, node.to));
      if (node.name === 'VariableName') assert.ok(variables.has(source.slice(node.from, node.to)), source.slice(node.from, node.to));
      if (node.name === 'ClassSelector') for (const match of source.slice(node.from, node.to).matchAll(/\.([\w-]+)/g)) assert.ok(classes.has(match[1]), match[0]);
    } });
    assert.match(source.split('\n')[0], /^@import url\("https:\/\/fonts.googleapis.com\//);
    for (const token of ['og-bg', 'og-text', 'og-accent']) assert.equal([...source.matchAll(new RegExp(`--${token}:\\s*#[\\da-f]{6};`, 'gi'))].length, 1);
    const baseline = css('standard');
    for (const name of ['grid-template-columns', 'position', 'word-break', 'line-break', 'overflow-wrap']) {
      const declarations = (text: string) => [...text.matchAll(new RegExp(`\\b${name}:([^;]+);`, 'g'))].map(match => match[0]);
      assert.deepEqual(declarations(source), declarations(baseline));
    }
    assert.deepEqual([...source.matchAll(/@media[^\{]+/g)].map(match => match[0]), [...baseline.matchAll(/@media[^\{]+/g)].map(match => match[0]));
  });
  test(`${theme.name}の本文、補助文字、リンクとコードはAAのコントラストを満たす`, () => {
    const tokens = colors(css(theme.id));
    for (const background of ['--color-bg', '--color-surface']) {
      for (const text of ['--color-text', '--color-text-muted', '--color-link', '--color-link-hover', '--astro-code-foreground', ...['comment', 'keyword', 'string', 'string-expression', 'constant', 'function', 'parameter', 'punctuation', 'link'].map(name => `--astro-code-token-${name}`)]) {
        const ratio = contrast(tokens[text], tokens[background]);
        assert.ok(ratio >= 4.5, `${text} / ${background}: ${ratio.toFixed(2)}`);
      }
    }
    assert.ok(contrast(tokens['--og-bg'], tokens['--og-text']) >= 4.5);
  });
  test(`${theme.name}をNagoriの本文へ読み替えると編集の印と見出しのフォントを保つ`, () => {
    const source = css(theme.id), adapted = blogThemeCss({ template: '', theme: source });
    assert.ok(adapted.includes(`color-scheme:${theme.id === 'dusk' ? 'dark' : 'light'}`));
    assert.ok(adapted.includes('.cm-cursor{border-left-color:var(--text)}'));
    assert.ok(adapted.includes('--selection:color-mix(in srgb,var(--color-accent) 28%,var(--color-bg))'));
    assert.ok(adapted.includes('.cm-searchMatch{background:color-mix('));
    assert.ok(adapted.includes('outline:1px solid var(--color-accent)'));
    if (theme.id !== 'standard') assert.match(adapted, /\.nagori-h2[^\{]*\{font-family:/);
    assert.equal(blogThemeCss({ template: '', theme: source }, false), '');
  });
}
for (const [id, palette] of Object.entries(palettes)) {
  test(`${id}は決めた8色を使う`, () => {
    const tokens = colors(css(id));
    assert.deepEqual(['bg', 'surface', 'text', 'text-muted', 'border', 'accent', 'accent-secondary', 'link'].map(name => tokens[`--color-${name}`]), palette);
  });
}
test('フォントは本文と見出しで指定し、夕闇の明るい背景を残さない', () => {
  assert.match(css('mono'), /--font-sans: "Zen Kaku Gothic New"/);
  assert.match(css('washi'), /--font-sans: "Zen Old Mincho"/);
  assert.match(css('washi'), /font-family: "Shippori Mincho B1"/);
  assert.match(css('dusk'), /--font-sans: "Zen Kaku Gothic New"/);
  assert.match(css('dusk'), /font-family: "Zen Old Mincho"/);
  assert.ok(!css('dusk').includes('background: #fff'));
  assert.ok(!css('dusk').includes('rgb(255 255 255'));
});
