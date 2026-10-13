import { WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { children } from './markdown.ts';
import { inlineContent, decodeMarkdown, codeDisplay, linkTarget } from './markdownInline.ts';
import { ImageWidget } from './previewImage.ts';
import { MathWidget, releaseMath, type MathContext } from './previewMath.ts';
import { inlineClasses, previewOnlyField, selectSource, type Options } from './previewState.ts';

export function renderInline(
  parent: HTMLElement,
  node: SyntaxNode,
  text: string,
  refs: Map<string, string>,
  options: Options,
  view: EditorView,
  math: MathContext,
) {
  const content = inlineContent(node);
  const kids = children(node).filter(
    (n) =>
      n.from >= content.from &&
      n.to <= content.to &&
      !/^(?:LinkMark|LinkLabel|URL|LinkTitle|EmphasisMark|CodeMark|StrikethroughMark|HeaderMark)$/.test(n.name),
  );
  let at = content.from;
  for (const child of kids) {
    if (child.from > at) parent.append(document.createTextNode(decodeMarkdown(text.slice(at, child.from))));
    const tag = (
      { StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 's', InlineCode: 'code', Link: 'span', Autolink: 'span' } as Record<
        string,
        string
      >
    )[child.name];
    const target = child.name === 'Link' || child.name === 'Autolink' ? linkTarget(child, text, refs) : null;
    if (tag && (!(child.name === 'Link') || target)) {
      const element = document.createElement(tag);
      if (inlineClasses[child.name]) element.className = inlineClasses[child.name];
      if (target) {
        element.title = `${target}（Cmd＋クリックで開く）`;
        element.addEventListener('click', (e) => {
          if (e.metaKey) {
            e.stopPropagation();
            options.onLink(target);
          }
        });
      }
      if (child.name === 'InlineCode') element.textContent = codeDisplay(text.slice(inlineContent(child).from, inlineContent(child).to));
      else renderInline(element, child, text, refs, options, view, math);
      parent.append(element);
    } else if (child.name === 'InlineMath' || child.name === 'DisplayMath') {
      parent.append(
        new MathWidget(
          child.from,
          text.slice(child.from, child.to),
          child.name === 'DisplayMath',
          math,
          view.state.field(previewOnlyField),
        ).toDOM(view),
      );
    } else if (child.name === 'Image') {
      const target = linkTarget(child, text, refs);
      if (target)
        parent.append(
          new ImageWidget(
            child.from,
            target,
            text.slice(inlineContent(child).from, inlineContent(child).to),
            options.resolveImage,
            view.state.field(previewOnlyField),
          ).toDOM(view),
        );
      else parent.append(document.createTextNode(text.slice(child.from, child.to)));
    } else if (child.name === 'HardBreak') parent.append(document.createElement('br'));
    else if (child.name === 'Escape' || child.name === 'Entity')
      parent.append(document.createTextNode(decodeMarkdown(text.slice(child.from, child.to))));
    else parent.append(document.createTextNode(text.slice(child.from, child.to)));
    at = child.to;
  }
  if (at < content.to) parent.append(document.createTextNode(decodeMarkdown(text.slice(at, content.to))));
}
export class TableWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  readonly node: SyntaxNode;
  readonly text: string;
  readonly options: Options;
  readonly refs: Map<string, string>;
  readonly math: MathContext;
  constructor(
    position: number,
    node: SyntaxNode,
    text: string,
    options: Options,
    refs: Map<string, string>,
    math: MathContext,
    previewOnly = false,
  ) {
    super();
    this.previewOnly = previewOnly;
    this.position = position;
    this.node = node;
    this.text = text;
    this.options = options;
    this.refs = refs;
    this.math = math;
  }
  eq(other: TableWidget) {
    return (
      this.position === other.position &&
      this.text.slice(this.node.from, this.node.to) === other.text.slice(other.node.from, other.node.to) &&
      JSON.stringify([...this.refs]) === JSON.stringify([...other.refs]) &&
      this.options.resolveImage === other.options.resolveImage &&
      this.math === other.math &&
      this.previewOnly === other.previewOnly
    );
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'nagori-table-wrap';
    wrapper.tabIndex = this.previewOnly ? -1 : 0;
    wrapper.setAttribute('role', this.previewOnly ? 'group' : 'button');
    wrapper.setAttribute('aria-label', this.previewOnly ? '表' : '表のMarkdownを編集');
    const table = document.createElement('table');
    const rows = children(this.node).filter((n) => n.name === 'TableHeader' || n.name === 'TableRow');
    const delimiter = children(this.node).find((n) => n.name === 'TableDelimiter');
    const align = delimiter
      ? this.text
          .slice(delimiter.from, delimiter.to)
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((s) => s.trim())
      : [];
    for (const row of rows) {
      const tr = document.createElement('tr');
      children(row)
        .filter((n) => n.name === 'TableCell')
        .forEach((cell, i) => {
          const td = document.createElement(row.name === 'TableHeader' ? 'th' : 'td');
          if (align[i]?.startsWith(':') && align[i]?.endsWith(':')) td.style.textAlign = 'center';
          else if (align[i]?.endsWith(':')) td.style.textAlign = 'right';
          renderInline(td, cell, this.text, this.refs, this.options, view, this.math);
          tr.append(td);
        });
      table.append(tr);
    }
    wrapper.append(table);
    wrapper.addEventListener('click', () => selectSource(view, this.position));
    wrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') selectSource(view, this.position);
    });
    return wrapper;
  }
  destroy(element: HTMLElement) {
    element.querySelectorAll<HTMLElement>('.nagori-math').forEach(releaseMath);
  }
  ignoreEvent() {
    return true;
  }
}
