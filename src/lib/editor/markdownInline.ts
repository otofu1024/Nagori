import type { SyntaxNode, Tree } from '@lezer/common';
import { children, frontMatter, intersects, walk, type Span } from './markdown.ts';

export function decodeMarkdown(text: string): string {
  const unescaped = text.replace(/\\([!\"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
  if (typeof document !== 'undefined' && unescaped.includes('&')) {
    const area = document.createElement('textarea');
    // Escape angle brackets before asking the native HTML entity decoder; document HTML is never inserted.
    area.innerHTML = unescaped.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return area.value;
  }
  return text
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
      if (entity[0] !== '#')
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()] ?? whole;
      const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\uFFFD';
    });
}
const normalizeLabel = (label: string) =>
  decodeMarkdown(label.replace(/^\[|\]$/g, ''))
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
export function references(tree: Tree, text: string): Map<string, string> {
  const result = new Map<string, string>();
  const front = frontMatter(text);
  walk(tree.topNode, (node) => {
    if (front && intersects(front, node) && node.name !== 'Document') return false;
    if (node.name === 'LinkReference') {
      const parts = children(node),
        label = parts.find((p) => p.name === 'LinkLabel'),
        url = parts.find((p) => p.name === 'URL');
      if (label && url) {
        const key = normalizeLabel(text.slice(label.from, label.to));
        if (!result.has(key)) result.set(key, decodeMarkdown(text.slice(url.from, url.to).replace(/^<|>$/g, '')));
      }
      return false;
    }
  });
  return result;
}
export function linkTarget(node: SyntaxNode, text: string, refs: Map<string, string>): string | null {
  const parts = children(node),
    url = parts.find((p) => p.name === 'URL');
  if (url) return decodeMarkdown(text.slice(url.from, url.to).replace(/^<|>$/g, ''));
  const label = parts.find((p) => p.name === 'LinkLabel');
  const raw = text.slice(node.from, node.to);
  let key = label ? text.slice(label.from, label.to) : '';
  if (!key || key === '[]') key = raw.replace(/^!?\[/, '').replace(/\](?:\[\])?$/, '');
  return refs.get(normalizeLabel(key)) ?? null;
}
export function inlineContent(node: SyntaxNode): Span {
  const marks = children(node).filter((p) => /^(?:EmphasisMark|StrikethroughMark|CodeMark|LinkMark)$/.test(p.name));
  if (!marks.length) return { from: node.from, to: node.to };
  if (node.name === 'Link' || node.name === 'Image') {
    const close = marks.find((p) => p.from > marks[0].from && p.name === 'LinkMark');
    return { from: marks[0].to, to: close?.from ?? node.to };
  }
  return { from: marks[0].to, to: marks[marks.length - 1].from };
}
export function codeDisplay(text: string): string {
  const value = text.replace(/\r?\n/g, ' ');
  return value.startsWith(' ') && value.endsWith(' ') && /\S/.test(value) ? value.slice(1, -1) : value;
}
export function linkMarkdown(label: string, url: string): string {
  const clean = url.trim();
  if (!clean || /[\r\n\u0000-\u001f]/.test(clean)) throw new Error('改行や制御文字を含まない参照先を入力してください');
  if (/^[a-z][a-z\d+.-]*:/i.test(clean) && !/^https?:\/\//i.test(clean)) throw new Error('外部リンクはHTTP / HTTPSだけ利用できます');
  if (/[\r\n]/.test(label)) throw new Error('リンクの表示テキストは単一行にしてください');
  return `[${label.replace(/[\\\[\]]/g, '\\$&')}](<${clean.replace(/[<>]/g, (c) => (c === '<' ? '%3C' : '%3E')).replace(/\\/g, '%5C')}>)`;
}
