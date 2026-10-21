import { mount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import Editor from '../../src/lib/editor/Editor.svelte';
import '../../src/app.css';

// 本文の外側(左右の余白や本文の左のpadding)を押した時の確認用ページ。
// ?preview=1 でLive Previewの読み取り専用表示、それ以外で編集画面を開く。
// マウス操作はPlaywrightから行うため、このページは本文を表示して view を window に置くだけにする。
const preview = new URLSearchParams(location.search).get('preview') === '1';
const errors = [];
window.addEventListener('error', event => errors.push(event.message));
window.errors = errors;

const paragraphs = Array.from({ length: 60 }, (_, i) => `第${i + 1}段落` + '折り返しの確認に使う本文です。'.repeat(i % 3 + 2));
mount(Editor, { target: document.querySelector('#host'), props: {
  initialText: paragraphs.join('\n\n'), documentKey: 'margin-click', previewOnly: preview, focus: false, typewriter: false,
  onReady: () => {}, onChange: () => {}, onComposition: () => {}, onSave: () => {}, onLink: () => {}, resolveImage: async () => '',
} });
await tick();
await new Promise(resolve => setTimeout(resolve, 500));
window.__view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
window.ready = true;
