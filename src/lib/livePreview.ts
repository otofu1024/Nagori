import { mathExpressions, type MathExpression } from './markdownMath.ts';
import type { MathRender } from './mathjax.ts';
import { countDiscard } from './mathStats.ts';
import { StateEffect, StateField, EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode, Tree } from '@lezer/common';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { applyTableCommand, setTableCell, setTableColumnWidths, tableCells, tableColumnDashes, tableShape, type TableCommand, type TableRowSpan, type TableTarget } from './tableEdit.ts';
import type { TableCellRef } from './editor.ts';
import { children, codeDisplay, decodeMarkdown, frontMatter, inlineContent, intersects, linkTarget, markdownParser, references, touches, walk, type Span } from './markdown.ts';

export const refreshImagesEffect = StateEffect.define<void>();
export const previewOnlyMode = StateEffect.define<boolean>();
// 表を見た目のまま編集するかどうか(設定)
export const tableWysiwygMode = StateEffect.define<boolean>();
export const compositionMode = StateEffect.define<boolean>();
export const previewOnlyField = StateField.define({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => e.is(previewOnlyMode) ? e.value : v, value),
  provide: field => [
    EditorState.readOnly.computeN([field], state => state.field(field) ? [true] : []),
    EditorView.editable.computeN([field], state => state.field(field) ? [false] : []),
  ],
});
const tableWysiwygField = StateField.define({ create: () => false, update: (value, tr) => tr.effects.reduce((v, e) => e.is(tableWysiwygMode) ? e.value : v, value) });
const compositionField = StateField.define({ create: () => false, update: (value, tr) => tr.effects.reduce((v, e) => e.is(compositionMode) ? e.value : v, value) });
type Options = { resolveImage(reference: string): Promise<string>; onLink(href: string): void };
const inlineClasses: Record<string, string> = { StrongEmphasis: 'nagori-bold', Emphasis: 'nagori-italic', Strikethrough: 'nagori-strike', InlineCode: 'nagori-code', Link: 'nagori-link', Autolink: 'nagori-link' };
// 箇条書きの記号は入れ子の深さで変える。4段目以降は1段目から繰り返す。
const bulletGlyphs = ['•', '◦', '▪'];
export function bulletGlyph(depth: number): string { return bulletGlyphs[(depth - 1) % bulletGlyphs.length]; }
// 項目を囲むリストの数。1段目が1になる。
export function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent: SyntaxNode | null = node; parent; parent = parent.parent) if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth++;
  return depth;
}
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
// 表のマスは本文と別の編集欄として扱う。部品ごとに、今の本文と表示の状態を覚えておく
type TableState = { widget: TableWidget; view: EditorView; cells: boolean };
const tableStates = new WeakMap<HTMLElement, TableState>();
// IMEの変換中のマス。変換が終わるまで本文へ書き戻さない
const composingCells = new WeakSet<HTMLElement>();
// 次にマスへフォーカスした時、文字の先頭と末尾のどちらへ置くか
let caretHint: 'start' | 'end' = 'end';
const tableFocusLabel = '表（Tab・矢印キーでマスを移動、Escapeで表を抜ける）';
// 列の幅を変える時の最小幅（px）
const minColumnWidth = 48;

