import { mount, tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import App from '../../src/App.svelte';
import { defaults } from '../../src/lib/workspace/settings.ts';
import '../../src/app.css';

const checks = [], errors = [], calls = [];
const check = (name, pass) => checks.push({ name, pass: !!pass });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) {
  const started = performance.now();
  while (!test()) {
    if (performance.now() - started > 15000) throw Error('確認の待ち時間を超えました');
    await pause(20);
  }
}
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const root = '/private/tmp/nagori-git-ui';
const paths = ['src/content/blog/20261013-4d1877/index.md', 'public/images/cover.png', 'notes/日本語 空白.md', 'public/images/sketch.png', 'notes/draft.md'];
const files = new Map([[paths[0], '# Gitの確認\n\n本文です。\n'], [paths[2], '# 日本語のファイル\n']]);
let sequence = 0, statusReads = 0, available = true, pushError = '', hold;
const callbacks = new Map();
const sample = () => ({ branch: 'main', upstream: 'origin/main', ahead: 2,
  changes: [
    { path: paths[0], originalPath: null, index: 'M', worktree: '.' },
    { path: paths[1], originalPath: null, index: 'A', worktree: '.' },
    { path: paths[2], originalPath: null, index: '.', worktree: 'M' },
    { path: paths[3], originalPath: null, index: '.', worktree: '?' },
    { path: paths[4], originalPath: null, index: '.', worktree: 'D' },
  ], lastCommit: { oid: 'head-2', message: '記事追加', undo: 'reset', reason: null } });
let state = sample();
let settings = { ...defaults, lastProject: root, lastFile: paths[0], theme: new URLSearchParams(location.search).get('theme') ?? 'light', outlineWidth: 310, autosaveDelay: 60000 };
const entries = () => [...files.keys()].map(path => ({ path, name: path.split('/').at(-1), kind: 'markdown' }));
window.isTauri = true;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.__TAURI_INTERNALS__ = {
  transformCallback(callback) { callbacks.set(++sequence, callback); return sequence; },
  unregisterCallback(id) { callbacks.delete(id); },
  async invoke(command, args = {}) {
    if (command === 'plugin:event|listen') return args.handler;
    if (command === 'plugin:event|unlisten') return;
    if (command === 'settings_get') return settings;
    if (command === 'settings_save') { settings = args.settings; return; }
    if (command === 'open_request_take') return null;
    if (command === 'workspace_open') return { root, blogMode: false };
    if (command === 'workspace_list') return args.path ? [] : [{ path: 'notes', name: 'notes', kind: 'directory' }];
    if (command === 'workspace_index') return entries();
    if (command === 'trash_list') return [];
    if (command === 'document_open') return { path: args.path, text: files.get(args.path), baseline: files.get(args.path), readonly: false };
    if (command === 'document_save') { calls.push({ command, args }); files.set(args.path, args.text); return { baseline: args.text }; }
    if (command === 'git_status') { statusReads++; return available ? structuredClone(state) : null; }
    if (command === 'git_action') {
      calls.push({ command, args });
      if (hold) await hold;
      const action = args.action;
      if (action.kind === 'push' && pushError) throw { code: pushError, message: pushError === 'GIT_PULL_REQUIRED' ? 'fetch first' : 'GitHubのログインが要ります。ターミナルで1回pushしてください' };
      if (action.kind === 'stage') for (const row of state.changes) if (action.paths.includes(row.path)) { row.index = row.worktree === '?' ? 'A' : row.worktree; row.worktree = '.'; }
      if (action.kind === 'unstage') for (const row of state.changes) if (action.paths.includes(row.path)) { row.worktree = row.index; row.index = '.'; }
      if (action.kind === 'commit') {
        state.changes = state.changes.filter(row => row.index === '.');
        state.lastCommit = { oid: 'head-3', message: action.message, undo: 'reset', reason: null };
        state.ahead++;
      }
      if (action.kind === 'push') state.ahead = 0;
      if (action.kind === 'pull') files.set(paths[0], '# 取り込んだ記事\n');
      return structuredClone(state);
    }
    throw Error('確認ページにないコマンド: ' + command);
  },
};
mount(App, { target: document.querySelector('#host') });
const toggle = () => document.querySelector('.git-toggle');
const panel = () => document.querySelector('.git-panel');
const editorView = () => { const element = document.querySelector('.cm-editor'); return element ? EditorView.findFromDOM(element) : null; };
const button = (label, within = panel()) => [...within.querySelectorAll('button')].find(button => button.textContent.trim() === label);
const row = (path, staged = false) => [...panel().querySelectorAll('.git-section')].find(section => section.querySelector('h3').textContent.startsWith(staged ? 'ステージした変更' : '変更'))?.querySelector(`[data-path="${path}"]`);
const editMessage = async message => { const input = panel().querySelector('textarea'); input.value = message; input.dispatchEvent(new Event('input', { bubbles: true })); await tick(); };
const focusRefresh = async () => {
  const count = statusReads;
  window.dispatchEvent(new Event('focus'));
  await until(() => statusReads > count);
  // IPCの開始だけでなく、応答を受けたSvelteの描画まで待つ。
  await new Promise(resolve => requestAnimationFrame(resolve));
  await tick();
};
async function actionDone() { await until(() => !panel()?.querySelector('.git-spinner')); await pause(80); }

