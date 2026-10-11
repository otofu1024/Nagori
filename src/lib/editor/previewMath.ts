import { WidgetType, type EditorView } from '@codemirror/view';
import type { MathExpression } from './markdownMath.ts';
import type { MathRender } from './mathjax.ts';
import { countDiscard } from './mathStats.ts';
import { selectSource } from './previewState.ts';

export type MathContext = { expressions: MathExpression[]; mounts: Set<HTMLElement>; epoch: number; result?: Promise<MathRender | null> };
const mathMounts = new WeakMap<HTMLElement, MathContext>();
export function releaseMath(element: HTMLElement) {
  const context = mathMounts.get(element);
  if (!context) return;
  mathMounts.delete(element);
  context.mounts.delete(element);
  if (!context.mounts.size) {
    context.epoch++;
    context.result = undefined;
    countDiscard();
  }
}
function mathError(element: HTMLElement, source: string, error: unknown) {
  element.textContent = source;
  element.classList.add('nagori-math-error');
  element.title = `数式を表示できません: ${String(error)}`;
  const reason = document.createElement('span');
  reason.className = 'nagori-math-reason';
  reason.textContent = '（数式エラー）';
  element.append(reason);
}
export class MathWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  readonly source: string;
  readonly display: boolean;
  readonly context: MathContext;
  constructor(position: number, source: string, display: boolean, context: MathContext, previewOnly = false) {
    super();
    this.previewOnly = previewOnly;
    this.position = position;
    this.source = source;
    this.display = display;
    this.context = context;
  }
  eq(other: MathWidget) {
    return (
      this.position === other.position &&
      this.source === other.source &&
      this.display === other.display &&
      this.context === other.context &&
      this.previewOnly === other.previewOnly
    );
  }
  toDOM(view: EditorView) {
    const element = document.createElement(this.display ? 'div' : 'span');
    element.className = this.display ? 'nagori-math nagori-math-display' : 'nagori-math';
    element.textContent = this.source;
    element.tabIndex = this.previewOnly ? -1 : 0;
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', this.previewOnly ? '数式' : '数式（EnterでLaTeX記法を編集）');
    if (!this.previewOnly) element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectSource(view, this.position);
    });
    element.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        selectSource(view, this.position);
      }
    });
    const context = this.context;
    context.mounts.add(element);
    mathMounts.set(element, context);
    const epoch = context.epoch,
      active = () => context.epoch === epoch && [...context.mounts].some((node) => node.isConnected);
    context.result ??= import('./mathjax.ts').then((engine) => engine.renderMath(context.expressions, active));
    context.result
      .then((rendered) => {
        if (!rendered || context.epoch !== epoch || !element.isConnected || mathMounts.get(element) !== context) return;
        const result = rendered.expressions.get(this.position);
        if (!result?.html) {
          mathError(element, this.source, result?.error ?? '数式を表示できません');
          view.requestMeasure();
          return;
        }
        let style = document.getElementById('nagori-mathjax-style');
        if (!style) {
          style = document.createElement('style');
          style.id = 'nagori-mathjax-style';
          document.head.append(style);
        }
        if (style.textContent !== rendered.css) style.textContent = rendered.css;
        // Only MathJax-generated CHTML from the fixed TeX package set enters the DOM.
        const template = document.createElement('template');
        template.innerHTML = result.html;
        element.replaceChildren(template.content);
        view.requestMeasure();
        document.fonts.ready.then(() => {
          if (element.isConnected && mathMounts.get(element) === context) view.requestMeasure();
        });
      })
      .catch((error) => {
        if (context.epoch === epoch && element.isConnected && mathMounts.get(element) === context) {
          mathError(element, this.source, error);
          view.requestMeasure();
        }
      });
    return element;
  }
  destroy(element: HTMLElement) {
    releaseMath(element);
  }
  ignoreEvent() {
    return true;
  }
}
