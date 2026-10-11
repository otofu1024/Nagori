import test from 'node:test';
import { renderMath } from '../../src/lib/editor/mathjax.ts';
import { readMathStats, resetMathStats } from '../../src/lib/editor/mathStats.ts';
import { MAX_MATH_LENGTH, mathExpressions, type MathExpression } from '../../src/lib/editor/markdownMath.ts';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorView, type WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { frontMatter, markdownParser, markdownExtensions, walk, references, linkTarget, formatPlan, linkMarkdown, touches, codeDisplay } from '../../src/lib/editor/markdown.ts';
import { livePreview, previewOnlyMode, compositionMode, buildPreview } from '../../src/lib/editor/livePreview.ts';
import { ChangeSet } from '@codemirror/state';
import { reparse } from '../../src/lib/editor/markdown.ts';

// 適用した結果の本文を返す補助
function applied(text: string, from: number, to: number, kind: 'bold' | 'italic' | 'strike' | 'code') {
  const plan = formatPlan(text, { from, to }, kind);
  if (plan.reason) return { reason: plan.reason };
  return { text: text.slice(0, plan.from) + plan.text + text.slice(plan.to), selected: (text.slice(0, plan.from) + plan.text + text.slice(plan.to)).slice(plan.selection.from, plan.selection.to) };
}

test('装飾の付け外しとコードの空白を保ち、複数段落とタスクの本文にも付ける', () => {
  for (const kind of ['bold', 'italic', 'strike'] as const) {
    const text = 'before plain after'; const plan = formatPlan(text, { from: 7, to: 12 }, kind); assert.ok(!plan.reason);
    const wrapped = text.slice(0, plan.from) + plan.text + text.slice(plan.to);
    const removed = formatPlan(wrapped, plan.selection, kind); assert.ok(!removed.reason);
    assert.equal(wrapped.slice(0, removed.from) + removed.text + wrapped.slice(removed.to), text);
  }
  for (const plain of ['a`b', '`edge', ' spaced ']) {
    const plan = formatPlan(plain, { from: 0, to: plain.length }, 'code'); assert.ok(!plan.reason);
    const remove = formatPlan(plan.text, { from: 0, to: plan.text.length }, 'code'); assert.equal(remove.text, plain);
  }
  assert.equal(applied('one\n\ntwo', 0, 8, 'italic').text, '*one*\n\n*two*');
  assert.ok(formatPlan('---\nx: y\n---\n', { from: 4, to: 8 }, 'bold').reason);
  assert.equal(codeDisplay(' a\n b '), 'a  b');
  assert.ok(!formatPlan('- [ ] task', { from: 6, to: 10 }, 'bold').reason);
  assert.equal(applied('- [ ] task', 2, 10, 'bold').text, '- [ ] **task**');
});

test('safe link generation handles spaces/brackets and rejects dangerous schemes', () => {
  const value = linkMarkdown('a [label]', 'assets/a (1).md'); assert.match(markdownParser.parse(value).toString(), /Link/);
  assert.throws(() => linkMarkdown('x', 'javascript:alert(1)'));
  assert.throws(() => linkMarkdown('x', 'file:///etc/passwd'));
  assert.throws(() => linkMarkdown('x', 'foo\nbar'));
});


test('複数段落は本文ごとに囲み、ソフト改行と選択外の空白を保つ', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['strike', '~~']] as const) {
    const source = '前 一つ目の段落\n\n二つ目の段落 後';
    const result = applied(source, 2, source.length - 2, kind);
    assert.equal(result.text, `前 ${mark}一つ目の段落${mark}\n\n${mark}二つ目の段落${mark} 後`);
    assert.equal(result.selected, `一つ目の段落${mark}\n\n${mark}二つ目の段落`);
    assert.equal(applied(' one\n two \r\n\r\n three ', 0, 22, kind).text, ` ${mark}one\n two${mark} \r\n\r\n ${mark}three${mark} `);
  }
});


