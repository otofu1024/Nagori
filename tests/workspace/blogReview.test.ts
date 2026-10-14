import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { reviewRequest, parseReviewResult, reviewLocation, orderedIssues, correctionChanges, suggestionChanges, reviewDiff, resolvedReviewAi, type ReviewSkills, type ReviewIssue } from '../../src/lib/workspace/blogReview.ts';
import { applyReviewEdit, reviewHistory, reviewDismissed } from '../../src/lib/editor/reviewEdit.ts';
import { readProperties } from '../../src/lib/workspace/frontMatter.ts';
import { startupSettings } from '../../src/lib/workspace/settings.ts';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const skills: ReviewSkills = {
  common: read('../../src/lib/review/skills/共通.md'),
  review: { instruction: read('../../src/lib/review/skills/添削/SKILL.md'), schema: JSON.parse(read('../../src/lib/review/skills/添削/schema.json')) },
  suggest: { instruction: read('../../src/lib/review/skills/提案/SKILL.md'), schema: JSON.parse(read('../../src/lib/review/skills/提案/schema.json')) },
};
const article = '---\ntitle: ぼくの話\ntags: [日常]\n---\n\n　みなさんこんばんわ。ぼくです。';
const snapshot = { text: article, from: 0, to: article.length };
const issue: ReviewIssue = { kind: '誤り', quote: 'こんばんわ', replacement: 'こんばんは', reason: 'あいさつの表記を直します。' };

