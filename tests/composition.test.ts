import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionGate } from '../src/lib/composition.ts';

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
