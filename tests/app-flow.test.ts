import test from 'node:test';
import assert from 'node:assert/strict';
import { AppFlow, type AppFlowDeps } from '../src/lib/appFlow.ts';
import { EditSession, type OpenedDocument } from '../src/lib/session.ts';

// IPCとDOMを記録用の関数へ差し替えて、呼び出し順を確認する補助
function setup(write: (path: string, text: string, baseline: string) => Promise<{ baseline: string }> = async () => ({ baseline: 'saved' }), disk: OpenedDocument = { path: 'a.md', text: 'original', baseline: 'loaded', readonly: false }) {
  const log: string[] = [];
  const state = { busy: false, composing: false };
  const session = new EditSession({ path: 'a.md', text: 'original', baseline: 'loaded', readonly: false }, write, () => {});
  const realFlush = session.flush.bind(session);
  session.flush = async () => { log.push('flush'); return realFlush(); };
  const deps: AppFlowDeps = {
    getSession: () => session,
    isBusy: () => state.busy,
    setBusy: (value) => { state.busy = value; },
    isComposing: () => state.composing,
    cancelSave: () => log.push('cancelSave'),
    settleComposition: async () => { log.push('settle'); },
    showProblem: async () => { log.push('showProblem'); },
    openDocument: async () => { log.push('open'); session.composing = state.composing; return disk; },
    replaceText: (text) => log.push('replace:' + text),
    notify: (message) => log.push('notify:' + message),
    persist: async () => { log.push('persist'); },
    settingsQueue: () => Promise.resolve(),
    exitApp: async () => { log.push('exit'); },
    resumeTree: () => {},
    resumeOpenRequests: () => {},
    defer: (run) => run(),
  };
  return { flow: new AppFlow(deps), session, log, state, disk };
}

test('終了前のflushが共通経路を通り、保存後に設定保存と終了の順で進む', async () => {
  const { flow, session, log } = setup();
  session.edit('edited');
  await flow.quit();
  assert.deepEqual(log, ['settle', 'cancelSave', 'settle', 'flush', 'persist', 'exit']);
  assert.equal(session.dirty, false);
});

test('保存失敗中は終了が止まり、再書き込みも設定保存も行わない', async () => {
  let writes = 0;
  const { flow, session, log, state } = setup(async () => { writes++; throw { code: 'PERMISSION', message: 'ro' }; });
  session.edit('edited');
  await flow.quit();
  await flow.quit();
  assert.equal(log.includes('exit'), false);
  assert.equal(log.includes('persist'), false);
  assert.equal(log.filter((entry) => entry === 'showProblem').length, 2);
  assert.equal(writes, 1);
  assert.equal(session.text, 'edited');
  assert.equal(session.dirty, true);
  assert.equal(state.busy, false);
});

test('操作中の終了要求は二重に実行しない', async () => {
  const { flow, log, state } = setup();
  state.busy = true;
  await flow.quit();
  assert.equal(log.includes('exit'), false);
  assert.equal(log.includes('flush'), false);
});

test('IME変換中は外部更新の確認を保留し、変換後に再開する', async () => {
  const { flow, session, log, state } = setup(undefined, { path: 'a.md', text: 'disk', baseline: 'other', readonly: false });
  state.composing = true;
  await flow.checkExternal();
  assert.equal(log.includes('open'), false);
  assert.equal(flow.externalQueued, true);
  flow.resumeExternal();
  assert.equal(flow.externalQueued, true);
  state.composing = false;
  flow.resumeExternal();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ['open', 'replace:disk', 'notify:外部の変更を読み込みました。']);
  assert.equal(session.text, 'disk');
});

test('読み取り中に変換が始まった場合は結果を反映せず保留する', async () => {
  const { flow, session, log, state } = setup(undefined, { path: 'a.md', text: 'disk', baseline: 'other', readonly: false });
  const open = flow as unknown as { deps: AppFlowDeps };
  const original = open.deps.openDocument;
  open.deps.openDocument = async (path) => { const result = await original(path); state.composing = true; return result; };
  await flow.checkExternal();
  assert.equal(flow.externalQueued, true);
  assert.equal(log.some((entry) => entry.startsWith('replace')), false);
  assert.equal(session.text, 'original');
  assert.equal(session.issue, null);
});

test('未保存の編集がある状態で外部更新を検知したら、競合として本文を保持する', async () => {
  const { flow, session, log } = setup(undefined, { path: 'a.md', text: 'disk', baseline: 'other', readonly: false });
  session.edit('edited');
  await flow.checkExternal();
  assert.equal(session.issue?.code, 'CONFLICT');
  assert.equal(session.status, 'conflict');
  assert.equal(session.text, 'edited');
  assert.equal(session.dirty, true);
  assert.deepEqual(log, ['open', 'cancelSave', 'showProblem']);
  // 競合後は自動保存の経路も止まり、書き込みしない
  assert.equal(await session.flush(), false);
  assert.equal(session.baseline, 'loaded');
});

test('未保存がなければ外部更新を読み込み、基準が同じなら何もしない', async () => {
  const same = setup();
  await same.flow.checkExternal();
  assert.deepEqual(same.log, ['open']);
  const changed = setup(undefined, { path: 'a.md', text: 'disk', baseline: 'other', readonly: false });
  await changed.flow.checkExternal();
  assert.equal(changed.session.text, 'disk');
  assert.equal(changed.session.baseline, 'other');
  assert.equal(changed.session.dirty, false);
});
