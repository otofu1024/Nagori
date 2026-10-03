import { parser, Table, TaskList, Strikethrough } from '@lezer/markdown';
import { TreeFragment, type SyntaxNode, Tree, type Input, type ChangedRange } from '@lezer/common';
import type { ChangeDesc } from '@codemirror/state';
import { mathExtension } from './markdownMath.ts';
import type { FormatKind } from './editor.ts';

const baseParser = parser.configure([Table, TaskList, Strikethrough, mathExtension]);
export const markdownExtensions = [Table, TaskList, Strikethrough, mathExtension, { wrap: (_inner: unknown, input: Input) => {
  const start = input.read(0, Math.min(input.length, 6));
  const front = /^(?:\uFEFF)?---\r?\n/.test(start) ? frontMatter(input.read(0, input.length)) : null;
  if (!front) return _inner as ReturnType<typeof baseParser.startParse>;
  // Front Matter stays source, and its closing --- must not turn metadata into a Setext heading.
  // ponytail: front matter reparses this document; add a fragment-aware block parser if measured input latency exceeds the target.
  const read = (from: number, to: number) => input.read(from, Math.min(to, Math.max(from, front.to))).replace(/[^\r\n]/g, ' ') + input.read(Math.min(to, Math.max(from, front.to)), to);
  return baseParser.startParse({ length: input.length, lineChunks: false, read, chunk: from => read(from, Math.min(input.length, from + 4096)) });
} }];
export const markdownParser = parser.configure(markdownExtensions);
// markdownParserで作った木だけを差分解析の材料にする。CodeMirror側の木はノード型の集合が異なる
const ownTree = (tree: Tree) => markdownParser.nodeSet.types[tree.type.id] === tree.type;
function parseChanged(previous: Tree, text: string, ranges: ChangedRange[]): Tree {
  return markdownParser.parse(text, ownTree(previous) ? TreeFragment.applyChanges(TreeFragment.addTree(previous), ranges) : undefined);
}
// 前回の木と変更内容から、変わった部分だけを解析し直す
export function reparse(previous: Tree, text: string, changes: ChangeDesc): Tree {
  const ranges: ChangedRange[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({ fromA, toA, fromB, toB }));
  return parseChanged(previous, text, ranges);
}
export type Span = { from: number; to: number };
export const touches = (span: Span, selection: Span) => selection.from <= span.to && selection.to >= span.from;
export const intersects = (a: Span, b: Span) => a.from < b.to && b.from < a.to;
export function frontMatter(text: string): Span | null {
  const match = /^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  return match ? { from: 0, to: match[0].length } : null;
}
export function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}
export function walk(node: SyntaxNode, visit: (node: SyntaxNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of children(node)) walk(child, visit);
}
export function decodeMarkdown(text: string): string {
  const unescaped = text.replace(/\\([!\"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
  if (typeof document !== 'undefined' && unescaped.includes('&')) {
    const area = document.createElement('textarea');
    // Escape angle brackets before asking the native HTML entity decoder; document HTML is never inserted.
    area.innerHTML = unescaped.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return area.value;
  }
  return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()] ?? whole;
    const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\uFFFD';
  });
}
export const normalizeLabel = (label: string) => decodeMarkdown(label.replace(/^\[|\]$/g, '')).trim().replace(/\s+/g, ' ').toLowerCase();
export function references(tree: Tree, text: string): Map<string, string> {
  const result = new Map<string, string>();
  const front = frontMatter(text);
  walk(tree.topNode, node => {
    if (front && intersects(front, node) && node.name !== 'Document') return false;
    if (node.name === 'LinkReference') {
      const parts = children(node), label = parts.find(p => p.name === 'LinkLabel'), url = parts.find(p => p.name === 'URL');
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
  const parts = children(node), url = parts.find(p => p.name === 'URL');
  if (url) return decodeMarkdown(text.slice(url.from, url.to).replace(/^<|>$/g, ''));
  const label = parts.find(p => p.name === 'LinkLabel');
  const raw = text.slice(node.from, node.to);
  let key = label ? text.slice(label.from, label.to) : '';
  if (!key || key === '[]') key = raw.replace(/^!?\[/, '').replace(/\](?:\[\])?$/, '');
  return refs.get(normalizeLabel(key)) ?? null;
}
export function inlineContent(node: SyntaxNode): Span {
  const marks = children(node).filter(p => /^(?:EmphasisMark|StrikethroughMark|CodeMark|LinkMark)$/.test(p.name));
  if (!marks.length) return { from: node.from, to: node.to };
  if (node.name === 'Link' || node.name === 'Image') {
    const close = marks.find(p => p.from > marks[0].from && p.name === 'LinkMark');
    return { from: marks[0].to, to: close?.from ?? node.to };
  }
  return { from: marks[0].to, to: marks[marks.length - 1].from };
}
const formatNode = { bold: 'StrongEmphasis', italic: 'Emphasis', strike: 'Strikethrough', code: 'InlineCode', link: 'Link' };
const decorated = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link', 'Image']);
export type FormatPlan = { reason?: string; from: number; to: number; text: string; selection: Span; existingLink?: string; linkText?: string };
// treeを渡すと、変更後の本文もその木からの差分解析で確かめる(表示用)。省略すると全文解析で確かめる(本文を変える時用)
export function formatPlan(text: string, selection: Span, kind: FormatKind, given?: Tree): FormatPlan {
  const tree = given ?? markdownParser.parse(text);
  const denied = (reason: string): FormatPlan => ({ reason, ...selection, text: '', selection });
  if (selection.from === selection.to) return denied('テキストを選択してください');
  const front = frontMatter(text);
  if (front && intersects(front, selection)) return denied('Front Matterはソースのまま編集してください');
  const nodes: SyntaxNode[] = [];
  walk(tree.topNode, node => { if (intersects(node, selection)) nodes.push(node); else if (node.name !== 'Document') return false; });
  if (nodes.some(n => /^(?:InlineMath|DisplayMath|MathBlock|MathUnclosed)$/.test(n.name))) return denied('数式は元のLaTeX記法で編集してください');
  if (nodes.some(n => n.name === 'TaskMarker')) return denied('チェック記号を除いて選択してください');
  if (nodes.some(n => /^(?:FencedCode|CodeBlock|HTMLBlock|HTMLTag|Table|LinkReference)$/.test(n.name))) return denied('コード・表・HTML・参照定義内には適用できません');
  const blocks = nodes.filter(n => n.name === 'Paragraph' || n.name === 'Task' || /^(?:ATXHeading|SetextHeading)/.test(n.name));
  if (blocks.length !== 1 || selection.to > blocks[0].to || (selection.from < blocks[0].from && !/^[ \t]{0,3}$/.test(text.slice(selection.from, blocks[0].from)))) return denied('単一段落内を選択してください');
  const formats = nodes.filter(n => decorated.has(n.name));
  const target = formats.find(n => {
    if (n.name !== formatNode[kind]) return false;
    const content = inlineContent(n), raw = text.slice(content.from, content.to);
    const trim = kind === 'code' && raw.startsWith(' ') && raw.endsWith(' ') && /\S/.test(raw) ? 1 : 0;
    return (selection.from === n.from && selection.to === n.to) || (selection.from === content.from && selection.to === content.to) || (selection.from === content.from + trim && selection.to === content.to - trim);
  });
  if (target && formats.length === 1) {
    const content = inlineContent(target); let plain = text.slice(content.from, content.to);
    if (kind === 'code' && plain.startsWith(' ') && plain.endsWith(' ') && /\S/.test(plain)) plain = plain.slice(1, -1);
    return { from: target.from, to: target.to, text: plain, selection: { from: target.from, to: target.from + plain.length }, ...(kind === 'link' ? { existingLink: linkTarget(target, text, references(tree, text)) ?? '', linkText: plain } : {}) };
  }
  if (formats.length) return denied('装飾境界をまたぐ選択や混在した装飾は変更できません');
  const plain = text.slice(selection.from, selection.to);
  if (kind === 'link') return { ...selection, text: plain, selection, linkText: plain };
  if (kind === 'code') {
    if (plain.includes('\n')) return denied('Inline Codeは単一行だけに適用できます');
    const runs = [...plain.matchAll(/`+/g)].map(m => m[0].length), delimiter = '`'.repeat(Math.max(0, ...runs) + 1);
    const padding = plain.startsWith('`') || plain.endsWith('`') || (plain.startsWith(' ') && plain.endsWith(' ') && /\S/.test(plain)) ? ' ' : '';
    const insert = delimiter + padding + plain + padding + delimiter;
    return { ...selection, text: insert, selection: { from: selection.from + delimiter.length + padding.length, to: selection.from + delimiter.length + padding.length + plain.length } };
  }
  if (!plain.trim() || /^\s|\s$/.test(plain)) return denied('装飾する文字の前後の空白を除いて選択してください');
  const delimiter = kind === 'bold' ? '**' : kind === 'italic' ? '*' : '~~';
  const insert = delimiter + plain + delimiter;
  // Reject surrounding delimiter interactions rather than guessing how CommonMark will regroup them.
  const changed = text.slice(0, selection.from) + insert + text.slice(selection.to);
  let valid = false;
  const checked = given ? parseChanged(given, changed, [{ fromA: selection.from, toA: selection.to, fromB: selection.from, toB: selection.from + insert.length }]) : markdownParser.parse(changed);
  walk(checked.topNode, n => { if (n.name === formatNode[kind] && n.from === selection.from && n.to === selection.from + insert.length) valid = true; });
  if (!valid) return denied('周囲のMarkdown記号と衝突するため適用できません');
  return { ...selection, text: insert, selection: { from: selection.from + delimiter.length, to: selection.from + delimiter.length + plain.length } };
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
  return `[${label.replace(/[\\\[\]]/g, '\\$&')}](<${clean.replace(/[<>]/g, c => c === '<' ? '%3C' : '%3E').replace(/\\/g, '%5C')}>)`;
}
