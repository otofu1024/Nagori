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

export function wheelPosition(from: number, to: number, elapsed: number): number {
  return from + (to - from) * (1 - Math.exp(-Math.max(0, elapsed) / 30));
}

let stopWheel = (_dom?: HTMLElement) => {};

export function mountSmoothWheel() {
  let frame = 0, target = 0, previousTime = 0, expectedTop = 0, expectedLeft = 0, lastNative = -Infinity;
  let dom: HTMLElement | undefined;
  const events = new AbortController(), signal = events.signal;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stop = () => { cancelAnimationFrame(frame); frame = 0; dom = undefined; };
  stopWheel = (element) => { if (!element || element === dom) stop(); };
  const scrolled = () => {
    if (dom && (!dom.isConnected || dom.scrollTop !== expectedTop || dom.scrollLeft !== expectedLeft)) stop();
  };
  const animate = (now: number) => {
    scrolled();
    if (!dom) return;
    target = wheelTarget(target, 0, dom.scrollHeight - dom.clientHeight);
    const position = wheelPosition(dom.scrollTop, target, now - previousTime);
    dom.scrollTop = Math.abs(target - position) <= 1 ? target : position;
    expectedTop = dom.scrollTop;
    previousTime = now;
    if (expectedTop === target) stop();
    else frame = requestAnimationFrame(animate);
  };
  const wheel = (event: WheelEvent) => {
    const now = performance.now(), notch = isWheelNotch(event, now - lastNative);
    // DOMにはphaseがないため、細かい入力から400msは標準へ任せ、連続入力の間は延長する。
    // shortcut: トラックパッドの最初の入力が40pxの倍数だと区別できない。実機で起きる場合はネイティブ側で判別する。
    if (!notch) lastNative = now;
    if (!notch || reduced.matches || !event.cancelable || event.defaultPrevented) { stop(); return; }
    scrolled();
    const element = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement &&
      node.scrollHeight > node.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY));
    if (!element) { stop(); return; }
    if (dom !== element) {
      stop();
      dom = element;
      target = expectedTop = dom.scrollTop;
      expectedLeft = dom.scrollLeft;
      previousTime = now;
    }
    const style = getComputedStyle(dom);
    const delta = event.deltaY * (event.deltaMode === 1 ? parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 : 1);
    target = wheelTarget(target, delta, dom.scrollHeight - dom.clientHeight);
    event.preventDefault();
    if (target === dom.scrollTop) stop();
    else if (!frame) frame = requestAnimationFrame(animate);
  };
  document.addEventListener('wheel', wheel, { passive: false, signal });
  document.addEventListener('scroll', scrolled, { capture: true, passive: true, signal });
  for (const name of ['keydown', 'pointerdown', 'touchstart', 'compositionstart', 'input', 'click']) {
    document.addEventListener(name, stop, { capture: true, passive: true, signal });
  }
  reduced.addEventListener('change', stop, { signal });
  return () => { stop(); events.abort(); stopWheel = () => {}; };
}

const plugin = ViewPlugin.fromClass(class {
  view: EditorView;
  constructor(view: EditorView) { this.view = view; }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.focusChanged || update.transactions.some(tr => tr.scrollIntoView)) stopWheel(this.view.scrollDOM);
  }
  destroy() { stopWheel(this.view.scrollDOM); }
});

export const smoothWheel = [plugin, Prec.highest(EditorView.scrollHandler.of(view => { stopWheel(view.scrollDOM); return false; }))];
