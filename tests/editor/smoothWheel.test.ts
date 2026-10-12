import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isWheelNotch, wheelTarget, wheelPosition, mountSmoothWheel, smoothWheel } from '../../src/lib/editor/smoothWheel.ts';

test('WKWebViewの刻みだけを判別し、細かい入力と横方向とズームを除く', () => {
  const wheel = { deltaMode: 0, deltaY: 40, deltaX: 0, wheelDeltaY: -120, ctrlKey: false, shiftKey: false };
  assert.equal(isWheelNotch(wheel), true);
  assert.equal(isWheelNotch(wheel, 399), false);
  assert.equal(isWheelNotch(wheel, 400), true);
  assert.equal(isWheelNotch({ ...wheel, deltaY: -120, wheelDeltaY: 360 }), true);
  assert.equal(isWheelNotch({ ...wheel, deltaMode: 1, deltaY: 3, wheelDeltaY: undefined }), true);
  for (const other of [{ deltaY: 8, wheelDeltaY: -24 }, { deltaY: 39.9 }, { wheelDeltaY: undefined },
    { deltaMode: 2 }, { deltaMode: 1, deltaY: 0.5 }, { deltaY: 0 }, { deltaY: NaN }, { deltaY: Infinity },
    { ctrlKey: true }, { shiftKey: true }, { deltaX: 1 }, { wheelDeltaY: 120 }]) {
    assert.equal(isWheelNotch({ ...wheel, ...other }), false, JSON.stringify(other));
  }
});

test('刻みを目標位置へ加算し、上下の端で止める', () => {
  assert.equal(wheelTarget(wheelTarget(100, 40, 500), 120, 500), 260);
  assert.equal(wheelTarget(100, -200, 500), 0);
  assert.equal(wheelTarget(490, 40, 500), 500);
  assert.equal(wheelTarget(500, -40, 500), 460);
  assert.equal(wheelTarget(0, 40, -10), 0);
});

test('指数の追従は上下とも目標へ近づき、フレーム間隔が変わっても同じ位置になる', () => {
  assert.equal(wheelPosition(100, 140, -1), 100);
  assert.equal(wheelPosition(100, 140, 0), 100);
  const once = wheelPosition(100, 180, 150);
  const twice = wheelPosition(wheelPosition(100, 180, 50), 180, 100);
  assert.ok(Math.abs(once - twice) < 1e-10);
  assert.ok(180 - once < 1);
  assert.ok(wheelPosition(180, 100, 16) < 180);
  assert.ok(wheelPosition(180, 100, 16) > 100);
});

