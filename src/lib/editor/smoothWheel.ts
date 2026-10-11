import { Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

type WheelInput = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'shiftKey'> & { wheelDeltaY?: number };

export function isWheelNotch(event: WheelInput, sinceNative = Infinity): boolean {
  if (sinceNative < 400 || event.ctrlKey || event.shiftKey || event.deltaX !== 0 || !Number.isFinite(event.deltaY) || event.deltaY === 0) return false;
  if (event.deltaMode === 1) return Number.isInteger(event.deltaY);
  const ticks = event.wheelDeltaY;
  // WKWebViewの刻みは120単位で、1刻みのdeltaYは40pxになる。
  return event.deltaMode === 0 && ticks !== undefined && ticks !== 0 && ticks % 120 === 0 && Math.abs(event.deltaY + ticks / 3) < 0.01;
}

export function wheelTarget(position: number, delta: number, maximum: number): number {
  return Math.max(0, Math.min(Math.max(0, maximum), position + delta));
}

export function wheelPosition(from: number, to: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return from + (to - from) * (1 - (1 - t) ** 3);
}

const plugin = ViewPlugin.fromClass(class {
  frame = 0;
  from = 0;
  target = 0;
  started = 0;
  expectedTop = 0;
  expectedLeft = 0;
  lastNative = -Infinity;
  events = new AbortController();
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
  view: EditorView;
  constructor(view: EditorView) {
    this.view = view;
    const signal = this.events.signal;
    view.scrollDOM.addEventListener('wheel', this.wheel, { passive: false, signal });
    view.scrollDOM.addEventListener('scroll', this.scrolled, { passive: true, signal });
    for (const name of ['keydown', 'pointerdown', 'touchstart', 'compositionstart']) {
      view.dom.addEventListener(name, this.stop, { capture: true, passive: true, signal });
    }
    this.reduced.addEventListener('change', this.stop, { signal });
  }
  stop = () => { cancelAnimationFrame(this.frame); this.frame = 0; };
  scrolled = () => {
    if (this.frame && (this.view.scrollDOM.scrollTop !== this.expectedTop || this.view.scrollDOM.scrollLeft !== this.expectedLeft)) this.stop();
  };
  wheel = (event: WheelEvent) => {
    const now = performance.now(), notch = isWheelNotch(event, now - this.lastNative);
    // DOMにはphaseがないため、細かい入力から400msは標準へ任せ、連続入力の間は延長する。
    // shortcut: トラックパッドの最初の入力が40pxの倍数だと区別できない。実機で起きる場合はネイティブ側で判別する。
    if (!notch) this.lastNative = now;
    if (!notch || this.reduced.matches || !event.cancelable || event.defaultPrevented) { this.stop(); return; }
    this.scrolled();
    const dom = this.view.scrollDOM;
    const delta = event.deltaY * (event.deltaMode === 1 ? this.view.defaultLineHeight : 1);
    this.target = wheelTarget(this.frame ? this.target : dom.scrollTop, delta, dom.scrollHeight - dom.clientHeight);
    event.preventDefault();
    this.from = this.expectedTop = dom.scrollTop;
    this.expectedLeft = dom.scrollLeft;
    this.started = now;
    if (!this.frame) this.frame = requestAnimationFrame(this.animate);
  };
  animate = (now: number) => {
    this.scrolled();
    if (!this.frame) return;
    const dom = this.view.scrollDOM;
    this.target = wheelTarget(this.target, 0, dom.scrollHeight - dom.clientHeight);
    const progress = (now - this.started) / 150;
    dom.scrollTop = wheelPosition(this.from, this.target, progress);
    this.expectedTop = dom.scrollTop;
    if (progress >= 1 || this.expectedTop === this.target) this.stop();
    else this.frame = requestAnimationFrame(this.animate);
  };
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.focusChanged || update.transactions.some(tr => tr.scrollIntoView)) this.stop();
  }
  destroy() { this.stop(); this.events.abort(); }
});

export const smoothWheel = [plugin, Prec.highest(EditorView.scrollHandler.of(view => { view.plugin(plugin)?.stop(); return false; }))];
