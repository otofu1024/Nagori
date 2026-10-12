import test from 'node:test';
import assert from 'node:assert/strict';
import { graphCanvas } from '../../src/lib/workspace/graphCanvas.ts';
import type { GraphData } from '../../src/lib/workspace/graph.ts';

test('canvas settles, retains positions, handles drag and cursor zoom, and releases its frame loop', (t) => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0,
    time = 0;
  const fonts = new Set<string>();
  const context = {
    set font(value: string) {
      fonts.add(value);
    },
    setTransform() {},
    clearRect() {},
    translate() {},
    scale() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillText() {},
  };
  class Canvas extends EventTarget {
    style = { cursor: '' };
    title = '';
    width = 0;
    height = 0;
    getContext() {
      return context;
    }
    getAttribute() {
      return '';
    }
    setAttribute() {}
    getBoundingClientRect() {
      return { width: 800, height: 600, left: 0, top: 0 };
    }
    focus() {}
    setPointerCapture() {}
    hasPointerCapture() {
      return false;
    }
  }
  const canvas = new Canvas();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: Object.assign(new EventTarget(), { devicePixelRatio: 2 }),
    document: { documentElement: {} },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let opened = '';
  const graph = graphCanvas(canvas as unknown as HTMLCanvasElement, (path) => {
    opened = path;
  });
  const dispatch = (type: string, fields: Record<string, unknown>) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, fields);
    canvas.dispatchEvent(event);
    return event;
  };
  const step = (count = 1) => {
    for (let i = 0; i < count && frames.size; i++) {
      const pending = [...frames.values()];
      frames.clear();
      time += 16.67;
      pending.forEach((callback) => callback(time));
    }
  };
  try {
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    const data: GraphData = {
      nodes: Array.from({ length: 350 }, (_, i) => ({ id: 'article:' + i, path: i + '.md', label: String(i), kind: 'article', degree: 2 })),
      edges: Array.from({ length: 350 }, (_, i) => ({ source: 'article:' + i, target: 'article:' + ((i + 1) % 350), kind: 'link' })),
    };
    graph.update(data);
    graph.current('0.md');
    graph.show(true);
    const started = performance.now();
    step(500);
    t.diagnostic(`350 nodes settled in ${(performance.now() - started).toFixed(1)}ms of simulation/drawing work`);
    assert.equal(canvas.width, 1600);
    assert.equal(canvas.height, 1200);
    assert.equal(graph.inspect().running, false);
    const draws = graph.inspect().draws;
    step(10);
    assert.equal(graph.inspect().draws, draws);
    const previous = graph.inspect().nodes;
    graph.update({ ...data, nodes: [...data.nodes, { id: 'tag:added', kind: 'tag', label: '#added', degree: 0 }] });
    assert.deepEqual(
      graph
        .inspect()
        .nodes.slice(0, 350)
        .map((node) => [node.x, node.y]),
      previous.map((node) => [node.x, node.y]),
    );
    step(500);
    assert.equal(graph.inspect().nodes.length, 351);
    assert.equal(graph.inspect().running, false);
    const beforeZoom = graph.inspect(),
      cursor = { x: 530, y: 350 };
    const worldX = (cursor.x - 400 - beforeZoom.x) / beforeZoom.scale,
      worldY = (cursor.y - 300 - beforeZoom.y) / beforeZoom.scale;
    const wheel = dispatch('wheel', { clientX: cursor.x, clientY: cursor.y, deltaY: -80, deltaMode: 0, ctrlKey: true });
    assert.equal(wheel.defaultPrevented, true);
    step(150);
    assert.deepEqual([...fonts], ['12px -apple-system, BlinkMacSystemFont, sans-serif']);
    let zoomed = graph.inspect();
    assert.ok(zoomed.scale > beforeZoom.scale);
    assert.ok(Math.abs(400 + zoomed.x + worldX * zoomed.scale - cursor.x) < 0.01);
    assert.ok(Math.abs(300 + zoomed.y + worldY * zoomed.scale - cursor.y) < 0.01);
    const pinchScale = zoomed.scale;
    dispatch('gesturestart', {});
    const gesture = dispatch('gesturechange', { scale: 1.25 });
    step(150);
    zoomed = graph.inspect();
    assert.equal(gesture.defaultPrevented, true);
    assert.ok(Math.abs(zoomed.scale - pinchScale * 1.25) < 0.001);
    assert.ok(Number.isFinite(zoomed.x) && Number.isFinite(zoomed.y));
    const first = zoomed.nodes[0];
    dispatch('pointerdown', { pointerId: 1, button: 0, clientX: first.screenX, clientY: first.screenY });
    dispatch('pointermove', { pointerId: 1, clientX: first.screenX + 100, clientY: first.screenY + 50 });
    step();
    assert.ok(Math.abs(graph.inspect().nodes[0].screenX - first.screenX - 100) < 0.01);
    dispatch('pointerup', { pointerId: 1, clientX: first.screenX + 100, clientY: first.screenY + 50 });
    step(500);
    assert.equal(opened, '');
    assert.equal(graph.inspect().running, false);
    assert.notDeepEqual(graph.inspect().nodes[1], zoomed.nodes[1]);
    const clicked = graph.inspect().nodes[0];
    dispatch('pointerdown', { pointerId: 1, button: 0, clientX: clicked.screenX, clientY: clicked.screenY });
    dispatch('pointerup', { pointerId: 1, clientX: clicked.screenX, clientY: clicked.screenY });
    assert.equal(opened, '0.md');
    dispatch('pointerdown', { pointerId: 1, button: 0, clientX: -10000, clientY: -10000 });
    const panned = graph.inspect().x;
    dispatch('pointermove', { pointerId: 1, clientX: -9950, clientY: -9980 });
    step();
    assert.ok(graph.inspect().x > panned);
    dispatch('pointerup', { pointerId: 1 });
    step(500);
    assert.equal(graph.inspect().running, false);
    graph.show(false);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    window.dispatchEvent(new Event('resize'));
    assert.equal(canvas.width, 0);
    graph.update({ nodes: [], edges: [] });
    assert.equal(frames.size, 0);
    dispatch('keydown', { key: 'ArrowRight' });
    graph.show(true);
    step(500);
    assert.equal(graph.inspect().running, false);
    graph.update(data);
    graph.destroy();
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.deepEqual(graph.inspect().nodes, []);
    assert.equal(graph.inspect().edges, 0);
    assert.equal(frames.size, 0);
    dispatch('wheel', { deltaY: -80 });
    assert.equal(frames.size, 0);
  } finally {
    graph.destroy();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
