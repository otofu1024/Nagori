import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';
import {
  reviewRequest,
  reviewTarget,
  reviewLocation,
  rewriteLocation,
  correctionChanges,
  suggestionChanges,
  parseReviewResult,
  resolvedReviewAi,
  rewriteDiff,
  reviewFeatures,
  type ReviewFeature,
} from '../../src/lib/workspace/blogReview.ts';
import { applyReviewEdit } from '../../src/lib/editor/reviewEdit.ts';
import { readProperties } from '../../src/lib/workspace/frontMatter.ts';

const article = '---\ntitle: タイトル\ndescription: 説明\ntags: [既存]\n---\n\n# 本文\n誤字です。\n次の段落です。\n';
const from = article.indexOf('誤字です。');
const snapshot = { text: article, from, to: from + '誤字です。'.length };

test('機能ごとの指示とスキーマ、必要な記事データだけを渡す', () => {
  for (const feature of Object.keys(reviewFeatures) as ReviewFeature[]) {
    const request = reviewRequest(snapshot, feature, ['既存', '候補']);
    assert.equal(request.feature, feature);
    assert.equal(request.schema.additionalProperties, false);
    assert.ok(request.prompt.includes(reviewFeatures[feature].instruction));
    const data = JSON.parse(request.prompt.split('\n記事データ\n')[1]);
    assert.ok(data.frontMatter.includes('title: タイトル'));
    assert.ok(data.body.includes('# 本文'));
    assert.equal(data.target, feature === 'rewrite' ? '誤字です。' : data.body);
    assert.equal('existingTags' in data, feature === 'suggest');
    assert.deepEqual(
      Object.keys(data).sort(),
      (feature === 'suggest' ? ['body', 'existingTags', 'frontMatter', 'target'] : ['body', 'frontMatter', 'target']).sort(),
    );
  }
  assert.ok(reviewRequest(snapshot, 'rewrite').prompt.includes('AIの知識による・未確認'));
  assert.equal(reviewTarget({ ...snapshot, to: from }, 'rewrite').original, article.slice(readProperties(article)!.bodyFrom));
  assert.equal(reviewTarget({ ...snapshot, from: 0, to: article.length }, 'rewrite').from, readProperties(article)!.bodyFrom);
  assert.throws(() => reviewRequest({ text: '---\ntitle: 題\n---\n', from: 0, to: 0 }, 'proofread'));
});

test('利用できるAIから指定順に初期値を選ぶ', () => {
  assert.equal(resolvedReviewAi(null, ['codex', 'claude', 'agy']), 'agy');
  assert.equal(resolvedReviewAi('claude', ['codex', 'claude']), 'claude');
  assert.equal(resolvedReviewAi('agy', ['codex']), 'codex');
  assert.equal(resolvedReviewAi('codex', []), null);
});

test('本文だけを照合し、見つからない箇所と複数の箇所は採用しない', () => {
  assert.deepEqual(reviewLocation(article, '誤字です。'), { from, to: from + 5, reason: '' });
  assert.equal(reviewLocation(article, 'タイトル').reason, '本文で見つからない');
  assert.equal(reviewLocation(article, '').reason, '本文で見つからない');
  assert.equal(reviewLocation(article + '誤字です。', '誤字です。').reason, '本文に複数あります');
  assert.throws(() => correctionChanges(article, { original: 'ない', replacement: 'ある', reason: '' }));
  const unicode = article + '絵文字😀を直す';
  assert.equal(reviewLocation(unicode, '😀').to - reviewLocation(unicode, '😀').from, 2);
});

test('校正、推敲、各プロパティの採用は1回のUndoで戻る', () => {
  const plans = [
    correctionChanges(article, { original: '誤字です。', replacement: '正しい文です。', reason: '' }),
    [{ from, to: snapshot.to, insert: '推敲した文です。' }],
    suggestionChanges(article, 'description', '新しい説明'),
    suggestionChanges(article, 'tags', '新しいタグ'),
    suggestionChanges(article, 'title', '新しい題'),
  ];
  for (const changes of plans) {
    let state = EditorState.create({ doc: article, extensions: [history()] });
    const editor = {
      get state() {
        return state;
      },
      dispatch(spec: TransactionSpec) {
        state = state.update(spec).state;
      },
    };
    editor.dispatch({ changes: { from: article.length, insert: '直前の入力' }, userEvent: 'input' });
    const before = state.doc.toString();
    assert.equal(applyReviewEdit(editor, before, changes), true);
    assert.equal(undoDepth(state), 2);
    const after = state.doc.toString();
    assert.notEqual(after, before);
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    assert.equal(state.doc.toString(), before);
    assert.equal(applyReviewEdit(editor, article, changes), false);
  }
  const tags = suggestionChanges(article, 'tags', '既存');
  assert.deepEqual(tags, []);
  let readonly = EditorState.create({ doc: article, extensions: [EditorState.readOnly.of(true)] });
  assert.equal(
    applyReviewEdit(
      {
        state: readonly,
        dispatch() {
          throw Error('書き換えた');
        },
      },
      article,
      plans[0],
    ),
    false,
  );
});

