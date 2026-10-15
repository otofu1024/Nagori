import { mount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import App from '../../src/App.svelte';
import { buildGraph } from '../../src/lib/workspace/graph.ts';
import { defaults } from '../../src/lib/workspace/settings.ts';
import '../../src/app.css';
const errors = [],
  checks = [],
  diagnostics = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, pass) => checks.push({ name, pass: !!pass });
async function until(test, limit = 15000) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > limit) throw new Error('確認の待ち時間を超えました');
    await pause(30);
  }
}
async function waitIdle() {
  const start = performance.now();
  while (performance.now() - start < 15000) {
    const previous = draws;
    await pause(400);
    if (previous === draws) return;
  }
  throw new Error('グラフの描画が止まりません');
}
let draws = 0,
  painted = { nodes: [], edges: 0 };
const prototype = CanvasRenderingContext2D.prototype;
const clear = prototype.clearRect,
  arc = prototype.arc,
  fill = prototype.fill,
  line = prototype.lineTo;
let lastArc;
prototype.clearRect = function (...args) {
  if (this.canvas.closest('.graph-view')) {
    draws++;
    painted = { nodes: [], edges: 0 };
  }
  return clear.apply(this, args);
};
prototype.arc = function (x, y, radius, ...args) {
  if (this.canvas.closest('.graph-view')) {
    const matrix = this.getTransform(),
      ratio = window.devicePixelRatio || 1;
    lastArc = {
      worldX: x,
      worldY: y,
      x: (matrix.a * x + matrix.c * y + matrix.e) / ratio,
      y: (matrix.b * x + matrix.d * y + matrix.f) / ratio,
      radius,
    };
  }
  return arc.call(this, x, y, radius, ...args);
};
prototype.fill = function (...args) {
  if (this.canvas.closest('.graph-view') && lastArc) painted.nodes.push({ ...lastArc, color: this.fillStyle, alpha: this.globalAlpha });
  return fill.apply(this, args);
};
prototype.lineTo = function (...args) {
  if (this.canvas.closest('.graph-view')) painted.edges++;
  return line.apply(this, args);
};
async function extract(documents) {
  const response = await fetch('./graph-extract', { method: 'POST', body: JSON.stringify(documents) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
window.show = async () => {};
window.run = async () => {
  try {
    const response = await fetch('./graph-data');
    if (!response.ok) throw new Error('テスト用ワークスペースを読み込めません: ' + (await response.text()));
    const { root, documents } = await response.json();
    const files = new Map(documents.map((doc) => [doc.path, doc.text]));
    const article = documents.find((doc) => doc.path === 'notes/first.md');
    if (!article) throw new Error('テスト用ワークスペースにノートがありません');
    let settings = { ...defaults, theme: 'light', lastProject: root, lastFile: article.path, autosaveDelay: 5000, zoomFontSize: true };
    const callbacks = new Map(),
      listeners = new Map(),
      opened = [],
      saved = [];
    let sequence = 0;
    const entries = () => [...files].map(([path]) => ({ path, name: path.split('/').at(-1), kind: 'markdown', modified: 1 }));
    const listing = (path) => {
      const children = new Map();
      const prefix = path ? path + '/' : '';
      for (const entry of entries()) {
        if (!entry.path.startsWith(prefix)) continue;
        const relative = entry.path.slice(prefix.length),
          name = relative.split('/')[0];
        children.set(name, relative.includes('/') ? { path: prefix + name, name, kind: 'directory' } : entry);
      }
      return [...children.values()];
    };
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
        if (command === 'plugin:event|listen') {
          listeners.set(args.event, args.handler);
          return args.handler;
        }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'settings_get') return settings;
        if (command === 'settings_save') {
          settings = args.settings;
          return;
        }
        if (command === 'open_request_take') return null;
        if (command === 'workspace_open') return { root, blogMode: false };
        if (command === 'workspace_list') return listing(args.path);
        if (command === 'workspace_index') return entries();
        if (command === 'trash_list') return [];
        if (command === 'image_read')
          return Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTWkAAAAASUVORK5CYII='),
            (char) => char.charCodeAt(0),
          ).buffer;
        if (command === 'workspace_graph_documents')
          return extract([...files].map(([path, text]) => ({ path, text: args.draft?.path === path ? args.draft.text : text })));
        if (command === 'document_open') {
          opened.push(args.path);
          if (!files.has(args.path)) throw Error('missing');
          return { path: args.path, text: files.get(args.path), baseline: files.get(args.path), readonly: false };
        }
        if (command === 'document_save') {
          if (files.get(args.path) !== args.baseline) throw { code: 'CONFLICT', message: '競合' };
          files.set(args.path, args.text);
          saved.push(args);
          return { baseline: args.text };
        }
        throw new Error('確認ページにないコマンド: ' + command);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    const changed = () => callbacks.get(listeners.get('nagori:fs-changed'))({ payload: { project: root, paths: [...files.keys()] } });
    mount(App, { target: document.querySelector('#host') });
    await until(() => document.querySelector('.cm-editor'));
    const editorElement = document.querySelector('.cm-editor'),
      editor = EditorView.findFromDOM(editorElement);
    const original = editor.state.doc.toString(),
      edited = original + '\n\nグラフを開く前の編集';
    editor.dispatch({ changes: { from: original.length, insert: edited.slice(original.length) } });
    const nav = () => [...document.querySelectorAll('.nav-row')].find((button) => button.textContent.includes('グラフビュー'));
    nav().click();
    await until(
      () =>
        document.querySelector('.graph-view:not([hidden]) canvas') &&
        document.querySelector('.graph-view').getAttribute('aria-busy') === 'false',
    );
    await until(() => painted.nodes.length > 0);
    const expected = buildGraph(await extract([...files].map(([path, text]) => ({ path, text: path === article.path ? edited : text }))));
    check('titleのないノートを含む4文書と2タグが描かれる', painted.nodes.length === 6 && expected.nodes.length === 6);
    check('タグと相対パスとwikiリンクの6本の線が描かれる', painted.edges === 6 && expected.edges.length === 6);
    check('ゴミ箱の直下にグラフビューの行がある', nav().previousElementSibling.textContent.includes('ゴミ箱'));
    check(
      'グラフ内に操作の説明が出ない',
      !document.querySelector('.graph-help') && !document.querySelector('.graph-view').textContent.trim(),
    );
    check(
      '本文だけが隠れ、既存のエディタが保持されている',
      document.querySelector('.editor-root').hidden &&
        document.querySelector('.cm-editor') === editorElement &&
        editor.state.doc.toString() === edited,
    );
    const canvas = document.querySelector('.graph-view:not([hidden]) canvas');
    check('Retinaの解像度に合わせて描かれる', canvas.width === Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
    check(
      '現在の文書の点がアクセント色になる',
      painted.nodes[expected.nodes.findIndex((node) => node.path === article.path)].color ===
        getComputedStyle(canvas).getPropertyValue('--accent').trim(),
    );
    await until(() => saved.some((save) => save.path === article.path && save.text === edited), 7000);
    await waitIdle();
    let before = draws;
    await pause(400);
    check('落ち着いた後は描画が止まる', draws === before);
    check(
      'グラフを見ている間も本文が保存される',
      saved.some((save) => save.path === article.path && save.text === edited),
    );
    const bounds = canvas.getBoundingClientRect(),
      node = painted.nodes[expected.nodes.findIndex((node) => node.path === article.path)];
    // Synthetic pointer events have no native pointer capture.
    canvas.setPointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
    const pointer = (type, point) => {
      const event = new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: bounds.left + point.x, clientY: bounds.top + point.y });
      canvas.dispatchEvent(event);
      diagnostics.push({ type, point, bounds: canvas.getBoundingClientRect().toJSON(), pixelWidth: canvas.width, pixelHeight: canvas.height, ratio: window.devicePixelRatio, clientX: event.clientX, clientY: event.clientY, title: canvas.title, draws });
    };
    // 最初のノートはほかのすべての点とつながるので、つながりの少ない「散歩」でホバーを確かめる
    const walk = painted.nodes[expected.nodes.findIndex((item) => item.path === '日記/散歩.md')];
    pointer('pointermove', walk);
    await pause(450);
    check('ホバーで関係のない点が薄くなる', painted.nodes.some((point) => point.alpha < 0.5));
    pointer('pointermove', node);
    await pause(450);
    pointer('pointerdown', node);
    pointer('pointerup', node);
    await tick();
    check('閉じたCanvasの描画領域が解放される', canvas.width === 0 && canvas.height === 0 && !canvas.isConnected);
    check('点を押すと記事へ戻る', !document.querySelector('.graph-view:not([hidden])') && settings.lastFile === article.path);
    check(
      '戻ったエディタで編集中の本文とUndo履歴が保たれる',
      document.querySelector('.cm-editor') === editorElement &&
        editor.state.doc.toString() === edited &&
        undo(editor) &&
        editor.state.doc.toString() === original,
    );
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: edited.slice(original.length) } });
    nav().click();
    await pause(600);
    nav().click();
    await pause(100);
    check(
      'もう一度行を押すと本文が保たれたまま戻る',
      !document.querySelector('.graph-view:not([hidden])') && editor.state.doc.toString() === edited,
    );
    nav().click();
    await pause(600);
    document.querySelector('.graph-view:not([hidden]) .graph-back').click();
    await pause(300);
    check(
      '右上の戻るボタンで本文が保たれたまま戻る',
      !document.querySelector('.graph-view:not([hidden])') && editor.state.doc.toString() === edited,
    );
    nav().click();
    await pause(600);
    document.querySelector('.nav-row').click();
    await tick();
    const note =
      [...document.querySelectorAll('.note-list button')].find((button) => !button.classList.contains('active')) ??
      document.querySelector('.note-list button');
    note?.click();
    await pause(300);
    check(
      'ファイル一覧で記事を開くとエディタに戻る',
      !document.querySelector('.graph-view:not([hidden])') && settings.lastFile === note.title,
    );
    nav().click();
    await pause(600);
    const visibleCanvas = document.querySelector('.graph-view:not([hidden]) canvas');
    before = draws;
    visibleCanvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -40,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      }),
    );
    await pause(400);
    check('拡大縮小はグラフにだけ反映される', draws > before && settings.fontSize === defaults.fontSize);
    document.querySelector('[aria-label="ダークモードに切り替える"]').click();
    await pause(500);
    check(
      'ダークテーマでも既存の色を使う',
      document.documentElement.dataset.theme === 'dark' && painted.nodes.every((point) => point.color),
    );
    const added = 'notes/graph-fixture.md';
    files.set(added, '---\ntitle: 追加したノート\ntags: [グラフ確認]\n---\n[元のノート](first.md)');
    changed();
    await pause(1000);
    const refreshed = buildGraph(await extract([...files].map(([path, text]) => ({ path, text }))));
    check(
      'ファイルの追加がグラフに反映される',
      painted.nodes.length === refreshed.nodes.length && painted.edges === refreshed.edges.length,
    );
    files.delete(added);
    changed();
    await pause(800);
    check(
      'ファイルの削除と使われなくなったタグが反映される',
      painted.nodes.length === buildGraph(await extract([...files].map(([path, text]) => ({ path, text })))).nodes.length,
    );
    await waitIdle();
    before = draws;
    await pause(400);
    check('再読み込みとテーマ変更の後も描画が止まる', draws === before);
    return JSON.stringify({
      pass: checks.every((check) => check.pass) && !errors.length,
      checks,
      errors,
      articles: documents.length,
      nodes: expected.nodes.length,
      edges: expected.edges.length,
      draws,
      diagnostics,
    });
  } catch (error) {
    errors.push(String(error));
    return JSON.stringify({ pass: false, checks, errors, diagnostics });
  }
};
window.ready = true;