window.show = async () => {
  await until(() => toggle() && !toggle().disabled);
  if (!panel()) toggle().click();
  await until(panel);
};
window.run = async () => {
  try {
    await until(() => toggle() && !toggle().disabled && editorView());
    check('Gitと目次を1つのグループに並べる', document.querySelector('.right-pane-tabs .outline-toggle')?.nextElementSibling === toggle());
    const editor = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const initialEditor = document.querySelector('.cm-editor');
    const preview = document.querySelector('[aria-label="Previewで閲覧する"]');
    const normalBackground = getComputedStyle(preview).backgroundColor;
    check('編集時もボタンはPreviewで押されていない', preview.textContent.trim() === 'Preview' && preview.getAttribute('aria-pressed') === 'false' && preview.title === 'Previewで閲覧する');
    preview.click(); await tick(); await pause(100);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
    const color = document.createElement('span'); color.style.backgroundColor = accent; document.body.append(color);
    check('閲覧時はPreviewボタンをほかの押されたボタンと同じ色にする', preview.textContent.trim() === 'Preview' && preview.getAttribute('aria-pressed') === 'true' && getComputedStyle(preview).backgroundColor === getComputedStyle(color).backgroundColor && getComputedStyle(preview).backgroundColor !== normalBackground);
    color.remove();
    check('Previewを押すと編集へ戻ると伝える', preview.getAttribute('aria-label') === 'Previewをやめて編集する' && preview.title === 'Previewをやめて編集する' && editor.state.readOnly);
    preview.click(); await tick(); await pause(100);
    check('Previewをやめるとボタンの押された表示と読み取り専用を解除', preview.getAttribute('aria-pressed') === 'false' && getComputedStyle(preview).backgroundColor === normalBackground && !editor.state.readOnly);
    const sidebarToggle = document.querySelector('[aria-controls="file-sidebar"]');
    const beforeSidebar = sidebarToggle.getBoundingClientRect();
    const logo = [...document.querySelectorAll('.brand-wordmark')].find(node => node.offsetWidth)?.getBoundingClientRect();
    const search = document.querySelector('.quick-button').getBoundingClientRect();
    check('折りたたみボタンはロゴの右で信号ボタンと重ならない', sidebarToggle.parentElement.classList.contains('brand') && beforeSidebar.left >= logo.right && beforeSidebar.left > 80 && beforeSidebar.right <= search.left);
    check('ライトとダークの切り替えは右側に残す', !!document.querySelector('.global-actions button[title*="モードに切り替える"]') && !document.querySelector('.global-actions [aria-controls="file-sidebar"]'));
    sidebarToggle.click(); await tick(); await pause(100);
    const hiddenSidebar = sidebarToggle.getBoundingClientRect();
    check('左の欄を隠しても折りたたみボタンの位置を保つ', document.querySelector('#file-sidebar').hidden && sidebarToggle.getAttribute('aria-expanded') === 'false' && hiddenSidebar.left === beforeSidebar.left && hiddenSidebar.top === beforeSidebar.top);
    sidebarToggle.click(); await tick(); await pause(100);
    check('同じボタンで左の欄を再表示', !document.querySelector('#file-sidebar').hidden && sidebarToggle.getAttribute('aria-expanded') === 'true');
    await window.show();
    check('Gitを開いても本文のエディタを保持する', document.querySelector('.cm-editor') === initialEditor);
    check('ブランチと先に進んだ数を出す', panel().textContent.includes('main') && panel().textContent.includes('2つ先'));
    check('ステージと変更の一覧を出す', panel().querySelectorAll('.git-file').length === 5);
    check('場所の文字をファイル名の1px下にする', parseFloat(getComputedStyle(panel().querySelector('.git-directory')).fontSize) === parseFloat(getComputedStyle(panel().querySelector('.git-file-open strong')).fontSize) - 1);
    check('長い場所を途中で省く', panel().querySelector('.git-directory').textContent.includes('…'));
    check('削除したファイルは開けない', row(paths[4]).querySelector('.git-file-open').disabled);
    check('空のメッセージではコミットできない', button('コミット').disabled);
    await editMessage('途中のメッセージ');
    document.querySelector('.outline-toggle').click(); await tick();
    await window.show();
    check('右の欄を切り替えてもメッセージを残す', panel().querySelector('textarea').value === '途中のメッセージ');
    row(paths[2]).querySelector('.git-stage').click(); await actionDone();
    check('ファイルをステージする', !!row(paths[2], true));
    row(paths[2], true).querySelector('.git-stage').click(); await actionDone();
    check('ファイルをステージから外す', !!row(paths[2]));
    button('全部入れる').click(); await actionDone();
    check('全部入れる', panel().querySelectorAll('.git-section').length === 1 && panel().querySelectorAll('.git-file').length === 5);
    button('全部外す').click(); await actionDone();
    check('全部外す', ![...panel().querySelectorAll('h3')].some(title => title.textContent.startsWith('ステージ')));
    await editMessage('記事更新'); check('ステージしたファイルがない時はコミットできない', button('コミット').disabled);
    row(paths[0]).querySelector('.git-stage').click(); await actionDone();
    const before = editor.state.doc.length;
    editor.dispatch({ changes: { from: before, insert: '\n保存する変更' } }); await tick();
    button('コミット').click(); await actionDone();
    const committed = calls.findIndex(call => call.args.action?.kind === 'commit');
    check('未保存の本文を保存してからコミットする', committed > 0 && calls.slice(0, committed).some(call => call.command === 'document_save' && call.args.text.includes('保存する変更')));
    check('コミットにメッセージとフォルダを渡す', calls[committed]?.args.action.message === '記事更新' && calls[committed]?.args.project === root);
    check('コミット後は入力を空にする', panel().querySelector('textarea').value === '');
    state = sample(); await focusRefresh();
    button('取り消す').click(); await until(() => document.querySelector('.git-undo-dialog[open]'));
    let dialog = document.querySelector('.git-undo-dialog');
    check('push前は消すこととステージを残すことを確認する', dialog.textContent.includes('記事追加') && dialog.textContent.includes('コミットを消し') && dialog.textContent.includes('ステージした状態'));
    const count = calls.length; button('キャンセル', dialog).click(); await tick();
    check('取り消しのキャンセルではGitを呼ばない', calls.length === count);
    button('取り消す').click(); await until(() => document.querySelector('.git-undo-dialog[open]'));
    // 前に閉じた時のイベントが、開き直した後に届く場合を再現する。
    document.querySelector('.git-undo-dialog').dispatchEvent(new Event('close'));
    await tick();
    check('開き直した後にcloseが届いても確認中のコミットを保つ', document.querySelector('.git-undo-dialog').textContent.includes('記事追加'));
    button('取り消す', document.querySelector('.git-undo-dialog')).click(); await actionDone();
    check('確かめたコミットと方法を渡す', calls.at(-1).args.action.oid === 'head-2' && calls.at(-1).args.action.mode === 'reset');
    state.lastCommit.undo = 'revert'; state.changes = []; await focusRefresh();
    button('取り消す').click(); await until(() => document.querySelector('.git-undo-dialog[open]'));
    dialog = document.querySelector('.git-undo-dialog');
    check('push済みは打ち消すコミットを作ることを確認する', dialog.textContent.includes('push済み') && dialog.textContent.includes('打ち消すコミットを作ります'));
    button('キャンセル', dialog).click(); await tick();
    check('変更がなければ1行を出す', panel().textContent.includes('変更はありません'));
    state.lastCommit.undo = null; state.lastCommit.reason = '最初のコミットは取り消せません。'; await focusRefresh();
    check('取り消せない時はボタンを押せない', button('取り消す').disabled);
    state = sample(); await focusRefresh();
    pushError = 'GIT_PULL_REQUIRED'; button('push').click(); await actionDone();
    check('pushが断られた時はpullだけを聞く', !!button('pullする') && !!button('pullしない') && panel().textContent.includes('GitHubに新しい変更があります'));
    button('pullしない').click(); await tick();
    check('pullしない時は閉じる', !button('pullする') && !calls.some(call => call.args.action?.kind === 'pull'));
    button('push').click(); await actionDone();
    const pushCount = calls.filter(call => call.args.action?.kind === 'push').length;
    button('pullする').click(); await actionDone();
    check('pullの後にpushしない', calls.filter(call => call.args.action?.kind === 'push').length === pushCount && calls.some(call => call.args.action?.kind === 'pull'));
    await until(() => editor.state.doc.toString().includes('取り込んだ記事'));
    check('pullで変わった本文を読み直す', editor.state.doc.toString().includes('取り込んだ記事'));
    pushError = 'GIT_AUTH'; button('push').click(); await actionDone();
    check('認証エラーを短く出す', panel().querySelector('.git-error')?.textContent.includes('ログイン') && !button('pullする'));
    panel().querySelector('[aria-label="Gitのエラーを閉じる"]').click(); await tick();
    check('エラーを閉じる', !panel().querySelector('.git-error'));
    state.upstream = null; await focusRefresh();
    check('追跡するリモートがない時はpushできない', button('push').disabled && panel().textContent.includes('リモートがありません'));
    state = sample(); pushError = ''; await focusRefresh();
    let release; hold = new Promise(resolve => release = resolve);
    button('push').click(); await until(() => panel().querySelector('.git-spinner'));
    check('実行中はボタンと入力を押せない', button('push').disabled && panel().querySelector('textarea').disabled && button('コミット').disabled);
    release(); hold = undefined; await actionDone();
    toggle().click(); await tick();
    check('開いているGitのボタンを押すと右の欄を閉じる', !panel() && !document.querySelector('.outline'));
    document.querySelector('.outline-toggle').click(); await tick();
    check('目次へ切り替える', !!document.querySelector('.outline') && !panel());
    available = false; await focusRefresh();
    check('Gitのフォルダでない時はボタンを出さない', !toggle());
    await focusRefresh(); check('Gitがない時もボタンを出さない', !toggle());
    available = true; state = sample(); await focusRefresh(); await window.show();
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.theme = theme;
      await tick();
      const mark = panel().querySelector('.git-mark');
      check(theme + 'で状態の印と欄に色がある', getComputedStyle(mark).color !== getComputedStyle(mark).backgroundColor && getComputedStyle(panel()).backgroundColor !== 'rgba(0, 0, 0, 0)');
    }
    document.documentElement.dataset.theme = settings.theme;
    row(paths[2]).querySelector('.git-file-open').click();
    await until(() => editorView()?.state.doc.toString().includes('日本語のファイル'));
    check('一覧から日本語のファイルを本文で開く', editorView().state.doc.toString().includes('日本語のファイル'));
    row(paths[0], true).querySelector('.git-file-open').click();
    await until(() => editorView()?.state.doc.toString().includes('取り込んだ記事'));
    return JSON.stringify({ pass: checks.every(check => check.pass) && !errors.length, checks, errors });
  } catch (error) { return JSON.stringify({ pass: false, checks, errors: [...errors, String(error)] }); }
};
window.ready = true;
