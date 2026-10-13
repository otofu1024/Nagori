import { cssLanguage } from '@codemirror/lang-css';
import type { SyntaxNode } from '@lezer/common';
import { defaults as settingDefaults } from '../workspace/settings.ts';

export type BlogTheme = { template: string; theme: string };
export const blogThemePaths = ['src/styles/template.css', 'src/theme/theme.css'];
const scope = '.editor-host[data-blog-theme]';
// 本文の部品に対応があるセレクタだけを読み替える。元のセレクタはそのまま使わない。
export const proseSelectors: Record<string, string> = {
  '.prose': '.cm-content',
  '.prose h1': '.nagori-h1',
  '.prose h2': '.nagori-h2',
  '.prose h3': '.nagori-h3',
  '.prose h4': '.nagori-h4',
  '.prose p': '.nagori-paragraph',
  '.prose blockquote': '.nagori-quote',
  '.prose a': '.nagori-link',
  '.prose a:not(.link-card)': '.nagori-link',
  '.prose code': '.nagori-code',
  '.prose code:not(pre code)': '.nagori-code',
  '.prose pre': '.nagori-code-line',
  '.prose pre code': '.nagori-code-line',
  '.prose table': '.nagori-table-wrap table',
  '.prose th': '.nagori-table-wrap th',
  '.prose td': '.nagori-table-wrap td',
  '.prose hr': '.nagori-rule',
  '.prose img': '.nagori-image img',
  '.prose strong': '.nagori-bold',
  '.prose em': '.nagori-italic',
  '.prose del': '.nagori-strike',
};
const variables: Record<string, string> = {
  text: '--color-text',
  heading: '--color-text',
  accent: '--color-accent',
  link: '--color-link',
  surface: '--color-bg',
  'surface-soft': '--color-surface',
  muted: '--color-text-muted',
  border: '--color-border',
  'code-bg': '--astro-code-background',
  'syntax-keyword': '--astro-code-token-keyword',
  'syntax-string': '--astro-code-token-string',
  'syntax-number': '--astro-code-token-constant',
  'syntax-comment': '--astro-code-token-comment',
  'syntax-function': '--astro-code-token-function',
  'syntax-type': '--astro-code-token-keyword',
  'syntax-property': '--astro-code-token-parameter',
  'editor-family': '--font-sans',
};
const defaults = `--color-bg:#fff;--color-surface:#f7f9fb;--color-text:#1e2a3f;--color-text-muted:#5b6577;--color-border:#e3e7ee;--color-accent:#099dbe;--color-link:#0a7791;--font-sans:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;--astro-code-background:var(--color-surface);--astro-code-foreground:var(--color-text);--astro-code-token-keyword:#0a7791;--astro-code-token-string:#1a7f5f;--astro-code-token-constant:#8a4b08;--astro-code-token-comment:#5b6577;--astro-code-token-function:#2b4a8b;--astro-code-token-parameter:var(--color-text);`;
// theme.cssに従うのは色、フォントの種類、リンクや引用・コード・表の飾り、見出しの太さと下線と大きさ。
// 本文の文字の大きさ(拡大縮小)、行間、段落や見出しの上下の間隔、本文の幅はNagoriに従う。
// ブログのremはNagoriの本文の文字の大きさに読み替えるので、見出しの大きさの比は拡大縮小に比例する
const blogRem = `var(--editor-font-size, ${settingDefaults.fontSize}px)`;
const scaleRem = (value: string) => value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n: string) => `calc(var(--blog-rem) * ${n})`);
// Nagoriに従う指定を落とす。marginの左右(画像の中央寄せなど)は残す
function editorOwned(ds: { name: string; value: string }[], keepSize: boolean) {
  const kept = ds.filter(
    ({ name }) => !/^(?:line-height|margin(?:-top|-bottom|-block)?|width|max-width)$/.test(name) && (keepSize || name !== 'font-size'),
  );
  const horizontal = ds.find(({ name }) => name === 'margin')?.value.split(/\s+/);
  if (horizontal && horizontal.length > 1)
    kept.push({ name: 'margin-inline', value: `${horizontal[3] ?? horizontal[1]} ${horizontal[1]}`.replace(/^(\S+) \1$/, '$1') });
  return kept;
}
const properties =
  /^(?:color|background(?:-color|-image)?|font(?:-family|-size|-weight|-style)?|line-height|letter-spacing|text-(?:align|decoration(?:-color|-thickness|-line|-style)?|underline-offset)|border(?:-(?:top|bottom|left|right|inline|block))?(?:-color|-width|-style|-radius)?|padding(?:-(?:top|bottom|left|right|inline|block))?|margin(?:-(?:top|bottom|left|right|inline|block))?|width|max-width|height|max-height|object-fit|border-collapse)$/;