test('AIの答えを検証し、推敲の差分を文字列として描く', () => {
  assert.deepEqual(parseReviewResult('proofread', { issues: [] }), { issues: [] });
  assert.deepEqual(parseReviewResult('rewrite', { rewritten: '案', checks: ['未確認'] }), { rewritten: '案', checks: ['未確認'] });
  assert.deepEqual(parseReviewResult('suggest', { descriptions: ['説明'], tags: ['タグ', 'タグ'], titles: ['題'] }).tags, ['タグ']);
  for (const value of [
    null,
    [],
    { issues: [{ original: '', replacement: '案', reason: '' }] },
    { issues: [{ original: '元', replacement: 1, reason: '' }] },
  ])
    assert.throws(() => parseReviewResult('proofread', value));
  assert.throws(() => parseReviewResult('rewrite', { rewritten: '案' }));
  assert.throws(() => parseReviewResult('suggest', { descriptions: [], tags: [], titles: [] }));
  assert.deepEqual(rewriteDiff('前。元の文。後。', '前。案の文。後。'), {
    prefix: '前。',
    removed: '元',
    added: '案',
    suffix: 'の文。後。',
  });
});

test('差分は絵文字の途中を分けない', () => {
  assert.deepEqual(rewriteDiff('前😀後', '前😁後'), { prefix: '前', removed: '😀', added: '😁', suffix: '後' });
});

test('保存用の文が古くても、送信、校正の位置、推敲の採用は現在のEditorStateを使う', async () => {
  let state = EditorState.create({ doc: article, extensions: [history()] });
  const editor = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  };
  const inserted = '\n直前に書いた文です。';
  editor.dispatch({ changes: { from: state.doc.length, insert: inserted }, annotations: Transaction.addToHistory.of(false) });
  const current = state.doc.toString();
  const sent = { text: current, from, to: snapshot.to };
  const request = reviewRequest(sent, 'rewrite');
  assert.equal(JSON.parse(request.prompt.split('\n記事データ\n')[1]).body, current.slice(readProperties(current)!.bodyFrom));
  assert.equal(reviewLocation(current, inserted).reason, '');
  assert.equal(reviewLocation(article, inserted).reason, '本文で見つからない');

  let complete!: (answer: { rewritten: string; checks: string[] }) => void;
  const pending = new Promise<{ rewritten: string; checks: string[] }>((resolve) => {
    complete = resolve;
  });
  const prefix = '待ち時間中に書いた文です。\n';
  editor.dispatch({
    changes: { from: readProperties(current)!.bodyFrom, insert: prefix },
    annotations: Transaction.addToHistory.of(false),
  });
  complete({ rewritten: '推敲した文です。', checks: [] });
  const answer = await pending;
  const expected = state.doc.toString();
  const location = rewriteLocation(expected, sent);
  assert.deepEqual(location, { from: from + prefix.length, to: snapshot.to + prefix.length, reason: '' });
  assert.equal(reviewLocation(expected, '誤字です。').from, location.from);
  assert.equal(applyReviewEdit(editor, expected, [{ from: location.from, to: location.to, insert: answer.rewritten }]), true);
  assert.ok(state.doc.toString().includes(prefix));
  assert.ok(state.doc.toString().endsWith(inserted));
  assert.ok(state.doc.toString().includes(answer.rewritten));
  undo({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  assert.equal(state.doc.toString(), expected);
});

test('現在の本文に推敲の対象がなくなった時と重複した時は採用しない', () => {
  assert.equal(rewriteLocation(article.replace('誤字です。', '手で変更した文です。'), snapshot).reason, '本文で見つからない');
  assert.equal(rewriteLocation(article + '誤字です。', snapshot).reason, '本文に複数あります');
  const repeated = { ...snapshot, text: article + '誤字です。' };
  assert.deepEqual(rewriteLocation(repeated.text, repeated), { from, to: snapshot.to, reason: '' });
});
