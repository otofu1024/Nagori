import { parser, Table, TaskList, Strikethrough, type MarkdownConfig } from '@lezer/markdown';
import { TreeFragment, type SyntaxNode, Tree, type Input, type ChangedRange } from '@lezer/common';
import type { ChangeDesc } from '@codemirror/state';
import { mathExtension } from './markdownMath.ts';

// Front Matterは、先頭の --- から閉じの --- までを1つの葉のブロックとして扱う。
// 入力を空白に置き換えて別のパーサーで読むと、言語の木の型が変わり、CodeMirrorの言語判定(isActiveAt)が効かなくなるため、この方法は取らない。
const frontMatterBlock: MarkdownConfig = {
  defineNodes: [{ name: 'FrontMatter', block: true }],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^(?:\uFEFF)?---\r?$/.test(line.text)) return false;
        // 閉じの位置を先に確かめるため、解析中の入力を読む(公開型には無い)。閉じがなければ通常の本文として扱う
        const input = (cx as unknown as { input: Input }).input;
        const front = frontMatter(input.read(0, input.length));
        if (!front) return false;
        while (cx.nextLine() && cx.lineStart < front.to);
        cx.addElement(cx.elt('FrontMatter', 0, cx.prevLineEnd()));
        return true;
      },
    },
  ],
};
export const markdownExtensions = [Table, TaskList, Strikethrough, mathExtension, frontMatterBlock];
export const markdownParser = parser.configure(markdownExtensions);
// markdownParserで作った木だけを差分解析の材料にする。CodeMirror側の木はノード型の集合が異なる
const ownTree = (tree: Tree) => markdownParser.nodeSet.types[tree.type.id] === tree.type;
export function parseChanged(previous: Tree, text: string, ranges: ChangedRange[]): Tree {
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