function children(node: SyntaxNode) {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}
function selectors(source: string): string[] {
  source = source.trim().replace(/\s+/g, ' ');
  source = source.replace(/:where\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, '$1');
  // 関数の形のセレクタの中のカンマは扱わない。範囲を広げるより、当てない方を選ぶ。
  return source.split(',').map((value) => value.trim());
}
function mapped(selector: string) {
  const pseudo = selector.match(/:(hover|focus-visible)$/)?.[0] ?? '';
  const target = proseSelectors[pseudo ? selector.slice(0, -pseudo.length) : selector];
  return target ? `${scope} .cm-content ${target}${pseudo}`.replace('.cm-content .cm-content', '.cm-content') : null;
}

// 記事の見出しは自前の部品なので、元のクラスを見出しの入れ物の中だけで使う。
function headerSelector(selector: string) {
  if (
    !/^(?:\.article-header(?: (?:h1|time|span))?|\.article-title-line|\.article-description|\.article-dates(?: time)?|\.category-label(?:\.[\w-]+)?|\.tag-list(?: a)?)(?::(?:hover|focus-visible))?$/.test(
      selector,
    )
  )
    return null;
  return `${scope} .nagori-blog-header ${selector.startsWith('.article-header') ? selector : '.article-header ' + selector}`;
}
// 元のクラス名を部品の入れ物の中だけで使う。本文の行には広げない。
function componentSelector(selector: string) {
  const original = selector.replace(/^\.prose /, '');
  if (
    /^\.(?:link-card(?:--with-image|__[\w-]+)?|talk(?:__[\w-]+)?)(?: (?:> )?(?:img|p|a|strong|span|:[\w-]+))*?(?::(?:hover|focus-visible|first-child|last-child))?(?:::(?:before|after))?$/.test(
      original,
    )
  )
    return `${scope} .nagori-blog-component ${original}`;
  if (selector === '.prose') return `${scope} .nagori-blog-component`;
  if (
    proseSelectors[selector.replace(/:(hover|focus-visible)$/, '')] ||
    /^\.prose (?:ul|ol|li|h5|h6|blockquote > :(?:first-child|last-child))$/.test(selector)
  )
    return `${scope} .nagori-blog-component ${original}`;
  return null;
}
const componentProperties =
  /^(?:display|grid-template-columns|grid-template-rows|flex-direction|justify-content|align-items|gap|row-gap|column-gap|min-width|min-height|overflow(?:-x|-y)?|position|top|right|bottom|left|content|transform|transition|box-shadow|-webkit-box-orient|-webkit-line-clamp)$/;
const headerProperties = /^(?:display|flex-wrap|align-items|gap|row-gap|column-gap|text-wrap|line-break|overflow-wrap|word-break)$/;