function recorded(name: string): number[][] {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}-wheel.json`, import.meta.url), 'utf8')).events;
}

function mounted(t: test.TestContext) {
  class Element extends EventTarget {
    scrollTop = 1000;
    scrollLeft = 0;
    scrollHeight = 1_000_000;
    clientHeight = 500;
    isConnected = true;
    overflowY = 'auto';
  }
  const doc = new EventTarget(), media = Object.assign(new EventTarget(), { matches: false });
  const frames = new Map<number, FrameRequestCallback>();
  let now = 0, sequence = 0;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    document: doc, HTMLElement: Element, matchMedia: () => media,
    getComputedStyle: (element: Element) => ({ overflowY: element.overflowY, lineHeight: '24px', fontSize: '16px' }),
    performance: { now: () => now },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const release = mountSmoothWheel();
  t.after(() => {
    release();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const element = new Element();
  const wheel = (fields: Record<string, unknown> = {}, path = [element], cancelable = true) => {
    const event = new Event('wheel', { cancelable });
    const { defaultPrevented, ...input } = fields;
    Object.assign(event, { deltaY: 80, deltaX: 0, deltaMode: 0, wheelDeltaY: -240, ctrlKey: false, shiftKey: false, ...input });
    if (defaultPrevented) event.preventDefault();
    event.composedPath = () => path;
    doc.dispatchEvent(event);
    return event;
  };
  const step = (time: number) => {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  };
  return { doc, media, frames, element, Element, wheel, step, release, time: (time: number) => { now = time; } };
}

test('MX Masterの実測828件を再生し、同方向の目標と表示が進み、詰まった入力でも速さを保つ', t => {
  const h = mounted(t), rows = recorded('mx-master');
  h.element.scrollTop = 500_000;
  assert.equal(rows.length, 828);
  let direction = 0, target = h.element.scrollTop, frameTime = rows[0][0], previousSpeed = 0, speedChecks = 0;
  const frameDuration = 1000 / 60;
  for (const [time, deltaX, deltaY, wheelDeltaY, deltaMode] of rows) {
    while (frameTime + frameDuration <= time) {
      frameTime += frameDuration;
      const before = h.element.scrollTop;
      h.step(frameTime);
      const speed = (h.element.scrollTop - before) * direction / frameDuration;
      assert.ok(speed >= 0);
      assert.ok((target - h.element.scrollTop) * direction >= -1e-8);
      if (previousSpeed > 0 && h.frames.size && Math.abs(target - h.element.scrollTop) > 2) {
        assert.ok(speed + 1e-8 >= previousSpeed * Math.exp(-frameDuration / 30));
        speedChecks++;
      }
      previousSpeed = h.frames.size ? speed : 0;
    }
    if (direction !== Math.sign(deltaY)) {
      h.doc.dispatchEvent(new Event('click'));
      direction = Math.sign(deltaY);
      target = h.element.scrollTop;
      previousSpeed = 0;
    }
    const before = target;
    target = wheelTarget(target, deltaY, h.element.scrollHeight - h.element.clientHeight);
    assert.ok((target - before) * direction > 0);
    h.time(time);
    assert.equal(h.wheel({ deltaX, deltaY, wheelDeltaY, deltaMode }).defaultPrevented, true);
    assert.equal(h.frames.size, 1);
  }
  h.step(rows.at(-1)![0] + 500);
  assert.equal(h.element.scrollTop, target);
  assert.equal(h.frames.size, 0);
  assert.ok(speedChecks > 100);
});

test('トラックパッドの実測1288件は刻みと同じ5件も含めて標準へ任せる', t => {
  const h = mounted(t), rows = recorded('trackpad');
  assert.equal(rows.length, 1288);
  let notchShapes = 0;
  for (const [time, deltaX, deltaY, wheelDeltaY, deltaMode] of rows) {
    h.time(time);
    const fields = { deltaX, deltaY, wheelDeltaY, deltaMode, ctrlKey: false, shiftKey: false };
    if (wheelDeltaY !== 0 && wheelDeltaY % 120 === 0 && Math.abs(deltaY + wheelDeltaY / 3) < 0.01) notchShapes++;
    assert.equal(h.wheel(fields).defaultPrevented, false);
    assert.equal(h.frames.size, 0);
  }
  assert.equal(notchShapes, 5);
  assert.equal(h.element.scrollTop, 1000);
});

test('最も近いスクロール欄を選び、端で止め、別の欄へ切り替える', t => {
  const h = mounted(t), child = new h.Element(), outer = new h.Element();
  child.overflowY = 'hidden';
  h.wheel({}, [child, h.element, outer]);
  h.step(50);
  assert.ok(h.element.scrollTop > 1000);
  assert.equal(child.scrollTop, 1000);
  h.wheel({}, [outer]);
  const left = h.element.scrollTop;
  h.step(100);
  assert.equal(h.element.scrollTop, left);
  assert.ok(outer.scrollTop > 1000);
  outer.scrollTop = outer.scrollHeight - outer.clientHeight;
  h.wheel({}, [outer, h.element]);
  assert.equal(h.frames.size, 0);
  assert.equal(h.element.scrollTop, left);
  outer.scrollTop = 0;
  h.wheel({ deltaY: -80, wheelDeltaY: 240 }, [outer, h.element]);
  assert.equal(h.frames.size, 0);
  h.wheel({ deltaMode: 1, deltaY: 2 }, [outer]);
  h.step(300);
  assert.equal(outer.scrollTop, 48);
});

test('標準の入力、別操作、外からのスクロールと破棄で追従を止める', t => {
  const h = mounted(t);
  let time = 0;
  const start = () => { h.time(time += 1000); h.wheel(); assert.equal(h.frames.size, 1); };
  for (const fields of [{ ctrlKey: true }, { shiftKey: true }, { deltaX: 1 }, { deltaY: 8, wheelDeltaY: -24 }]) {
    start();
    assert.equal(h.wheel(fields).defaultPrevented, false);
    assert.equal(h.frames.size, 0);
  }
  for (const name of ['keydown', 'pointerdown', 'touchstart', 'compositionstart', 'input', 'click']) {
    start(); h.doc.dispatchEvent(new Event(name)); assert.equal(h.frames.size, 0);
  }
  start(); h.element.scrollTop += 10; h.doc.dispatchEvent(new Event('scroll')); assert.equal(h.frames.size, 0);
  start(); h.element.scrollLeft += 10; h.step(time + 16); assert.equal(h.frames.size, 0);
  start(); h.media.matches = true; h.media.dispatchEvent(new Event('change')); assert.equal(h.frames.size, 0);
  assert.equal(h.wheel().defaultPrevented, false);
  h.media.matches = false;
  assert.equal(h.wheel({}, [], false).defaultPrevented, false);
  assert.equal(h.wheel({}, []).defaultPrevented, false);
  start(); h.wheel({ defaultPrevented: true }); assert.equal(h.frames.size, 0);
  start(); h.element.isConnected = false; h.step(time + 16); assert.equal(h.frames.size, 0);
  h.element.isConnected = true;
  const extension = smoothWheel as unknown as [{ create(view: unknown): { update(update: unknown): void; destroy(): void } }];
  const plugin = extension[0].create({ scrollDOM: h.element });
  for (const change of [{ docChanged: true }, { selectionSet: true }, { focusChanged: true }, { transactions: [{ scrollIntoView: true }] }]) {
    start(); plugin.update({ transactions: [], ...change }); assert.equal(h.frames.size, 0);
  }
  start();
  const state = EditorState.create({ extensions: smoothWheel });
  state.facet(EditorView.scrollHandler)[0]({ scrollDOM: h.element } as EditorView, state.selection.main, { x: 'nearest', y: 'nearest', xMargin: 0, yMargin: 0 });
  assert.equal(h.frames.size, 0);
  start(); plugin.destroy(); assert.equal(h.frames.size, 0);
  start(); h.release(); assert.equal(h.frames.size, 0);
  assert.equal(h.wheel().defaultPrevented, false);
});
