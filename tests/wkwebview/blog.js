import { mount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { EditorSelection, Transaction } from '@codemirror/state';
import { undo, isolateHistory } from '@codemirror/commands';
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
  let originalTheme;
  const writeTheme = async (path, text) => {
    const response = await fetch('./blog-theme', { method: 'POST', body: JSON.stringify({ path, text }) });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  };
  try {
    const response = await fetch('./blog-data');
    if (!response.ok) throw Error(await response.text());
    const data = await response.json(),
      { root, entries, generic, documents } = data;
    originalTheme = await (await fetch('./blog-theme')).json();
    const article = documents.find((doc) => doc.text.startsWith('---'));
    if (!article) throw Error('ブログのコピーにFront Matter付きの記事がありません');
    const files = new Map(documents.map((doc) => [doc.path, doc.text]));
    const originals = new Map(files);
    const saves = [];
    let settings = { ...defaults, lastProject: root, lastFile: article.path, theme: 'dark', autosaveDelay: 5000 };
    let blogMode = true,
      sequence = 0;
    const callbacks = new Map(),
      listeners = new Map();
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
        if (command === 'workspace_open') {
          blogMode = args.blogFeatures && data.blogMode;
          return { root, blogMode };
        }
        if (command === 'workspace_blog_config') return blogMode ? data.config : null;
        if (command === 'workspace_blog_theme') return blogMode ? (await fetch('./blog-theme')).json() : null;
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
    const content = document.querySelector('.cm-content'),
      host = document.querySelector('.editor-host');
    await until(() => host.hasAttribute('data-blog-theme'));
    check(
      'ダークモードでも本文だけブログの明るい配色',
      getComputedStyle(host).backgroundColor === 'rgb(255, 255, 255)' &&
        getComputedStyle(content).color === 'rgb(30, 42, 63)' &&
        getComputedStyle(document.querySelector('.sidebar')).backgroundColor === 'rgb(19, 32, 49)',
    );
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const snapshot = () => view.state.doc.toString();
    const value = (key) => readProperties(snapshot()).properties.find((property) => property.key === key)?.value;
    const field = (key) => document.querySelector(`.article-header [data-key="${key}"]`);
    const replace = (text) =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [Transaction.userEvent.of('input.properties'), isolateHistory.of('full')],
      });
    const sampleHeader =
      '---\ntitle: 見出しの確認\ndescription: 説明の確認\npublishedAt: 2026-10-09\nupdatedAt: 2026-10-10\ncategory: tech\ntags: [最初, 次]\ndraft: false\ncustom: その他\n---\n\n本文です。\n次の行です。';
    replace(sampleHeader);
    await frame();
    check(
      '記事の構造とクラスで見出しを描く',
      !!document.querySelector('.article-header h1 .article-title-line') &&
        !!document.querySelector('.article-description') &&
        !!document.querySelector('.article-dates time') &&
        !!document.querySelector('.tag-list a'),
    );
    check('カテゴリの表示名を設定から読む', field('category').textContent === '技術');
    // 本文はカーソルを透明にしているので、見出しの入力欄で受け継がないこと
    check(
      '見出しの入力欄ではカーソルが見える',
      [field('title'), field('description'), document.querySelector('.nagori-header-tag-input')].every(
        (element) => getComputedStyle(element).caretColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(element).caretColor !== 'transparent',
      ),
    );
    check('タグの消去ボタンはマウスを合わせるまで出さない', getComputedStyle(document.querySelector('.tag-list a button')).opacity === '0');
    const tagInput = document.querySelector('.nagori-header-tag-input');
    check(
      'タグの追加欄はタグと同じくらいの高さ',
      tagInput.getBoundingClientRect().height <= document.querySelector('.tag-list a').getBoundingClientRect().height + 2,
    );
    const extraList = document.querySelector('.nagori-blog-properties'),
      wasOpen = extraList.open;
    extraList.open = true;
    check(
      'プロパティの見出しは1つだけ',
      [...document.querySelectorAll('.nagori-blog-header summary, .nagori-blog-header .nagori-properties-heading')].filter(
        (element) => element.getClientRects().length > 0,
      ).length === 1,
    );
    extraList.open = wasOpen;
    check(
      '公開日と更新日をブログの書式で表示',
      field('publishedAt').textContent === '2026年10月9日 公開' && field('updatedAt').textContent === '2026年10月10日 更新',
    );
    const verifyEdit = async (key, edit, expected) => {
      const prior = snapshot();
      view.dispatch({ annotations: isolateHistory.of('full') });
      edit();
      await frame();
      check(key + 'をFront Matterに書き戻す', JSON.stringify(value(key)) === JSON.stringify(expected));
      if (key === 'draft')
        document
          .querySelector('.nagori-blog-properties input[type="checkbox"]')
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
      else undo(view);
      await frame();
      check(key + 'の編集をUndoで戻す', snapshot() === prior);
    };
    for (const key of ['title', 'description'])
      await verifyEdit(
        key,
        () => {
          const text = field(key);
          text.focus();
          text.textContent = '編集した' + key;
          text.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
          const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
          text.dispatchEvent(enter);
          check(key + 'のEnterで改行を入れない', enter.defaultPrevented && !/[\r\n]/.test(text.textContent));
        },
        '編集した' + key,
      );
    await verifyEdit(
      'category',
      () => {
        field('category').click();
        const select = document.querySelector('.article-header select');
        check(
          'カテゴリ候補は表示名と保存するキーを持つ',
          [...select.options].some((option) => option.value === 'daily' && option.textContent === '日常'),
        );
        select.value = 'daily';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      'daily',
    );
    for (const key of ['publishedAt', 'updatedAt'])
      await verifyEdit(
        key,
        () => {
          const input = field(key).nextElementSibling;
          input.hidden = false;
          input.focus();
          input.value = '2026-10-13';
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
        },
        '2026-10-13',
      );
    await verifyEdit('tags', () => document.querySelector('.tag-list button').click(), ['次']);
    await verifyEdit(
      'tags',
      () => {
        const input = document.querySelector('.nagori-header-tag-input');
        input.focus();
        input.value = '追加';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      },
      ['最初', '次', '追加'],
    );
    const readingBefore = document.querySelector('.nagori-reading-time').textContent;
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: '文'.repeat(1000) }, annotations: isolateHistory.of('full') });
    await frame();
    check(
      '読了時間を本文の文字数から更新',
      readingBefore === '約 1 分で読めます' && document.querySelector('.nagori-reading-time').textContent === '約 3 分で読めます',
    );
    undo(view);
    await frame();
    let details = document.querySelector('.nagori-blog-properties');
    details.open = false;
    await frame();
    check('たたんだ一覧は短い名前だけを表示', details.querySelector('summary').textContent === 'プロパティ' && !details.open);
    details.querySelector('summary').click();
    await frame();
    check(
      '一覧を開くと見出し以外の項目を既存の欄で編集できる',
      details.open && [...details.querySelectorAll('.nagori-property-row')].map((row) => row.dataset.key).join(',') === 'draft,custom',
    );
    await verifyEdit('draft', () => details.querySelector('input[type="checkbox"]').click(), true);
    replace(sampleHeader.replace('title: 見出しの確認', 'title: 別の記事').replace('updatedAt: 2026-10-10\n', ''));
    await frame();
    details = document.querySelector('.nagori-blog-properties');
    check('記事をまたいで一覧の開閉を保つ', details.open);
    check('更新日のない記事では見出しに更新日を出さない', !field('updatedAt'));
    await verifyEdit(
      'updatedAt',
      () => {
        details.querySelector('.nagori-property-add').click();
        const select = details.querySelector('select');
        select.value = 'updatedAt';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      '',
    );
    const desc = field('description');
    desc.focus();
    desc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const imeBefore = snapshot();
    desc.textContent = '変換中の日本語';
    desc.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
    const imeEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true, keyCode: 229 });
    desc.dispatchEvent(imeEnter);
    check(
      '日本語変換中は確定も書き戻しもしない',
      snapshot() === imeBefore && !imeEnter.defaultPrevented && document.activeElement === desc,
    );
    desc.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '変換中の日本語' }));
    await frame();
    check('日本語の変換が終わると書き戻す', value('description') === '変換中の日本語');
    desc.blur();
    replace(sampleHeader);
    await frame();
    const bodyStart = snapshot().indexOf('本文です。');
    view.dispatch({ selection: { anchor: bodyStart } });
    view.focus();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await frame();
    check(
      '本文の先頭から上矢印で見出しへ移る',
      document.activeElement === field('description') && view.state.selection.main.head === bodyStart,
    );
    const selection = window.getSelection(),
      rangeToEnd = document.createRange();
    rangeToEnd.selectNodeContents(field('description'));
    rangeToEnd.collapse(false);
    selection.removeAllRanges();
    selection.addRange(rangeToEnd);
    field('description').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await frame();
    check('見出しから下矢印で本文の先頭へ移る', document.activeElement === view.contentDOM && view.state.selection.main.head === bodyStart);
    const moved = view.moveVertically(EditorSelection.cursor(bodyStart), true);
    check('見出しのmarginで本文の行を飛ばさない', view.state.doc.lineAt(moved.head).number === view.state.doc.lineAt(bodyStart).number + 1);
    replace(
      sampleHeader
        .replace('title: 見出しの確認', 'title: ""')
        .replace('description: 説明の確認', 'description: 12')
        .replace('publishedAt: 2026-10-09', 'publishedAt: 2026-02-31')
        .replace('category: tech', 'category: unknown'),
    );
    await frame();
    check(
      '空や不正な必須項目に印を付ける',
      ['title', 'description', 'publishedAt', 'category'].every((key) => field(key).getAttribute('aria-invalid') === 'true'),
    );
    replace(sampleHeader.replace('title: 見出しの確認\n', ''));
    await frame();
    const missingTitle = field('title');
    missingTitle.focus();
    missingTitle.textContent = '欠けていたタイトル';
    missingTitle.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await frame();
    check(
      '欠けた必須項目をその場で足しても入力の焦点を保つ',
      value('title') === '欠けていたタイトル' && document.activeElement === missingTitle,
    );
    missingTitle.blur();
    check(
      '見出しで足した項目を一覧の追加候補から外す',
      ![...document.querySelector('.nagori-blog-properties select').options].some((option) => option.value === 'title'),
    );
    replace(before);
    await frame();
    document.querySelector('.nagori-blog-properties').open = false;
    await frame();
    // 本文の文字の大きさ、行間、幅はNagoriに従う。テーマを外した時と同じになること
    const measure = () =>
      [getComputedStyle(content).fontSize, getComputedStyle(content).lineHeight, content.getBoundingClientRect().width].join();
    const themed = measure();
    host.removeAttribute('data-blog-theme');
    const plainLook = measure();
    host.setAttribute('data-blog-theme', '');
    check('ブログのテーマでも本文の文字サイズと行間と幅はNagoriのまま', themed === plainLook);
    // テーマが行に上下のmarginを足すと、CodeMirrorが行の高さを測り違えて矢印キーの移動先が飛ぶ
    const sample =
      '\n\n## 見出し二\n\n一つ目の段落です。\n\n二つ目の段落です。\n\n> 引用の一行目\n> 引用の二行目\n\n### 見出し三\n\n三つ目の段落です。\n\n---\n\n最後の段落です。';
    const sampleFrom = view.state.doc.length;
    view.dispatch({ changes: { from: sampleFrom, insert: sample } });
    await tick();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // 上下の間隔はNagoriに従うので、テーマを外した時と同じmarginになること
    const margins = () =>
      [...content.querySelectorAll('.cm-line, .cm-widgetBuffer, .nagori-rule, .nagori-image img')]
        .map((line) => {
          const style = getComputedStyle(line);
          return style.marginTop + ' ' + style.marginBottom;
        })
        .join();
    const themedMargins = margins();
    host.removeAttribute('data-blog-theme');
    const plainMargins = margins();
    host.setAttribute('data-blog-theme', '');
    check('ブログのテーマでも本文の行の上下のmarginはNagoriのまま', themedMargins === plainMargins);
    const firstLine = view.state.doc.lineAt(sampleFrom).number + 1;
    // 続けて下矢印を押した時と同じく、前の位置と目標の列を引き継いで動かす。
    // 区切り線の行は線の絵に置き換えて表示するので、通り越すのが正しい
    let range = EditorSelection.cursor(view.state.doc.line(firstLine).from);
    let steady = true;
    for (let number = firstLine; number < view.state.doc.lines;) {
      range = view.moveVertically(range, true);
      view.dispatch({ selection: range });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const next = view.state.doc.lineAt(range.head).number;
      const skipped = view.state.doc.line(number + 1).text;
      if (!(next === number + 1 || (next === number + 2 && skipped === '---'))) steady = false;
      if (next <= number) break;
      number = next;
    }
    check('ブログのテーマでも下矢印で次の行へ進む', steady);
    view.dispatch({ changes: { from: sampleFrom, to: view.state.doc.length }, selection: { anchor: 0 } });
    const root19 = document.querySelector('.editor-root');
    const baseSize = parseFloat(getComputedStyle(content).fontSize);
    root19.style.setProperty('--editor-font-size', '28px');
    await tick();
    const zoomed = parseFloat(getComputedStyle(content).fontSize);
    root19.style.setProperty('--editor-font-size', defaults.fontSize + 'px');
    check('ブログのテーマでも拡大縮小で本文の文字が大きくなる', zoomed > baseSize * 1.3);
    const blogThemeStyle = () => [...document.querySelectorAll('head style')].map((style) => style.textContent).join('');
    const changed = (path) =>
      callbacks.get(listeners.get('nagori:fs-changed'))({ event: 'nagori:fs-changed', payload: { paths: [path], project: root } });
    await writeTheme('src/theme/theme.css', originalTheme.theme + '\n:root {--color-text:#643219} :where(.prose){line-height:2.4}');
    changed('src/theme/theme.css');
    await until(() => getComputedStyle(content).color === 'rgb(100, 50, 25)');
    check('外で保存したtheme.cssが再起動せず本文へ映る', measure() === themed && view.state.doc.toString() === before);
    check(
      '外のCSSが左右の欄と上のバーへ広がらない',
      getComputedStyle(document.querySelector('.sidebar')).color !== 'rgb(100, 50, 25)' &&
        getComputedStyle(document.querySelector('.global-bar')).color !== 'rgb(100, 50, 25)',
    );
    await writeTheme('src/styles/template.css', originalTheme.template + '\n@layer template {.prose a{text-decoration-color:#123456}}');
    changed('src/styles/template.css');
    await until(() => blogThemeStyle().includes('#123456'));
    check('外で保存したtemplate.cssも映る', view === EditorView.findFromDOM(document.querySelector('.cm-editor')));
    await writeTheme('src/theme/theme.css', originalTheme.theme);
    await writeTheme('src/styles/template.css', originalTheme.template);
    changed('src/theme/theme.css');
    await until(() => getComputedStyle(content).color === 'rgb(30, 42, 63)');
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
    await until(() => !host.hasAttribute('data-blog-theme'));
    check('オフで本文もNagoriの配色へ戻る', getComputedStyle(content).color === 'rgb(219, 230, 244)');
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
    await until(() => host.hasAttribute('data-blog-theme'));
    check('オンで本文もブログの配色へ戻る', getComputedStyle(content).color === 'rgb(30, 42, 63)');
    document.querySelector('[aria-label="設定を閉じる"]').click();
    // モードの切り替えで同じ内容を書き戻すことはあるが、記事の中身は変えない
    check(
      '元のコピーの中身を変える保存がない',
      saves.every((save) => save.text === save.baseline),
    );
    return JSON.stringify({ pass: checks.every((check) => check.pass) && !errors.length, checks, errors, root });
  } catch (error) {
    return JSON.stringify({ pass: false, checks, errors: [...errors, String(error)] });
  } finally {
    if (originalTheme) {
      await writeTheme('src/theme/theme.css', originalTheme.theme);
      await writeTheme('src/styles/template.css', originalTheme.template);
    }
  }
};
window.ready = true;
