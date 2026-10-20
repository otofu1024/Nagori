import { mount, unmount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import Editor from '../../src/lib/editor/Editor.svelte';
import '../../src/app.css';

const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [];
let component, view;
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const check = (name, pass) => checks.push({ name, pass: !!pass });
// 段落は1行ずつにして、黒い段落の数と番号を数えやすくする。先頭にFront Matterを置き、対象外であることも確かめる。
const paragraphs = Array.from({ length: 60 }, (_, i) => `第${i + 1}段落` + '折り返しの確認に使う本文です。'.repeat(i % 3 + 2));
const text = '---\ntitle: 確認\n---\n\n' + paragraphs.join('\n\n');
const scroller = () => view.scrollDOM;
const lines = () => [...view.contentDOM.children].filter(child => child.classList.contains('cm-line'));
const active = () => lines().filter(child => child.classList.contains('nagori-focus-active'));
const activeCount = () => view.contentDOM.querySelectorAll('.nagori-focus-active').length;
const activeNumber = () => Number(/第(\d+)段落/.exec(active()[0]?.textContent ?? '')?.[1] ?? 0);
const centerOffset = element => {
  const rect = element.getBoundingClientRect(), scroll = scroller().getBoundingClientRect();
  return (rect.top + rect.bottom) / 2 - (scroll.top + scroller().clientHeight / 2);
};
const line = number => lines().find(child => child.textContent.startsWith(`第${number}段落`));
// 指定の段落の中央が画面の中央に来る位置へ、手で動かした時と同じように移す
function scrollToParagraph(number) {
  const block = view.lineBlockAt(text.indexOf(`第${number}段落`));
  const scroll = scroller().getBoundingClientRect();
  scroller().scrollTop = view.documentTop - scroll.top + (block.top + block.bottom) / 2 - scroller().clientHeight / 2;
}
function key(value) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
}
async function create({ previewOnly = true, focus = true, typewriter = true, at = 0 } = {}) {
  if (component) await unmount(component);
  component = mount(Editor, { target: document.querySelector('#host'), props: {
    initialText: text, documentKey: `preview-focus-${checks.length}`, previewOnly, focus, typewriter,
    onReady: () => {}, onChange: () => {}, onComposition: () => {}, onSave: () => {}, onLink: () => {}, resolveImage: async () => '',
  } });
  await tick(); await pause(250);
  view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
  if (!previewOnly) view.dispatch({ selection: { anchor: at } });
  await pause(150);
}
window.run = async () => {
  await create();
  check('開いた時は先頭の段落だけが黒い', activeCount() === 1 && activeNumber() === 1);
  check('Front Matterは黒くならない', !view.contentDOM.querySelector('.nagori-focus-active:not(.cm-line)'));

  key('ArrowDown');
  const before = scroller().scrollTop;
  await pause(60);
  const middle = scroller().scrollTop;
  await pause(340);
  check('↓で次の段落へ移り、中央に来る', activeCount() === 1 && activeNumber() === 2 && Math.abs(centerOffset(active()[0])) < 12);
  check('↓の移動はなめらかに動く', middle > before && middle < scroller().scrollTop);

  key('ArrowUp'); await pause(340);
  check('一番上の段落で↑を押すと止まる', activeNumber() === 1 && scroller().scrollTop === 0);

  key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
  await pause(400);
  check('押し続けた時は途中でも次の段落へ進む', activeCount() === 1 && activeNumber() === 4 && Math.abs(centerOffset(active()[0])) < 12);

  const target = line(5), rect = target.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 20, clientY: (rect.top + rect.bottom) / 2, bubbles: true, cancelable: true }));
  await pause(60);
  check('クリックした段落が黒くなる', activeCount() === 1 && activeNumber() === 5);

  scrollToParagraph(20);
  await pause(400);
  check('手のスクロールの後は中央の段落が黒くなる', activeCount() === 1 && activeNumber() === 20 && Math.abs(centerOffset(active()[0])) < 80);

  // 手で動かした直後は待ちの間に黒を移さず、止まってから中央の段落へ移す
  scrollToParagraph(40);
  await pause(60);
  check('スクロールの止まる前は黒を移さない', activeCount() === 1 && activeNumber() === 20);
  await pause(400);
  check('スクロールが止まったら中央の段落へ移す', activeCount() === 1 && activeNumber() === 40 && Math.abs(centerOffset(active()[0])) < 80);

  for (let i = 0; i < 60; i++) key('ArrowDown');
  await pause(400);
  check('末尾の段落が画面の中央まで上がる', activeNumber() === 60 && Math.abs(centerOffset(active()[0])) < 12);
  key('ArrowDown'); await pause(340);
  check('末尾の段落で↓を押すと止まる', activeNumber() === 60 && activeCount() === 1);

  await create({ focus: false, typewriter: false });
  const start = scroller().scrollTop;
  key('ArrowDown'); await pause(300);
  check('集中モードがオフなら↓は1行分の移動のまま', activeCount() === 0 && Math.abs(scroller().scrollTop - start - view.defaultLineHeight) < 2);

  await create({ previewOnly: false, at: text.indexOf('第5段落') });
  check('編集画面では今の集中モードのまま(カーソルの段落)', activeCount() === 1 && activeNumber() === 5);

  check('JavaScriptのエラーなし', errors.length === 0);
  return JSON.stringify({ pass: checks.every(item => item.pass), checks, errors });
};
window.ready = true;
