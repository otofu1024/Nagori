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
// 行の中の文字だけに付く部品。これ以外は行や部品の箱になる
const inlineTargets = ['.nagori-link', '.nagori-code', '.nagori-bold', '.nagori-italic', '.nagori-strike'];
// ブログのremは、Nagoriの拡大縮小の標準の大きさの時に16pxになるよう、文字の大きさに比例させる
const blogRem = `calc(var(--editor-font-size, ${settingDefaults.fontSize}px) * ${16 / settingDefaults.fontSize})`;
const scaleRem = (value: string) => value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n: string) => `calc(var(--blog-rem) * ${n})`);
// marginの上下を取り出す。shorthandの1〜4個の値に対応する
function verticalSpacing(ds: { name: string; value: string }[], kind: 'margin' | 'padding') {
  let top: string | undefined, bottom: string | undefined;
  for (const { name, value } of ds) {
    if (name === kind) {
      const parts = value.split(/\s+/);
      top = parts[0];
      bottom = parts[2] ?? parts[0];
    } else if (name === `${kind}-block`) {
      const parts = value.split(/\s+/);
      top = parts[0];
      bottom = parts[1] ?? parts[0];
    } else if (name === `${kind}-top`) top = value;
    else if (name === `${kind}-bottom`) bottom = value;
  }
  return { top, bottom };
}
// CodeMirrorは行の高さを測って矢印キーの移動先を決めるので、行や部品の箱に上下のmarginがあると測り違える。
// 上下のmarginはpaddingに足して同じ間隔を作る。見出しの下線より下の間隔は、線と文字が離れないよう落とす
function lineSafe(ds: { name: string; value: string }[], underline: boolean) {
  const margin = verticalSpacing(ds, 'margin');
  const kept = ds.filter(({ name }) => !/^margin(?:-top|-bottom|-block)?$/.test(name));
  if (!margin.top && !margin.bottom) return kept;
  const padding = verticalSpacing(ds, 'padding');
  const sum = (a?: string, b?: string) => (a && b ? `calc(${a} + ${b})` : (a ?? b ?? '0'));
  const horizontal = ds.find(({ name }) => name === 'margin')?.value.split(/\s+/);
  if (horizontal && horizontal.length > 1) kept.push({ name: 'margin-inline', value: `${horizontal[3] ?? horizontal[1]} ${horizontal[1]}`.replace(/^(\S+) \1$/, '$1') });
  kept.push({ name: 'padding-top', value: sum(padding.top, margin.top) });
  if (!underline) kept.push({ name: 'padding-bottom', value: sum(padding.bottom, margin.bottom) });
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
  if (source.startsWith(':where(') && source.endsWith(')')) source = source.slice(7, -1);
  // 関数の形のセレクタの中のカンマは扱わない。範囲を広げるより、当てない方を選ぶ。
  return source.split(',').map((value) => value.trim());
}
function mapped(selector: string) {
  const pseudo = selector.match(/:(hover|focus-visible)$/)?.[0] ?? '';
  const target = proseSelectors[pseudo ? selector.slice(0, -pseudo.length) : selector];
  return target ? `${scope} .cm-content ${target}${pseudo}`.replace('.cm-content .cm-content', '.cm-content') : null;
}

export function blogThemeCss(source: BlogTheme | null): string {
  if (!source) return '';
  const imports: string[] = [],
    rules: string[] = [];
  const declarations = (node: SyntaxNode, css: string, root = false) =>
    children(node).flatMap((child) => {
      if (child.name !== 'Declaration' || children(child).some((part) => part.type.isError)) return [];
      const nameNode = child.firstChild!;
      const name = css.slice(nameNode.from, nameNode.to);
      const value = css.slice(child.getChild(':')!.to, child.to).trim();
      if (root ? !/^--(?:color-[\w-]+|font-[\w-]+|astro-code-[\w-]+)$/.test(name) : !properties.test(name)) return [];
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
          const targets = root ? [scope] : from.map(mapped).filter((s): s is string => !!s);
          if (!targets.length) {
            // グリッドの1列目が、目次を除いたブログの記事の本文の幅になる。
            if (from.includes('.article-layout')) {
              const declaration = children(block).find(
                (n) => n.name === 'Declaration' && css.slice(n.firstChild!.from, n.firstChild!.to) === 'grid-template-columns',
              );
              const width =
                declaration && css.slice(declaration.from, declaration.to).match(/minmax\(\s*0\s*,\s*([\d.]+(?:px|rem|em))\s*\)/)?.[1];
              if (width) return `${scope}{--editor-width:${width}}`;
            }
            return '';
          }
          const blockLines = from.includes('.prose pre') || from.includes('.prose blockquote');
          const inline = targets.every((target) => inlineTargets.some((name) => target.endsWith(name)));
          const underline = from.some((selector) => /^\.prose h[1-6]$/.test(selector));
          const ds = (root || inline || blockLines ? declarations(block, css, root) : lineSafe(declarations(block, css, root), underline)).map(
            ({ name, value }) => ({ name, value: scaleRem(value) }),
          );
          // CodeMirrorはブロックの入れ物ではなく行で並ぶ。余白と角丸は最初と最後の行に付ける。
          const code = from.includes('.prose pre');
          const kind = code ? 'code' : 'quote';
          const body = ds.map(({ name, value }) => `${name}:${value};`).join('');
          if (!blockLines) return `${targets.join(',')}{${body}}`;
          const padding = ds.find((d) => d.name === 'padding')?.value;
          const radius = ds.find((d) => d.name === 'border-radius')?.value;
          const border = ds.find((d) => d.name === 'border')?.value;
          const borderColor = ds.find((d) => d.name === 'border-color')?.value;
          return (
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
    `\n${scope}{${defaults}${aliases}--editor-width:740px;--blog-rem:${blogRem};--selection:#b6eeee;--accent-soft:#e4f8f8;color-scheme:light;color:var(--text);background:var(--surface);}` +
    `${scope} .cm-scroller{font-family:var(--editor-family)}` +
    `${scope} .cm-content{font-size:var(--blog-rem);line-height:2;--nagori-list-indent:calc(var(--editor-font-size) * 1.6)}` +
    `${scope} .cm-content .nagori-heading{padding-top:0;background:none}` +
    `${scope} .cm-content .nagori-code-line{color:var(--astro-code-foreground)}` +
    `${scope} .cm-content :is(th,td){border:0}${scope} .cm-content th{background:transparent}` +
    rules.join('\n') +
    // ブログの差し色がとても淡くても、編集のための印は見えるようにする。
    `${scope} .cm-content .nagori-hidden-line{font-size:0;line-height:0;padding:0;margin:0;border:0}` +
    `${scope} .cm-cursor{border-left-color:var(--text)}` +
    `${scope} .cm-searchMatch{background:#ffdf80;color:var(--text)}${scope} .cm-searchMatch-selected{background:#ffc65c}`
  );
}
