import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionGate, createBlurFailsafe, inputEndsComposition, keyEndsComposition } from '../src/lib/composition.ts';

test('変換中のinputでは処理せず、確定のcompositionendで処理する', () => {
  let calls = 0;
  const gate = compositionGate(() => calls++);
  gate.start();
  // 変換の途中の入力
  gate.input(true);
  gate.input(true);
  assert.equal(calls, 0);
  // WebKitは確定の時の最後のinputにもisComposingを立て、そのあとにcompositionendを送る
  gate.input(true);
  assert.equal(calls, 0);
  gate.end();
  assert.equal(calls, 1);
});

test('変換を使わない入力は、入力のたびに処理する', () => {
  let calls = 0;
  const gate = compositionGate(() => calls++);
  gate.input(false);
  gate.input();
  assert.equal(calls, 2);
});

test('Chromeのように確定の時のinputがisComposingを立てなくても、変換中は処理せず、確定で1回だけ処理する', () => {
  const seen: string[] = [];
  let text = '';
  const gate = compositionGate(() => seen.push(text));
  gate.start();
  text = 'ひらがな';
  gate.input(false);
  assert.deepEqual(seen, []);
  gate.end();
  assert.deepEqual(seen, ['ひらがな']);
  // 確定のあとの入力は通常どおり処理する
  text = 'ひらがなです';
  gate.input(false);
  assert.deepEqual(seen, ['ひらがな', 'ひらがなです']);
});

test('reset の後は変換中の状態が残らず、入力のたびに処理する', () => {
  let calls = 0;
  const gate = compositionGate(() => calls++);
  gate.start();
  gate.reset();
  gate.input(false);
  assert.equal(calls, 1);
});

test('変換をキャンセルした時も処理し、そのあとの入力は通常どおり処理する', () => {
  let calls = 0;
  const gate = compositionGate(() => calls++);
  gate.start();
  gate.input(true);
  gate.end();
  gate.input(false);
  assert.equal(calls, 2);
});

test('変換中の入力（isComposingや変換用の入力種別）では、変換の終わりとみなさない', () => {
  // 変換の途中の入力と、確定の時の最後の入力（isComposingが立つ）
  assert.equal(inputEndsComposition('insertCompositionText', false), false);
  assert.equal(inputEndsComposition('deleteCompositionText', false), false);
  assert.equal(inputEndsComposition('insertFromComposition', false), false);
  assert.equal(inputEndsComposition('insertText', true), false);
});

test('変換を使わない入力が来たら、compositionend が届かなくても変換の終わりとみなす', () => {
  assert.equal(inputEndsComposition('insertText', false), true);
  assert.equal(inputEndsComposition('insertParagraph', false), true);
  assert.equal(inputEndsComposition('deleteContentBackward', false), true);
});

test('IMEが握っているキー（keyCode 229）や変換中のキーでは、変換の終わりとみなさない', () => {
  assert.equal(keyEndsComposition({ key: 'Process', keyCode: 229, isComposing: false }), false);
  assert.equal(keyEndsComposition({ key: 'Enter', keyCode: 229, isComposing: true }), false);
  assert.equal(keyEndsComposition({ key: 'a', keyCode: 65, isComposing: true }), false);
  // 修飾キーだけでは、変換が続いているかどうか分からない
  assert.equal(keyEndsComposition({ key: 'Shift', keyCode: 16, isComposing: false }), false);
  assert.equal(keyEndsComposition({ key: 'Meta', keyCode: 91, isComposing: false }), false);
});

test('変換が終わったあとのキー操作（Cmd+Sなど）では、変換の終わりとみなす', () => {
  assert.equal(keyEndsComposition({ key: 's', keyCode: 83, isComposing: false }), true);
  assert.equal(keyEndsComposition({ key: 'ArrowLeft', keyCode: 37, isComposing: false }), true);
});

test('正常な変換の流れでは、途中の入力で変換の終わりとみなさず、compositionend で1回だけ終わる', () => {
  // WebKitの変換の流れ: keydown（229）→ 変換中の入力 → 確定の最後の入力（isComposing）→ compositionend
  const events = [
    () => keyEndsComposition({ key: 'k', keyCode: 229, isComposing: false }),
    () => inputEndsComposition('insertCompositionText', false),
    () => keyEndsComposition({ key: 'a', keyCode: 229, isComposing: true }),
    () => inputEndsComposition('insertCompositionText', true),
    () => inputEndsComposition('insertText', true),
  ];
  for (const ends of events) assert.equal(ends(), false);
});

test('blur のあと compositionend が来れば、変換の終わりを待たず何もしない', async () => {
  let ended = 0;
  const failsafe = createBlurFailsafe(() => ended++, 20);
  // 変換中に blur し、WebKitが確定して compositionend を送る
  failsafe.blur(true);
  failsafe.cancel();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ended, 0);
});

test('blur のあと compositionend が来なければ、待ったあとに変換の終わりとみなす', async () => {
  let ended = 0;
  const failsafe = createBlurFailsafe(() => ended++, 20);
  failsafe.blur(true);
  assert.equal(ended, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ended, 1);
});

test('変換が終わったあとの blur では待たない', async () => {
  let ended = 0;
  const failsafe = createBlurFailsafe(() => ended++, 20);
  failsafe.blur(false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ended, 0);
});

test('blur の待ちの途中で新しく blur した時は、古い待ちを捨てて1回だけ終わりとみなす', async () => {
  let ended = 0;
  const failsafe = createBlurFailsafe(() => ended++, 20);
  failsafe.blur(true);
  failsafe.blur(true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ended, 1);
});
