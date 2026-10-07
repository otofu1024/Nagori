import { mount, unmount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import EditorFixture from './EditorFixture.svelte';
import '../../src/app.css';

const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
let component, view, composing = false, saveTimer, saveTick = 0, source = '';
const errors = [], saves = [];
window.addEventListener('error', event => errors.push(event.message));
window.native = action => new Promise(resolve => {
  window.nativeDone = resolve;
  window.webkit.messageHandlers.ime.postMessage(action);
});
const box = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height });
function inspect() {
  const selection = document.getSelection(), range = view.state.selection.main;
  const native = document.createRange();
  if (selection?.focusNode && view.contentDOM.contains(selection.focusNode)) {
    native.setStart(selection.focusNode, selection.focusOffset); native.collapse(true);
  }
  return {
    doc: view.state.doc.toString(), head: range.head, anchor: range.anchor, composing,
    domHead: selection?.focusNode && view.contentDOM.contains(selection.focusNode) ? view.posAtDOM(selection.focusNode, selection.focusOffset) : null,
    html: view.contentDOM.innerHTML,
    selected: selection?.toString(), native: box(native.getBoundingClientRect()),
    cursors: [...view.scrollDOM.querySelectorAll('.cm-cursor')].map(node => box(node.getBoundingClientRect())),
    caret: getComputedStyle(view.contentDOM).caretColor,
    font: getComputedStyle(view.contentDOM).fontSize, lineHeight: getComputedStyle(view.contentDOM).lineHeight,
    animation: getComputedStyle(view.scrollDOM.querySelector('.cm-cursorLayer')).animationName,
    opacity: getComputedStyle(view.scrollDOM.querySelector('.cm-cursorLayer')).opacity,
  };
}
function scheduleSave() {
  clearTimeout(saveTimer);
  if (composing) return;
  saveTimer = setTimeout(() => { saves.push(view.state.doc.toString()); component.save(true); setTimeout(() => component.save(false), 120); }, 500);
}
async function create(name, at, text) {
  await window.native({ kind: 'unmark' });
  clearTimeout(saveTimer);
  if (component) await unmount(component);
  composing = false; saves.length = 0; saveTick = 0;
  source = text;
  component = mount(EditorFixture, { target: document.querySelector('#host'), props: { config: {
    initialText: text, documentKey: name, plain: name === 'plain', focus: name === 'focus', typewriter: name === 'focus',
    onReady: api => window.editorApi = api, onChange: scheduleSave,
    onComposition: active => { composing = active; if (active) clearTimeout(saveTimer); else scheduleSave(); },
    onSave: () => {}, onLink: () => {}, resolveImage: async () => '',
  } } });
  await tick(); await pause(200);
  view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
  view.contentDOM.addEventListener('compositionupdate', () => component.save(++saveTick % 2 === 1));
  // 確認用の画面へ紛れ込んだ実キー入力は、結果から見分けられるようにする。
  view.contentDOM.addEventListener('beforeinput', event => { if (event.inputType === 'insertParagraph') { event.preventDefault(); errors.push('予定外の改行入力'); } }, true);
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(at, 1)]) });
  window.editorApi.focus(); await pause(160);
}
window.run = async () => {
  const results = [], checks = [];
  const check = (name, pass) => checks.push({ name, pass });
  const paragraph = '折り返した段落の途中で日本語を入力して変換する位置を確認します。'.repeat(8);
  for (const name of ['normal', 'bold', 'link', 'heading', 'plain', 'focus']) {
    const text = name === 'bold' ? `**${paragraph}**\n\n後の段落` : name === 'link' ? `[${paragraph}](https://example.com)\n\n後の段落` : name === 'heading' ? `## ${paragraph}\n\n後の段落` : `${paragraph}\n\n**後の太字**`;
    for (const action of ['commit', 'cancel', 'unmark', 'backspace']) {
      const at = 45;
      await create(name, at, text);
      check(`${name}/${action}/初期本文`, view.state.doc.toString() === text && view.state.selection.main.head === at);
      const steps = [];
      const send = async (stage, command) => { await window.native(command); steps.push({ stage, ...inspect() }); };
      await send('ひらがな', { kind: 'mark', text: 'にほんご', location: 4 });
      check(`${name}/${action}/保存待機`, saves.length === 0);
      const kana = steps.at(-1), cursor = kana.cursors[0];
      check(`${name}/${action}/文字の高さ`, composing && !!cursor && Math.abs(cursor.height - kana.native.height) < 1.5 && Math.abs(cursor.top - kana.native.top) < 1.5);
      check(`${name}/${action}/標準カーソル非表示`, kana.caret === 'rgba(0, 0, 0, 0)');
      await pause(650); check(`${name}/${action}/変換中の自動保存停止`, saves.length === 0);
      // IMEはBackspaceで短くした未確定文字をsetMarkedTextへ渡す。
      if (action === 'backspace') for (let i = 3; i >= 0; i--) await send(`削除${i}`, { kind: 'mark', text: 'にほんご'.slice(0, i), location: i });
      else {
        await send('漢字', { kind: 'mark', text: '日本語', location: 0, length: 2 });
        await send('文節移動', { kind: 'mark', text: '日本語', location: 2, length: 1 });
        if (action === 'cancel') await send('取り消し', { kind: 'mark', text: '', location: 0 });
      }
      await send('確定', action === 'commit' ? { kind: 'insert', text: '日本語' } : { kind: 'unmark' });
      const expected = action === 'cancel' || action === 'backspace' ? text : text.slice(0, at) + '日本語' + text.slice(at);
      check(`${name}/${action}/本文と位置`, view.state.doc.toString() === expected && view.state.selection.main.head === at + (action === 'cancel' || action === 'backspace' ? 0 : 3));
      if (action === 'commit') {
        await pause(700); check(`${name}/${action}/確定後の保存`, saves.at(-1) === expected);
        undo(view); await pause(); check(`${name}/${action}/Undo`, view.state.doc.toString() === source);
        redo(view); await pause(); check(`${name}/${action}/Redo`, view.state.doc.toString() === expected);
      }
      results.push({ name, action, steps });
    }
  }
  const indented = '　この映画で**良かった**とこって、あまり説明しすぎないところですね。続いて静かな場面を見ていきます。'.repeat(4) + '\n\n後の段落';
  for (const at of [0, 14, 19, 36, 70]) {
    await create('normal', at, indented);
    const steps = [];
    for (let n = 4; n >= 0; n--) {
      await window.native({ kind: 'mark', text: 'あ'.repeat(n), location: n });
      steps.push({ stage: `未確定${n}`, ...inspect() });
      check(`字下げと太字/${at}/削除${n}`, view.state.doc.toString() === indented.slice(0, at) + 'あ'.repeat(n) + indented.slice(at) && view.state.selection.main.head === at + n);
    }
    await window.native({ kind: 'mark', text: 'あ', location: 1 });
    await window.native({ kind: 'insert', text: 'あ' });
    check(`字下げと太字/${at}/空にした後の再入力`, view.state.doc.toString() === indented.slice(0, at) + 'あ' + indented.slice(at) && view.state.selection.main.head === at + 1);
    steps.push({ stage: '再入力と確定', ...inspect() });
    results.push({ name: '字下げと太字', at, steps });
  }
  for (const name of ['normal', 'bold', 'plain']) {
    const text = name === 'bold' ? `**${paragraph}**` : paragraph, at = 45;
    await create(name, at, text);
    await window.native({ kind: 'insert', text: 'abc' });
    const typed = text.slice(0, at) + 'abc' + text.slice(at);
    check(`${name}/通常入力`, view.state.doc.toString() === typed && view.state.selection.main.head === at + 3);
    const data = new DataTransfer(); data.setData('text/plain', '貼付日本語');
    view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await pause();
    const pasted = text.slice(0, at) + 'abc貼付日本語' + text.slice(at);
    check(`${name}/貼り付け`, view.state.doc.toString() === pasted && view.state.selection.main.head === at + 8);
    undo(view); await pause(); check(`${name}/貼り付けのUndo`, view.state.doc.toString() === typed);
    undo(view); await pause(); check(`${name}/通常入力のUndo`, view.state.doc.toString() === text);
    redo(view); redo(view); await pause(); check(`${name}/通常入力と貼り付けのRedo`, view.state.doc.toString() === pasted);
    await create(name, at, text);
    // 確定済みの語を未確定文字へ戻す呼び出しも確かめる。
    await window.native({ kind: 'mark', text: 'にほんご', location: 4, replace: at, replaceLength: 3 });
    await window.native({ kind: 'mark', text: '日本語', location: 2, length: 1 });
    await window.native({ kind: 'insert', text: '日本語' });
    check(`${name}/再変換`, view.state.doc.toString() === text.slice(0, at) + '日本語' + text.slice(at + 3) && view.state.selection.main.head === at + 3);
  }
  const punctuation = 'ああああああああ、ああああああああ「ああああああああ」ああああああああ。'.repeat(8);
  for (const at of [0, 4, 8, 9, 16, 17, 24, 25, 45, 90]) {
    await create('normal', at, punctuation);
    await window.native({ kind: 'mark', text: 'ああああ', location: 4 });
    await window.native({ kind: 'mark', text: '嗚呼嗚呼', location: 0, length: 2 });
    await window.native({ kind: 'mark', text: '嗚呼嗚呼', location: 2, length: 2 });
    await window.native({ kind: 'insert', text: '嗚呼嗚呼' });
    check(`繰り返しと句読点/${at}`, view.state.doc.toString() === punctuation.slice(0, at) + '嗚呼嗚呼' + punctuation.slice(at) && view.state.selection.main.head === at + 4);
  }
  await create('normal', 45, paragraph);
  await window.native({ kind: 'mark', text: 'にほんご', location: 4 });
  const lit = inspect(); await pause(650); const blink = inspect();
  check('変換中の点滅', lit.opacity !== blink.opacity);
  await window.native({ kind: 'mark', text: '日本語', location: 3 });
  check('移動後の点灯', inspect().opacity === '1');
  check('JavaScriptのエラーなし', errors.length === 0);
  return JSON.stringify({ pass: checks.every(check => check.pass), checks, results, errors, final: inspect() });
};
window.ready = true;
