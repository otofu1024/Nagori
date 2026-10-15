import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { readProperties } from '../../src/lib/workspace/frontMatter.ts';

export function createReviewMock() {
  const pending = new Map();
  return {
    calls: [], mode: 'answer', modelCalls: [],
    get pendingCount() { return pending.size; },
    complete(answer) { const [id, entry] = pending.entries().next().value; pending.delete(id); entry.resolve(answer); },
    async invoke(command, args) {
      if (command === 'blog_review_available') return ['agy', 'claude', 'codex'];
      if (command === 'blog_review_models') { this.modelCalls.push(args.ai); if (this.mode === 'models-error') throw Error('一覧の確認'); return args.ai === 'claude' ? ['fable', 'opus', 'sonnet', 'haiku'] : ['model-one', 'model-two']; }
      if (command === 'blog_review_cancel') { pending.get(args.id)?.reject({ code: 'CANCELLED', message: '取り消しました。' }); pending.delete(args.id); return; }
      if (command !== 'blog_review_run') throw Error('添削の確認にないコマンド');
      this.calls.push(args);
      if (this.mode === 'pending') return new Promise((resolve, reject) => pending.set(args.id, { resolve, reject }));
      if (this.mode === 'error') throw { code: 'TIMEOUT', message: '時間切れ' };
      if (this.mode === 'invalid') return { issues: '不正な答え' };
      if (this.mode === 'empty') return { issues: [] };
      return args.request.feature === 'review' ? { issues: [
        { kind: '読みやすさ', quote: '全部「私」に直すのが', replacement: '全部「私」に書きそろえるのが', reason: '何を直すかが伝わります。' },
        { kind: '誤り', quote: 'みなさんこんばんわ。', replacement: 'みなさんこんばんは。', reason: 'あいさつの「は」の誤りです。' },
        { kind: '表記ゆれ', quote: '芸術なんだけどなぁ', replacement: '芸術なんだけどなあ', reason: '語尾の表記をそろえます。' },
        { kind: 'つながり', quote: 'これからのぼくをよろしくお願いします。', replacement: 'これからもよろしくお願いします。', reason: '前の文とのつながりを整えます。' },
        { kind: '公開前の確認', quote: 'TODO', replacement: '', reason: '書きかけの印が残っています。' },
        { kind: '事実の確認', quote: '本文にはありません', replacement: '', reason: 'AIの知識による・未確認' },
      ] } : { descriptions: ['ぼくのイラストを見てほしい。', '芸術の話を書きました。'], tags: ['添削タグ', '日常', '芸術'], titles: ['ぼくのイラスト', '芸術の話', '書き方の話'] };
    },
  };
}
export async function checkReview({ check, until, view, mock }) {
  const root = document.querySelector('#host'), previousWidth = root.style.width, before = view.state.doc.toString();
  const beforeSelection = view.state.selection, beforeScroll = view.scrollDOM.scrollTop;
  root.style.width = '1500px';
  const sample = '---\ntitle: ぼくのイラストを見てほしい\ndescription: 芸術なんだけどなぁ\ntags: [芸術]\n---\n\n# 至高の芸術\n　みなさんこんばんわ。芸術なんだけどなぁ。全部「私」に直すのがめんどくさくなった。\nこれからのぼくをよろしくお願いします。\nTODO';
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const snapshot = () => view.state.doc.toString();
  const replace = text => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length }, annotations: Transaction.addToHistory.of(false) });
  const panel = () => document.querySelector('.blog-review:not([hidden])');
  const button = label => [...panel().querySelectorAll('button')].find(button => button.textContent.trim() === label);
  const cards = () => [...panel().querySelectorAll('.review-card')];
  const property = key => readProperties(snapshot()).properties.find(property => property.key === key)?.value;
  const data = () => JSON.parse(mock.calls.at(-1).request.prompt.split('\n').at(-1));
  const run = async mode => { mock.mode = mode; button('添削する').click(); await until(() => mode === 'pending' ? mock.pendingCount === 1 : mode === 'empty' ? panel().textContent.includes('指摘はありません') : mode === 'error' || mode === 'invalid' ? panel().querySelector('.review-error') : cards().length === 6, '添削の答え'); };
  const ordinary = () => [...panel().querySelectorAll('.review-diff, .review-diff del, .review-diff ins')].every(node => {
    const style = getComputedStyle(node); return style.color === getComputedStyle(root).color && style.fontWeight === '400' && style.animationName === 'none';
  });
  const stableResults = () => !panel().querySelector('.review-spinner') && [...panel().querySelectorAll('.review-results, .review-results *')].every(node => getComputedStyle(node).animationName === 'none') && ordinary() && cards().every(card => getComputedStyle(card).color === getComputedStyle(root).color);
  const verifySuggestion = async (key, value) => { const old = snapshot(); button(value).click(); await frame(); check(key + 'の提案を見出しへ入れる', key === 'tags' ? property(key).includes(value) : property(key) === value); undo(view); await frame(); check(key + 'の提案は1回のUndoで戻る', snapshot() === old); };
  try {
    replace(sample);
    document.querySelector('.review-toggle').click();
    await until(panel, '添削の欄');
    check('まだ実行していない時は説明を出さない', !panel().querySelector('.review-results').textContent.trim() && !!button('添削する'));
    check('目次と同じ大きさの添削アイコン', document.querySelector('.review-toggle').offsetWidth === document.querySelector('.outline-toggle').offsetWidth);
    await run('pending');
    await until(() => panel().textContent.includes('1秒'), '経過時間');
    check('実行中は取り消すボタンと小さな回転の印、結果は空', !!button('取り消す') && getComputedStyle(panel().querySelector('.review-spinner')).animationName !== 'none' && !panel().querySelector('.review-results').textContent.trim());
    button('取り消す').click();
    await until(() => !mock.pendingCount && button('添削する'), '取り消し');
    check('取り消したら説明を出さず実行前に戻る', !panel().querySelector('.review-results').textContent.trim() && !panel().querySelector('.review-spinner'));
    await run('answer');
    check('AIには保存を待たず今の本文全体とFront Matterを送る', data().body === sample.slice(readProperties(sample).bodyFrom) && data().frontMatter === sample.slice(0, readProperties(sample).bodyFrom) && !('existingTags' in data()));
    check('指摘は本文の順に並べる', cards()[0].querySelector('.review-kind').textContent === '誤り' && cards()[2].querySelector('.review-kind').textContent === '読みやすさ');
    check('カードに元の文だけの行を足さない', cards().every(card => card.querySelectorAll('.review-diff').length === 1 && card.querySelectorAll('p').length === 1 && !card.querySelector('.review-quote')));
    check('差分の文字は普通の色と太さで、回転や明滅が残らない', stableResults());
    panel().querySelector('.review-results').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await frame(); check('スクロールバーが出ても結果の文字の色と太さは変わらない', stableResults());
    await new Promise(resolve => setTimeout(resolve, 1300));
    check('スクロールバーが消えても結果の文字の色と太さは変わらない', stableResults());
    check('見つからない指摘は普通の濃さと印で示し、直すだけ押せない', getComputedStyle(cards().at(-1)).opacity === '1' && cards().at(-1).querySelector('.review-missing-label')?.textContent === '本文で見つからない' && [...cards().at(-1).querySelectorAll('button')].every(button => button.disabled === button.classList.contains('review-correct')));
    check('案が空の確認は本文を削除しない', cards()[4].querySelector('.review-correct').disabled);
    cards()[0].querySelector('.review-diff').click(); await frame();
    check('差分を押すと本文の場所へ移って選ぶ', view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'みなさんこんばんわ。');
    cards()[0].querySelector('.review-correct').click(); await frame();
    check('直したカードが消え、本文に修正を入れる', cards().length === 5 && snapshot().includes('みなさんこんばんは。'));
    undo(view); await frame(); check('1回のUndoで本文もカードも戻る', snapshot() === sample && cards().length === 6);
    redo(view); await frame(); check('Redoで本文とカードの採用を戻す', cards().length === 5 && snapshot().includes('こんばんは'));
    undo(view); await frame();
    cards()[0].querySelector('.review-actions button:last-child').click(); await frame();
    check('無視するとカードだけ消える', cards().length === 5 && snapshot() === sample);
    undo(view); await frame(); check('無視も1回のUndoでカードが戻る', cards().length === 6 && snapshot() === sample);
    await run('pending');
    const added = '待つ間に追加した文。\n';
    view.dispatch({ changes: { from: readProperties(sample).bodyFrom, insert: added }, annotations: Transaction.addToHistory.of(false) });
    mock.complete({ issues: [{ kind: '誤り', quote: 'みなさんこんばんわ。', replacement: 'みなさんこんばんは。', reason: '確認用です。' }] });
    await until(() => cards().length === 1, '編集後の答え');
    cards()[0].querySelector('.review-diff').click(); await frame();
    check('応答を待つ間の編集に合わせて位置を探し直す', view.state.selection.main.from === snapshot().indexOf('みなさんこんばんわ。'));
    cards()[0].querySelector('.review-correct').click(); await frame(); check('今の位置に修正を入れる', snapshot().includes(added) && snapshot().includes('こんばんは'));
    undo(view); await frame();
    const from = snapshot().indexOf('みなさんこんばんわ。');
    view.dispatch({ changes: { from, to: from + 'みなさんこんばんわ。'.length, insert: 'こんにちは。' }, annotations: Transaction.addToHistory.of(false) });
    await frame(); check('結果の後に対象を変えると直せなくなる', cards()[0].querySelector('.review-correct').disabled);
    replace(sample); await frame();
    await run('empty'); check('指摘なしは1行だけ', panel().querySelector('.review-results').textContent.trim() === '指摘はありません');
    await run('error'); check('失敗は短い理由ともう一度ボタン', panel().textContent.includes('うまくいきませんでした') && panel().textContent.includes('時間切れ') && !!button('もう一度') && !panel().querySelector('.review-spinner'));
    mock.mode = 'invalid'; button('もう一度').click(); await until(() => panel().textContent.includes('答えの形式が違います'), '不正な答え');
    check('不正な答えでも本文を保つ', snapshot() === sample);
    button('提案').click(); await frame(); mock.mode = 'answer'; button('提案する').click();
    await until(() => panel().querySelectorAll('.review-suggestions button').length === 8, '提案');
    check('提案は説明2案、タグ3個、タイトル3案', panel().querySelectorAll('.review-suggestions button').length === 8 && Array.isArray(data().existingTags));
    await verifySuggestion('description', 'ぼくのイラストを見てほしい。');
    await verifySuggestion('tags', '添削タグ');
    await verifySuggestion('title', 'ぼくのイラスト');
    panel().querySelector('.review-ai').click(); await until(() => document.querySelector('.review-settings'), '添削の設定');
    await until(() => mock.modelCalls.length > 0, 'モデルの一覧');
    const ai = document.querySelector('[aria-label="添削のAI"]'), model = document.querySelector('[aria-label="添削のモデル"]'), effort = document.querySelector('[aria-label="添削の考える深さ"]');
    ai.value = 'codex'; ai.dispatchEvent(new Event('change', { bubbles: true })); await until(() => mock.modelCalls.includes('codex'), 'Codexのモデル');
    model.value = 'custom-model'; model.dispatchEvent(new Event('input', { bubbles: true })); model.dispatchEvent(new Event('change', { bubbles: true })); effort.value = 'high'; effort.dispatchEvent(new Event('change', { bubbles: true })); await frame();
    document.querySelector('[aria-label="設定を閉じる"]').click(); await frame();
    check('モデル名を下の設定へのリンクにも出す', panel().querySelector('.review-ai').textContent.includes('Codex') && panel().querySelector('.review-ai').textContent.includes('custom-model'));
    button('添削').click(); await frame(); await run('answer');
    const reviewCall = mock.calls.at(-1);
    button('提案').click(); await frame(); button('提案する').click();
    await until(() => panel().querySelectorAll('.review-suggestions button').length === 8, '共通の設定で提案');
    const suggestionCall = mock.calls.at(-1);
    check('全機能に共通のAI、モデルと考える深さを渡す', reviewCall.request.feature === 'review' && suggestionCall.request.feature === 'suggest' && [reviewCall, suggestionCall].every(call => call.ai === 'codex' && call.request.model === 'custom-model' && call.request.effort === 'high'));
    panel().querySelector('.review-ai').click(); await until(() => document.querySelector('.review-settings'), '設定を開き直す');
    await until(() => mock.modelCalls.length >= 3, '一覧を再取得');
    check('設定を開くたびにモデル一覧を取り直す', mock.modelCalls.length >= 3);
    mock.mode = 'models-error'; document.querySelector('[aria-label="設定を閉じる"]').click(); await frame();
    panel().querySelector('.review-ai').click(); await until(() => document.querySelector('.review-settings'), '一覧が取れない時の設定'); await frame();
    check('モデル一覧が取れなくても前の一覧と手入力を使える', document.querySelector('#review-models').textContent.includes('model-one') && !document.querySelector('[aria-label="添削のモデル"]').disabled);
    document.querySelector('[aria-label="設定を閉じる"]').click(); mock.mode = 'answer'; await frame();
    check('右の欄はブログのテーマの色を使わない', getComputedStyle(panel()).color === getComputedStyle(root).color && getComputedStyle(panel()).backgroundColor === getComputedStyle(document.body).backgroundColor);
    window.reviewScreens = async (state = 'list', theme = 'light') => {
      root.style.width = '1500px';
      if (!panel()) document.querySelector('.review-toggle').click(); await until(panel);
      if (button('取り消す')) { button('取り消す').click(); await until(() => !mock.pendingCount && !button('取り消す'), '画面確認の取り消し'); }
      button('添削').click(); await frame();
      // 記事を開き直した後も、今画面にある本文を差し替える。
      const currentView = EditorView.findFromDOM(document.querySelector('.cm-editor'));
      currentView.dispatch({ changes: { from: 0, to: currentView.state.doc.length, insert: sample }, selection: { anchor: sample.length }, annotations: Transaction.addToHistory.of(false) });
      const themeLabel = theme === 'dark' ? 'ダークモードに切り替える' : 'ライトモードに切り替える';
      document.querySelector(`[aria-label="${themeLabel}"]`)?.click();
      await until(() => document.documentElement.dataset.theme === theme, '画面確認の配色'); await frame();
      await until(() => button('添削する') && !button('添削する').disabled, '画面確認の実行前');
      if (state === 'running') { await run('pending'); return !!button('取り消す') && !panel().querySelector('.review-results').textContent.trim(); }
      await run('answer');
      if (state === 'diff') {
        // 各カードの消去を反映してから次を消す。
        for (const card of cards().filter(card => card.querySelector('.review-kind').textContent !== '読みやすさ')) { card.querySelector('.review-actions button:last-child').click(); await frame(); }
      }
      return stableResults() && currentView.state.doc.toString() === sample && (state === 'diff' ? cards().length === 1 && !panel().querySelector('.review-missing') : cards().length === 6 && panel().querySelectorAll('.review-missing').length === 1);
    };
    root.style.width = '850px'; await until(() => !panel(), '狭い時の添削'); check('幅が足りない時は目次と同じ仕組みで隠す', !panel());
    root.style.width = '1500px'; await until(panel, '再表示'); document.querySelector('.outline-toggle').click(); await frame(); check('目次へ切り替えられる', !panel());
  } finally { mock.mode = 'answer'; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: before }, userEvent: 'input.review-check' }); view.dispatch({ selection: beforeSelection }); view.scrollDOM.scrollTop = beforeScroll; root.style.width = previousWidth; await frame(); }
}
