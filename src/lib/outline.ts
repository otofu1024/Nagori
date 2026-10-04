import type { Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { children, codeDisplay, decodeMarkdown, inlineContent } from './markdown.ts';

export type OutlineHeading = { from: number; lineEnd: number; level: number; text: string };

// 記号だけを除き、コードと数式の中の文字はそのまま残す。
export function headingText(node: SyntaxNode, doc: Text): string {
  const content = inlineContent(node);
  if (node.name === 'InlineCode') return codeDisplay(doc.sliceString(content.from, content.to));
  if (node.name === 'Autolink') return doc.sliceString(node.from + 1, node.to - 1);
  if (node.name === 'InlineMath' || node.name === 'DisplayMath') return doc.sliceString(node.from, node.to);
  let result = '', at = content.from;
  for (const child of children(node)) {
    if (child.from < content.from || child.to > content.to) continue;
    result += decodeMarkdown(doc.sliceString(at, child.from));
    if (!/^(?:HeaderMark|EmphasisMark|StrikethroughMark|CodeMark|LinkMark|LinkLabel|URL|LinkTitle)$/.test(child.name)) {
      result += headingText(child, doc);
    }
    at = child.to;
  }
  return result + decodeMarkdown(doc.sliceString(at, content.to));
}

export function extractHeadings(tree: Tree, doc: Text): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  tree.iterate({ enter(node) {
    const match = /^(?:ATXHeading|SetextHeading)([1-4])$/.exec(node.name);
    if (!match) return;
    headings.push({ from: node.from, lineEnd: doc.lineAt(node.from).to, level: Number(match[1]), text: headingText(node.node, doc).trim().replace(/\s+/g, ' ') });
    return false;
  } });
  return headings;
}

// スクロールのたびに全見出しを走査せず、本文の上端以前の最後の見出しを探す。
export function currentHeading(headings: readonly OutlineHeading[], position: number): number {
  let low = 0, high = headings.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (headings[middle].from <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