test('送信する指示の全文は、承認済みのスキルと固定した記事だけで決まる', () => {
  const expected = JSON.parse(read('./fixtures/blog-review-prompts.json'));
  assert.equal(reviewRequest(snapshot, 'review', skills).prompt, expected.review);
  assert.equal(reviewRequest(snapshot, 'suggest', skills, ['日常', '道具']).prompt, expected.suggest);
  assert.equal(reviewRequest({ ...snapshot, from: article.indexOf('ぼくです'), to: article.length }, 'review', skills).prompt, expected.review);
  assert.deepEqual(reviewRequest(snapshot, 'review', skills).schema, skills.review.schema);
  assert.throws(() => reviewRequest({ ...snapshot, text: '---\ntitle: 空\n---\n' }, 'review', skills));
});
test('スキルの本文は要件定義の承認済みの文と一字も違わない', () => {
  const blocks = [...read('../../docs/blog-review.md').matchAll(/```markdown\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.deepEqual([skills.common, skills.review.instruction, skills.suggest.instruction], blocks);
});
test('種類と答えの形、説明80字とタイトル30字を確かめる', () => {
  assert.deepEqual(parseReviewResult('review', { issues: [issue] }), { issues: [issue] });
  assert.deepEqual(parseReviewResult('review', { issues: [] }), { issues: [] });
  for (const malformed of [null, [], { issues: [{ ...issue, kind: '校正' }] }, { issues: [{ ...issue, quote: '' }] }, { issues: [{ ...issue, reason: 3 }] }, { issues: [{ ...issue, extra: true }] }, { issues: [], rewritten: '全文' }]) assert.throws(() => parseReviewResult('review', malformed));
  const answer = { descriptions: ['あ'.repeat(80), '😀'.repeat(80)], tags: ['日常', '道具', '芸術'], titles: ['あ'.repeat(30), '次の案', '最後の案'] };
  assert.deepEqual(parseReviewResult('suggest', answer).tags, ['日常', '道具', '芸術']);
  assert.throws(() => parseReviewResult('suggest', { ...answer, tags: ['日常', '道具', '日常'] }));
  for (const malformed of [{ ...answer, descriptions: ['あ'.repeat(81), '案'] }, { ...answer, titles: ['あ'.repeat(31), '案', '案'] }, { ...answer, descriptions: ['案'] }, { ...answer, tags: ['日常'] }, { ...answer, titles: ['案'] }]) assert.throws(() => parseReviewResult('suggest', malformed));
  assert.equal((skills.suggest.schema as any).properties.descriptions.items.maxLength, 80);
  assert.equal((skills.suggest.schema as any).properties.titles.items.maxLength, 30);
});
test('Front Matterを除き、今の本文で一か所だけ見つかる引用を使う', () => {
  const from = article.indexOf(issue.quote);
  assert.deepEqual(reviewLocation(article, issue.quote), { from, to: from + issue.quote.length, reason: '' });
  assert.equal(reviewLocation('---\ntitle: こんばんわ\n---\n本文', issue.quote).reason, '本文で見つからない');
  assert.equal(reviewLocation(article + '\nこんばんわ', issue.quote).reason, '本文に複数あります');
  assert.equal(reviewLocation('---\ntitle: [こんばんわ\n---\n本文', issue.quote).reason, '本文で見つからない');
  assert.equal(reviewLocation(article, '').reason, '本文で見つからない');
  const current = article.replace('　みなさん', '新しい文です。\n　みなさん');
  assert.equal(correctionChanges(current, issue)[0].from, current.indexOf(issue.quote));
  assert.throws(() => correctionChanges(article.replace(issue.quote, 'こんにちは'), issue));
  const late: ReviewIssue = { ...issue, quote: 'ぼくです。' };
  assert.deepEqual(orderedIssues(article, [late, issue]).map(item => item.index), [1, 0]);
  assert.deepEqual(correctionChanges(article, { ...issue, kind: '公開前の確認', replacement: '' }), []);
  assert.equal(correctionChanges(article, { ...issue, replacement: '' })[0].insert, '');
});
test('差分は共通の文字を残し、絵文字を途中で切らない', () => {
  assert.deepEqual(reviewDiff('みなさんこんばんわ。', 'みなさんこんばんは。'), { prefix: 'みなさんこんばん', removed: 'わ', added: 'は', suffix: '。' });
  assert.deepEqual(reviewDiff('😀です', '😄です'), { prefix: '', removed: '😀', added: '😄', suffix: 'です' });
});
function editor(text = article) {
  const view = {
    state: EditorState.create({ doc: text, extensions: [history(), reviewHistory] }),
    dispatch(input: any) { view.state = input.state ?? view.state.update(input).state; },
  };
  return view;
}
test('直した本文とカード、無視したカードを1回のUndoで戻し、Redoもできる', () => {
  const view = editor();
  assert.equal(applyReviewEdit(view, article, correctionChanges(article, issue), 'run:0'), true);
  assert.ok(view.state.doc.toString().includes('こんばんは'));
  assert.deepEqual(view.state.field(reviewDismissed), ['run:0']);
  assert.equal(undoDepth(view.state), 1);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), article);
  assert.deepEqual(view.state.field(reviewDismissed), []);
  assert.equal(redo(view), true);
  assert.deepEqual(view.state.field(reviewDismissed), ['run:0']);
  const corrected = view.state.doc.toString();
  assert.equal(applyReviewEdit(view, corrected, [], 'run:1'), true);
  assert.deepEqual(view.state.field(reviewDismissed), ['run:0', 'run:1']);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), corrected);
  assert.deepEqual(view.state.field(reviewDismissed), ['run:0']);
  assert.equal(redo(view), true);
  assert.deepEqual(view.state.field(reviewDismissed), ['run:0', 'run:1']);
  assert.equal(applyReviewEdit(view, article, correctionChanges(article, issue)), false);
});
test('提案は見出しにだけ反映し、コメントと本文を保ち、1回で戻せる', () => {
  const text = article.replace('title: ぼくの話', 'title: ぼくの話 # コメント');
  for (const [key, value] of [['title', '次の話'], ['description', 'ぼくの話です。'], ['tags', '道具']] as const) {
    const view = editor(text);
    assert.equal(applyReviewEdit(view, text, suggestionChanges(text, key, value)), true);
    const result = view.state.doc.toString();
    assert.ok(result.endsWith('　みなさんこんばんわ。ぼくです。'));
    assert.ok(result.includes('# コメント'));
    assert.deepEqual(readProperties(result)?.properties.find(p => p.key === key)?.value, key === 'tags' ? ['日常', '道具'] : value);
    assert.equal(undo(view), true); assert.equal(view.state.doc.toString(), text);
  }
});
test('AIとモデル、考える深さを保存して、取得済みのモデル一覧を残す', () => {
  assert.equal(resolvedReviewAi('codex', ['agy', 'codex']), 'codex');
  assert.equal(resolvedReviewAi('claude', ['agy', 'codex']), 'agy');
  assert.equal(resolvedReviewAi('codex', []), null);
  const saved = startupSettings({ blogReviewAi: 'codex', blogReviewModel: 'gpt-custom', blogReviewEffort: 'high', blogReviewModels: { codex: ['gpt-custom'] } });
  assert.equal(saved.blogReviewModel, 'gpt-custom'); assert.equal(saved.blogReviewEffort, 'high'); assert.deepEqual(saved.blogReviewModels, { codex: ['gpt-custom'] });
  assert.equal(startupSettings({ blogReviewEffort: 'invalid' }).blogReviewEffort, '');
});
