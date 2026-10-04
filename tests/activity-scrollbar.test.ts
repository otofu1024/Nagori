import test from 'node:test';
import assert from 'node:assert/strict';
import { activityScrollbar } from '../src/lib/activityScrollbar.ts';

test('領域上の動きとスクロールで表示し、最後の動きから1秒で隠す', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set<string>();
  const node = Object.assign(new EventTarget(), {
    classList: {
      add: (...names: string[]) => names.forEach(name => classes.add(name)),
      remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
    },
  }) as unknown as HTMLElement;
  const action = activityScrollbar(node);
  assert.equal(classes.has('activity-scrollbar'), true);
  assert.equal(classes.has('scrollbar-active'), false);
  node.dispatchEvent(new Event('mouseenter'));
  assert.equal(classes.has('scrollbar-active'), false);
  node.dispatchEvent(new Event('mousemove'));
  assert.equal(classes.has('scrollbar-active'), true);
  t.mock.timers.tick(900);
  node.dispatchEvent(new Event('scroll'));
  t.mock.timers.tick(999);
  assert.equal(classes.has('scrollbar-active'), true);
  t.mock.timers.tick(1);
  assert.equal(classes.has('scrollbar-active'), false);
  node.dispatchEvent(new Event('scroll'));
  assert.equal(classes.has('scrollbar-active'), true);
  action.destroy();
  t.mock.timers.tick(1000);
  node.dispatchEvent(new Event('mousemove'));
  node.dispatchEvent(new Event('scroll'));
  assert.equal(classes.size, 0);
});
