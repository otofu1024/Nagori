import { mathExpressions, type MathExpression } from './markdownMath.ts';
import type { MathRender } from './mathjax.ts';
import { countDiscard } from './mathStats.ts';
import { StateEffect, StateField, EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode, Tree } from '@lezer/common';
import { children, codeDisplay, decodeMarkdown, frontMatter, inlineContent, intersects, linkTarget, markdownParser, references, touches, walk, type Span } from './markdown.ts';

export const refreshImagesEffect = StateEffect.define<void>();
export const previewOnlyMode = StateEffect.define<boolean>();
export const compositionMode = StateEffect.define<boolean>();
export const previewOnlyField = StateField.define({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => e.is(previewOnlyMode) ? e.value : v, value),
  provide: field => [
    EditorState.readOnly.computeN([field], state => state.field(field) ? [true] : []),
    EditorView.editable.computeN([field], state => state.field(field) ? [false] : []),
  ],
});
const compositionField = StateField.define({ create: () => false, update: (value, tr) => tr.effects.reduce((v, e) => e.is(compositionMode) ? e.value : v, value) });
type Options = { resolveImage(reference: string): Promise<string>; onLink(href: string): void };
const inlineClasses: Record<string, string> = { StrongEmphasis: 'nagori-bold', Emphasis: 'nagori-italic', Strikethrough: 'nagori-strike', InlineCode: 'nagori-code', Link: 'nagori-link', Autolink: 'nagori-link' };
function selectSource(view: EditorView, position: number) {
  if (view.state.field(previewOnlyField)) return;
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'nearest' }) });
  view.focus();
}
class TextWidget extends WidgetType {
  readonly value: string;
  readonly className: string;
  constructor(value: string, className = 'nagori-list-marker') { super(); this.value = value; this.className = className; }
  eq(other: TextWidget) { return this.value === other.value && this.className === other.className; }
  toDOM() { const span = document.createElement('span'); span.textContent = this.value; span.className = this.className; return span; }
  ignoreEvent() { return false; }
}
class TaskWidget extends WidgetType {
  readonly position: number;
  readonly checked: boolean;
  readonly disabled: boolean;
  constructor(position: number, checked: boolean, disabled: boolean) { super(); this.position = position; this.checked = checked; this.disabled = disabled; }
  eq(other: TaskWidget) { return this.position === other.position && this.checked === other.checked && this.disabled === other.disabled; }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked; input.disabled = this.disabled; input.setAttribute('aria-label', 'タスクを完了にする');
    input.addEventListener('mousedown', e => e.preventDefault());
    input.addEventListener('change', () => {
      if (view.state.readOnly || view.composing) return;
      view.dispatch({ changes: { from: this.position + 1, to: this.position + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input' }); view.focus();
    });
    return input;
  }
}
class RuleWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  constructor(position: number, previewOnly = false) { super(); this.previewOnly = previewOnly; this.position = position; }
  eq(other: RuleWidget) { return this.position === other.position && this.previewOnly === other.previewOnly; }
  toDOM(view: EditorView) { const hr = document.createElement('hr'); hr.className = 'nagori-rule'; hr.addEventListener('click', () => selectSource(view, this.position)); return hr; }
  ignoreEvent() { return true; }
}
class ImageWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  readonly ref: string;
  readonly alt: string;
  readonly resolveImage: Options['resolveImage'];
  constructor(position: number, ref: string, alt: string, resolveImage: Options['resolveImage'], previewOnly = false) { super(); this.previewOnly = previewOnly; this.position = position; this.ref = ref; this.alt = alt; this.resolveImage = resolveImage; }
  eq(other: ImageWidget) { return this.position === other.position && this.ref === other.ref && this.alt === other.alt && this.resolveImage === other.resolveImage && this.previewOnly === other.previewOnly; }
  toDOM(view: EditorView) {
    const container = document.createElement('span'); container.className = 'nagori-image'; container.tabIndex = this.previewOnly ? -1 : 0; container.setAttribute('role', this.previewOnly ? 'group' : 'button'); container.setAttribute('aria-label', this.previewOnly ? `画像: ${this.alt || this.ref}` : `画像の記法を編集: ${this.alt || this.ref}`); container.textContent = `画像: ${this.ref}`;
    container.addEventListener('click', () => selectSource(view, this.position)); container.addEventListener('keydown', e => { if (e.key === 'Enter') selectSource(view, this.position); });
    // Only URLs created by the parent's validated local-image resolver enter an img element.
    let reference = this.ref; try { reference = decodeURIComponent(reference); } catch { /* Invalid percent escape stays literal and resolver reports the path error. */ }
    this.resolveImage(reference).then(url => {
      if (!container.isConnected || !/^blob:/.test(url)) return;
      const image = document.createElement('img'); image.src = url; image.alt = this.alt; image.addEventListener('load', () => view.requestMeasure());
      image.addEventListener('error', () => { container.textContent = `画像を表示できません: ${this.ref}`; }); container.replaceChildren(image);
    }).catch(error => { if (container.isConnected) container.textContent = `画像: ${this.ref} — ${String(error)}`; });
    return container;
  }
  ignoreEvent() { return true; }
}
type MathContext = { expressions: MathExpression[]; mounts: Set<HTMLElement>; epoch: number; result?: Promise<MathRender | null> };
const mathMounts = new WeakMap<HTMLElement, MathContext>();
function releaseMath(element: HTMLElement) {
  const context = mathMounts.get(element); if (!context) return;
  mathMounts.delete(element); context.mounts.delete(element);
  if (!context.mounts.size) { context.epoch++; context.result = undefined; countDiscard(); }
}
function mathError(element: HTMLElement, source: string, error: unknown) {
  element.textContent = source; element.classList.add('nagori-math-error');
  element.title = `数式を表示できません: ${String(error)}`;
  const reason = document.createElement('span'); reason.className = 'nagori-math-reason'; reason.textContent = '（数式エラー）'; element.append(reason);
}
class MathWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  readonly source: string;
  readonly display: boolean;
  readonly context: MathContext;
  constructor(position: number, source: string, display: boolean, context: MathContext, previewOnly = false) { super(); this.previewOnly = previewOnly; this.position = position; this.source = source; this.display = display; this.context = context; }
  eq(other: MathWidget) { return this.position === other.position && this.source === other.source && this.display === other.display && this.context === other.context && this.previewOnly === other.previewOnly; }
  toDOM(view: EditorView) {
    const element = document.createElement(this.display ? 'div' : 'span');
    element.className = this.display ? 'nagori-math nagori-math-display' : 'nagori-math'; element.textContent = this.source;
    element.tabIndex = this.previewOnly ? -1 : 0; element.setAttribute('role', 'group'); element.setAttribute('aria-label', this.previewOnly ? '数式' : '数式（EnterでLaTeX記法を編集）');
    if (!this.previewOnly) element.addEventListener('mousedown', event => event.preventDefault());
    element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); selectSource(view, this.position); });
    element.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); event.stopPropagation(); selectSource(view, this.position); } });
    const context = this.context; context.mounts.add(element); mathMounts.set(element, context);
    const epoch = context.epoch, active = () => context.epoch === epoch && [...context.mounts].some(node => node.isConnected);
    context.result ??= import('./mathjax.ts').then(engine => engine.renderMath(context.expressions, active));
    context.result.then(rendered => {
      if (!rendered || context.epoch !== epoch || !element.isConnected || mathMounts.get(element) !== context) return;
      const result = rendered.expressions.get(this.position);
      if (!result?.html) { mathError(element, this.source, result?.error ?? '数式を表示できません'); view.requestMeasure(); return; }
      let style = document.getElementById('nagori-mathjax-style');
      if (!style) { style = document.createElement('style'); style.id = 'nagori-mathjax-style'; document.head.append(style); }
      if (style.textContent !== rendered.css) style.textContent = rendered.css;
      // Only MathJax-generated CHTML from the fixed TeX package set enters the DOM.
      const template = document.createElement('template'); template.innerHTML = result.html; element.replaceChildren(template.content);
      view.requestMeasure();
      document.fonts.ready.then(() => { if (element.isConnected && mathMounts.get(element) === context) view.requestMeasure(); });
    }).catch(error => { if (context.epoch === epoch && element.isConnected && mathMounts.get(element) === context) { mathError(element, this.source, error); view.requestMeasure(); } });
    return element;
  }
  destroy(element: HTMLElement) { releaseMath(element); }
  ignoreEvent() { return true; }
}
function renderInline(parent: HTMLElement, node: SyntaxNode, text: string, refs: Map<string, string>, options: Options, view: EditorView, math: MathContext) {
  const content = inlineContent(node);
  const kids = children(node).filter(n => n.from >= content.from && n.to <= content.to && !/^(?:LinkMark|LinkLabel|URL|LinkTitle|EmphasisMark|CodeMark|StrikethroughMark)$/.test(n.name));
  let at = content.from;
  for (const child of kids) {
    if (child.from > at) parent.append(document.createTextNode(decodeMarkdown(text.slice(at, child.from))));
    const tag = ({ StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 's', InlineCode: 'code', Link: 'span', Autolink: 'span' } as Record<string, string>)[child.name];
    const target = (child.name === 'Link' || child.name === 'Autolink') ? linkTarget(child, text, refs) : null;
    if (tag && (!(child.name === 'Link') || target)) {
      const element = document.createElement(tag); if (inlineClasses[child.name]) element.className = inlineClasses[child.name];
      if (target) { element.title = `${target}（Cmd＋クリックで開く）`; element.addEventListener('click', e => { if (e.metaKey) { e.stopPropagation(); options.onLink(target); } }); }
      if (child.name === 'InlineCode') element.textContent = codeDisplay(text.slice(inlineContent(child).from, inlineContent(child).to));
      else renderInline(element, child, text, refs, options, view, math);
      parent.append(element);
    } else if (child.name === 'InlineMath' || child.name === 'DisplayMath') {
      parent.append(new MathWidget(child.from, text.slice(child.from, child.to), child.name === 'DisplayMath', math, view.state.field(previewOnlyField)).toDOM(view));
    } else if (child.name === 'Image') {
      const target = linkTarget(child, text, refs);
      if (target) parent.append(new ImageWidget(child.from, target, text.slice(inlineContent(child).from, inlineContent(child).to), options.resolveImage, view.state.field(previewOnlyField)).toDOM(view));
      else parent.append(document.createTextNode(text.slice(child.from, child.to)));
    } else if (child.name === 'HardBreak') parent.append(document.createElement('br'));
    else if (child.name === 'Escape' || child.name === 'Entity') parent.append(document.createTextNode(decodeMarkdown(text.slice(child.from, child.to))));
    else parent.append(document.createTextNode(text.slice(child.from, child.to)));
    at = child.to;
  }
  if (at < content.to) parent.append(document.createTextNode(decodeMarkdown(text.slice(at, content.to))));
}
class TableWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  readonly node: SyntaxNode;
  readonly text: string;
  readonly options: Options;
  readonly refs: Map<string, string>;
  readonly math: MathContext;
  constructor(position: number, node: SyntaxNode, text: string, options: Options, refs: Map<string, string>, math: MathContext, previewOnly = false) { super(); this.previewOnly = previewOnly; this.position = position; this.node = node; this.text = text; this.options = options; this.refs = refs; this.math = math; }
  eq(other: TableWidget) { return this.position === other.position && this.text.slice(this.node.from, this.node.to) === other.text.slice(other.node.from, other.node.to) && JSON.stringify([...this.refs]) === JSON.stringify([...other.refs]) && this.options.resolveImage === other.options.resolveImage && this.math === other.math && this.previewOnly === other.previewOnly; }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'nagori-table-wrap'; wrapper.tabIndex = this.previewOnly ? -1 : 0; wrapper.setAttribute('role', this.previewOnly ? 'group' : 'button'); wrapper.setAttribute('aria-label', this.previewOnly ? '表' : '表のMarkdownを編集');
    const table = document.createElement('table'); const rows = children(this.node).filter(n => n.name === 'TableHeader' || n.name === 'TableRow');
    const delimiter = children(this.node).find(n => n.name === 'TableDelimiter');
    const align = delimiter ? this.text.slice(delimiter.from, delimiter.to).replace(/^\||\|$/g, '').split('|').map(s => s.trim()) : [];
    for (const row of rows) {
      const tr = document.createElement('tr');
      children(row).filter(n => n.name === 'TableCell').forEach((cell, i) => {
        const td = document.createElement(row.name === 'TableHeader' ? 'th' : 'td');
        if (align[i]?.startsWith(':') && align[i]?.endsWith(':')) td.style.textAlign = 'center'; else if (align[i]?.endsWith(':')) td.style.textAlign = 'right';
        renderInline(td, cell, this.text, this.refs, this.options, view, this.math); tr.append(td);
      }); table.append(tr);
    }
    wrapper.append(table); wrapper.addEventListener('click', () => selectSource(view, this.position)); wrapper.addEventListener('keydown', e => { if (e.key === 'Enter') selectSource(view, this.position); }); return wrapper;
  }
  destroy(element: HTMLElement) { element.querySelectorAll<HTMLElement>('.nagori-math').forEach(releaseMath); }
  ignoreEvent() { return true; }
}
type PreviewContext = { tree: Tree; text: string; front: Span | null; refs: Map<string, string>; math: MathContext };
function previewContext(state: EditorState, previous?: PreviewContext): PreviewContext {
  const tree = syntaxTree(state), text = state.doc.toString();
  // ponytail: full math scan once per text revision up to the 2MiB document limit; index only if measured latency requires it.
  const hasMath = text.includes('$') || text.includes('\\(') || text.includes('\\[');
  const math = previous?.text === text ? previous.math : { expressions: hasMath ? mathExpressions(markdownParser.parse(text), text) : [], mounts: new Set<HTMLElement>(), epoch: 0 };
  return { tree, text, front: frontMatter(text), refs: references(tree, text), math };
}
export function buildPreview(state: EditorState, options: Options, context?: PreviewContext): DecorationSet {
  const previewOnly = state.field(previewOnlyField, false) ?? false;
  const { tree, text, front, refs, math } = context ?? previewContext(state), ranges: Range<Decoration>[] = [];
  const active = (span: Span) => !previewOnly && state.selection.ranges.some(r => touches(span, r));
  const hide = (from: number, to: number) => { if (from < to) ranges.push(Decoration.replace({}).range(from, to)); };
  const mark = (from: number, to: number, className: string, attributes?: Record<string, string>) => { if (from < to) ranges.push(Decoration.mark({ class: className, attributes }).range(from, to)); };
  const line = (position: number, className: string) => ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(position).from));
  const hideMarker = (node: SyntaxNode) => {
    const current = state.doc.lineAt(node.from);
    if (!active(current)) { let end = node.to; if (text[end] === ' ') end++; hide(node.from, end); }
  };
  // ponytail: traverse parsed document for selection changes; index decoration candidates if measured 100KiB latency exceeds the target.
  walk(tree.topNode, node => {
    if (node.name !== 'Document' && front && intersects(front, node)) return false;
    if (/^(?:HTMLBlock|HTMLTag|CommentBlock|ProcessingInstructionBlock|LinkReference|MathUnclosed)$/.test(node.name)) return false;
    if (/^(?:InlineMath|DisplayMath|MathBlock)$/.test(node.name)) {
      if (!active(node)) {
        const current = state.doc.lineAt(node.from);
        const block = node.name === 'MathBlock' || (node.name === 'DisplayMath' && text.slice(current.from, node.from).trim() === '' && text.slice(node.to, state.doc.lineAt(node.to).to).trim() === '');
        ranges.push(Decoration.replace({ widget: new MathWidget(node.from, text.slice(node.from, node.to), node.name !== 'InlineMath', math, previewOnly), block }).range(node.from, node.to));
      }
      return false;
    }
    if (node.name === 'Table') {
      if (!active(node)) { ranges.push(Decoration.replace({ widget: new TableWidget(node.from, node, text, options, refs, math, previewOnly), block: true }).range(node.from, node.to)); return false; }
      line(node.from, 'nagori-table-source');
    }
    if (node.name === 'Image') {
      const ref = linkTarget(node, text, refs);
      if (ref && !active(node)) ranges.push(Decoration.replace({ widget: new ImageWidget(node.from, ref, text.slice(inlineContent(node).from, inlineContent(node).to), options.resolveImage, previewOnly) }).range(node.from, node.to));
      return false;
    }
    if (inlineClasses[node.name]) {
      const target = node.name === 'Link' || node.name === 'Autolink' ? linkTarget(node, text, refs) : null;
      if (node.name === 'Link' && !target) return false;
      const content = inlineContent(node); mark(content.from, content.to, inlineClasses[node.name], target ? { 'data-href': target, title: `${target}（Cmd＋クリックで開く）` } : undefined);
      if (!active(node)) { hide(node.from, content.from); hide(content.to, node.to); }
      if (node.name === 'InlineCode') {
        if (!active(node)) ranges.push(Decoration.replace({ widget: new TextWidget(codeDisplay(text.slice(content.from, content.to)), inlineClasses[node.name]) }).range(content.from, content.to));
        return false;
      }
    }
    if (/^(?:ATXHeading|SetextHeading)/.test(node.name)) {
      const level = Number(node.name.at(-1)); line(node.from, `nagori-heading nagori-h${level}`);
      if (level <= 3) {
        const last = state.doc.lineAt(node.to);
        const rule = node.name.startsWith('Setext') && !active(node) ? state.doc.line(last.number - 1) : last;
        line(rule.from, 'nagori-heading-rule');
      }
      if (!active(node)) for (const part of children(node).filter(n => n.name === 'HeaderMark')) {
        if (node.name.startsWith('Setext')) {
          const underline = state.doc.lineAt(part.from); hide(Math.max(node.from, underline.from - 1), underline.to);
        } else { let end = part.to; if (part.from === node.from && text[end] === ' ') end++; hide(part.from, end); }
      }
    }
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      const first = state.doc.lineAt(node.from), last = state.doc.lineAt(node.to);
      for (let n = first.number; n <= last.number; n++) line(state.doc.line(n).from, 'nagori-code-line');
      if (node.name === 'FencedCode' && !active(node)) {
        const marks = children(node).filter(n => n.name === 'CodeMark');
        for (const part of marks) { const fence = state.doc.lineAt(part.from); hide(fence.from, fence.to < state.doc.length ? fence.to + 1 : fence.to); }
      }
      return false;
    }
    if (node.name === 'HorizontalRule') { if (!active(node)) ranges.push(Decoration.replace({ widget: new RuleWidget(node.from, previewOnly), block: true }).range(node.from, node.to)); return false; }
    if (node.name === 'Blockquote') { for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++) line(state.doc.line(n).from, 'nagori-quote'); }
    if (node.name === 'QuoteMark') hideMarker(node);
    if (node.name === 'ListMark') {
      const current = state.doc.lineAt(node.from), mark = text.slice(node.from, node.to);
      // タスクの行では、チェックボックスの前に箇条書きの点を重ねて出さない
      if (node.nextSibling?.name === 'Task' && !/^\d/.test(mark)) hideMarker(node);
      else if (!active(current)) ranges.push(Decoration.replace({ widget: new TextWidget(/^\d/.test(mark) ? mark : '•') }).range(node.from, node.to));
    }
    if (node.name === 'TaskMarker') {
      if (!active(state.doc.lineAt(node.from))) ranges.push(Decoration.replace({ widget: new TaskWidget(node.from, /x/i.test(text.slice(node.from, node.to)), state.readOnly) }).range(node.from, node.to));
    }
    if (node.name === 'Paragraph' && !active(node)) {
      const blocked: Span[] = [];
      walk(node, child => { if (child.name === 'InlineCode' || child.name === 'HardBreak' || child.name === 'DisplayMath' || child.name === 'InlineMath') { blocked.push(child); return false; } });
      for (let pos = text.indexOf('\n', node.from); pos >= 0 && pos < node.to; pos = text.indexOf('\n', pos + 1)) {
        if (!blocked.some(span => pos >= span.from && pos < span.to)) ranges.push(Decoration.replace({ widget: new TextWidget(' ') }).range(pos, pos + 1));
      }
    }
    if ((node.name === 'Escape' || node.name === 'Entity') && !active(node)) ranges.push(Decoration.replace({ widget: new TextWidget(decodeMarkdown(text.slice(node.from, node.to))) }).range(node.from, node.to));
    if (node.name === 'HardBreak' && !active(node)) hide(node.from, Math.min(node.to, state.doc.lineAt(node.from).to));
  });
  return Decoration.set(ranges, true);
}
export function livePreview(options: Options): Extension {
  const resolver = options.resolveImage;
  let currentOptions = options;
  let cached: PreviewContext | undefined;
  const field = StateField.define<DecorationSet>({
    create: state => { cached = previewContext(state); return buildPreview(state, currentOptions, cached); },
    update: (value, tr) => {
      if (tr.effects.some(e => e.is(refreshImagesEffect))) currentOptions = { ...options, resolveImage: ref => resolver(ref) };
      // The cursor's source is already exposed. Keep every other widget and the composing DOM stable until IME commits.
      if (tr.state.field(compositionField)) return value.map(tr.changes);
      const parsedChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (tr.docChanged || parsedChanged || tr.startState.field(compositionField)) cached = previewContext(tr.state, cached);
      return tr.docChanged || tr.selection || tr.effects.length || parsedChanged ? buildPreview(tr.state, currentOptions, cached) : value;
    },
    provide: field => EditorView.decorations.from(field)
  });
  return [previewOnlyField, compositionField, field, EditorState.changeFilter.of(tr => !tr.startState.field(previewOnlyField)), EditorView.domEventHandlers({ click(event) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-href]');
    if (target && event.metaKey) { event.preventDefault(); options.onLink(target.dataset.href!); return true; }
    return false;
  } })];
}
