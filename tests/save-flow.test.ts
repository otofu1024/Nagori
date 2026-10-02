import test from 'node:test';
import assert from 'node:assert/strict';
import { EditSession, failure } from '../src/lib/session.ts';

// 書き込み関数を差し替えて保存の経路を再現する補助
function make(write: (path: string, text: string, baseline: string) => Promise<{ baseline: string }>, text = 'original') {
  const updates: string[] = [];
  const session = new EditSession({ path: 'a.md', text, baseline: 'loaded', readonly: false }, write, () => updates.push(session.status));
  return { session, updates };
}

test('failure() normalizes Tauri rejections: object, JSON string, plain string', () => {
  assert.deepEqual(failure({ code: 'PERMISSION', message: 'ro' }), { code: 'PERMISSION', message: 'ro' });
  assert.deepEqual(failure('{"code":"IO","message":"disk full"}'), { code: 'IO', message: 'disk full' });
  assert.deepEqual(failure('plain text'), { code: 'ERROR', message: 'plain text' });
  assert.deepEqual(failure({ message: 'no code' }), { code: 'ERROR', message: 'no code' });
});

test('each failure code maps to a status and keeps the body and the failed generation dirty', async () => {
  for (const [code, status] of [['PERMISSION', 'error'], ['IO', 'error'], ['CONFLICT', 'conflict'], ['MISSING', 'missing']] as const) {
    const { session } = make(async () => { throw { code, message: code }; });
    session.edit('edited');
    assert.equal(await session.flush(), false, code);
    assert.equal(session.status, status, code);
    assert.equal(session.text, 'edited', code);
    assert.equal(session.dirty, true, code);
    assert.equal(session.baseline, 'loaded', code);
  }
});

test('quit path (flush) stays stopped while a failure is unresolved and never calls write again', async () => {
  let writes = 0;
  const { session } = make(async () => { writes++; throw { code: 'PERMISSION', message: 'ro' }; });
  session.edit('edited');
  assert.equal(await session.flush(), false);
  for (let i = 0; i < 3; i++) assert.equal(await session.flush(), false);
  assert.equal(writes, 1);
  assert.equal(session.text, 'edited');
});

test('edits typed after a failure are kept and saved together after an explicit retry', async () => {
  const writes: string[] = [];
  let fail = true;
  const { session } = make(async (_path, text) => {
    writes.push(text);
    if (fail) throw { code: 'IO', message: 'disk full' };
    return { baseline: 'saved' };
  });
  session.edit('first');
  assert.equal(await session.flush(), false);
  session.edit('second');
  assert.equal(await session.flush(), false);
  assert.equal(writes.length, 1);
  fail = false;
  session.retry();
  assert.equal(session.status, 'dirty');
  assert.equal(await session.flush(), true);
  assert.deepEqual(writes, ['first', 'second']);
  assert.equal(session.status, 'saved');
  assert.equal(session.baseline, 'saved');
});

test('a failure on the second generation keeps the first acknowledged and the latest body dirty', async () => {
  let call = 0;
  const releases: Array<() => void> = [];
  const { session } = make(async (_path, text) => {
    call++;
    if (call === 2) throw { code: 'IO', message: 'disk full' };
    await new Promise<void>(resolve => releases.push(resolve));
    return { baseline: 'after-' + text };
  });
  session.edit('one');
  const saving = session.flush();
  await Promise.resolve();
  session.edit('two');
  releases.shift()!();
  assert.equal(await saving, false);
  assert.equal(session.savedGeneration, 1);
  assert.equal(session.generation, 2);
  assert.equal(session.baseline, 'after-one');
  assert.equal(session.text, 'two');
  assert.equal(session.status, 'error');
});

test('a write rejected as a JSON string is classified through failure()', async () => {
  const { session } = make(async () => { throw '{"code":"CONFLICT","message":"changed"}'; });
  session.edit('edited');
  assert.equal(await session.flush(), false);
  assert.equal(session.status, 'conflict');
  assert.equal(session.issue?.message, 'changed');
});

test('readonly sessions ignore edits and never write', async () => {
  let writes = 0;
  const updates: number[] = [];
  const session = new EditSession({ path: 'a.md', text: 'ro', baseline: 'b', readonly: true }, async () => { writes++; return { baseline: 'x' }; }, () => updates.push(1));
  session.edit('changed');
  assert.equal(session.text, 'ro');
  assert.equal(session.dirty, false);
  assert.equal(await session.flush(), true);
  assert.equal(writes, 0);
  assert.equal(updates.length, 0);
});