test('リスト・タスク・引用・見出しの記号を囲まず、本文だけに付ける', () => {
  for (const [source, expected] of [
    ['- 一\n- 二\n- 三', '- *一*\n- *二*\n- *三*'],
    ['1. 一\n2. 二', '1. *一*\n2. *二*'],
    ['- [ ] 一\n- [x] 二', '- [ ] *一*\n- [x] *二*'],
    ['# 見出し #\n\n段落\n\n小見出し\n====', '# *見出し* #\n\n*段落*\n\n*小見出し*\n===='],
    ['> 一\n> 二\n\n> 三', '> *一*\n> *二*\n\n> *三*'],
    ['- 一\n  続き\n- 二', '- *一\n  続き*\n- *二*'],
  ]) assert.equal(applied(source, 0, source.length, 'italic').text, expected);
  for (const [source, from, to] of [['# 見出し', 0, 1], ['見出し\n====', 4, 8], ['- [ ] 本文', 2, 5], ['> 本文', 0, 1]] as const) {
    assert.ok(formatPlan(source, { from, to }, 'bold').reason);
  }
  const quoted = '> **一\n> 二**\n\n**三**';
  assert.equal(applied(quoted, 0, quoted.length, 'bold').text, '> 一\n> 二\n\n三');
});


test('装飾できないブロックと区間だけを飛ばし、全区間で付けられない時は従来の理由を返す', () => {
  for (const blocked of ['```md\nコード\n```', '    コード', '$$\nx^2\n$$', '<div>HTML</div>', '| 列 |\n|---|\n| 値 |', '[参照]: /path']) {
    const source = `前\n\n${blocked}\n\n後`;
    assert.equal(applied(source, 0, source.length, 'bold').text, `**前**\n\n${blocked}\n\n**後**`);
    assert.ok(formatPlan(blocked, { from: 0, to: blocked.length }, 'bold').reason);
  }
  const front = '---\ntitle: 記事\n---\n\n本文';
  assert.equal(applied(front, 0, front.length, 'bold').text, '---\ntitle: 記事\n---\n\n**本文**');
  assert.equal(applied('*ab* c\n\n後', 2, 9, 'bold').text, '*ab* c\n\n**後**');
  assert.equal(formatPlan('*ab* c', { from: 2, to: 6 }, 'bold').reason, 'ほかの装飾の境界をまたぐ選択には適用できません');
  assert.equal(applied('前 $x$\n\n後', 0, 9, 'bold').text, '前 $x$\n\n**後**');
});


test('全区間が同じ装飾内ならすべて外し、混在時は付ける操作へそろえる', () => {
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['strike', '~~'], ['code', '`']] as const) {
    const source = `${mark}一${mark}\n\n${mark}二${mark}`;
    assert.equal(applied(source, 0, source.length, kind).text, '一\n\n二');
    const partial = applied(source, mark.length, source.length - mark.length, kind);
    assert.equal(partial.text, '一\n\n二');
    const mixed = `${mark}一${mark}\n\n二`;
    assert.equal(applied(mixed, 0, mixed.length, kind).text, source);
  }
  const source = 'a **b** c\n\nd **e** f';
  assert.equal(applied(source, 0, source.length, 'bold').text, '**a b c**\n\n**d e f**');
  const skipped = '**一**\n\n数式 $x$\n\n**二**';
  assert.equal(applied(skipped, 0, skipped.length, 'bold').text, '一\n\n数式 $x$\n\n二');
});


test('Inline Codeは行ごとに付け、装飾を含む行だけを飛ばす', () => {
  const source = '一\n二\n\n- 三\n- **太字**\n- a`b';
  assert.equal(applied(source, 0, source.length, 'code').text, '`一`\n`二`\n\n- `三`\n- **太字**\n- ``a`b``');
  assert.equal(formatPlan('**太字**\n*斜体*', { from: 0, to: 11 }, 'code').reason, '装飾を含む範囲はInline Codeにできません');
});


test('複数段落のリンクは無効で、表示用と適用時の判定は一致する', () => {
  assert.equal(formatPlan('一\n\n二', { from: 0, to: 4 }, 'link').reason, '単一段落内を選択してください');
  for (const source of ['一\n\n二', '# 見出し\n\n- [ ] 一\n- 二', '前\n\n```\nコード\n```\n\n後', '**一**\n\n**二**', '一\n二\n\n**太字**']) {
    const tree = markdownParser.parse(source);
    for (const kind of ['bold', 'italic', 'strike', 'code', 'link'] as const) {
      assert.deepEqual(formatPlan(source, { from: 0, to: source.length }, kind, tree), formatPlan(source, { from: 0, to: source.length }, kind));
    }
  }
});


