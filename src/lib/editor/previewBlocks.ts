import { Decoration } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { children } from './markdown.ts';
import { RuleWidget } from './previewText.ts';
import type { DecorationContext } from './previewState.ts';

export function decorateBlocks(node: SyntaxNode, context: DecorationContext, previewOnly: boolean) {
  const { state, text, active, ranges, line, hide } = context;
  const hideMarker = (node: SyntaxNode) => {
    const current = state.doc.lineAt(node.from);
    if (!active(current)) {
      let end = node.to;
      if (text[end] === ' ') end++;
      hide(node.from, end);
    }
  };
  if (/^(?:ATXHeading|SetextHeading)/.test(node.name)) {
    const level = Number(node.name.at(-1));
    line(node.from, `nagori-heading nagori-h${level}`);
    if (level <= 3) {
      const last = state.doc.lineAt(node.to);
      const rule = node.name.startsWith('Setext') && !active(node) ? state.doc.line(last.number - 1) : last;
      line(rule.from, 'nagori-heading-rule');
    }
    if (!active(node))
      for (const part of children(node).filter((n) => n.name === 'HeaderMark')) {
        // 下線の行は改行を残したまま行の高さを0にする。改行まで消すと前の行と同じDOMに統合され、変換中の行が作り直される。
        if (node.name.startsWith('Setext')) line(part.from, 'nagori-hidden-line');
        else {
          let end = part.to;
          if (part.from === node.from && text[end] === ' ') end++;
          hide(part.from, end);
        }
      }
  }
  if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
    const first = state.doc.lineAt(node.from),
      last = state.doc.lineAt(node.to);
    for (let n = first.number; n <= last.number; n++) line(state.doc.line(n).from, 'nagori-code-line');
    if (node.name === 'FencedCode' && !active(node)) {
      const marks = children(node).filter((n) => n.name === 'CodeMark');
      for (const part of marks) line(part.from, 'nagori-hidden-line');
    }
    return false;
  }
  if (node.name === 'HorizontalRule') {
    if (!active(node))
      ranges.push(Decoration.replace({ widget: new RuleWidget(node.from, previewOnly), block: true }).range(node.from, node.to));
    return false;
  }
  if (node.name === 'Blockquote') {
    for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++)
      line(state.doc.line(n).from, 'nagori-quote');
  }
  if (node.name === 'QuoteMark') hideMarker(node);
}
