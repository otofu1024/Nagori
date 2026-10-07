import { mount, unmount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { undo, redo, undoDepth } from '@codemirror/commands';
import Editor from '../src/lib/Editor.svelte';
import { markdownParser, walk } from '../src/lib/markdown.ts';
import '../src/app.css';

const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], checks = [], changes = [];
let component, view, api, composing = false, saves = 0;
window.addEventListener('error', event => errors.push(event.message));
window.native = action => new Promise(resolve => {
  window.nativeDone = resolve;
  window.webkit.messageHandlers.ime.postMessage(action);
});
function check(name, pass) { checks.push({ name, pass: !!pass }); }
async function create(text, at, props = {}) {
  if (component) await unmount(component);
  changes.length = 0; composing = false;
  component = mount(Editor, { target: document.querySelector('#host'), props: {
    initialText: text, documentKey: checks.length, onReady: value => { api = value; }, onChange: text => changes.push(text),
    onComposition: value => { composing = value; }, onSave: () => { saves++; }, onLink: () => {}, resolveImage: async () => '', ...props,
  } });
  await tick(); await pause();
  view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
  view.dispatch({ selection: { anchor: at } }); api.focus(); await pause();
}
function key(value) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: value, code: `Key${value.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true }));
}
const doc = () => view.state.doc.toString();
function formattedAt(pos) {
  const names = [];
  walk(markdownParser.parse(doc()).topNode, node => { if (node.from < pos && node.to > pos && /^(?:StrongEmphasis|Emphasis)$/.test(node.name)) names.push(node.name); });
  return names;
}
window.run = async () => {
  for (const [kind, command, mark] of [['bold', 'b', '**'], ['italic', 'i', '*']]) {
    await create('前 後', 2);
    key(command); await pause();
    check(`${kind}の空の記号と位置`, doc() === `前 ${mark}${mark}後` && view.state.selection.main.head === 2 + mark.length);
    check(`${kind}の記号表示とツールバー非表示`, view.contentDOM.textContent.includes(mark + mark) && !document.querySelector('.floating-toolbar'));
    await window.native({ kind: 'insert', text: '本文' }); await pause();
    check(`${kind}の入力とLive Preview`, doc() === `前 ${mark}本文${mark}後` && document.querySelector(kind === 'bold' ? '.nagori-bold' : '.nagori-italic')?.textContent.includes('本文'));
    key(command); await pause();
    check(`${kind}の閉じる直後へ移動`, view.state.selection.main.head === 4 + mark.length * 2);
    undo(view); await pause(); check(`${kind}の出る操作のUndo`, view.state.selection.main.head === 4 + mark.length);
    redo(view); await pause(); check(`${kind}の出る操作のRedo`, view.state.selection.main.head === 4 + mark.length * 2);
    await window.native({ kind: 'insert', text: '普通' }); await pause();
    check(`${kind}を出た後は普通の文字`, !formattedAt(doc().indexOf('普通') + 1).includes(kind === 'bold' ? 'StrongEmphasis' : 'Emphasis'));

    await create(`${mark}前半後半${mark}`, mark.length + 2);
    api.format(kind); await pause();
    check(`${kind}の途中で閉じる`, doc() === `${mark}前半${mark}${mark}後半${mark}`);
    await window.native({ kind: 'insert', text: '普通' }); await pause();
    check(`${kind}の分割後の解析`, doc() === `${mark}前半${mark}普通${mark}後半${mark}` && formattedAt(doc().indexOf('普通') + 1).length === 0);

    await create('前 後', 2); key(command); await pause(); key(command); await pause();
    check(`${kind}の空の解除`, doc() === '前 後');
    undo(view); await pause(); check(`${kind}の空の解除のUndo`, doc() === `前 ${mark}${mark}後`);
    view.dispatch({ selection: { anchor: view.state.doc.length } }); await pause();
    check(`${kind}のカーソル移動で自動削除`, doc() === '前 後' && view.state.selection.main.head === 3 && changes.at(-1) === '前 後');
    check(`${kind}の自動削除を履歴に積まない`, undoDepth(view.state) === 0);

    await create('前 後', 2); key(command); await pause(); document.querySelector('#outside').focus(); await pause();
    check(`${kind}のフォーカス喪失で自動削除`, doc() === '前 後' && changes.at(-1) === '前 後');
    await create(`前 ${mark}${mark} 後`, 0); document.querySelector('#outside').focus(); await pause();
    check(`${kind}の手書き記号は保つ`, doc() === `前 ${mark}${mark} 後`);
  }

  for (const [source, at, kind] of [['**前後**', 2, 'italic'], ['**前後**', 3, 'italic'], ['**前後**', 4, 'italic'], ['*前後*', 1, 'bold'], ['*前後*', 2, 'bold'], ['*前後*', 3, 'bold']]) {
    await create(source, at); api.format(kind); await pause(); await window.native({ kind: 'insert', text: '文字' }); await pause();
    const formats = formattedAt(doc().indexOf('文字') + 1);
    check(`${source}の${at}で${kind}を入れ子にする`, formats.includes('StrongEmphasis') && formats.includes('Emphasis'));
  }
  for (const props of [{ plain: true }, { previewOnly: true }, { readonly: true }, { busy: true }]) {
    await create('本文', 1, props); key('b'); key('i'); api.format('bold'); api.format('italic'); await pause();
    check(`${Object.keys(props)[0]}では装飾しない`, doc() === '本文');
  }
  await create('前 後', 2); await window.native({ kind: 'mark', text: '未確定', location: 3 });
  const marked = doc(); key('b'); key('i'); api.format('bold'); api.format('italic'); await pause();
  check('IME変換中は装飾しない', composing && doc() === marked); await window.native({ kind: 'unmark' });
  await create('一\n\n二', 0); view.dispatch({ selection: { anchor: 0, head: 4 } }); await pause();
  document.querySelector('.floating-toolbar button[aria-label="太字"]').click(); await pause();
  check('Floating Toolbarの複数段落の太字', doc() === '**一**\n\n**二**' && view.hasFocus);
  undo(view); await pause(); check('選択ありの装飾のUndo', doc() === '一\n\n二');
  key('f'); await pause(); check('検索のキーを保つ', !!document.querySelector('.nagori-find'));
  api.focus(); key('s'); check('保存のキーを保つ', saves === 1);
  await create('画面の確認。太字と斜体を入力します。', 6); api.format('bold'); await pause(); await window.native({ kind: 'insert', text: '新しい太字' }); await pause();
  return JSON.stringify({ pass: checks.every(item => item.pass) && !errors.length, checks, errors, doc: doc(), html: view.contentDOM.innerHTML, changes });
};
window.ready = true;
