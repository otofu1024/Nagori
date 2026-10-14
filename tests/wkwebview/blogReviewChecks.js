import { EditorSelection, Transaction } from '@codemirror/state';
import { undo, isolateHistory } from '@codemirror/commands';
import { readProperties } from '../../src/lib/workspace/frontMatter.ts';

export function createReviewMock() {
  const pending = new Map();
  return {
    calls: [],
    mode: 'answer',
    get pendingCount() {
      return pending.size;
    },
    complete(answer) {
      const entry = pending.entries().next().value;
      if (!entry) throw Error('待機中の添削がありません。');
      pending.delete(entry[0]);
      entry[1].resolve(answer);
    },
    async invoke(command, args) {
      if (command === 'blog_review_available') return ['agy', 'codex'];
      if (command === 'blog_review_cancel') {
        pending.get(args.id)?.reject({ code: 'CANCELLED', message: '取り消しました。' });
        pending.delete(args.id);
        return;
      }
      if (command !== 'blog_review_run') throw Error('添削の確認にないコマンド');
      this.calls.push(args);
      if (this.mode === 'pending') return new Promise((resolve, reject) => pending.set(args.id, { resolve, reject }));
      if (this.mode === 'error') throw { code: 'AI_COMMAND', message: '確認用のコマンドの失敗' };
      if (this.mode === 'invalid') return { issues: '不正な答え' };
      if (args.request.feature === 'proofread')
        return {
          issues: [
            { original: '校正の誤りです。', replacement: '校正の修正です。', reason: '確認用の理由' },
            { original: '本文にない指摘です。', replacement: '案', reason: '確認用' },
          ],
        };
      if (args.request.feature === 'rewrite') return { rewritten: '推敲した文です。', checks: ['AIの知識による・未確認の日付'] };
      return {
        descriptions: ['添削の説明案', '別の説明案'],
        tags: ['添削タグ'],
        titles: ['添削のタイトル案', '別のタイトル案', 'もう1つのタイトル案'],
      };
    },
  };
}

