import test from 'node:test';
import assert from 'node:assert/strict';
import { isWheelNotch, wheelTarget, wheelPosition } from '../../src/lib/editor/smoothWheel.ts';

test('WKWebViewの刻みだけを判別し、細かい入力と横方向とズームを除く', () => {
  const wheel = { deltaMode: 0, deltaY: 40, deltaX: 0, wheelDeltaY: -120, ctrlKey: false, shiftKey: false };
  assert.equal(isWheelNotch(wheel), true);
  assert.equal(isWheelNotch(wheel, 399), false);
  assert.equal(isWheelNotch(wheel, 400), true);
  assert.equal(isWheelNotch({ ...wheel, deltaY: -120, wheelDeltaY: 360 }), true);
  assert.equal(isWheelNotch({ ...wheel, deltaMode: 1, deltaY: 3, wheelDeltaY: undefined }), true);
  for (const other of [{ deltaY: 8, wheelDeltaY: -24 }, { deltaY: 39.9 }, { wheelDeltaY: undefined },
    { deltaMode: 2 }, { deltaMode: 1, deltaY: 0.5 }, { deltaY: 0 }, { deltaY: NaN }, { deltaY: Infinity },
    { ctrlKey: true }, { shiftKey: true }, { deltaX: 1 }, { wheelDeltaY: 120 }]) {
    assert.equal(isWheelNotch({ ...wheel, ...other }), false, JSON.stringify(other));
  }
});

test('刻みを目標位置へ加算し、上下の端で止める', () => {
  assert.equal(wheelTarget(wheelTarget(100, 40, 500), 120, 500), 260);
  assert.equal(wheelTarget(100, -200, 500), 0);
  assert.equal(wheelTarget(490, 40, 500), 500);
  assert.equal(wheelTarget(500, -40, 500), 460);
  assert.equal(wheelTarget(0, 40, -10), 0);
});

test('ease-outは上下とも目標へ近づき、開始前と終了後も範囲を超えない', () => {
  assert.equal(wheelPosition(100, 140, -1), 100);
  assert.equal(wheelPosition(100, 140, 0), 100);
  assert.equal(wheelPosition(100, 140, 0.5), 135);
  assert.equal(wheelPosition(140, 100, 0.5), 105);
  assert.equal(wheelPosition(100, 140, 1), 140);
  assert.equal(wheelPosition(100, 140, 2), 140);
});
