import { checkCharacters } from './blogCharacterChecks.js';
import { checkThemes } from './blogThemeChecks.js';
import { mount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { EditorSelection, Transaction } from '@codemirror/state';
import { undo, redo, undoDepth, isolateHistory } from '@codemirror/commands';
import App from '../../src/App.svelte';
import { buildGraph } from '../../src/lib/workspace/graph.ts';
import { BLOG_DIRECTORY } from '../../src/lib/workspace/navigation.ts';
import { readProperties } from '../../src/lib/workspace/frontMatter.ts';
import { propertiesSource, templateProperties } from '../../src/lib/editor/previewProperties.ts';
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
  let charactersPrepared = false;
  let themesPrepared = false;
  const themeRequest = async (input) => {
    const response = await fetch('./blog-themes', { method: 'POST', body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok || result?.error) throw result?.error ?? Error('テーマの確認に失敗しました。');
    if (input.action === 'prepare') themesPrepared = true;
    if (input.action === 'reset') themesPrepared = false;
    return result;
  };
  const characterRequest = async (input) => {
    const response = await fetch('./blog-characters', { method: 'POST', body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok || result?.error) throw result?.error ?? Error('キャラクターの確認に失敗しました。');
    if (input.action === 'prepare') charactersPrepared = true;
    if (input.action === 'reset') charactersPrepared = false;
    return result;
  };
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
    await themeRequest({ action: 'prepare' });
    const article = documents.find((doc) => doc.text.startsWith('---'));
    if (!article) throw Error('ブログのコピーにFront Matter付きの記事がありません');
    const files = new Map(documents.map((doc) => [doc.path, doc.text]));
    const originals = new Map(files);
    let characterSaves = 0;
    const confirmations = [];
    const confirmationAnswers = [];
    const saves = [],
      openedLinks = [],
      cardRequests = [];
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
        if (command === 'plugin:dialog|message') { confirmations.push(args.message); return args.buttons.OkCancelCustom[confirmationAnswers.shift() === false ? 1 : 0]; }
        if (command.startsWith('blog_themes_')) {
          if (!blogMode || args.project !== root) throw { code: 'WORKSPACE', message: '開いているブログが変わりました。' };
          return themeRequest({ ...args, action: command.slice('blog_themes_'.length) });
        }
        if (command === 'blog_characters_image_baseline') return characterRequest({ action: 'imageBaseline', path: args.path });
        if (command === 'blog_characters_save') {
          const result = await characterRequest({ action: 'save', request: args.request });
          data.config = args.request.text; characterSaves++; return result;
        }
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
        if (command === 'workspace_link_cards') return blogMode ? data.linkCards : {};
        if (command === 'workspace_link_card') {
          cardRequests.push(args.url);
          return null;
        }
        if (command === 'image_read') {
          const response = await fetch('./blog-image?path=' + encodeURIComponent(args.path));
          if (!response.ok) throw Error(await response.text());
          return response.arrayBuffer();
        }
        if (command === 'external_open') {
          openedLinks.push(args.url);
          return;
        }
        if (command === 'workspace_blog_config') return blogMode ? data.config : null;
        if (command === 'workspace_blog_theme') return blogMode ? (await fetch('./blog-theme')).json() : null;
        if (command === 'workspace_list') return listing(args.path);
        if (command === 'workspace_index') return blogMode ? [...entries, ...(charactersPrepared ? [{ path: 'src/content/blog/nagori-character-check.md', name: 'nagori-character-check.md', kind: 'markdown' }] : [])] : generic;
        if (command === 'workspace_search') return data.search;
        if (command === 'trash_list') return [];
        if (command === 'document_open' && args.path === 'src/config.ts') return characterRequest({ action: 'open' });
        if (command === 'document_open' && args.path === 'src/content/blog/nagori-character-check.md') return (await characterRequest({ action: 'documents' })).find(doc => doc.path === args.path);
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
    const cardUrl = Object.keys(data.linkCards)[0];
    if (!cardUrl) throw Error('ブログのコピーにリンクカードのキャッシュがありません');
    const componentSample = sampleHeader + '\n\n' + cardUrl + '\n\n> [!NAGORI]\n> **吹き出しの一行目**\n> 二行目\n\n後の段落';
    replace(componentSample);
    view.dispatch({ selection: { anchor: componentSample.indexOf('本文です。') } });
    await until(() => document.querySelector('.link-card') && document.querySelector('.talk'));
    const card = document.querySelector('.link-card'),
      talk = document.querySelector('.talk');
    check(
      'キャッシュのURLをブログの構造とクラスでカードにする',
      card.querySelector('.link-card__title').textContent === data.linkCards[cardUrl].title &&
        !!card.querySelector('.link-card__body') &&
        !cardRequests.includes(cardUrl),
    );
    check(
      '吹き出しをブログの構造とクラスで描く',
      talk.dataset.character === 'NAGORI' &&
        talk.dataset.expression === 'normal' &&
        !!talk.querySelector('.talk__bubble p strong') &&
        talk.textContent.includes('二行目') &&
        !talk.textContent.includes('[!NAGORI]'),
    );
    await until(() => talk.querySelector('.talk__character').complete && talk.querySelector('.talk__character').naturalWidth > 0);
    check('publicのキャラクター画像をblobで読む', talk.querySelector('.talk__character').src.startsWith('blob:'));
    if (data.linkCards[cardUrl].image) {
      await until(() => card.querySelector('img').complete && card.querySelector('img').naturalWidth > 0);
      check('キャッシュのカード画像もpublicからblobで読む', card.querySelector('img').src.startsWith('blob:'));
    }
    check(
      'カードと吹き出しの入れ物でmarginを閉じ込める',
      [card, talk].every((element) => getComputedStyle(element.parentElement).display === 'flow-root') &&
        getComputedStyle(card).display === 'grid' &&
        getComputedStyle(talk).display === 'grid',
    );
    card.click();
    await frame();
    check('カードを押すと既存のリンクの開き方を使う', openedLinks.includes(data.linkCards[cardUrl].url));
    view.dispatch({ selection: { anchor: componentSample.indexOf(cardUrl) } });
    await frame();
    check(
      'カードの段落にカーソルを入れるとURLへ戻す',
      !document.querySelector('.link-card') && view.state.doc.lineAt(view.state.selection.main.head).text === cardUrl,
    );
    for (const marker of ['[!NAGORI]', '二行目']) {
      view.dispatch({ selection: { anchor: componentSample.indexOf(marker) } });
      await frame();
      check(
        '引用の' + marker + 'へカーソルを入れると吹き出しを記法へ戻す',
        !document.querySelector('.talk') && view.state.doc.toString() === componentSample,
      );
    }
    let componentRange = EditorSelection.cursor(componentSample.indexOf('本文です。')),
      componentSteady = true;
    view.dispatch({ selection: componentRange });
    await frame();
    view.focus();
    // 実際のキー入力と同じく、下矢印のキーを送って動かす
    for (let number = view.state.doc.lineAt(componentRange.head).number; number < view.state.doc.lines;) {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await frame();
      componentRange = view.state.selection.main;
      const next = view.state.doc.lineAt(componentRange.head).number;
      if (next !== number + 1) componentSteady = false;
      if (next <= number) break;
      number = next;
    }
    check('リンクカードと複数行の吹き出しでも下矢印で行を飛ばさない', componentSteady);
    const savedCard = await (await fetch('./blog-card-check')).json();
    check(
      'ローカルHTMLの取得結果をコピーへ保存しブログのビルドが使えるWebPとJSONにする',
      savedCard.saved && savedCard.sorted && savedCard.webp && savedCard.image,
    );
    replace(sampleHeader);
    await frame();
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
    const extraSummary = extraList.querySelector('summary');
    check(
      'たたんだ一覧の見出しは文字の周りだけが光り、下線がある',
      extraSummary.getBoundingClientRect().width < extraList.getBoundingClientRect().width / 2 &&
        getComputedStyle(extraSummary).textDecorationLine.includes('underline'),
    );
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
    [...document.querySelectorAll('.settings-nav button')].find((button) => button.textContent === 'ブログ').click();
    await tick();
    await checkCharacters({ check, until, tick, view, replace, before, request: characterRequest, confirmations, saveCount: () => characterSaves });
    // テーマの確認では短い記事を使い、見出しと検索対象の本文を同じ画面に描く。
    const themeSelection = view.state.selection, themeScrollTop = view.scrollDOM.scrollTop;
    try {
      replace(sampleHeader);
      view.dispatch({ selection: { anchor: sampleHeader.indexOf('本文です。') }, effects: propertiesSource.of(false) });
      view.scrollDOM.scrollTop = 0;
      await until(() => document.querySelector('.article-header h1')?.textContent.includes('見出しの確認'));
      await checkThemes({ check, until, tick, view, request: themeRequest, writeTheme, changed, originalTheme, confirmations, confirmationAnswers });
    } finally {
      replace(before);
      view.dispatch({ selection: themeSelection });
      view.scrollDOM.scrollTop = themeScrollTop;
    }
    const toggle = [...document.querySelectorAll('.check-row')]
      .find((label) => label.textContent.trim() === 'ブログの機能')
      .querySelector('input');
    check('ブログの機能は初期値オン', toggle.checked);
    const blogToggle = (label) =>
      [...document.querySelectorAll('.settings-panel .check-row')].find((row) => row.textContent.trim() === label).querySelector('input');
    const displayLabels = ['記事の見出し', 'リンクカード', 'キャラクターの吹き出し', '本文のテーマ'];
    const indentLabel = '改行したら全角スペースで字下げする';
    const blogLabels = [...displayLabels, indentLabel];
    check(
      'ブログの欄に4つの表示設定を初期値オンで置く',
      displayLabels.every((label) => blogToggle(label).checked),
    );
    check('全角スペースの字下げは初期値オン', blogToggle(indentLabel).checked);
    const indentSample = sampleHeader + '\n\n　段落です。';
    const pressEnter = () => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    replace(indentSample);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await frame();
    const beforeEnter = snapshot();
    pressEnter();
    await frame();
    check(
      'ブログの段落を改行すると全角スペースを1つ入れる',
      snapshot() === beforeEnter + '\n　' && view.state.doc.line(view.state.doc.lines).text === '　',
    );
    undo(view);
    await frame();
    check('改行と全角スペースは1回のUndoで戻る', snapshot() === beforeEnter);
    blogToggle(indentLabel).click();
    await frame();
    pressEnter();
    await frame();
    check(
      '字下げがオフの時は全角も半角も入れない',
      snapshot() === beforeEnter + '\n' && view.state.doc.line(view.state.doc.lines).text === '',
    );
    undo(view);
    await frame();
    blogToggle(indentLabel).click();
    await frame();
    // 見出しの行の改行で、後ろの段落の全角スペースの字下げを数えて半角スペースを足さない
    const headingSample = sampleHeader + '\n\n# 至高の芸術\n　みなさんこんばんわ。';
    replace(headingSample);
    view.dispatch({ selection: { anchor: headingSample.indexOf('# 至高の芸術') + '# 至高の芸術'.length } });
    await frame();
    pressEnter();
    await frame();
    check('見出しの行の改行では空白を足さない', snapshot() === headingSample.replace('# 至高の芸術\n', '# 至高の芸術\n\n'));
    replace(componentSample);
    view.dispatch({ selection: { anchor: componentSample.indexOf('本文です。') } });
    await until(() => document.querySelector('.link-card') && document.querySelector('.talk'));
    for (const [label, visible] of [
      ['記事の見出し', () => !!document.querySelector('.article-header')],
      ['リンクカード', () => !!document.querySelector('.link-card')],
      ['キャラクターの吹き出し', () => !!document.querySelector('.talk')],
      ['本文のテーマ', () => host.hasAttribute('data-blog-theme')],
    ]) {
      const prior = snapshot();
      view.dispatch({ changes: { from: view.state.doc.length, insert: '変更' }, annotations: isolateHistory.of('full') });
      const edited = snapshot(),
        selected = view.state.selection,
        depth = undoDepth(view.state);
      blogToggle(label).click();
      await until(() => !visible());
      check(label + 'をオフにすると表示が変わる', !visible());
      if (label === '記事の見出し')
        check(
          '見出しをオフにすると汎用の一覧へ戻る',
          !!document.querySelector('.nagori-properties') && !document.querySelector('.nagori-blog-header'),
        );
      if (label === 'キャラクターの吹き出し')
        check(
          '吹き出しをオフにすると普通の引用へ戻る',
          !!document.querySelector('.nagori-quote') && content.textContent.includes('[!NAGORI]'),
        );
      if (label === 'リンクカード') {
        check('カードをオフにするとURLのリンクへ戻る', !!document.querySelector(`.nagori-link[data-href="${cardUrl}"]`));
        const requestCount = cardRequests.length,
          from = view.state.doc.length;
        view.dispatch({
          changes: { from, insert: '\n\nhttps://example.com/blog-settings-disabled' },
          annotations: Transaction.addToHistory.of(false),
        });
        await frame();
        check('カードがオフの間は新しいURLの情報を取得しない', cardRequests.length === requestCount);
        view.dispatch({ changes: { from, to: view.state.doc.length }, annotations: Transaction.addToHistory.of(false) });
      }
      if (label === '本文のテーマ')
        check(
          'テーマをオフにすると見出しの構造を残してNagoriの配色へ戻す',
          !!document.querySelector('.article-header') &&
            getComputedStyle(content).color === 'rgb(219, 230, 244)' &&
            getComputedStyle(field('title')).color === 'rgb(219, 230, 244)',
        );
      check(
        label + 'をオフにしても本文、選択位置、Undo履歴を保つ',
        snapshot() === edited && view.state.selection.eq(selected) && undoDepth(view.state) === depth,
      );
      blogToggle(label).click();
      await until(visible);
      check(label + 'をオンに戻すと表示が戻る', visible());
      check(
        label + 'をオンにしても同じエディタ、本文、選択位置、Undo履歴を保つ',
        view === EditorView.findFromDOM(document.querySelector('.cm-editor')) &&
          snapshot() === edited &&
          view.state.selection.eq(selected) &&
          undoDepth(view.state) === depth,
      );
      undo(view);
      await frame();
      check(label + 'の切り替え後も直前の編集をUndoで戻せる', snapshot() === prior);
      redo(view);
      await frame();
      check(label + 'の切り替え後もRedoで編集を戻せる', snapshot() === edited);
      undo(view);
      await frame();
    }
    // 全体をオフにしても個別の設定値を残す。
    blogToggle('キャラクターの吹き出し').click();
    blogToggle(indentLabel).click();
    await until(() => !document.querySelector('.talk'));
    replace(before);
    await frame();
    toggle.click();
    await until(
      () => !blogMode && document.querySelector('.nagori-property-key-input') && document.querySelector('.tree-row[data-path="src"]'),
    );
    await until(() => !host.hasAttribute('data-blog-theme'));
    check(
      'ブログの機能がオフの時はブログの設定を押せない',
      blogLabels.every((label) => blogToggle(label).disabled) && document.querySelector('.manage-characters').disabled,
    );
    check('汎用のモードではブログのテーマを選べない', document.querySelector('.blog-themes select').disabled && document.querySelector('.blog-themes button').disabled);
    check(
      'ブログの機能をオフにしても個別の値を保つ',
      !blogToggle('キャラクターの吹き出し').checked &&
        displayLabels.filter((label) => label !== 'キャラクターの吹き出し').every((label) => blogToggle(label).checked),
    );
    check('ブログの機能をオフにしても字下げの値を保つ', !blogToggle(indentLabel).checked);
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
    await until(() => !document.querySelector('.blog-themes select').disabled);
    check('ブログのモードへ戻すとテーマを選べる', !document.querySelector('.blog-themes select').disabled);
    check(
      'ブログの機能をオンに戻すとブログの設定を押せる',
      blogLabels.every((label) => !blogToggle(label).disabled) && !document.querySelector('.manage-characters').disabled,
    );
    check('ブログの機能をオンに戻しても個別の値を保つ', !blogToggle('キャラクターの吹き出し').checked);
    check('ブログの機能をオンに戻しても字下げの値を保つ', !blogToggle(indentLabel).checked);
    blogToggle('キャラクターの吹き出し').click();
    blogToggle(indentLabel).click();
    await frame();
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
    if (themesPrepared) await themeRequest({ action: 'reset' });
    if (charactersPrepared) await characterRequest({ action: 'reset' });
    if (originalTheme) {
      await writeTheme('src/theme/theme.css', originalTheme.theme);
      await writeTheme('src/styles/template.css', originalTheme.template);
    }
  }
};
window.ready = true;
