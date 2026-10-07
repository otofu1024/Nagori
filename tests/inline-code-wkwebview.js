import { mount, unmount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import Editor from '../src/lib/Editor.svelte';
import '../src/app.css';

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const checks = [], errors = [];
let component, view, api;
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const check = (name, pass) => checks.push({ name, pass: !!pass });
const doc = () => view.state.doc.toString();
async function create(text, at = text.length, previewOnly = false) {
  if (component) await unmount(component);
  component = mount(Editor, { target: document.querySelector('#host'), props: {
    initialText: text, documentKey: checks.length, previewOnly,
    onReady: value => { api = value; }, onChange: () => {}, onComposition: () => {},
    onSave: () => {}, onLink: () => {}, resolveImage: async () => '',
  } });
  await tick(); await pause();
  view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
  view.dispatch({ selection: { anchor: at } });
  if (!previewOnly) api.focus();
  await pause();
}
function styled(element) {
  if (!element) return false;
  const style = getComputedStyle(element), parent = getComputedStyle(element.parentElement);
  const color = document.createElement('span'); color.style.background = 'var(--code-bg)'; document.body.append(color);
  const background = getComputedStyle(color).backgroundColor; color.remove();
  return style.fontFamily.includes('monospace') && style.backgroundColor === background &&
    style.borderRadius === '5px' && style.padding === '2px 4px' &&
    Math.abs(parseFloat(style.fontSize) / parseFloat(parent.fontSize) - .9) < .01;
}
const code = () => view.contentDOM.querySelector('.nagori-code');
function key(value) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: value, code: `Key${value.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true }));
}
window.show = async (theme = 'light', previewOnly = false) => {
  document.documentElement.dataset.theme = theme;
  await create('# 見出しの `npm run build`\n\n本文の `npm run build`、**`太字のコード`**、[`リンクのコード`](https://example.com)。\n\n複数の記号 ``a`b`` と、`行をまたぐ\nコード`。\n\n| `表の見出し` | 項目 |\n|---|---|\n| `表のコード` | **`太字`** |\n\n`' + 'long code '.repeat(24) + '`\n\n末尾', undefined, previewOnly);
};
window.run = async () => {
  checks.length = 0; errors.length = 0;
  const samples = [
    ['本文', '前 `npm run build` 後', 'npm run build'],
    ['見出し', '# `見出し`', '見出し'],
    ['太字', '**`太字`**', '太字'],
    ['リンク', '[`リンク`](https://example.com)', 'リンク'],
    ['表', '| `見出し` |\n|---|\n| **`セル`** |', '見出し'],
    ['複数のバッククォート', '``a`b``', 'a`b'],
    ['改行', '` a\n b `', 'a  b'],
    ['折り返し', '`' + 'long code '.repeat(50) + '`', 'long code '.repeat(50)],
  ];
  for (const theme of ['light', 'dark']) for (const previewOnly of [false, true]) {
    document.documentElement.dataset.theme = theme;
    for (const [name, source, value] of samples) {
      const text = source + '\n\n末尾', label = `${theme}・${previewOnly ? 'Preview' : 'Live Preview'}・${name}`;
      await create(text, undefined, previewOnly);
      const element = code();
      check(`${label}のDOMと文字列`, element?.textContent === value && (name === '表' || element?.getAttribute('contenteditable') === 'false'));
      check(`${label}のフォントと背景と余白`, styled(element));
      if (name === '表') check(`${label}のセル`, styled(view.contentDOM.querySelector('td .nagori-code')));
      if (name === '折り返し') check(`${label}の複数行表示`, element?.getClientRects().length > 1 && view.scrollDOM.scrollWidth <= view.scrollDOM.clientWidth + 1);
      check(`${label}の原文保持`, doc() === text);
    }
  }
  const text = '前 `npm run build` 後\n\n末尾', at = text.indexOf('run');
  await create(text, at);
  check('カーソルを入れると記号が出る', view.contentDOM.textContent.includes('`npm run build`') && !code()?.hasAttribute('contenteditable') && styled(code()));
  check('コード内にカーソルを描く', !!view.dom.querySelector('.cm-cursor-primary') && getComputedStyle(view.contentDOM).caretColor === 'rgba(0, 0, 0, 0)');
  key('b'); key('i'); await pause();
  check('コード内でCmd+BとCmd+Iは本文を変えない', doc() === text);
  view.dispatch({ selection: { anchor: at, head: at + 3 } }); await pause();
  const toolbar = document.querySelector('.floating-toolbar');
  check('コード内の選択とFloating Toolbarの判定', view.state.selection.main.from === at && toolbar?.querySelector('[aria-label="太字"]')?.disabled && toolbar?.querySelector('[aria-label="斜体"]')?.disabled && !toolbar?.querySelector('[aria-label="Inline Code"]')?.disabled);
  const clipboard = new DataTransfer();
  view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  check('コピーで選択した原文を渡す', clipboard.getData('text/plain') === 'run');
  view.dispatch({ selection: { anchor: text.length } }); await pause();
  check('カーソルを外すとコードのWidgetへ戻る', code()?.getAttribute('contenteditable') === 'false' && styled(code()) && !view.contentDOM.textContent.includes('`'));
  await create('- 項目\n\n改行\n続き &amp; \\*\n\n末尾');
  check('リストと改行とエスケープと文字参照のWidgetを保つ', [...view.contentDOM.querySelectorAll('.nagori-list-marker')].map(el => el.textContent).join('|') === '•| |&|*' && !code());
  if (window.webkit?.messageHandlers?.ime) {
    await create(text, at);
    const native = action => new Promise(resolve => { window.nativeDone = resolve; window.webkit.messageHandlers.ime.postMessage(action); });
    await native({ kind: 'mark', text: '入力', location: 2 });
    await native({ kind: 'insert', text: '入力' }); await pause();
    check('コード内の未確定文字と確定', doc() === text.slice(0, at) + '入力' + text.slice(at));
    view.dispatch({ selection: { anchor: doc().length } }); await pause();
    check('IME確定後にコードのWidgetへ戻る', code()?.textContent === 'npm 入力run build' && styled(code()));
  }
  await window.show('dark');
  return JSON.stringify({ pass: checks.every(item => item.pass) && !errors.length, checks, errors, html: view.contentDOM.innerHTML });
};
window.ready = true;
