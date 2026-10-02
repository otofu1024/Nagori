import type { MarkdownConfig, InlineContext } from '@lezer/markdown';
import type { SyntaxNode, Tree } from '@lezer/common';

export const MAX_MATH_LENGTH = 8192;
export type MathExpression = { from: number; to: number; source: string; expression: string; display: boolean };
export function mathExpressions(tree: Tree, text: string): MathExpression[] {
  const result: MathExpression[] = [];
  const visit = (node: SyntaxNode) => {
    if (/^(?:HTMLBlock|HTMLTag|CommentBlock|ProcessingInstructionBlock|LinkReference|InlineCode|FencedCode|CodeBlock|MathUnclosed)$/.test(node.name)) return;
    if (/^(?:InlineMath|DisplayMath|MathBlock)$/.test(node.name)) {
      const source = text.slice(node.from, node.to);
      let expression: string;
      if (node.name === 'MathBlock') {
        const lines: string[] = [];
        for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === 'MathContent') lines.push(text.slice(child.from, child.to));
        expression = lines.join('\n').trim();
      } else expression = source.slice(source.startsWith('$$') || source.startsWith('\\') ? 2 : 1, source.startsWith('$') && !source.startsWith('$$') ? -1 : -2).trim();
      result.push({ from: node.from, to: node.to, source, expression, display: node.name !== 'InlineMath' }); return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(tree.topNode); return result;
}

export const mathExtension: MarkdownConfig = {
  defineNodes: ['InlineMath', 'DisplayMath', 'MathMark', 'MathContent', { name: 'MathBlock', block: true }, { name: 'MathUnclosed', block: true }],
  parseBlock: [{ name: 'MathBlock', before: 'HorizontalRule', parse(cx, line) {
    const open = line.text.slice(line.pos).trimEnd();
    if (open !== '$$' && open !== '\\[') return false;
    const close = open === '$$' ? '$$' : '\\]', from = cx.lineStart + line.pos;
    const marks = [cx.elt('MathMark', from, from + 2)];
    let closed = false;
    while (cx.nextLine()) {
      if (line.text.slice(line.pos).trim() === close) { marks.push(cx.elt('MathMark', cx.lineStart + line.pos, cx.lineStart + line.pos + 2)); closed = true; cx.nextLine(); break; }
      marks.push(cx.elt('MathContent', cx.lineStart + line.pos, cx.lineStart + line.text.length));
      if (cx.lineStart + line.text.length - from > MAX_MATH_LENGTH + 4) { cx.nextLine(); break; }
    }
    cx.addElement(cx.elt(closed ? 'MathBlock' : 'MathUnclosed', from, cx.prevLineEnd(), marks));
    return true;
  } }],
  parseInline: [{ name: 'Math', before: 'Escape', parse(cx: InlineContext, next, pos) {
    let open: string, close: string, display: boolean;
    if (next === 36) {
      display = cx.char(pos + 1) === 36; open = close = display ? '$$' : '$';
      // Keep monetary prose such as "$5 and $10" and spaced dollar signs as text.
      if (!display && (/\s/.test(cx.slice(pos + 1, pos + 2)) || cx.char(pos - 1) === 36)) return -1;
    } else if (next === 92 && (cx.char(pos + 1) === 40 || cx.char(pos + 1) === 91)) {
      display = cx.char(pos + 1) === 91; open = display ? '\\[' : '\\('; close = display ? '\\]' : '\\)';
    } else return -1;
    const start = pos + open.length, limit = Math.min(cx.end, start + MAX_MATH_LENGTH + close.length);
    for (let at = start; at < limit; at++) {
      if (cx.char(at) === 10) break; // Multiline displays use the block parser, preserving quote/list prefixes.
      if (cx.slice(at, at + close.length) === close) {
        if (at === start || (!display && (/\s/.test(cx.slice(at - 1, at)) || /\d/.test(cx.slice(at + 1, at + 2))))) return -1;
        const end = at + close.length;
        return cx.addElement(cx.elt(display ? 'DisplayMath' : 'InlineMath', pos, end, [cx.elt('MathMark', pos, start), cx.elt('MathMark', at, end)]));
      }
      if (cx.char(at) === 92) at++; // Escaped dollar/closing delimiters belong to the TeX source.
    }
    return -1;
  } }],
};