test('同じ装飾にかかる範囲は、中の記号を外して全体に付け直す', () => {
  const sentence = "There's something about **Autumn** that makes time";
  const from = sentence.indexOf('something'), to = sentence.indexOf(' makes');
  assert.deepEqual(applied(sentence, from, to, 'bold'), { text: "There's **something about Autumn that** makes time", selected: 'something about Autumn that' });
  // 装飾の境界を途中でまたぐ選択は、かかった装飾まで範囲を広げる
  assert.deepEqual(applied('**bold** plain', 3, 14, 'bold'), { text: '**bold plain**', selected: 'bold plain' });
  assert.deepEqual(applied('x **ab** y', 5, 10, 'bold'), { text: 'x **ab y**', selected: 'ab y' });
  // 複数の同じ装飾もまとめる
  assert.deepEqual(applied('**a** and **b**', 0, 15, 'bold'), { text: '**a and b**', selected: 'a and b' });
  assert.deepEqual(applied('a ~~b~~ c', 0, 9, 'strike'), { text: '~~a b c~~', selected: 'a b c' });
  assert.deepEqual(applied('a `b` c', 0, 7, 'code'), { text: '`a b c`', selected: 'a b c' });
});


test('同じ装飾の中だけを選ぶと外し、ほかの種類の装飾は丸ごと入る時だけ残す', () => {
  assert.deepEqual(applied('**Autumn**', 3, 5, 'bold'), { text: 'Autumn', selected: 'Autumn' });
  assert.deepEqual(applied('a *b* c', 0, 7, 'bold'), { text: '**a *b* c**', selected: 'a *b* c' });
  assert.deepEqual(applied('*a b c*', 3, 4, 'bold'), { text: '*a **b** c*', selected: 'b' });
  assert.ok(applied('*ab* c', 2, 6, 'bold').reason);
  // 選択範囲の前後の空白は外してから付ける
  assert.deepEqual(applied('one two three', 3, 8, 'bold'), { text: 'one **two** three', selected: 'two' });
  assert.deepEqual(applied('a **b** c d', 0, 10, 'italic'), { text: '*a **b** c* d', selected: 'a **b** c' });
  assert.ok(applied('a   b', 1, 4, 'bold').reason);
  assert.ok(applied('a **b** c', 0, 9, 'code').reason);
});


const kinds = ['bold', 'italic', 'strike', 'code', 'link'] as const;

test('段落内の編集を差分解析した木でも、装飾の判定は全文解析と同じになる', () => {
  let text = '# 記事\n\nこれは長い文章です。**太字**と*斜体*があります。\n\n- 一つ目\n- 二つ目\n\n次の段落 `code` です。\n';
  let tree = markdownParser.parse(text);
  for (const insert of ['追記', '**', '*強調*', '`', 'x']) {
    const at = text.indexOf('長い');
    const changes = ChangeSet.of({ from: at, insert }, text.length);
    text = text.slice(0, at) + insert + text.slice(at);
    tree = reparse(tree, text, changes);
    const start = text.indexOf('文章');
    for (const kind of kinds) {
      for (const [from, to] of [[start, start + 2], [start - 2, start + 4], [text.indexOf('次の'), text.indexOf('次の') + 2]]) {
        assert.deepEqual(formatPlan(text, { from, to }, kind, tree), formatPlan(text, { from, to }, kind), `${insert} ${kind} ${from}-${to}`);
      }
    }
  }
});

test('CodeMirror側など別の解析器の木を渡しても、全文解析にして判定する', () => {
  const text = 'これは文章です。\n';
  const foreign = markdownParser.configure([]).parse(text);
  assert.deepEqual(formatPlan(text, { from: 3, to: 5 }, 'bold', foreign), formatPlan(text, { from: 3, to: 5 }, 'bold'));
});
