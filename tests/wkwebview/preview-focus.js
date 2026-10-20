import { mount, unmount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import Editor from '../../src/lib/editor/Editor.svelte';
import '../../src/app.css';

const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [];
let component, view;
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
// CodeMirrorは更新中の例外を console.error に出すだけなので、それも捕まえる
const reportError = console.error.bind(console);
console.error = (...args) => { errors.push(args.map(String).join(' ')); reportError(...args); };
// 失敗の原因を次の実行で分けるため、各checkの時点の状態を detail に残す
const check = (name, pass) => checks.push({ name, pass: !!pass, detail: describe() });
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
// 黒い段落は、画面の外へ出ると DOM から外れるため、選択の位置の段落で数える
const selected = () => Number(/第(\d+)段落/.exec(view.state.doc.lineAt(view.state.selection.main.head).text)?.[1] ?? 0);
// 画面の中央の高さにある段落の番号
const middleNumber = () => {
  const middle = scroller().getBoundingClientRect().top + scroller().clientHeight / 2;
  const hit = lines().find(child => { const rect = child.getBoundingClientRect(); return rect.top <= middle && rect.bottom >= middle; });
  return Number(/第(\d+)段落/.exec(hit?.textContent ?? '')?.[1] ?? 0);
};
// 黒い段落の番号と数、中央からのずれ、スクロールの寸法をまとめる
const describe = () => {
  if (!view) return '';
  const first = active()[0], offset = first ? Math.round(centerOffset(first)) : null;
  const numbers = active().map(child => /第(\d+)段落/.exec(child.textContent)?.[1] ?? '?');
  const scroll = scroller();
  return `scrollTop=${scroll.scrollTop} scrollHeight=${scroll.scrollHeight} clientHeight=${scroll.clientHeight} 黒い段落=[${numbers.join(',')}] 数=${activeCount()} 中央からのずれ=${offset ?? 'なし'}`;
};
// 指定の段落の中央が画面の中央に来る位置へ、手で動かした時と同じように移す。
// documentTop は画面上の座標で、scrollTop を変えると一緒に動くため、現在の scrollTop に差を足して求める
function scrollToParagraph(number) {
  const block = view.lineBlockAt(text.indexOf(`第${number}段落`));
  const scroll = scroller().getBoundingClientRect();
  scroller().scrollTop += view.documentTop + (block.top + block.bottom) / 2 - (scroll.top + scroller().clientHeight / 2);
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

  // 先頭近くは中央まで下げられないため、次の段落へ移っても一番上のまま
  key('ArrowDown');
  await pause(340);
  check('↓で次の段落へ移り、一番上のまま', activeCount() === 1 && activeNumber() === 2 && scroller().scrollTop === 0);

  key('ArrowUp'); await pause(340);
  check('一番上の段落で↑を押すと止まる', activeNumber() === 1 && scroller().scrollTop === 0);

  key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
  await pause(400);
  check('押し続けた時は途中でも次の段落へ進む', activeCount() === 1 && activeNumber() === 4);

  const target = line(5), rect = target.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 20, clientY: (rect.top + rect.bottom) / 2, bubbles: true, cancelable: true }));
  await pause(60);
  check('クリックした段落が黒くなる', activeCount() === 1 && activeNumber() === 5);

  scrollToParagraph(20);
  await pause(400);
  const middle20 = middleNumber();
  check('手のスクロールの後は画面の中央の段落が黒くなる', selected() === middle20 && middle20 > 0 && activeCount() === 1 && active()[0] === line(middle20) && Math.abs(centerOffset(active()[0])) < 80);

  // 手で動かした直後は待ちの間に黒を移さず、止まってから中央の段落へ移す
  scrollToParagraph(40);
  await pause(60);
  check('スクロールの止まる前は黒を移さない', selected() === middle20);
  await pause(400);
  const middle40 = middleNumber();
  check('スクロールが止まったら画面の中央の段落へ移す', selected() === middle40 && middle40 > 0 && activeCount() === 1 && active()[0] === line(middle40) && Math.abs(centerOffset(active()[0])) < 80);

  // 中央に置ける位置では、↓で次の段落が中央に来て、なめらかに動く
  scrollToParagraph(12);
  await pause(400);
  check('中央に置ける位置では手で移した後に第12段落が黒い', activeCount() === 1 && activeNumber() === 12 && Math.abs(centerOffset(active()[0])) < 80);
  const beforeCentered = scroller().scrollTop;
  key('ArrowDown');
  await pause(60);
  const middleCentered = scroller().scrollTop;
  await pause(340);
  check('中央に置ける位置で↓を押すと第13段落が中央に来る', activeCount() === 1 && activeNumber() === 13 && Math.abs(centerOffset(active()[0])) < 12);
  check('中央に置ける位置での↓の移動はなめらかに動く', beforeCentered < middleCentered && middleCentered < scroller().scrollTop);

  for (let i = 0; i < 60; i++) key('ArrowDown');
  await pause(400);
  check('末尾の段落が画面の中央まで上がる', activeNumber() === 60 && Math.abs(centerOffset(active()[0])) < 12);
  key('ArrowDown'); await pause(340);
  check('末尾の段落で↓を押すと止まる', activeNumber() === 60 && activeCount() === 1);

  // 黒い段落が画面の外にある時は、↓で前後へ移さず、画面の中央の段落を黒くする。
  // 手のスクロールの後は中央へ戻すまで150msの待ちがあるため、その間に↓を押して画面の外のまま確かめる
  view.dispatch({ selection: { anchor: text.indexOf('第60段落') } });
  await pause(100);
  check('末尾の段落へ移すと、その段落が黒い', selected() === 60 && activeNumber() === 60);
  scrollToParagraph(30);
  const outside = () => { const block = view.lineBlockAt(text.indexOf('第60段落')), scroll = scroller().getBoundingClientRect(); return view.documentTop + block.top > scroll.bottom || view.documentTop + block.bottom < scroll.top; };
  check('手で動かした直後は、黒い段落(第60段落)が画面の外にある', outside());
  key('ArrowDown');
  await pause(340);
  // 中央の段落は第30段落付近。描き直しの前後で1つずれないよう、番号は範囲で確かめる
  const picked = selected();
  check('画面の外の段落で↓を押すと、画面の中央の段落が黒くなる', picked >= 29 && picked <= 31 && activeNumber() === picked && activeCount() === 1 && Math.abs(centerOffset(active()[0])) < 80);
  key('ArrowDown');
  await pause(340);
  check('もう一度↓で次の段落へ移る', selected() === picked + 1 && activeNumber() === picked + 1 && activeCount() === 1);

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