export function blogThemeCss(source: BlogTheme | null): string {
  if (!source) return '';
  const imports: string[] = [],
    rules: string[] = [];
  const declarations = (node: SyntaxNode, css: string, root = false, header = false, component = false) =>
    children(node).flatMap((child) => {
      if (child.name !== 'Declaration' || children(child).some((part) => part.type.isError)) return [];
      const nameNode = child.firstChild!;
      const name = css.slice(nameNode.from, nameNode.to);
      const value = css.slice(child.getChild(':')!.to, child.to).trim();
      if (
        root
          ? !/^--(?:color-[\w-]+|font-[\w-]+|astro-code-[\w-]+)$/.test(name)
          : !(properties.test(name) || (header && headerProperties.test(name)) || (component && componentProperties.test(name)))
      )
        return [];
      return [{ name, value }];
    });
  function read(node: SyntaxNode, css: string): string {
    return children(node)
      .map((child) => {
        if (child.name === 'ImportStatement') {
          const text = css.slice(child.from, child.to);
          if (/^@import\s+(?:url\(\s*)?["']https:\/\/fonts\.googleapis\.com\//.test(text)) imports.push(text);
        } else if (child.name === 'RuleSet') {
          const block = child.getChild('Block');
          if (!block) return '';
          const from = selectors(css.slice(child.from, block.from));
          const root = from.includes(':root');
          const componentTargets = root ? [] : from.map(componentSelector).filter((target): target is string => !!target);
          const componentExtra = from.some((selector) => /^\.(?:talk|link-card)/.test(selector.replace(/^\.prose /, '')));
          const componentCss = componentTargets.length
            ? `${componentTargets.join(',')}{${declarations(block, css, false, true, componentExtra)
                .map(({ name, value }) => `${name}:${scaleRem(value)};`)
                .join('')}}`
            : '';
          const headerTargets = root ? [] : from.map(headerSelector).filter((target): target is string => !!target);
          const headerCss = headerTargets.length
            ? `${headerTargets.join(',')}{${declarations(block, css, false, true)
                .map(({ name, value }) => `${name}:${scaleRem(value)};`)
                .join('')}}`
            : '';
          const targets = root ? [scope] : from.map(mapped).filter((s): s is string => !!s);
          if (!targets.length) return headerCss + componentCss;
          const blockLines = from.includes('.prose pre') || from.includes('.prose blockquote');
          // 文字の大きさは、本文と段落ではNagoriに従い、見出しやコードなどではtheme.cssに従う
          const baseText = from.some((selector) => selector === '.prose' || selector === '.prose p');
          const ds = (root ? declarations(block, css, root) : editorOwned(declarations(block, css, root), !baseText)).map(
            ({ name, value }) => ({ name, value: scaleRem(value) }),
          );
          // CodeMirrorはブロックの入れ物ではなく行で並ぶ。余白と角丸は最初と最後の行に付ける。
          const code = from.includes('.prose pre');
          const kind = code ? 'code' : 'quote';
          const body = ds.map(({ name, value }) => `${name}:${value};`).join('');
          if (!blockLines) return headerCss + componentCss + `${targets.join(',')}{${body}}`;
          const padding = ds.find((d) => d.name === 'padding')?.value;
          const radius = ds.find((d) => d.name === 'border-radius')?.value;
          const border = ds.find((d) => d.name === 'border')?.value;
          const borderColor = ds.find((d) => d.name === 'border-color')?.value;
          return (
            headerCss +
            componentCss +
            `${targets.join(',')}{${body}${radius ? `--blog-${kind}-radius:${radius};` : ''}${code && border ? `--blog-${kind}-border:${border};` : ''}${borderColor ? `--blog-${kind}-border-color:${borderColor};` : ''}margin-block:0;padding-block:0;border-top:0;border-bottom:0;border-radius:0}` +
            `${scope} .cm-content .nagori-${kind}-first{${padding ? `padding:${padding};padding-bottom:0;` : ''}${code ? `border-top:var(--blog-code-border,0);border-top-color:var(--blog-code-border-color,currentColor);` : ''}border-radius:var(--blog-${kind}-radius,0);border-bottom-left-radius:0;border-bottom-right-radius:0}` +
            `${scope} .cm-content .nagori-${kind}-last{${padding ? `padding:${padding};padding-top:0;` : ''}${code ? `border-bottom:var(--blog-code-border,0);border-bottom-color:var(--blog-code-border-color,currentColor);` : ''}border-radius:var(--blog-${kind}-radius,0);border-top-left-radius:0;border-top-right-radius:0}` +
            `${scope} .cm-content .nagori-${kind}-first.nagori-${kind}-last{${padding ? `padding:${padding};` : ''}border-radius:var(--blog-${kind}-radius,0)}`
          );
        } else if (child.name === 'MediaStatement' || child.name === 'SupportsStatement') {
          const block = child.getChild('Block');
          if (block) {
            const body = read(block, css);
            if (body) return `${css.slice(child.from, block.from)}{${body}}`;
          }
        } else if (child.name === 'AtRule' && css.slice(child.from, child.from + 6) === '@layer') {
          const block = child.getChild('Block');
          if (block) return read(block, css);
        }
        return '';
      })
      .join('');
  }
  for (const css of [source.template, source.theme]) rules.push(read(cssLanguage.parser.parse(css).topNode, css));
  const aliases = Object.entries(variables)
    .map(([to, from]) => `--${to}:var(${from});`)
    .join('');
  return (
    imports.join('\n') +
    `\n${scope}{${defaults}${aliases}--blog-rem:${blogRem};--selection:#b6eeee;--accent-soft:#e4f8f8;color-scheme:light;color:var(--text);background:var(--surface);}` +
    `${scope} .cm-scroller{font-family:var(--editor-family)}` +
    `${scope} .cm-content .nagori-heading{background:none}` +
    `${scope} .cm-content .nagori-code-line{color:var(--astro-code-foreground)}` +
    `${scope} .cm-content :is(th,td){border:0}${scope} .cm-content th{background:transparent}` +
    rules.join('\n') +
    // ブログの差し色がとても淡くても、編集のための印は見えるようにする。
    `${scope} .cm-content .nagori-hidden-line{font-size:0;line-height:0;padding:0;margin:0;border:0}` +
    `${scope} .cm-cursor{border-left-color:var(--text)}` +
    `${scope} .cm-searchMatch{background:#ffdf80;color:var(--text)}${scope} .cm-searchMatch-selected{background:#ffc65c}`
  );
}
