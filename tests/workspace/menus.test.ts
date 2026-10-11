import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenus } from '../../src/lib/workspace/menus.ts';

test('右クリックの入れ子のactionを受信IDへ移し、次のメニューで古い処理を外す', async () => {
  const called: string[] = [];
  const deps = { blocked: true } as Parameters<typeof createMenus>[0];
  const menus = createMenus(deps);
  const items = menus.contextItems([
    {
      text: '親',
      items: [
        {
          id: 'first',
          text: '子',
          action: () => {
            called.push('first');
          },
        },
      ],
    },
    { item: 'Separator' },
    {
      id: 'second',
      text: '次',
      action: () => {
        called.push('second');
      },
    },
  ]) as any[];
  assert.equal(items[0].items[0].action, undefined);
  assert.equal(items[1].item, 'Separator');
  await menus.menuAction(items[0].items[0].id);
  await menus.menuAction(items[2].id);
  assert.deepEqual(called, ['first', 'second']);
  menus.contextItems([
    {
      id: 'new',
      text: '新',
      action: () => {
        called.push('new');
      },
    },
  ]);
  await menus.menuAction(items[0].items[0].id);
  assert.deepEqual(called, ['first', 'second']);
});
