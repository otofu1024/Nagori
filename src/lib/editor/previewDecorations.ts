import { EditorState, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { children, intersects, touches, walk, type Span } from './markdown.ts';
import { codeDisplay, decodeMarkdown, inlineContent, linkTarget } from './markdownInline.ts';
import { TextWidget } from './previewText.ts';
import { ImageWidget } from './previewImage.ts';
import { MathWidget } from './previewMath.ts';
import { TableWidget } from './previewTable.ts';
import { decorateLists } from './previewLists.ts';
import { decorateBlocks } from './previewBlocks.ts';
import { propertiesDecoration } from './previewProperties.ts';
import { previewContext, type PreviewContext } from './previewContext.ts';
import { previewOnlyField, inlineClasses, type Options } from './previewState.ts';

export function buildPreview(state: EditorState, options: Options, context?: PreviewContext): DecorationSet {
  const previewOnly = state.field(previewOnlyField, false) ?? false;
  const { tree, text, front, refs, math } = context ?? previewContext(state),
    ranges: Range<Decoration>[] = [];
  const properties = propertiesDecoration(state, options);
  if (properties) ranges.push(properties);
  const active = (span: Span) => !previewOnly && state.selection.ranges.some((r) => touches(span, r));
  const mark = (from: number, to: number, className: string, attributes?: Record<string, string>) => {
    if (from < to) ranges.push(Decoration.mark({ class: className, attributes }).range(from, to));
  };
  // 記号は本文のDOMに残し、CSSで幅0にして隠す。replaceで消すと、変換中に未確定文字より後ろの隠し部品が作り直され、WebKitが変換中の文字を見失うため。
  // 隠した記号は支援技術に読ませない(replaceで消していた時と同じ扱い)。
  const hide = (from: number, to: number) => mark(from, to, 'nagori-hidden', { 'aria-hidden': 'true' });
  const line = (position: number, className: string) =>
    ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(position).from));
  // 項目の行は深さに応じた字下げと、折り返しの本文の位置を CSS 変数で渡す。番号付きのタスクだけ、チェックボックスの幅を足す。
  const listLine = (number: number, className: string, style: string) =>
    ranges.push(Decoration.line({ class: className, attributes: { style } }).range(state.doc.line(number).from));
  const decorationContext = { state, text, active, ranges, mark, hide, line, listLine };
  // ponytail: traverse parsed document for selection changes; index decoration candidates if measured 100KiB latency exceeds the target.
  walk(tree.topNode, (node) => {
    if (node.name !== 'Document' && front && intersects(front, node)) return false;
    if (/^(?:HTMLBlock|HTMLTag|CommentBlock|ProcessingInstructionBlock|LinkReference|MathUnclosed)$/.test(node.name)) return false;
    if (/^(?:InlineMath|DisplayMath|MathBlock)$/.test(node.name)) {
      if (!active(node)) {
        const current = state.doc.lineAt(node.from);
        const block =
          node.name === 'MathBlock' ||
          (node.name === 'DisplayMath' &&
            text.slice(current.from, node.from).trim() === '' &&
            text.slice(node.to, state.doc.lineAt(node.to).to).trim() === '');
        ranges.push(
          Decoration.replace({
            widget: new MathWidget(node.from, text.slice(node.from, node.to), node.name !== 'InlineMath', math, previewOnly),
            block,
          }).range(node.from, node.to),
        );
      }
      return false;
    }
    if (node.name === 'Table') {
      if (!active(node)) {
        ranges.push(
          Decoration.replace({ widget: new TableWidget(node.from, node, text, options, refs, math, previewOnly), block: true }).range(
            node.from,
            node.to,
          ),
        );
        return false;
      }
      line(node.from, 'nagori-table-source');
    }
    if (node.name === 'Image') {
      const ref = linkTarget(node, text, refs);
      if (ref && !active(node))
        ranges.push(
          Decoration.replace({
            widget: new ImageWidget(
              node.from,
              ref,
              text.slice(inlineContent(node).from, inlineContent(node).to),
              options.resolveImage,
              previewOnly,
            ),
          }).range(node.from, node.to),
        );
      return false;
    }
    if (inlineClasses[node.name]) {
      const target = node.name === 'Link' || node.name === 'Autolink' ? linkTarget(node, text, refs) : null;
      if (node.name === 'Link' && !target) return false;
      const content = inlineContent(node);
      mark(
        content.from,
        content.to,
        inlineClasses[node.name],
        target ? { 'data-href': target, title: `${target}（Cmd＋クリックで開く）` } : undefined,
      );
      if (!active(node)) {
        hide(node.from, content.from);
        hide(content.to, node.to);
      }
      if (node.name === 'InlineCode') {
        if (!active(node))
          ranges.push(
            Decoration.replace({
              widget: new TextWidget(codeDisplay(text.slice(content.from, content.to)), inlineClasses[node.name]),
            }).range(content.from, content.to),
          );
        return false;
      }
    }
    if (decorateBlocks(node, decorationContext, previewOnly, options.blogMode) === false) return false;
    decorateLists(node, decorationContext);
    if (options.blogMode && node.name === 'Paragraph' && node.parent?.name === 'Document') line(node.from, 'nagori-paragraph');
    if (node.name === 'Paragraph' && !active(node)) {
      const blocked: Span[] = [];
      walk(node, (child) => {
        if (child.name === 'InlineCode' || child.name === 'HardBreak' || child.name === 'DisplayMath' || child.name === 'InlineMath') {
          blocked.push(child);
          return false;
        }
      });
      for (let pos = text.indexOf('\n', node.from); pos >= 0 && pos < node.to; pos = text.indexOf('\n', pos + 1)) {
        if (!blocked.some((span) => pos >= span.from && pos < span.to))
          ranges.push(Decoration.replace({ widget: new TextWidget(' ') }).range(pos, pos + 1));
      }
    }
    if ((node.name === 'Escape' || node.name === 'Entity') && !active(node))
      ranges.push(Decoration.replace({ widget: new TextWidget(decodeMarkdown(text.slice(node.from, node.to))) }).range(node.from, node.to));
    if (node.name === 'HardBreak' && !active(node)) hide(node.from, Math.min(node.to, state.doc.lineAt(node.from).to));
  });
  return Decoration.set(ranges, true);
}
