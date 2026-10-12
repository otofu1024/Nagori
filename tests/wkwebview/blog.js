import { mount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import App from '../../src/App.svelte';
import { buildGraph } from '../../src/lib/workspace/graph.ts';
import { BLOG_DIRECTORY } from '../../src/lib/workspace/navigation.ts';
import { readProperties } from '../../src/lib/workspace/frontMatter.ts';
import { templateProperties } from '../../src/lib/editor/previewProperties.ts';
import { defaults } from '../../src/lib/workspace/settings.ts';
import '../../src/app.css';
const checks = [],
  errors = [];
const check = (name, pass) => checks.push({ name, pass: !!pass });
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function until(test) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > 15000) throw Error('確認の待ち時間を超えました');
    await pause();
  }
}
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
window.show = async () => {};
window.run = async () => {
  try {
    const response = await fetch('./blog-data');
    if (!response.ok) throw Error(await response.text());
    const data = await response.json(),
      { root, entries, generic, documents } = data;
    const article = documents.find((doc) => doc.text.startsWith('---'));
    if (!article) throw Error('ブログのコピーにFront Matter付きの記事がありません');
    const files = new Map(documents.map((doc) => [doc.path, doc.text]));
    const originals = new Map(files);
    const saves = [];
    let settings = { ...defaults, lastProject: root, lastFile: article.path, theme: 'light', autosaveDelay: 5000 };
    let blogMode = true,
      sequence = 0;
    const callbacks = new Map();
    const listing = (path) => {
      const prefix = path || (blogMode ? BLOG_DIRECTORY : '');
      const children = new Map();
      for (const entry of blogMode ? entries : generic) {
        if (prefix && !entry.path.startsWith(prefix + '/')) continue;
        const relative = entry.path.slice(prefix ? prefix.length + 1 : 0),
          name = relative.split('/')[0];
        children.set(name, relative.includes('/') ? { path: prefix ? prefix + '/' + name : name, name, kind: 'directory' } : entry);
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
        if (command === 'plugin:event|listen') return args.handler;
        if (command === 'plugin:event|unlisten') return;
        if (command === 'settings_get') return settings;
        if (command === 'settings_save') {
          settings = args.settings;
          return;
        }
        if (command === 'open_request_take') return null;
        if (command === 'workspace_open') {
          blogMode = args.blogFeatures && data.blogMode;
          return { root, blogMode };
        }
        if (command === 'workspace_list') return listing(args.path);
        if (command === 'workspace_index') return blogMode ? entries : generic;
        if (command === 'workspace_search') return data.search;
        if (command === 'trash_list') return [];
        if (command === 'document_open')
          return { path: args.path, text: files.get(args.path), baseline: originals.get(args.path), readonly: false };
        if (command === 'document_save') {
          files.set(args.path, args.text);
          originals.set(args.path, args.text);
          saves.push(args);
          return { baseline: args.text };
        }
        if (command === 'workspace_graph_documents') {
          const response = await fetch('./graph-extract', {
            method: 'POST',
            body: JSON.stringify([...files].map(([path, text]) => ({ path, text: args.draft?.path === path ? args.draft.text : text }))),
          });
          if (!response.ok) throw Error(await response.text());
          return response.json();
        }
        throw Error('確認ページにないコマンド: ' + command);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    mount(App, { target: document.querySelector('#host') });
    await tick();
    await until(() => document.querySelector('.nagori-property-add') && document.querySelector('.tree-row'));
    check('Rustの判定がブログを認識', data.blogMode);
    check('Rustの一覧が記事だけを返す', entries.length > 0 && entries.every((entry) => entry.path.startsWith(BLOG_DIRECTORY + '/')));
    check(
      'Rustの検索が記事だけを返す',
      data.search.results.length > 0 && data.search.results.every((entry) => entry.path.startsWith(BLOG_DIRECTORY + '/')),
    );
    check(
      '一覧に記事だけが表示される',
      [...document.querySelectorAll('.tree-row')].every((row) => row.dataset.path.startsWith(BLOG_DIRECTORY + '/')),
    );
    check(
      '元のバーとワードマークを表示',
      !!document.querySelector('.brand-wordmark-light[src]') && !!document.querySelector('.brand-wordmark-dark[src]'),
    );
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const before = view.state.doc.toString();
    document.querySelector('.nagori-property-add').click();
    const select = document.querySelector('.nagori-properties select');
    const existing = readProperties(before).properties.map((property) => property.key);
    const missing = templateProperties.filter((key) => !existing.includes(key));
    check(
      '追加候補が未使用のテンプレート項目',
      [...select.options]
        .slice(1)
        .map((option) => option.value)
        .join(',') === missing.join(','),
    );
    if (missing.length) {
      select.value = missing[0];
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => view.state.doc.toString() !== before);
      check('候補を追加できる', !!readProperties(view.state.doc.toString()).properties.find((property) => property.key === missing[0]));
      undo(view);
      await until(() => view.state.doc.toString() === before);
      check('追加をUndoで戻せる', view.state.doc.toString() === before);
    }
    const routeDocs = [
      { path: BLOG_DIRECTORY + '/first/index.md', text: '[次](/posts/second) [[unique]]' },
      { path: BLOG_DIRECTORY + '/second/index.md', text: '# 次' },
      { path: BLOG_DIRECTORY + '/unique.md', text: '# wiki' },
    ];
    const extracted = await (await fetch('./graph-extract', { method: 'POST', body: JSON.stringify(routeDocs) })).json();
    check(
      '本番の抽出とグラフでpostsとwikiを解決',
      buildGraph(extracted, true).edges.length === 2 && buildGraph(extracted).edges.length === 1,
    );
    document.querySelector('.settings-button').click();
    await until(() => document.querySelector('.settings-dialog[open]'));
    [...document.querySelectorAll('.settings-nav button')].find((button) => button.textContent === 'エディタ').click();
    await tick();
    const toggle = [...document.querySelectorAll('.check-row')]
      .find((label) => label.textContent.trim() === 'ブログの機能')
      .querySelector('input');
    check('ブログの機能は初期値オン', toggle.checked);
    toggle.click();
    await until(
      () => !blogMode && document.querySelector('.nagori-property-key-input') && document.querySelector('.tree-row[data-path="src"]'),
    );
    check('オフで汎用の一覧と自由入力へ戻る', !settings.blogFeatures && !!document.querySelector('.nagori-property-key-input'));
    check(
      '切り替えでエディタと本文を保つ',
      view === EditorView.findFromDOM(document.querySelector('.cm-editor')) && view.state.doc.toString() === before,
    );
    await until(() => !toggle.disabled);
    toggle.click();
    await until(() => blogMode && document.querySelector('.nagori-properties select') && document.querySelector('.tree-row'));
    check(
      'オンでブログのモードへ戻る',
      settings.blogFeatures &&
        [...document.querySelectorAll('.tree-row')].every((row) => row.dataset.path.startsWith(BLOG_DIRECTORY + '/')),
    );
    document.querySelector('[aria-label="設定を閉じる"]').click();
    // モードの切り替えで同じ内容を書き戻すことはあるが、記事の中身は変えない
    check('元のコピーの中身を変える保存がない', saves.every((save) => save.text === save.baseline));
    return JSON.stringify({ pass: checks.every((check) => check.pass) && !errors.length, checks, errors, root });
  } catch (error) {
    return JSON.stringify({ pass: false, checks, errors: [...errors, String(error)] });
  }
};
window.ready = true;
