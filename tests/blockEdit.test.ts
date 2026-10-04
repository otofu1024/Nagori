import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo, isolateHistory } from '@codemirror/commands';
import { blockEdit, blockAvailability, type BlockKind } from '../src/lib/blockEdit.ts';
import { markdownParser, walk } from '../src/lib/markdown.ts';

function apply(text: string, kind: BlockKind, from = 0, to = text.length, head = to) {
  const plan = blockEdit(text, { from, to, head }, kind);
  assert.ok(plan);
  let result = text;
  for (const change of [...plan.changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  return { text: result, selected: plan.selection ? result.slice(plan.selection.from, plan.selection.to) : '' };
}

test('見出しの付与・置換・解除は触れた行だけに適用する', () => {
  assert.equal(apply('前\n  ## 古い\n新しい\n後  \n', 'heading3', 4, 13).text, '前\n  ### 古い\n### 新しい\n後  \n');
  for (const level of [1, 2, 3] as const) assert.equal(apply('本文', `heading${level}`).text, '#'.repeat(level) + ' 本文');
  assert.equal(apply(' # 題\n##\n### 二つ', 'paragraph').text, ' 題\n\n二つ');
  assert.equal(apply('一行\n二行\n三行', 'heading1', 0, 3).text, '# 一行\n二行\n三行');
  assert.equal(apply('', 'heading1').text, '# ');
  assert.equal(apply('## 題 ##  ', 'paragraph').text, '題');
  assert.equal(apply('本文 #', 'paragraph').text, '本文 #');
});

test('見出しはリスト・引用・表と継続行で無効になる', () => {
  for (const text of ['- 項目', '1. 項目', '- [ ] 項目', '> 引用', '| a | b |\n| --- | --- |\n| c | d |', '- 項目\n  継続']) {
    assert.equal(blockAvailability(text, { from: 0, to: text.length }).heading, false);
    assert.equal(blockEdit(text, { from: 0, to: text.length }, 'heading1'), null);
    assert.equal(blockEdit(text, { from: 0, to: text.length }, 'paragraph'), null);
  }
});

test('コード・Front Matter・数式ではカーソルと複数行選択の段落操作を止める', () => {
  for (const text of ['```md\n本文\n```', '~~~\n本文\n~~~', '    コード', '---\ntitle: 題\n---', '$$\nx^2\n$$', '\\[\nx\n\\]', '$$\n未閉鎖', '```\n未閉鎖', '$$x$$']) {
    for (const selection of [{ from: 0, to: text.length }, { from: Math.floor(text.length / 2), to: Math.floor(text.length / 2) }, { from: text.length, to: text.length }]) {
      assert.equal(blockAvailability(text, selection).block, false, text);
      for (const kind of ['heading1', 'paragraph', 'bullet', 'ordered', 'task', 'quote', 'table', 'rule'] as BlockKind[]) assert.equal(blockEdit(text, selection, kind), null);
    }
  }
  const text = '---\ntitle: 題\n---\n本文';
  assert.equal(blockAvailability(text, { from: text.length, to: text.length }).heading, true);
  assert.equal(blockAvailability('```\nx\n```\n\n本文', { from: 11, to: 13 }).block, true);
});

test('リストの種類を置換し、インデントと空行を残す', () => {
  const text = '  + 一\n\t2) 二\n \n- [x] 三\n四';
  assert.equal(apply(text, 'task').text, '  - [ ] 一\n\t- [ ] 二\n \n- [ ] 三\n- [ ] 四');
  assert.equal(apply(text, 'bullet').text, '  - 一\n\t- 二\n \n- 三\n- 四');
  assert.equal(apply(text, 'ordered').text, '  1. 一\n\t2. 二\n \n3. 三\n4. 四');
});

test('全行が同じ種類なら空行を飛ばして解除する', () => {
  for (const [kind, text] of [['bullet', '  + 一\n \n* 二'], ['ordered', '  8) 一\n \n20. 二'], ['task', '  - [x] 一\n \n+ [ ] 二'], ['quote', '  > 一\n \n> 二']] as const) {
    assert.equal(apply(text, kind).text, '  一\n \n二');
  }
  assert.equal(apply('-  [ ] 一\n二', 'bullet').text, '- 一\n- 二');
  assert.equal(apply('-  [ ] 一\n- [x] 二', 'bullet').text, '- 一\n- 二');
  assert.equal(apply('一\n\n> 二', 'quote').text, '> 一\n\n> 二');
  assert.equal(apply('- 一\n二', 'quote').text, '> - 一\n> 二');
  assert.equal(apply(' \n\t', 'task').text, ' \n\t');
});

test('選択外の空白・記法・CRLFを保持する', () => {
  const text = '**前**  \r\n項目\r\n`後`\t\r\n';
  assert.equal(apply(text, 'bullet', 10, 12).text, '**前**  \r\n- 項目\r\n`後`\t\r\n');
  assert.equal(apply('前\n一\n二\n後', 'ordered', 2, 5).text, '前\n1. 一\n2. 二\n後');
});

test('表は行の後ろに空行で分離して挿入し、列1を選択する', () => {
  const table = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';
  for (const [text, expected] of [['前\n後', `前\n\n${table}\n\n後`], ['前\n\n後', `前\n\n${table}\n\n後`], ['前', `前\n\n${table}\n\n`], ['', `\n${table}\n\n`]] as const) {
    const result = apply(text, 'table', 0, 0);
    assert.equal(result.text, expected);
    assert.equal(result.selected, '列1');
  }
  assert.equal(apply('前\r\n後', 'table', 0, 0).text, `前\r\n\r\n${table.replaceAll('\n', '\r\n')}\r\n\r\n後`);
  assert.equal(apply('前\n後', 'table', 0, 3, 0).text, `前\n\n${table}\n\n後`);
  assert.equal(apply('前\n\n後', 'table', 2, 2).text, `前\n\n${table}\n\n後`);
});

test('区切り線の直前は空行になり、Setext見出しに変わらない', () => {
  for (const [text, from, expected] of [['前\n後', 0, '前\n\n---\n\n後'], ['前', 0, '前\n\n---\n\n'], ['前\n\n後', 2, '前\n\n---\n\n後']] as const) {
    const result = apply(text, 'rule', from, from).text;
    assert.equal(result, expected);
    const names: string[] = [];
    walk(markdownParser.parse(result).topNode, node => { names.push(node.name); });
    assert.ok(names.includes('HorizontalRule'));
    assert.ok(!names.some(name => name.startsWith('SetextHeading')));
  }
});

test('各段落操作は直前の入力と分離し、1回のUndoで戻る', () => {
  for (const kind of ['heading1', 'heading2', 'heading3', 'paragraph', 'bullet', 'ordered', 'task', 'quote', 'table', 'rule'] as BlockKind[]) {
    let state = EditorState.create({ doc: '# 元\n二行', extensions: history() });
    state = state.update({ changes: { from: state.doc.length, insert: '追記' }, userEvent: 'input.type' }).state;
    const before = state.doc.toString(), plan = blockEdit(before, { from: 0, to: before.length }, kind)!;
    const tr = state.update({ changes: plan.changes, ...(plan.selection ? { selection: { anchor: plan.selection.from, head: plan.selection.to } } : {}), userEvent: 'input.format', annotations: isolateHistory.of('full') });
    assert.equal(tr.isUserEvent('input.format'), true);
    state = tr.state;
    assert.ok(undo({ state, dispatch: transaction => { state = transaction.state; } }));
    assert.equal(state.doc.toString(), before);
    assert.ok(undo({ state, dispatch: transaction => { state = transaction.state; } }));
    assert.equal(state.doc.toString(), '# 元\n二行');
  }
});