export async function checkReview({ check, until, view, mock }) {
  const root = document.querySelector('#host'),
    previousWidth = root.style.width;
  root.style.width = '1500px';
  const before = view.state.doc.toString();
  const source = before + '\n\n校正の誤りです。\n推敲前の文です。\n';
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const snapshot = () => view.state.doc.toString();
  const replace = (text) =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      annotations: Transaction.addToHistory.of(false),
    });
  const panel = () => document.querySelector('.blog-review:not([hidden])');
  const button = (label) => [...panel().querySelectorAll('button')].find((button) => button.textContent === label);
  const feature = (name) => {
    const select = panel().querySelector('select');
    select.value = name;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const verifyUndo = async (label, apply, verify) => {
    const previous = snapshot();
    apply();
    await frame();
    check(label + 'を採用', verify());
    undo(view);
    await frame();
    check(label + 'の採用を1回のUndoで戻す', snapshot() === previous);
  };
  try {
    check('ブログのバーに添削を表示', !!document.querySelector('.review-toggle'));
    document.querySelector('.review-toggle').click();
    await until(panel, '添削の欄');
    check('目次から添削へ切り替え', !!panel() && !document.querySelector('.outline'));
    replace(source);
    // 保存用のonChangeが来ない書き換えの直後でも、EditorViewの本文を送る。
    button('校正').click();
    await until(() => panel().querySelectorAll('.review-issues li').length === 2, '校正の答え');
    check(
      '履歴に入れない編集の直後も現在の本文をAIへ送る',
      JSON.parse(mock.calls.at(-1).request.prompt.split('\n記事データ\n')[1]).body === source.slice(readProperties(source).bodyFrom),
    );
    check('校正は勝手に本文を書き換えない', snapshot() === source);
    const quote = panel().querySelector('.review-quote');
    quote.click();
    await frame();
    check(
      '指摘を押すと該当箇所を選択',
      view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === '校正の誤りです。',
    );
    const missing = panel().querySelectorAll('.review-issues li')[1];
    check(
      '見つからない指摘は採用できない',
      missing.textContent.includes('本文で見つからない') &&
        [...missing.querySelectorAll('button')].find((button) => button.textContent === '直す').disabled,
    );
    await verifyUndo(
      '校正',
      () => button('直す').click(),
      () => snapshot().includes('校正の修正です。'),
    );
    button('無視する').click();
    await frame();
    check('指摘を無視すると一覧から除く', !panel().querySelector('.review-issues li'));

    mock.mode = 'pending';
    button('校正').click();
    await until(() => mock.pendingCount === 1, '校正の応答待ち');
    const bodyFrom = readProperties(snapshot()).bodyFrom,
      added = '答えを待つ間の追記。\n';
    view.dispatch({ changes: { from: bodyFrom, insert: added }, annotations: Transaction.addToHistory.of(false) });
    mock.complete({ issues: [{ original: '校正の誤りです。', replacement: '校正の修正です。', reason: '確認用の理由' }] });
    await until(
      () => panel().querySelector('.review-quote') && !panel().querySelector('.review-quote').disabled,
      '現在の本文で校正の位置を照合',
    );
    panel().querySelector('.review-quote').click();
    await frame();
    check('校正の待ち時間中の編集に合わせて選択位置を探し直す', view.state.selection.main.from === snapshot().indexOf('校正の誤りです。'));
    await verifyUndo(
      '待ち時間中に編集した記事の校正',
      () => button('直す').click(),
      () => snapshot().includes(added) && snapshot().includes('校正の修正です。'),
    );
    replace(source);
    mock.mode = 'answer';
    await frame();

    feature('rewrite');
    await frame();
    const from = snapshot().indexOf('推敲前の文です。'),
      to = from + '推敲前の文です。'.length;
    view.dispatch({ selection: EditorSelection.range(from, to) });
    button('推敲').click();
    await until(() => panel().querySelector('.review-diff'), '推敲の答え');
    check('推敲は選択範囲を渡す', JSON.parse(mock.calls.at(-1).request.prompt.split('\n記事データ\n')[1]).target === '推敲前の文です。');
    check(
      '元の文と推敲の案を並べて差分を表示',
      panel().querySelector('del')?.textContent.includes('前') && panel().querySelector('ins')?.textContent.includes('した'),
    );
    check('事実の確認を未確認として表示', panel().textContent.includes('AIの知識による・未確認'));
    await verifyUndo(
      '推敲',
      () => button('採用する').click(),
      () => snapshot().includes('推敲した文です。') && snapshot().includes('校正の誤りです。'),
    );
    button('見送る').click();
    await frame();

    mock.mode = 'pending';
    view.dispatch({ selection: EditorSelection.range(from, to) });
    button('推敲').click();
    await until(() => mock.pendingCount === 1, '推敲の応答待ち');
    view.dispatch({ changes: { from: bodyFrom, insert: added }, annotations: Transaction.addToHistory.of(false) });
    mock.complete({ rewritten: '推敲した文です。', checks: [] });
    await until(() => panel().querySelector('.review-diff'), '編集後の推敲の答え');
    check('推敲の待ち時間中に別の箇所を編集しても現在の対象を採用できる', !button('採用する').disabled);
    await verifyUndo(
      '待ち時間中に編集した記事の推敲',
      () => button('採用する').click(),
      () => snapshot().includes(added) && snapshot().includes('推敲した文です。'),
    );
    replace(source);
    button('見送る').click();
    await frame();

    view.dispatch({ selection: EditorSelection.range(from, to) });
    button('推敲').click();
    await until(() => mock.pendingCount === 1, '対象を変更する推敲の応答待ち');
    view.dispatch({ changes: { from, to, insert: '手で変更した文です。' }, annotations: Transaction.addToHistory.of(false) });
    const manuallyEdited = snapshot();
    mock.complete({ rewritten: '推敲した文です。', checks: [] });
    await until(() => panel().querySelector('.review-diff'), '対象変更後の推敲の答え');
    check(
      '推敲の待ち時間中に対象の文を変更すると採用できない',
      button('採用する').disabled && panel().textContent.includes('本文で見つからない') && snapshot() === manuallyEdited,
    );
    replace(source);
    button('見送る').click();
    mock.mode = 'answer';
    await frame();

    view.dispatch({ selection: { anchor: snapshot().length } });
    button('推敲').click();
    await until(() => panel().querySelector('.review-diff'), '全体の推敲');
    check(
      '選択がない推敲は本文全体を渡す',
      JSON.parse(mock.calls.at(-1).request.prompt.split('\n記事データ\n')[1]).target ===
        snapshot().slice(readProperties(snapshot()).bodyFrom),
    );
    view.dispatch({ changes: { from, to, insert: '手で変更した文です。' }, annotations: isolateHistory.of('full') });
    await frame();
    check('推敲後に対象の文が変われば採用できない', button('採用する').disabled);
    undo(view);
    await frame();

    feature('suggest');
    await frame();
    button('説明文・タグ・タイトル').click();
    await until(() => panel().querySelector('.review-suggestions'), '提案の答え');
    check('説明文2件とタグとタイトル3件を表示', panel().querySelectorAll('.review-suggestions button').length === 6);
    check(
      '提案の時だけ既存のタグを渡す',
      'existingTags' in JSON.parse(mock.calls.at(-1).request.prompt.split('\n記事データ\n')[1]) &&
        !('existingTags' in JSON.parse(mock.calls[0].request.prompt.split('\n記事データ\n')[1])),
    );
    const property = (key) => readProperties(snapshot()).properties.find((property) => property.key === key)?.value;
    await verifyUndo(
      '説明文',
      () => button('添削の説明案').click(),
      () => property('description') === '添削の説明案',
    );
    await verifyUndo(
      'タグ',
      () => button('添削タグ').click(),
      () => property('tags').includes('添削タグ'),
    );
    await verifyUndo(
      'タイトル',
      () => button('添削のタイトル案').click(),
      () => property('title') === '添削のタイトル案',
    );

    mock.mode = 'pending';
    button('説明文・タグ・タイトル').click();
    await until(() => mock.pendingCount === 1 && button('取り消す'), '添削の実行中');
    check('添削の実行中を表示', panel().textContent.includes('実行中'));
    button('取り消す').click();
    await until(() => panel().textContent.includes('取り消しました。'), '添削の取り消し');
    check('取り消し後も本文を保つ', snapshot() === source);
    mock.mode = 'error';
    button('説明文・タグ・タイトル').click();
    await until(() => panel().textContent.includes('確認用のコマンドの失敗'), '添削の失敗');
    check('コマンドの失敗を短く表示', panel().textContent.includes('失敗しました。'));
    mock.mode = 'invalid';
    feature('proofread');
    await frame();
    button('校正').click();
    await until(() => panel().textContent.includes('答えの形式が違います'), '不正なAIの答え');
    check('不正な答えでは本文を保つ', snapshot() === source);
    mock.mode = 'answer';

    root.style.width = '850px';
    await until(() => !panel(), '幅が足りない時の添削');
    check('幅が足りない時は添削を隠す', !panel());
    root.style.width = '1500px';
    await until(panel, '添削の再表示');
    document.querySelector('.outline-toggle').click();
    await frame();
    check('添削から目次へ切り替え', !panel());
  } finally {
    mock.mode = 'answer';
    replace(before);
    root.style.width = previousWidth;
    await frame();
  }
}
