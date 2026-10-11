import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { editorKeymap } from '../../src/lib/editor/keymap.ts';

test('キーの優先順位と、IME中・plainの保存と装飾の扱いを保つ', () => {
  let saved = 0;
  const applied: string[] = [];
  const deps = {
    plain: false,
    previewOnly: false,
    composition: false,
    linkDialog: false,
    view: undefined,
    onSave: () => {
      saved++;
    },
    apply: (kind: string) => {
      applied.push(kind);
    },
  };
  const bindings = EditorState.create({ extensions: editorKeymap(deps) })
    .facet(keymap)
    .flat();
  assert.deepEqual(
    bindings.slice(0, 9).map((binding) => binding.key),
    ['Tab', 'Shift-Tab', 'Enter', 'Mod-s', 'Mod-b', 'Mod-i', 'Mod-k', 'Mod-f', 'Escape'],
  );
  const run = (key: string) => bindings.find((binding) => binding.key === key)!.run!({} as EditorView);
  assert.equal(run('Mod-s'), true);
  assert.equal(saved, 1);
  deps.composition = true;
  assert.equal(run('Mod-s'), true);
  assert.equal(saved, 1);
  for (const key of ['Tab', 'Shift-Tab', 'Enter']) assert.equal(run(key), false);
  deps.composition = false;
  assert.equal(run('Mod-b'), true);
  assert.deepEqual(applied, ['bold']);
  deps.plain = true;
  assert.equal(run('Mod-b'), false);
  assert.deepEqual(applied, ['bold']);
});
