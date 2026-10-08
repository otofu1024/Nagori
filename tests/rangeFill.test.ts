import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeFill, THUMB_SIZE } from '../src/lib/rangeFill.ts';

test('色の端は、最小と最大でつまみの中心の位置に止まる', () => {
  const range = { min: 300, max: 5000 };
  assert.equal(THUMB_SIZE, 18);
  assert.equal(rangeFill(300, range), 'calc(9px + (100% - 18px) * 0)');
  assert.equal(rangeFill(5000, range), 'calc(9px + (100% - 18px) * 1)');
});

test('自動保存の0.8秒は、範囲の割合でつまみの中心に止まる', () => {
  assert.equal(rangeFill(800, { min: 300, max: 5000 }), `calc(9px + (100% - 18px) * ${500 / 4700})`);
});

test('つまみの直径を渡すと、その直径の半分を基準にする', () => {
  assert.equal(rangeFill(10, { min: 0, max: 10 }, 20), 'calc(10px + (100% - 20px) * 1)');
});