class TableWidget extends WidgetType {
  readonly previewOnly: boolean;
  // 見た目のまま編集するか。オフ・プレビューの時は、記法を開く従来の表示にする
  readonly cells: boolean;
  readonly position: number;
  readonly node: SyntaxNode;
  readonly text: string;
  readonly options: Options;
  readonly refs: Map<string, string>;
  readonly math: MathContext;
  constructor(position: number, node: SyntaxNode, text: string, options: Options, refs: Map<string, string>, math: MathContext, previewOnly = false, cells = false) { super(); this.previewOnly = previewOnly; this.cells = cells; this.position = position; this.node = node; this.text = text; this.options = options; this.refs = refs; this.math = math; }
  eq(other: TableWidget) { return this.position === other.position && this.text.slice(this.node.from, this.node.to) === other.text.slice(other.node.from, other.node.to) && JSON.stringify([...this.refs]) === JSON.stringify([...other.refs]) && this.options.resolveImage === other.options.resolveImage && this.math === other.math && this.previewOnly === other.previewOnly && this.cells === other.cells; }
  // 表の行とマスの範囲。表示・書き戻し・行列の操作と同じ結果を使う
  private spans?: TableRowSpan[];
  private nodes?: SyntaxNode[];
  // 原文の全行(区切り行を含む)
  allRows(): TableRowSpan[] { return this.spans ??= tableCells(this.text, this.node.from, this.node.to); }
  // 表示の行。見出しを0とし、区切り行は含めない
  rows(): TableRowSpan[] { return this.allRows().filter(row => row.kind !== 'delimiter'); }
  // マスの中身の構文の節。空白だけのマスなどには節がないため null になる
  cellNode(row: number, column: number): SyntaxNode | null {
    const span = this.rows()[row]?.cells[column];
    if (!span) return null;
    if (!this.nodes) { this.nodes = []; walk(this.node, node => { if (node.name === 'TableCell') this.nodes!.push(node); }); }
    return this.nodes.find(node => node.from >= span.from && node.from < span.to) ?? null;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'nagori-table-wrap';
    wrapper.tabIndex = this.previewOnly || this.cells ? -1 : 0;
    wrapper.setAttribute('role', this.previewOnly || this.cells ? 'group' : 'button'); wrapper.setAttribute('aria-label', this.cells ? tableFocusLabel : this.previewOnly ? '表' : '表のMarkdownを編集');
    const table = document.createElement('table');
    const align = this.allRows()[1]?.cells.map(cell => cell.raw.trim()) ?? [];
    const colgroup = document.createElement('colgroup');
    this.rows()[0]?.cells.forEach(() => colgroup.append(document.createElement('col')));
    table.append(colgroup);
    this.rows().forEach((row, index) => {
      const tr = document.createElement('tr');
      row.cells.forEach((_cell, column) => {
        const td = document.createElement(index === 0 ? 'th' : 'td');
        td.dataset.row = String(index); td.dataset.column = String(column);
        if (align[column]?.startsWith(':') && align[column]?.endsWith(':')) td.style.textAlign = 'center'; else if (align[column]?.endsWith(':')) td.style.textAlign = 'right';
        if (this.cells) bindCell(td);
        renderCell(td, this, view); tr.append(td);
      });
      table.append(tr);
    });
    applyColumnWidths(table, this);
    wrapper.append(table);
    tableStates.set(wrapper, { widget: this, view, cells: this.cells });
    if (!this.cells) { wrapper.addEventListener('click', () => selectSource(view, this.position)); wrapper.addEventListener('keydown', e => { if (e.key === 'Enter') selectSource(view, this.position); }); }
    return wrapper;
  }
  // 本文の変更で部品を作り直す代わりに、フォーカスのあるマス以外の表示を更新する。構造が変わった時だけ作り直す
  updateDOM(dom: HTMLElement, view: EditorView) {
    // 行・列の数が変わった時は表の部品を作り直す。マスの対応がずれないよう、同じ数の時だけ使い回す
    const state = tableStates.get(dom), rows = this.rows(), trs = dom.querySelectorAll('tr');
    if (!state || state.cells !== this.cells || trs.length !== rows.length || rows.some((row, index) => trs[index].children.length !== row.cells.length)) return false;
    tableStates.set(dom, { widget: this, view, cells: this.cells });
    const focused = document.activeElement;
    dom.querySelectorAll<HTMLElement>('[data-row][data-column]').forEach(td => { if (td !== focused) renderCell(td, this, view); });
    const table = dom.querySelector<HTMLTableElement>('table');
    if (table) applyColumnWidths(table, this);
    return true;
  }
  destroy(element: HTMLElement) { element.querySelectorAll<HTMLElement>('.nagori-math').forEach(releaseMath); }
  ignoreEvent() { return true; }
}
// マスの表示を、フォーカスがない時の装飾つきの表示にする。フォーカス中は原文を入れる
function renderCell(td: HTMLElement, widget: TableWidget, view: EditorView) {
  const row = Number(td.dataset.row), column = Number(td.dataset.column), span = widget.rows()[row]?.cells[column], node = widget.cellNode(row, column);
  td.querySelectorAll<HTMLElement>('.nagori-math').forEach(releaseMath);
  td.replaceChildren();
  if (node) renderInline(td, node, widget.text, widget.refs, widget.options, view, widget.math);
  // フォーカスした時に出す原文は、本文のマスの範囲から読む
  td.dataset.raw = span ? widget.text.slice(span.contentFrom, span.contentTo) : '';
  if (widget.cells && row === 0 && column < widget.rows()[0].cells.length - 1) td.append(columnResizer());
}
// 列の幅のつまみ。見出しの右端に置き、隣の列との境目を動かす
function columnResizer() {
  const handle = document.createElement('span');
  handle.className = 'nagori-col-resizer'; handle.setAttribute('aria-hidden', 'true');
  // 押しても、マスへのフォーカスや文字選択にしない
  handle.addEventListener('mousedown', event => event.preventDefault());
  handle.addEventListener('pointerdown', event => startColumnResize(event, handle));
  return handle;
}
// 区切り行の - の数で列の幅を当てる。全列が同じ（自動）時は、表の幅を内容に合わせる。列の最小幅は48px
function applyColumnWidths(table: HTMLTableElement, widget: TableWidget) {
  const columns = widget.rows()[0]?.cells.length ?? 0, dashes = tableColumnDashes(widget.text.slice(widget.node.from, widget.node.to));
  const sum = dashes ? dashes.slice(0, columns).reduce((total, count) => total + count, 0) : 0;
  table.style.tableLayout = dashes && sum > 0 ? 'fixed' : '';
  table.querySelectorAll('col').forEach((col, index) => {
    col.style.width = dashes && sum > 0 ? `max(${minColumnWidth}px, ${(dashes[index] ?? 0) / sum * 100}%)` : '';
  });
}
// つまみを押した時、隣の2列の境目を動かす。ドラッグの間は表示だけ変え、離した時に区切り行を1回書き換える
function startColumnResize(event: PointerEvent, handle: HTMLElement) {
  const th = handle.parentElement as HTMLTableCellElement, state = stateOf(handle);
  if (event.button !== 0 || !state?.cells || state.view.state.readOnly) return;
  event.preventDefault(); event.stopPropagation();
  const table = th.closest('table')!, column = Number(th.dataset.column), cols = table.querySelectorAll('col');
  const start = [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().width), current = start.slice(), startX = event.clientX;
  const pair = start[column] + start[column + 1];
  table.style.tableLayout = 'fixed';
  start.forEach((width, index) => { cols[index].style.width = `${width}px`; });
  handle.setPointerCapture(event.pointerId);
  const move = (moved: PointerEvent) => {
    // 隣の2列の合計は変えず、どちらも最小幅を下回らないようにする
    const left = Math.min(Math.max(start[column] + moved.clientX - startX, minColumnWidth), pair - minColumnWidth);
    current[column] = left; current[column + 1] = pair - left;
    cols[column].style.width = `${left}px`; cols[column + 1].style.width = `${pair - left}px`;
  };
  const end = (finished: PointerEvent) => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
    if (handle.hasPointerCapture(finished.pointerId)) handle.releasePointerCapture(finished.pointerId);
    if (finished.type === 'pointerup' && current[column] !== start[column]) writeColumnWidths(state, current);
    else applyColumnWidths(table, state.widget);
  };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
