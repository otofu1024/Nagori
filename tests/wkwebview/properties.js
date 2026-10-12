import { mount, unmount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import { undo, redo, cursorLineUp, cursorLineDown, deleteCharBackward } from '@codemirror/commands';
import Editor from '../../src/lib/editor/Editor.svelte';
import '../../src/app.css';
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const original = `---
# コメントを残す
title: はじめて # タイトル
description: ノートの説明
publishedAt: 2026-08-29
category: daily
tags:
  - 記念 # 一覧の注記
  - 日記
draft: false
authors: [はじめて]
count: 1.5
time: 2026-08-29T12:34:56+09:00
aliases: [ノート]
nullValue:
other: {nested: true}
---


## Markdownを楽に編集したい

本文の最初の行
次の行
`;
let component, view, api, composing = false, timer, headings = [];
const saves = [], errors = [];
window.addEventListener('error', e => errors.push(e.message));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
window.native = action => new Promise(resolve => { window.nativeDone = resolve; window.webkit.messageHandlers.ime.postMessage(action); });
async function create(text = original, config = {}) {
  clearTimeout(timer); if (component) await unmount(component);
  saves.length = 0; composing = false; headings = [];
  component = mount(Editor, { target: document.querySelector('#host'), props: {
    initialText: text, documentKey: 'properties',
    onReady: value => api = value,
    onOutline: value => headings = value,
    onChange: text => { clearTimeout(timer); if (!composing) timer = setTimeout(() => saves.push(text), 120); },
    onComposition: value => { composing = value; if (value) clearTimeout(timer); },
    onSave: () => {}, onLink: () => {}, resolveImage: async () => '', ...config,
  } });
  await tick(); await pause(180); view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
}
const input = key => document.querySelector(`[aria-label="${key}"]`);
function edit(key, value) {
  const node = input(key); node.focus(); node.value = value; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}
function addChip(key, value) {
  const node = input(key + 'に追加'); node.focus(); node.value = value;
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
window.show = async () => { await create(); };
window.run = async () => {
  const checks = []; const check = (name, pass) => checks.push({ name, pass: !!pass });
  await create();
  check('YAML順の3列の一覧', [...document.querySelectorAll('.nagori-property-row')].map(row => row.dataset.key).join(',') === 'title,description,publishedAt,category,tags,draft,authors,count,time,aliases,nullValue,other');
  check('本文の空行を表示だけ詰める', !view.contentDOM.querySelector('.cm-line')?.textContent?.includes('---') && view.state.doc.toString() === original);
  const heading = view.contentDOM.querySelector('.nagori-heading.nagori-h2');
  check('プロパティ直後を見出しとして表示', heading?.textContent.includes('Markdownを楽に編集したい'));
  check('プロパティ直後の見出しを目次に表示', headings.length === 1 && headings[0].level === 2 && headings[0].text === 'Markdownを楽に編集したい');
  const body = [...view.contentDOM.querySelectorAll('.cm-line')].find(line => line.textContent.includes('本文の最初'));
  const bodySize = parseFloat(getComputedStyle(body).fontSize);
  const nameSize = parseFloat(getComputedStyle(document.querySelector('.nagori-property-name')).fontSize);
  check('項目名と値は本文の約0.85倍', Math.abs(nameSize / bodySize - .85) < .01 && parseFloat(getComputedStyle(input('title')).fontSize) === nameSize);
  check('プロパティの見出しは項目名より少し大きい', parseFloat(getComputedStyle(document.querySelector('.nagori-properties-heading')).fontSize) > nameSize && parseFloat(getComputedStyle(document.querySelector('.nagori-properties-heading')).fontSize) < bodySize);
  check('プロパティと本文の間を少し空ける', heading && heading.getBoundingClientRect().top - document.querySelector('.nagori-property-add').getBoundingClientRect().bottom >= bodySize * 2 && heading.getBoundingClientRect().top - document.querySelector('.nagori-property-add').getBoundingClientRect().bottom <= bodySize * 5);
  const tagsRow = document.querySelector('[data-key="tags"]');
  const chips = [...tagsRow.querySelectorAll('.nagori-property-chip')];
  check('tagsはアクセント色の小さなチップ', getComputedStyle(chips[0]).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(chips[0]).color === getComputedStyle(chips[0].querySelector('button')).color);
  check('tagsの行を折り返さない', getComputedStyle(tagsRow.querySelector('.nagori-property-chips')).flexWrap === 'nowrap' && chips.every(chip => Math.abs(chip.getBoundingClientRect().top - chips[0].getBoundingClientRect().top) < 1));
  check('ほかの一覧は背景なしで別のアイコン', getComputedStyle(document.querySelector('[data-key="authors"] .nagori-property-chip')).backgroundColor === 'rgba(0, 0, 0, 0)' && tagsRow.querySelector('path').getAttribute('d') !== document.querySelector('[data-key="authors"] path').getAttribute('d'));
  check('aliasesもアクセント色のチップ', getComputedStyle(document.querySelector('[data-key="aliases"] .nagori-property-chip')).backgroundColor !== 'rgba(0, 0, 0, 0)');
  const listInput = input('tagsに追加');
  check('追加欄は行にカーソルがない時だけ隠す', getComputedStyle(listInput).opacity === (tagsRow.matches(':hover') ? '1' : '0'));
  listInput.focus(); check('入力中は追加欄を表示', getComputedStyle(listInput).opacity === '1'); listInput.blur();
  check('日付の値の前にカレンダーを出さない', !document.querySelector('[data-key="publishedAt"] .nagori-property-value svg'));
  check('読み取り専用の入れ子', document.querySelector('[data-key="other"] .nagori-property-value').textContent.includes('nested') && !document.querySelector('[data-key="other"] input'));
  check('nullは読み取り専用の文字', !document.querySelector('[data-key="nullValue"] input') && document.querySelector('[data-key="nullValue"] .nagori-property-value').textContent === 'null');
  edit('title', '新タイトル'); edit('description', '新しい説明'); edit('category', 'memo'); edit('publishedAt', '2026-10-12'); edit('count', '-2.75'); edit('time', '2026-10-13'); input('draft').click();
  check('文字・日付・真偽の編集', view.state.doc.toString().includes('title: 新タイトル # タイトル') && view.state.doc.toString().includes('publishedAt: 2026-10-12') && view.state.doc.toString().includes('draft: true'));
  check('数字の型を保って編集', input('count').type === 'number' && view.state.doc.toString().includes('count: -2.75'));
  check('日時の日付を編集し時刻とタイムゾーンを保つ', input('time').type === 'date' && input('time').value === '2026-10-13' && view.state.doc.toString().includes('time: 2026-10-13T12:34:56+09:00'));
  const beforeEmptyNumber = view.state.doc.toString(); edit('count', '');
  check('空の数字を0で上書きしない', view.state.doc.toString() === beforeEmptyNumber); edit('count', '-2.75');
  edit('publishedAt', ''); check('日付の値を空の文字にできる', input('publishedAt').type === 'text' && view.state.doc.toString().includes('publishedAt: ""'));
  const titleNode = input('title'); edit('title', '続けて入力'); check('入力欄のDOMを保つ', input('title') === titleNode && document.activeElement === titleNode);
  const beforeUndo = view.state.doc.toString();
  titleNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
  check('入力欄からCmd+Z', view.state.doc.toString() !== beforeUndo && input('title').value === '新タイトル'); redo(view);
  addChip('tags', '追加タグ'); check('一覧を追加', view.state.doc.toString().includes('追加タグ'));
  document.querySelector('[aria-label="記念を削除"]').click(); check('チップを削除しコメントを残す', !document.querySelector('[aria-label="記念を削除"]') && view.state.doc.toString().includes('# 一覧の注記'));
  document.querySelector('[aria-label="はじめてを削除"]').click(); check('任意の一覧の最後の値を削除', view.state.doc.toString().includes('authors: []'));
  addChip('authors', '著者'); check('任意の一覧に追加', view.state.doc.toString().includes('著者'));
  document.querySelector('.nagori-property-add').click();
  const keyInput = input('追加するプロパティ');
  check('追加の項目名は文字の入力', keyInput.type === 'text' && !keyInput.hidden);
  keyInput.value = 'custom: name';
  keyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('任意の項目名を文字の項目として追加', input('custom: name')?.type === 'text' && view.state.doc.toString().includes('"custom: name": ""'));
  await pause(160); check('自動保存へ本文と同じ変更通知', saves.at(-1) === view.state.doc.toString());
  await create(); const beforeIME = view.state.doc.toString();
  const node = input('title'); node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); node.value = 'にほんご';
  node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
  await pause(180); check('変換中は書き戻しと保存を止める', composing && view.state.doc.toString() === beforeIME && !saves.length && input('title') === node);
  node.value = '日本語'; node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' })); await pause();
  check('変換確定後に書き戻す', !composing && view.state.doc.toString().includes('title: 日本語 # タイトル'));
  undo(view); check('変換をUndo', view.state.doc.toString() === beforeIME);
  if (window.webkit?.messageHandlers?.ime) {
    node.focus(); node.select();
    await window.native({ kind: 'mark', text: 'にほんご', location: 4 });
    check('WKWebViewの実変換中は本文を保持', view.state.doc.toString() === beforeIME && composing);
    await window.native({ kind: 'insert', text: '日本語' }); await pause();
    check('WKWebViewの実変換を確定', !composing && view.state.doc.toString().includes('title: 日本語 # タイトル'));
    undo(view); check('WKWebViewの変換をUndo', view.state.doc.toString() === beforeIME);
  }
  document.querySelector('.nagori-properties-heading').click(); await pause();
  check('ソースにYAMLと区切りを表示', !document.querySelector('.nagori-properties') && view.contentDOM.textContent.includes('title: はじめて') && view.contentDOM.textContent.includes('---'));
  const at = view.state.doc.toString().indexOf('はじめて'); view.dispatch({ changes: { from: at, to: at + 4, insert: '本文で編集' } });
  view.dispatch({ selection: { anchor: view.state.doc.length } }); await pause();
  check('本文のYAML編集を反映', input('title').value === '本文で編集');
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('本文の最初') } });
  cursorLineUp(view); cursorLineDown(view); check('上下移動でYAMLに入らない', view.state.selection.main.head >= view.state.doc.toString().indexOf('## Markdown'));
  const protectedDoc = view.state.doc.toString(); view.dispatch({ selection: { anchor: protectedDoc.indexOf('## Markdown') } }); deleteCharBackward(view);
  check('先頭のBackspaceでYAMLを消さない', view.state.doc.toString() === protectedDoc);
  api.replaceText(original.replace('はじめて # タイトル', '外部で変更 # タイトル')); await pause(); check('外部の変更を反映', input('title').value === '外部で変更');
  api.replaceText('---\ntitle: [\n---\n本文'); await pause(); check('読めないYAMLはソースで修正', !document.querySelector('.nagori-properties') && view.contentDOM.textContent.includes('title: ['));
  await create(original, { plain: true }); check('テキストファイルはYAMLを表示', !document.querySelector('.nagori-properties') && view.contentDOM.textContent.includes('title: はじめて'));
  await create(original, { previewOnly: true }); check('Previewは同じ見た目で読み取り専用', document.querySelector('.nagori-properties') && !document.querySelector('.nagori-properties input:not(:disabled)') && !document.querySelector('.nagori-property-add') && !document.querySelector('.nagori-property-chip button'));
  check('Previewでも直後の見出しと目次を表示', view.contentDOM.querySelector('.nagori-heading.nagori-h2')?.textContent.includes('Markdownを楽に編集したい') && headings[0]?.text === 'Markdownを楽に編集したい');
  check('Previewでも日付の値の前にカレンダーを出さない', !document.querySelector('[data-key="publishedAt"] .nagori-property-value svg'));
  await create('## 普通のノート\n\n本文'); check('Front Matterがないノートは今までどおり', !document.querySelector('.nagori-properties') && view.contentDOM.querySelector('.nagori-heading.nagori-h2'));
  await create(); check('JavaScriptのエラーなし', !errors.length);
  return JSON.stringify({ pass: checks.every(check => check.pass), checks, errors, realIME: !!window.webkit?.messageHandlers?.ime });
};
window.ready = true;
