import { mount, tick } from 'svelte';
import App from '../../src/App.svelte';
import { buildGraph } from '../../src/lib/workspace/graph.ts';
import { defaults } from '../../src/lib/workspace/settings.ts';
import '../../src/app.css';

const root = '/private/tmp/nagori-graph-memory';
const paths = Array.from({ length: 300 }, (_, i) => `notes/article-${i}.md`);
const errors = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, timeout = 20000) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > timeout) throw new Error('状態の切り替えが時間切れになりました');
    await pause(50);
  }
}
let draws = 0;
const clear = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function (...args) {
  if (this.canvas.closest('.graph-view')) draws++;
  return clear.apply(this, args);
};
let phase = 'before',
  sourceBytes = 0,
  payloadBytes = 0,
  count = 0,
  edgeCount = 0;
const callbacks = new Map();
let sequence = 0;
let settings = { ...defaults, theme: 'light', lastProject: root, lastFile: paths[0] };
const entries = paths.map((path) => ({ path, name: path.split('/').at(-1), kind: 'markdown', modified: 1 }));
const listing = (path) => {
  const children = new Map();
  const prefix = path ? path + '/' : '';
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length),
      name = relative.split('/')[0];
    children.set(name, relative.includes('/') ? { path: prefix + name, name, kind: 'directory' } : entry);
  }
  return [...children.values()];
};
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
window.isTauri = true;
window.__TAURI_INTERNALS__ = {
  transformCallback(callback) {
    callbacks.set(++sequence, callback);
    return sequence;
  },
  unregisterCallback(id) {
    callbacks.delete(id);
  },
  async invoke(command, args = {}) {
    if (command === 'plugin:event|listen') return args.handler;
    if (command === 'plugin:event|unlisten') return;
    if (command === 'settings_get') return settings;
    if (command === 'settings_save') {
      settings = { ...settings, ...args.patch };
      return;
    }
    if (command === 'open_request_take') return null;
    if (command === 'workspace_open') return { root, blogMode: false };
    if (command === 'workspace_list') return listing(args.path);
    if (command === 'workspace_index') return entries;
    if (command === 'trash_list') return [];
    if (command === 'document_open') {
      const doc = await json('./graph-memory-document');
      return { ...doc, path: args.path, baseline: 'fixture-baseline', readonly: false };
    }
    if (command === 'image_read')
      return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTWkAAAAASUVORK5CYII='), (char) =>
        char.charCodeAt(0),
      ).buffer;
    if (command === 'workspace_graph_documents') {
      const result = await json('./graph-memory-data');
      sourceBytes = result.sourceBytes;
      payloadBytes = new TextEncoder().encode(JSON.stringify(result.articles)).length;
      const graph = buildGraph(result.articles);
      count = graph.nodes.length;
      edgeCount = graph.edges.length;
      return result.articles;
    }
    if (command === 'document_save') return { baseline: 'fixture-saved' };
    throw new Error('確認ページにないコマンド: ' + command);
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
const nav = () => [...document.querySelectorAll('.nav-row')].find((button) => button.textContent.includes('グラフビュー'));
const snapshot = () => {
  const canvas = document.querySelector('.graph-view canvas');
  return {
    phase,
    articles: paths.length,
    sourceBytes,
    payloadBytes,
    nodes: count,
    edges: edgeCount,
    draws,
    canvas: canvas ? { width: canvas.width, height: canvas.height, bytes: canvas.width * canvas.height * 4 } : null,
    errors: [...errors],
  };
};
const display = () => {
  document.querySelector('#state').textContent = JSON.stringify(snapshot());
};
window.graphMemory = {
  snapshot,
  async open() {
    if (!document.querySelector('.graph-view')) nav().click();
    await until(
      () =>
        document.querySelector('.graph-view canvas')?.width && document.querySelector('.graph-view').getAttribute('aria-busy') === 'false',
    );
    await until(() => draws > 0);
    const start = performance.now();
    while (true) {
      const previous = draws;
      await pause(500);
      if (previous === draws) break;
      if (performance.now() - start > 20000) throw new Error('グラフの描画が止まりません');
    }
    phase = 'open';
    display();
    return snapshot();
  },
  async close() {
    const canvas = document.querySelector('.graph-view canvas');
    if (canvas) nav().click();
    await tick();
    await until(() => !document.querySelector('.graph-view'));
    if (canvas && (canvas.width || canvas.height)) throw new Error('Canvasの描画領域が残っています');
    phase = 'closed';
    display();
    return snapshot();
  },
};
window.run = async () => {
  try {
    mount(App, { target: document.querySelector('#host') });
    await until(() => document.querySelector('.cm-editor') && nav());
    await pause(1000);
    display();
    document.querySelector('#open').onclick = () =>
      window.graphMemory.open().catch((error) => {
        errors.push(String(error));
        display();
      });
    document.querySelector('#close').onclick = () =>
      window.graphMemory.close().catch((error) => {
        errors.push(String(error));
        display();
      });
    const target = new URLSearchParams(location.search).get('phase') ?? 'before';
    if (target === 'open' || target === 'closed') await window.graphMemory.open();
    if (target === 'closed') await window.graphMemory.close();
    const hold = Number(new URLSearchParams(location.search).get('hold') ?? 0);
    if (hold > 0) await pause(Math.min(hold, 240) * 1000);
    return JSON.stringify({ pass: !errors.length, ...snapshot() });
  } catch (error) {
    return JSON.stringify({ pass: false, ...snapshot(), error: String(error) });
  }
};
window.ready = true;