test('external update with no unsaved edits reloads and the next save uses the new baseline', async () => {
  const baselines: string[] = [];
  const { session } = make(async (_path, _text, baseline) => { baselines.push(baseline); return { baseline: 'mine' }; });
  session.reload({ path: 'a.md', text: 'external', baseline: 'ext1', readonly: false });
  assert.equal(session.text, 'external');
  assert.equal(session.dirty, false);
  assert.equal(session.status, 'saved');
  assert.equal(await session.flush(), true);
  assert.deepEqual(baselines, []);
  session.edit('external plus edit');
  assert.equal(await session.flush(), true);
  assert.deepEqual(baselines, ['ext1']);
});

test('external reload clears a conflict and an old failed body, while IME flag and save state stay consistent', async () => {
  const { session } = make(async () => { throw { code: 'CONFLICT', message: 'changed' }; });
  session.edit('mine');
  await session.flush();
  assert.equal(session.status, 'conflict');
  session.composing = true;
  session.reload({ path: 'a.md', text: 'disk', baseline: 'ext', readonly: false });
  assert.equal(session.issue, null);
  assert.equal(session.dirty, false);
  assert.equal(session.composing, true);
  // 変換中は確定まで書き込まない。確定後の編集は新しい基準で保存対象になる
  session.edit('disk 確定');
  assert.equal(await session.flush(), false);
  session.composing = false;
  assert.equal(session.status, 'dirty');
});

test('block() from an external check stops saving, keeps the body, and retry with a confirmed baseline resumes', async () => {
  const seen: string[] = [];
  const { session } = make(async (_path, text, baseline) => { seen.push(text + '@' + baseline); return { baseline: 'new' }; });
  session.edit('mine');
  session.block({ code: 'CONFLICT', message: 'ディスク側に変更があります。' });
  assert.equal(session.status, 'conflict');
  assert.equal(await session.flush(), false);
  assert.deepEqual(seen, []);
  session.baseline = 'disk-latest';
  session.retry();
  assert.equal(await session.flush(), true);
  assert.deepEqual(seen, ['mine@disk-latest']);
});

test('missing file keeps the body; saving to a rescue path acknowledges only the rescued generation', async () => {
  let writes = 0;
  const { session } = make(async () => { writes++; throw { code: 'MISSING', message: 'gone' }; });
  session.edit('v1');
  assert.equal(await session.flush(), false);
  assert.equal(session.status, 'missing');
  // 別名保存の実行中に追加された編集は、救済済みの世代に含めない(App.svelteのcommitSaveAsと同じ更新手順)
  const rescued = session.generation;
  session.edit('v2');
  session.path = 'rescued.md';
  session.baseline = 'rescued-baseline';
  session.savedGeneration = rescued;
  session.issue = null;
  assert.equal(session.dirty, true);
  assert.equal(session.text, 'v2');
  assert.equal(writes, 1);
});

test('quit during an in-flight save waits for it and a failure blocks the exit', async () => {
  let reject: (error: unknown) => void = () => {};
  const { session } = make(() => new Promise((_resolve, rej) => { reject = rej; }));
  session.edit('edited');
  const autosave = session.flush();
  const quit = session.flush();
  reject({ code: 'IO', message: 'disk full' });
  assert.equal(await autosave, false);
  assert.equal(await quit, false);
  assert.equal(session.text, 'edited');
  assert.equal(session.isSaving, false);
});

test('quit during an in-flight save proceeds only after the final generation is saved', async () => {
  const writes: string[] = [];
  const releases: Array<() => void> = [];
  const { session } = make(async (_path, text) => { writes.push(text); await new Promise<void>(r => releases.push(r)); return { baseline: 'b' + writes.length }; });
  session.edit('a');
  const autosave = session.flush();
  await Promise.resolve();
  session.edit('b');
  const quit = session.flush();
  releases.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()!();
  assert.equal(await autosave, true);
  assert.equal(await quit, true);
  assert.deepEqual(writes, ['a', 'b']);
  assert.equal(session.dirty, false);
});