// 列の幅（px）を区切り行の - の数に書き換え、1回の変更として本文へ入れる
function writeColumnWidths(state: TableState, widths: number[]) {
  const { widget, view } = state, { from, to } = widget.node;
  const source = view.state.doc.sliceString(from, to);
  const next = setTableColumnWidths(source, widths);
  if (next !== source) view.dispatch({ changes: { from, to, insert: next }, annotations: isolateHistory.of('full') });
}
// 確認用の操作で、本文の順で index 番目の表の列の幅を比で変える。比は - の数に変えて区切り行へ書く
export function setTableColumnWidthsAt(view: EditorView, index: number, ratios: number[]): boolean {
  if (view.state.readOnly) return false;
  const tables: { from: number; to: number }[] = [];
  walk(markdownParser.parse(view.state.doc.toString()).topNode, node => { if (node.name === 'Table') { tables.push({ from: node.from, to: node.to }); return false; } });
  const table = tables[index];
  if (!table) return false;
  const source = view.state.doc.sliceString(table.from, table.to), next = setTableColumnWidths(source, ratios);
  if (next === source) return false;
  view.dispatch({ changes: { from: table.from, to: table.to, insert: next }, annotations: isolateHistory.of('full'), scrollIntoView: true });
  return true;
}
function stateOf(element: Element): TableState | undefined {
  const wrapper = element.closest<HTMLElement>('.nagori-table-wrap');
  return wrapper ? tableStates.get(wrapper) : undefined;
}
function placeCaret(td: HTMLElement, at: 'start' | 'end') {
  const selection = window.getSelection(); if (!selection) return;
  const range = document.createRange(); range.selectNodeContents(td); range.collapse(at === 'start');
  selection.removeAllRanges(); selection.addRange(range);
}
// カーソルが文字の先頭・末尾にあるかを返す。選択範囲があれば、どちらでもない扱いにする
function caretEdges(td: HTMLElement) {
  const selection = window.getSelection(), text = td.textContent ?? '';
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !selection.anchorNode || !td.contains(selection.anchorNode)) return { start: false, end: false };
  const before = document.createRange(); before.selectNodeContents(td); before.setEnd(selection.anchorNode, selection.anchorOffset);
  const offset = before.toString().length;
  return { start: offset === 0, end: offset === text.length };
}
function bindCell(td: HTMLElement) {
  td.contentEditable = 'true';
  td.addEventListener('focus', () => {
    const state = stateOf(td); if (!state) return;
    // 読み取り専用の時は編集させない
    if (state.view.state.readOnly) { td.blur(); return; }
    // 原文に入れ替えても、見出しのつまみは残す
    const handle = td.querySelector(':scope > .nagori-col-resizer');
    td.textContent = td.dataset.raw ?? '';
    if (handle) td.append(handle);
    placeCaret(td, caretHint); caretHint = 'end';
  });
  td.addEventListener('blur', () => {
    // 変換の途中でフォーカスが外れた時は、compositionend で書き戻してから表示を戻す
    if (!td.isConnected || composingCells.has(td)) return;
    const state = stateOf(td); if (state) renderCell(td, state.widget, state.view);
  });
  td.addEventListener('compositionstart', () => composingCells.add(td));
  td.addEventListener('compositionend', () => {
    composingCells.delete(td); writeCell(td);
    if (!td.matches(':focus')) { const state = stateOf(td); if (state) renderCell(td, state.widget, state.view); }
  });
  td.addEventListener('input', event => { if (!composingCells.has(td) && !(event as InputEvent).isComposing) writeCell(td); });
  td.addEventListener('keydown', event => handleCellKey(event, td));
  // 貼り付けは書式を持たない文字列にし、改行は空白にする
  td.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, (event.clipboardData?.getData('text/plain') ?? '').replace(/\r?\n/g, ' ')); });
}
// マスの内容を表の原文へ書き戻す。表全体を1つの変更として本文へ入れ、Undoは入力の区切りでまとめる
function writeCell(td: HTMLElement) {
  const state = stateOf(td); if (!state || state.view.state.readOnly) return;
  const { widget, view } = state, { from, to } = widget.node;
  const source = view.state.doc.sliceString(from, to);
  const next = setTableCell(source, Number(td.dataset.row), Number(td.dataset.column), td.textContent ?? '');
  if (next !== source) view.dispatch({ changes: { from, to, insert: next }, userEvent: 'input.type' });
}
function focusCell(wrapper: HTMLElement, row: number, column: number, caret: 'start' | 'end') {
  const td = wrapper.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`);
  if (td) { caretHint = caret; td.focus(); }
}
// 表の前後へ本文のカーソルを移す。前は表の直前の改行、後は表の直後の改行の先
function exitTable(view: EditorView, widget: TableWidget, side: 'before' | 'after') {
  const { from, to } = widget.node;
  const anchor = side === 'before' ? Math.max(0, from - 1) : Math.min(to + 1, view.state.doc.length);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  view.focus();
}
function handleCellKey(event: KeyboardEvent, td: HTMLElement) {
  const state = stateOf(td); if (!state) return;
  // 変換中のキーは変換の操作なので、表の操作に使わない
  if (event.isComposing || event.keyCode === 229) return;
  const { widget, view } = state, wrapper = td.closest<HTMLElement>('.nagori-table-wrap')!;
  const row = Number(td.dataset.row), column = Number(td.dataset.column);
  const cell = { from: widget.node.from, to: widget.node.to, row, column };
  const shape = tableShape(view.state.doc.sliceString(cell.from, cell.to));
  const last = shape.rows - 1, lastColumn = shape.columns - 1;
  const mod = event.metaKey || event.ctrlKey;
  const handled = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
  if (event.key === 'Enter') return handled(() => {
    // Enterは下のマスへ。最後の行なら行を追加する。空白は入れない
    if (mod || row === last) runTableCommand(view, 'row-below', cell, { row: row + 1, column });
    else focusCell(wrapper, row + 1, column, 'end');
  });
  if (event.key === 'Tab') return handled(() => {
    if (event.shiftKey) { if (column > 0) focusCell(wrapper, row, column - 1, 'end'); else if (row > 0) focusCell(wrapper, row - 1, lastColumn, 'end'); return; }
    if (column < lastColumn) focusCell(wrapper, row, column + 1, 'start');
    else runTableCommand(view, 'row-below', cell, { row: row + 1, column: 0 });
  });
  if (event.key === 'Escape') return handled(() => exitTable(view, widget, 'after'));
  if (mod && event.key.toLowerCase() === 'z' && !event.altKey) return handled(() => { (event.shiftKey ? redo : undo)(view); view.focus(); });
  if (mod && event.altKey && event.key === 'ArrowRight') return handled(() => runTableCommand(view, 'column-right', cell));
  if (mod && event.altKey && event.key === 'ArrowLeft') return handled(() => runTableCommand(view, 'column-left', cell));
  if (event.shiftKey || event.altKey || mod) return;
  const edges = caretEdges(td);
  if (event.key === 'ArrowLeft' && edges.start) return handled(() => {
    if (column > 0) focusCell(wrapper, row, column - 1, 'end');
    else if (row > 0) focusCell(wrapper, row - 1, lastColumn, 'end');
    else exitTable(view, widget, 'before');
  });
  if (event.key === 'ArrowRight' && edges.end) return handled(() => {
    if (column < lastColumn) focusCell(wrapper, row, column + 1, 'start');
    else if (row < last) focusCell(wrapper, row + 1, 0, 'start');
    else exitTable(view, widget, 'after');
  });
  if (event.key === 'ArrowUp' && edges.start) return handled(() => { if (row > 0) focusCell(wrapper, row - 1, column, 'start'); else exitTable(view, widget, 'before'); });
  if (event.key === 'ArrowDown' && edges.end) return handled(() => { if (row < last) focusCell(wrapper, row + 1, column, 'end'); else exitTable(view, widget, 'after'); });
}
// 表の操作を本文へ1つの変更として入れ、操作の後のマスへフォーカスする
export function runTableCommand(view: EditorView, command: TableCommand, cell: TableCellRef, override?: TableTarget): boolean {
  if (view.state.readOnly) return false;
  const result = applyTableCommand(view.state.doc.sliceString(cell.from, cell.to), command, cell.row, cell.column);
  if (!result) return false;
  view.dispatch({ changes: { from: cell.from, to: cell.to, insert: result.source }, annotations: isolateHistory.of('full'), scrollIntoView: true });
  focusTableAt(view, cell.from, override ?? result.target);
  return true;
}
// 表を本文から消す。直後の改行も一緒に消す
export function removeTable(view: EditorView, cell: TableCellRef): boolean {
  if (view.state.readOnly) return false;
  const to = view.state.doc.sliceString(cell.to, cell.to + 1) === '\n' ? cell.to + 1 : cell.to;
  view.dispatch({ changes: { from: cell.from, to }, selection: { anchor: cell.from }, annotations: isolateHistory.of('full'), scrollIntoView: true });
  view.focus();
  return true;
}
function focusTableAt(view: EditorView, from: number, target: TableTarget) {
  for (const wrapper of view.contentDOM.querySelectorAll<HTMLElement>('.nagori-table-wrap')) {
    if (tableStates.get(wrapper)?.widget.node.from !== from) continue;
    focusCell(wrapper, target.row, target.column, 'end');
    return;
  }
}
// 本文の位置から表のマスを探す。マスの外や編集できない表なら null
export function tableCellAt(target: EventTarget | Element | null | undefined): (TableCellRef & { rows: number; columns: number }) | null {
  const td = target instanceof Element ? target.closest<HTMLElement>('[data-row][data-column]') : null;
  const state = td ? stateOf(td) : undefined;
  if (!td || !state?.cells) return null;
  const { widget, view } = state, { from, to } = widget.node, shape = tableShape(view.state.doc.sliceString(from, to));
  return { from, to, row: Number(td.dataset.row), column: Number(td.dataset.column), rows: shape.rows, columns: shape.columns };
}
// 確認用の操作で、指定した表の番号(本文の順)と行・列のマスへフォーカスする
export function focusTableCellAt(view: EditorView, index: number, row: number, column: number): boolean {
  const wrapper = view.contentDOM.querySelectorAll<HTMLElement>('.nagori-table-wrap')[index];
  if (!wrapper || !tableStates.get(wrapper)?.cells) return false;
  focusCell(wrapper, row, column, 'end');
  return true;
}
// 表の挿入の直後に、見出しの最初のマスへフォーカスする
export function focusTableStart(view: EditorView, from: number) { focusTableAt(view, from, { row: 0, column: 0 }); }
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
  const wysiwyg = !previewOnly && (state.field(tableWysiwygField, false) ?? false);
  const mark = (from: number, to: number, className: string, attributes?: Record<string, string>) => { if (from < to) ranges.push(Decoration.mark({ class: className, attributes }).range(from, to)); };
  // 記号は本文のDOMに残し、CSSで幅0にして隠す。replaceで消すと、変換中に未確定文字より後ろの隠し部品が作り直され、WebKitが変換中の文字を見失うため。
  // 隠した記号は支援技術に読ませない(replaceで消していた時と同じ扱い)。
  const hide = (from: number, to: number) => mark(from, to, 'nagori-hidden', { 'aria-hidden': 'true' });
  const line = (position: number, className: string) => ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(position).from));
  // 項目の行は深さに応じた字下げと、折り返しの本文の位置を CSS 変数で渡す。番号付きのタスクだけ、チェックボックスの幅を足す。
  const listLine = (number: number, className: string, style: string) => ranges.push(Decoration.line({ class: className, attributes: { style } }).range(state.doc.line(number).from));
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
      // 見た目のまま編集する時は、カーソルが表の中でも表の見た目を出す
      if (wysiwyg || !active(node)) { ranges.push(Decoration.replace({ widget: new TableWidget(node.from, node, text, options, refs, math, previewOnly, wysiwyg && !previewOnly), block: true }).range(node.from, node.to)); return false; }
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
        // 下線の行は改行を残したまま行の高さを0にする。改行まで消すと前の行と同じDOMに統合され、変換中の行が作り直される。
        if (node.name.startsWith('Setext')) line(part.from, 'nagori-hidden-line');
        else { let end = part.to; if (part.from === node.from && text[end] === ' ') end++; hide(part.from, end); }
      }
    }
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      const first = state.doc.lineAt(node.from), last = state.doc.lineAt(node.to);
      for (let n = first.number; n <= last.number; n++) line(state.doc.line(n).from, 'nagori-code-line');
      if (node.name === 'FencedCode' && !active(node)) {
        const marks = children(node).filter(n => n.name === 'CodeMark');
        for (const part of marks) line(part.from, 'nagori-hidden-line');
      }
      return false;
    }
    if (node.name === 'HorizontalRule') { if (!active(node)) ranges.push(Decoration.replace({ widget: new RuleWidget(node.from, previewOnly), block: true }).range(node.from, node.to)); return false; }
    if (node.name === 'Blockquote') { for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++) line(state.doc.line(n).from, 'nagori-quote'); }
    if (node.name === 'QuoteMark') hideMarker(node);
    if (node.name === 'ListItem') {
      // 項目の最初の行と、その直下の段落の行に字下げを付ける。入れ子の項目の行は、その項目が付ける。
      const marker = node.getChild('ListMark'), markerLine = marker ? state.doc.lineAt(marker.from).number : 0, ordered = !!marker && /^\d/.test(text.slice(marker.from, marker.to));
      const task = marker?.nextSibling?.name === 'Task';
      const lines = new Set<number>(markerLine ? [markerLine] : []);
      for (const paragraph of children(node)) if (paragraph.name === 'Paragraph') for (let n = state.doc.lineAt(paragraph.from).number; n <= state.doc.lineAt(paragraph.to).number; n++) lines.add(n);
      const depth = listDepth(node), extra = ordered && task ? ' --nagori-list-extra: 23px;' : '';
      for (const n of lines) {
        const current = state.doc.line(n), leading = /^[ \t]+/.exec(current.text);
        // 字下げは深さで決めるので、本文の空白は見せない。
        if (leading) hide(current.from, current.from + leading[0].length);
        const className = 'nagori-list-line' + (n === markerLine ? ' nagori-list-first' : '') + (n === markerLine && task && !ordered ? ' nagori-list-task' : '');
        listLine(n, className, `--nagori-list-depth: ${depth};${extra}`);
      }
    }
    if (node.name === 'ListMark') {
      const current = state.doc.lineAt(node.from), symbol = text.slice(node.from, node.to), isActive = active(current);
      // 記号の後ろの1文字は、記号と本文の間隔として字下げの幅に含める
      const end = text[node.to] === ' ' ? node.to + 1 : node.to;
      // カーソルのある行は、記号を幅の決まった枠に入れずにそのまま見せる。
      // 枠に入れると、記号の直後で変換した未確定文字をWebKitが枠の中へ入れ、枠の幅で1文字ずつ折り返すため。
      if (isActive) return;
      if (/^\d/.test(symbol)) mark(node.from, end, 'nagori-list-slot');
      // タスクの行は、チェックボックスが記号の位置に出るので、箇条書きの点は隠す
      else if (node.nextSibling?.name === 'Task') hide(node.from, end);
      else mark(node.from, end, 'nagori-list-slot nagori-hidden nagori-bullet', { 'data-bullet': bulletGlyph(listDepth(node)), 'aria-hidden': 'true' });
    }
    if (node.name === 'TaskMarker') {
      const current = state.doc.lineAt(node.from);
      if (!active(current)) {
        ranges.push(Decoration.replace({ widget: new TaskWidget(node.from, /x/i.test(text.slice(node.from, node.to)), state.readOnly) }).range(node.from, node.to));
        // チェックボックスの後ろの空白は、字下げの幅に含めるため隠す
        if (text[node.to] === ' ') hide(node.to, node.to + 1);
      }
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
  return [previewOnlyField, tableWysiwygField, compositionField, field, EditorState.changeFilter.of(tr => !tr.startState.field(previewOnlyField)), EditorView.domEventHandlers({ click(event) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-href]');
    if (target && event.metaKey) { event.preventDefault(); options.onLink(target.dataset.href!); return true; }
    return false;
  } })];
}
