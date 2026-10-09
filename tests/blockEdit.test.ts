import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo, isolateHistory } from '@codemirror/commands';
import { blockEdit, blockAvailability, type BlockKind } from '../src/lib/blockEdit.ts';
import { markdownParser, walk } from '../src/lib/markdown.ts';

// 右クリック位置に記号を入れた結果と、入れた後のカーソルが指す文字を返す
function apply(text: string, kind: BlockKind, position: number) {
  const plan = blockEdit(text, position, kind);
  assert.ok(plan);
  let result = text;
  for (const change of [...plan.changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  return { text: result, selected: result.slice(plan.selection.from, plan.selection.to) };
}

const table = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';

test('見出しは行頭・空行ではそのまま記号を入れ、行の途中では改行してから入れる', () => {
  for (const level of [1, 2, 3] as const) assert.equal(apply('本文', `heading${level}`, 0).text, '#'.repeat(level) + ' 本文');
  assert.equal(apply('', 'heading1', 0).text, '# ');
  assert.equal(apply('前\n後', 'heading3', 2).text, '前\n### 後');
  assert.equal(apply('前後', 'heading2', 1).text, '前\n## 後');
  assert.equal(apply('前', 'heading1', 1).text, '前\n# ');
  assert.equal(apply('前後\r\n次', 'heading1', 1).text, '前\r\n# 後\r\n次');
});

test('記号の直後にカーソルを置く', () => {
  assert.equal(apply('前後', 'heading1', 1).selected, '');
  assert.equal(apply('本文', 'task', 0).selected, '');
  const plan = blockEdit('本文', 0, 'heading2')!;
  assert.deepEqual(plan.selection, { from: 3, to: 3 });
});

test('選択範囲の文字は書き換えず、右クリック位置に挿入する', () => {
  assert.equal(apply('前選択後', 'quote', 1).text, '前\n> 選択後');
  assert.equal(apply('前選択後', 'bullet', 3).text, '前選択\n- 後');
});

test('リスト・引用は行頭・空行・行の途中・行末の各位置に入れる', () => {
  assert.equal(apply('前\n後', 'bullet', 2).text, '前\n- 後');
  assert.equal(apply('前後', 'ordered', 1).text, '前\n1. 後');
  assert.equal(apply('前', 'task', 1).text, '前\n- [ ] ');
  assert.equal(apply('前後', 'quote', 1).text, '前\n> 後');
  assert.equal(apply('  後', 'bullet', 2).text, '  - 後');
  assert.equal(apply('前\n\n後', 'ordered', 2).text, '前\n1. \n後');
  assert.equal(apply('前\n\n後', 'ordered', 3).text, '前\n\n1. 後');
  assert.equal(apply('前\r\n後', 'task', 3).text, '前\r\n- [ ] 後');
});

test('リスト・引用・表の行では見出しを使えない', () => {
  for (const text of ['- 項目', '1. 項目', '- [ ] 項目', '> 引用', table, '- 項目\n  継続']) {
    assert.equal(blockAvailability(text, 0).heading, false, text);
    assert.equal(blockEdit(text, 0, 'heading1'), null, text);
  }
  assert.equal(blockAvailability('- 項目', 3).heading, false);
  assert.equal(blockEdit('- 項目', 3, 'heading1'), null);
  assert.ok(blockEdit('- 項目', 3, 'quote'));
});

test('コード・Front Matter・数式の中では記号を入れない', () => {
  for (const text of ['```md\n本文\n```', '~~~\n本文\n~~~', '    コード', '$$\nx^2\n$$', '\\[\nx\n\\]', '$$\n未閉鎖', '```\n未閉鎖', '$$x$$']) {
    for (let position = 0; position <= text.length; position++) {
      assert.equal(blockAvailability(text, position).block, false, `${text}@${position}`);
      for (const kind of ['heading1', 'bullet', 'ordered', 'task', 'quote', 'table', 'rule'] as BlockKind[]) assert.equal(blockEdit(text, position, kind), null);
    }
  }
  const frontMatter = '---\ntitle: 題\n---\n本文';
  for (let position = 0; position <= '---\ntitle: 題\n---'.length; position++) assert.equal(blockAvailability(frontMatter, position).block, false);
  assert.equal(blockAvailability(frontMatter, frontMatter.length).heading, true);
  assert.equal(blockAvailability('```\nx\n```\n\n本文', 11).block, true);
});

test('表は行の途中なら前の文字と空行で分け、行頭・空行では前後に空行を入れる', () => {
  assert.equal(apply('前\n後', 'table', 0).text, `${table}\n\n前\n後`);
  assert.equal(apply('前\n後', 'table', 1).text, `前\n\n${table}\n\n後`);
  assert.equal(apply('前', 'table', 1).text, `前\n\n${table}`);
  assert.equal(apply('前\n\n後', 'table', 2).text, `前\n\n${table}\n\n後`);
  assert.equal(apply('', 'table', 0).text, table);
  assert.equal(apply('前\r\n後', 'table', 1).text, `前\r\n\r\n${table.replaceAll('\n', '\r\n')}\r\n\r\n後`);
});

test('表を入れた後のカーソルは列1を選ぶ', () => {
  const result = apply('前\n後', 'table', 1);
  assert.equal(result.selected, '列1');
});

test('区切り線は表と同じ位置ルールで入れ、Setext見出しに変わらない', () => {
  for (const [text, position, expected] of [['前\n後', 1, '前\n\n---\n\n後'], ['前', 1, '前\n\n---'], ['前\n\n後', 2, '前\n\n---\n\n後'], ['前\n後', 2, '前\n\n---\n\n後']] as const) {
    const result = apply(text, 'rule', position).text;
    assert.equal(result, expected);
    const names: string[] = [];
    walk(markdownParser.parse(result).topNode, node => { names.push(node.name); });
    assert.ok(names.includes('HorizontalRule'));
    assert.ok(!names.some(name => name.startsWith('SetextHeading')));
  }
});

test('各記号は直前の入力と分離し、1回のUndoで戻る', () => {
  for (const kind of ['heading1', 'heading2', 'heading3', 'bullet', 'ordered', 'task', 'quote', 'table', 'rule'] as BlockKind[]) {
    let state = EditorState.create({ doc: '# 元\n二行', extensions: history() });
    state = state.update({ changes: { from: state.doc.length, insert: '追記' }, userEvent: 'input.type' }).state;
    const before = state.doc.toString(), plan = blockEdit(before, before.length, kind)!;
    const tr = state.update({ changes: plan.changes, selection: { anchor: plan.selection.from, head: plan.selection.to }, userEvent: 'input.format', annotations: isolateHistory.of('full') });
    assert.equal(tr.isUserEvent('input.format'), true);
    state = tr.state;
    assert.ok(undo({ state, dispatch: transaction => { state = transaction.state; } }));
    assert.equal(state.doc.toString(), before);
    assert.ok(undo({ state, dispatch: transaction => { state = transaction.state; } }));
    assert.equal(state.doc.toString(), '# 元\n二行');
  }
});
