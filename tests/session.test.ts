import test from 'node:test';
import assert from 'node:assert/strict';
import { EditSession } from '../src/lib/session.ts';
import { candidates, localLink, renamedPath } from '../src/lib/navigation.ts';
test('save serializes generations and never acknowledges edits made during a write',async()=>{
 const releases:Array<()=>void>=[],writes:string[]=[];
 const session=new EditSession({path:'a.md',text:'a',baseline:'0',readonly:false},async(_path,text,baseline)=>{writes.push(text+baseline);await new Promise<void>(resolve=>releases.push(resolve));return {baseline:String(writes.length)};},()=>{});
 session.edit('b');const first=session.flush();await Promise.resolve();session.edit('c');const second=session.flush();assert.equal(session.dirty,true);releases.shift()!();await new Promise(resolve=>setImmediate(resolve));assert.equal(session.dirty,true);releases.shift()!();assert.equal(await first,true);assert.equal(await second,true);assert.deepEqual(writes,['b0','c1']);assert.equal(session.status,'saved');
});
test('conflict or missing blocks automatic recreation; IME suspends save',async()=>{let count=0;const s=new EditSession({path:'a.md',text:'a',baseline:'0',readonly:false},async()=>{count++;throw {code:'MISSING',message:'gone'}},()=>{});s.edit('b');s.composing=true;assert.equal(await s.flush(),false);assert.equal(count,0);s.composing=false;assert.equal(await s.flush(),false);assert.equal(s.status,'missing');assert.equal(await s.flush(),false);assert.equal(count,1);assert.equal(s.text,'b');});
test('paths, fuzzy matching and recent list remain scoped',()=>{const entries=[{path:'posts/hello.md',name:'hello.md',kind:'markdown' as const},{path:'assets/photo.png',name:'photo.png',kind:'image' as const}];assert.equal(candidates(entries,'p/hm',[])[0].path,'posts/hello.md');assert.equal(candidates(entries,'',['assets/photo.png'])[0].kind,'image');assert.equal(renamedPath('post/a.md','post','blog'),'blog/a.md');assert.equal(localLink('posts/a.md','../b.md'),'b.md');assert.throws(()=>localLink('a.md','../escape.md'));assert.throws(()=>localLink('a.md','javascript:alert(1)'));});
test('conflict retry uses explicitly refreshed baseline and keeps failed generation dirty',async()=>{const baselines:string[]=[];let fail=true;const s=new EditSession({path:'a.md',text:'old',baseline:'loaded',readonly:false},async(_path,_text,baseline)=>{baselines.push(baseline);if(fail)throw {code:'CONFLICT',message:'changed'};return {baseline:'saved'};},()=>{});s.edit('edited');assert.equal(await s.flush(),false);assert.equal(s.dirty,true);assert.equal(s.text,'edited');assert.equal(await s.flush(),false);assert.equal(baselines.length,1);s.baseline='latest-confirmed';s.retry();fail=false;assert.equal(await s.flush(),true);assert.deepEqual(baselines,['loaded','latest-confirmed']);assert.equal(s.status,'saved');});

test('IME starting during a write leaves the composing generation unsaved until confirmation', async () => {
  const releases: Array<() => void> = [], writes: string[] = [];
  const session = new EditSession({path:'a.md',text:'old',baseline:'loaded',readonly:false}, async (_path, text) => {
    writes.push(text);
    await new Promise<void>(resolve => releases.push(resolve));
    return {baseline:String(writes.length)};
  }, () => {});
  session.edit('before composition');
  const saving = session.flush();
  session.composing = true;
  session.edit('変換中');
  releases.shift()!();
  assert.equal(await saving, false);
  assert.equal(session.isSaving, false);
  assert.equal(session.dirty, true);
  assert.equal(await session.flush(), false);
  assert.deepEqual(writes, ['before composition']);
  session.edit('確定した日本語');
  session.composing = false;
  const confirmed = session.flush();
  releases.shift()!();
  assert.equal(await confirmed, true);
  assert.deepEqual(writes, ['before composition', '確定した日本語']);
  assert.equal(session.status, 'saved');
});


test('failed shared flush blocks switching callers and retains the latest edits until an explicit retry', async () => {
  const writes: Array<{text:string;baseline:string}> = [];
  let rejectWrite: (error:unknown)=>void = () => {}, fail = true;
  const session = new EditSession({path:'a.md',text:'original',baseline:'loaded',readonly:false}, async (_path,text,baseline) => {
    writes.push({text,baseline});
    if (fail) await new Promise((_resolve,reject) => {rejectWrite=reject;});
    return {baseline:'saved'};
  }, () => {});
  session.edit('first edit');
  const autosave=session.flush(), switching=session.flush();
  session.edit('latest edit');
  rejectWrite({code:'IO',message:'disk is full'});
  assert.equal(await autosave,false);
  assert.equal(await switching,false);
  assert.equal(session.text,'latest edit');
  assert.equal(session.dirty,true);
  assert.equal(await session.flush(),false);
  assert.equal(writes.length,1);
  fail=false;session.retry();
  assert.equal(await session.flush(),true);
  assert.deepEqual(writes,[{text:'first edit',baseline:'loaded'},{text:'latest edit',baseline:'loaded'}]);
});
