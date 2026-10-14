import { EditorView } from '@codemirror/view';
import { readBlogCategories } from '../../src/lib/editor/blogCategories.ts';
import { japanDate, newPostMarkdown } from '../../src/lib/workspace/blogNewPost.ts';

export async function checkNewPosts({ check, until, config, documents, created }) {
  const newButton = document.querySelector('button[aria-label="新しい記事"]');
  const wait = (name, test) =>
    until(test, '新しい記事: ' + name, () => {
      const dialog = document.querySelector('.new-post-dialog');
      const select = dialog?.querySelector('select');
      return {
        buttonConnected: newButton.isConnected,
        buttonDisabled: newButton.disabled,
        working: !!document.querySelector('.app-shell.working'),
        dialogOpen: dialog?.open,
        category: select?.value,
        categoryDisabled: select?.disabled,
        categoryOptions: [...(select?.options ?? [])].map((option) => option.value),
        title: document.getElementById('new-post-title')?.value,
        descriptionRequired: document.getElementById('new-post-description')?.required,
        submitDisabled: dialog?.querySelector('button[type="submit"]')?.disabled,
        createdCount: created.length,
        error: dialog?.querySelector('.error-text')?.textContent,
      };
    });
  const oldButtons = ['記事を作成', 'フォルダを作成'].map((label) =>
    document.querySelector(`.tree-actions > button[aria-label="${label}"]`),
  );
  check('ブログのモードだけの新しい記事ボタン', newButton?.title === '新しい記事');
  check(
    '既存の＋と新しいフォルダの大きさと線の太さを保つ',
    oldButtons.every((button) => {
      const svg = button.querySelector('svg');
      return (
        button.title === button.getAttribute('aria-label') &&
        svg.getAttribute('width') === '17' &&
        svg.getAttribute('stroke-width') === newButton.querySelector('svg').getAttribute('stroke-width') &&
        getComputedStyle(button).width === '30px' &&
        getComputedStyle(button).height === '30px'
      );
    }),
  );
  oldButtons[0].click();
  await wait('既存のファイル名入力', () => document.querySelector('input[aria-label="新しい名前"]')?.value === 'untitled.md');
  check('既存の＋は従来のファイル名入力を開く', document.querySelector('input[aria-label="新しい名前"]').value === 'untitled.md');
  document.querySelector('input[aria-label="新しい名前"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  oldButtons[1].click();
  await wait('既存のフォルダ名入力', () => document.querySelector('input[aria-label="新しい名前"]')?.value === '新しいフォルダ');
  check('既存の新しいフォルダは従来の名前入力を開く', document.querySelector('input[aria-label="新しい名前"]').value === '新しいフォルダ');
  document.querySelector('input[aria-label="新しい名前"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  newButton.click();
  await wait('1回目のカテゴリ読み込み', () => document.querySelector('.new-post-dialog[open] select option[value="daily"]'));
  const dialog = document.querySelector('.new-post-dialog');
  const form = dialog.querySelector('form');
  const submit = form.querySelector('button[type="submit"]');
  const set = (id, value) => {
    const element = document.getElementById(id);
    element.value = value;
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return element;
  };
  check('必須項目が空なら作成を押せない', submit.disabled);
  const categories = readBlogCategories(config);
  check(
    'カテゴリは設定の表示名とキーを使う',
    categories.every((category) =>
      [...dialog.querySelector('select').options].some((option) => option.value === category.key && option.textContent === category.label),
    ),
  );
  const candidate = documents.flatMap((document) => document.tags).find(Boolean);
  check(
    'ほかの記事のタグを候補に出す',
    !!candidate && [...dialog.querySelectorAll('datalist option')].some((option) => option.value === candidate),
  );
  const input = {
    title: '新しい記事 "引用" \\ #',
    description: '画面から作る記事の説明',
    category: categories[0].key,
    tags: [candidate, '新しいタグ'],
  };
  const title = set('new-post-title', input.title);
  set('new-post-description', input.description);
  set('new-post-category', input.category);
  for (const value of [...input.tags, '削除するタグ']) {
    set('new-post-tag', value);
    await new Promise((resolve) => setTimeout(resolve, 0));
    dialog.querySelector('.tag-input button').click();
  }
  await wait('削除するタグの追加', () => dialog.querySelector('[aria-label="削除するタグを削除"]'));
  dialog.querySelector('[aria-label="削除するタグを削除"]').click();
  await wait('1回目の作成ボタン有効化', () => !submit.disabled);
  check('タグを候補と自由入力で追加し削除できる', dialog.querySelectorAll('.tags button').length === 2);
  const count = created.length;
  title.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'あ' }));
  const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  title.dispatchEvent(enter);
  form.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 60));
  check('日本語の変換中のEnterとsubmitでは作成しない', enter.defaultPrevented && created.length === count && dialog.open);
  title.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '記事' }));
  const finishingEnter = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true });
  title.dispatchEvent(finishingEnter);
  check('変換を確定するEnterも作成しない', finishingEnter.defaultPrevented && created.length === count);
  submit.click();
  await wait('1回目の作成完了', () => created.length === count + 1 && !dialog.open);
  const result = created.at(-1),
    path = result.entry.path;
  check(
    'Rustで日付と16進6文字のフォルダとindex.mdを作る',
    new RegExp(`^src/content/blog/${japanDate().replaceAll('-', '')}-[0-9a-f]{6}/index\\.md$`).test(path),
  );
  check('作成した本文がテンプレートの形で保存される', result.document.text === newPostMarkdown(input, japanDate()));
  await wait('1回目の記事の一覧表示', () => document.querySelector(`.tree-row[data-path="${path}"]`));
  check('作成した記事が左の欄に出る', !!document.querySelector(`.tree-row[data-path="${path}"]`));
  check(
    '作成した記事をすぐ開く',
    EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString() === result.document.text,
  );
  await wait('2回目の新しい記事ボタン有効化', () => !newButton.disabled);
  newButton.click();
  // 押した直後は前回の画面が残っているので、開き直した画面が描かれてから待つ
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await wait('2回目のダイアログとカテゴリ読み込み', () => dialog.open && !dialog.querySelector('select').disabled);
  set('new-post-title', '説明とタグが空の記事');
  set('new-post-category', categories[0].key);
  await new Promise((resolve) => setTimeout(resolve, 0));
  check('2回目のカテゴリ選択を候補の反映後も保つ', document.getElementById('new-post-category').value === categories[0].key);
  await wait('2回目の作成ボタン有効化', () => !submit.disabled);
  check(
    '説明とタグが空でも作成を押せる',
    !document.getElementById('new-post-description').value &&
      !document.getElementById('new-post-tag').value &&
      !dialog.querySelector('.tags button') &&
      !submit.disabled,
  );
  submit.click();
  await wait('2回目の作成完了', () => created.length === count + 2 && !dialog.open);
  const emptyResult = created.at(-1);
  check(
    '説明とタグが空の記事を保存できる',
    emptyResult.document.text.includes('\ndescription: ""\n') && emptyResult.document.text.includes('\ntags: []\n'),
  );
  await wait('2回目の記事の一覧表示', () => document.querySelector(`.tree-row[data-path="${emptyResult.entry.path}"]`));
  check(
    '説明とタグが空の記事も一覧に出て開く',
    EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString() === emptyResult.document.text,
  );
}
