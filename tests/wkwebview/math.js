import { mount, tick } from 'svelte';
import Editor from '../../src/lib/editor/Editor.svelte';
import '../../src/app.css';
const errors = [];
window.addEventListener('error', e => errors.push(e.message));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
window.show = async () => {};
window.run = async () => {
  mount(Editor, { target: document.querySelector('#host'), props: {
    initialText: '本文\n\n$E=mc^2$ と $\\alpha+\\beta$\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n末尾', documentKey: 1, previewOnly: true,
    onReady: () => {}, onChange: () => {}, onComposition: () => {}, onSave: () => {}, onLink: () => {}, resolveImage: async () => '' } });
  await tick();
  for (let i = 0; i < 60 && document.querySelectorAll('mjx-container').length < 3 && !document.querySelector('.nagori-math-error'); i++) await new Promise(r => setTimeout(r, 100));
  await document.fonts.ready; await new Promise(r => setTimeout(r, 300));
  const checks = [
    { name: '数式3つがMathJaxで表示される', pass: document.querySelectorAll('mjx-container').length === 3 },
    { name: '数式エラーがない', pass: !document.querySelector('.nagori-math-error') },
    { name: 'フォントの読み込み先が解決されている', pass: !/nagori-mathjax-font\//.test(document.getElementById('nagori-mathjax-style')?.textContent ?? 'x') },
  ];
  const errorTitles = [...document.querySelectorAll('.nagori-math-error')].map(e => e.title);
  return JSON.stringify({ pass: checks.every(c => c.pass) && !errors.length, checks, errors, errorTitles });
};
window.ready = true;
