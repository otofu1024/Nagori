import type { SyntaxNode } from '@lezer/common';
import { children } from './markdown.ts';
import { decodeMarkdown, inlineContent, linkTarget } from './markdownInline.ts';
export type LinkPreview = { url: string; hostname: string; title: string; description: string; image: string; fetchedAt?: string };
export type LinkPreviews = Record<string, LinkPreview>;
const urlPattern = /^https?:\/\/[^\s<>]+$/i;
export function standaloneUrl(node: SyntaxNode, text: string, refs: Map<string, string>): string | null {
  if (node.name !== 'Paragraph') return null;
  const parts = children(node);
  if (parts.every((part) => ['Escape', 'Entity'].includes(part.name))) {
    const value = decodeMarkdown(text.slice(node.from, node.to)).trim();
    return urlPattern.test(value) ? value : null;
  }
  if (parts.length !== 1 || !['Link', 'Autolink'].includes(parts[0].name)) return null;
  const child = parts[0];
  if (text.slice(node.from, child.from).trim() || text.slice(child.to, node.to).trim()) return null;
  const url = linkTarget(child, text, refs);
  const content = inlineContent(child);
  const label = decodeMarkdown(text.slice(content.from, content.to).replace(/^<|>$/g, '')).trim();
  return url && urlPattern.test(url) && label === url ? url : null;
}
