// 画面の操作から共有処理を通し、確認用のコピーだけに保存する。
export async function checkCharacters({ check, until, tick, view, replace, before, request, confirmations, saveCount }) {
  await request({ action: 'prepare' });
  const button = (label) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label);
  const ready = () => document.querySelector('.character-manager')?.getAttribute('aria-busy') === 'false';
  const save = async () => {
    const previous = saveCount();
    button('保存').click();
    await tick();
    await until(
      () =>
        ready() && saveCount() > previous && document.querySelector('.character-manager [role="status"]')?.textContent === '保存しました。',
    );
  };
  const field = (key) => document.querySelector(`.character-manager [data-field="${key}"]`);
  const input = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const selectedExpression = (index, name) => document.querySelector(`[data-expression-index="${index}"] [data-field="${name}"]`);
  button('キャラクターの管理').click();
  await until(() => document.querySelector('.character-manager:not([aria-busy="true"]) [data-field="key"]'));
  await until(() => document.querySelector('.character-list img'));
  check(
    '設定内の管理ページにキャラクターのキー、名前、標準の画像を表示',
    field('key').value === 'NAGORI' && !!document.querySelector('.character-list img'),
  );
  button('キャラクターを追加').click();
  await tick();
  input(field('key'), 'NOTE');
  input(field('name'), '確認用');
  const start = saveCount();
  button('保存').click();
  await tick();
  await until(() => ready() && document.querySelector('.field-error'));
  check('予約語の入力では項目の横に理由を出して保存しない', saveCount() === start && field('key').getAttribute('aria-invalid') === 'true');
  input(field('key'), 'NAGORI_CHECK');
  const pngResponse = await fetch('./blog-image?path=' + encodeURIComponent('/images/nagori/normal.png'));
  const png = await pngResponse.arrayBuffer();
  const setImage = async (index, drop) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([png], 'source.png', { type: 'image/png' }));
    const container = document.querySelector(`[data-expression-index="${index}"] .image-picker`);
    const previous = container.querySelector('img')?.getAttribute('src');
    if (drop) container.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    else {
      const picker = container.querySelector('input');
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await tick();
    // 処理開始前のbusy=falseや前の画像では待ちを終えず、新しい画像と処理の完了を確かめる。
    await until(() => {
      const image = container.querySelector('img');
      return ready() && image && image.getAttribute('src') !== previous && image.complete && image.naturalWidth > 0;
    });
  };
  await setImage(0, false);
  button('表情を追加').click();
  await tick();
  input(selectedExpression(1, 'expression'), 'smile');
  input(selectedExpression(1, 'label'), '笑顔');
  input(selectedExpression(1, 'aliases'), 'grin');
  await setImage(1, true);
  await save();
  replace(before + '\n\n> [!NAGORI_CHECK grin]\n> 追加後の吹き出し\n\n終わり');
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  await until(() =>
    [...document.querySelectorAll('.talk')].some(
      (talk) => talk.dataset.character === 'NAGORI_CHECK' && talk.dataset.expression === 'smile',
    ),
  );
  check(
    'キャラクターと表情を追加して保存すると本文の吹き出しに反映',
    !!document.querySelector('.talk[data-character="NAGORI_CHECK"][data-expression="smile"]'),
  );
  check(
    '選択とドロップの画像を元の拡張子でpublicへコピー',
    (await request({ action: 'imageBaseline', path: 'public/images/nagori_check/normal.png' })) &&
      (await request({ action: 'imageBaseline', path: 'public/images/nagori_check/smile.png' })),
  );
  const saved = await request({ action: 'open' });
  input(selectedExpression(1, 'aliases'), 'normal！');
  const previousSave = saveCount();
  button('保存').click();
  await tick();
  await until(() => ready() && selectedExpression(1, 'aliases').getAttribute('aria-invalid') === 'true');
  check(
    '正規化した別名の重複では保存せず元の設定を保つ',
    saveCount() === previousSave && (await request({ action: 'open' })).text === saved.text,
  );
  input(selectedExpression(1, 'aliases'), 'grin');
  await setImage(1, false);
  await save();
  check(
    '同じ画像名の上書きを確認する',
    confirmations.some((message) => message.includes('public/images/nagori_check/smile.png') && message.includes('上書き')),
  );
  const deleteButtons = document.querySelectorAll('.delete-expression');
  deleteButtons[1].click();
  await until(() => ready() && document.querySelectorAll('.expression-fields').length === 1);
  check(
    '使用中の表情の削除は件数を出して確認する',
    confirmations.some((message) => message.includes('表情「smile」') && message.includes('1件')),
  );
  await save();
  let trash = await request({ action: 'trash' });
  check(
    '削除した表情の画像をNagoriのゴミ箱へ移す',
    trash.some((item) => item.path === 'public/images/nagori_check/smile.png') &&
      (await request({ action: 'imageBaseline', path: 'public/images/nagori_check/smile.png' })) === null,
  );
  button('キャラクターを削除').click();
  await until(
    () =>
      ready() && ![...document.querySelectorAll('.character-list button')].some((button) => button.textContent.includes('NAGORI_CHECK')),
  );
  check(
    '使用中のキャラクターの削除は件数を出して確認する',
    confirmations.some((message) => message.includes('キャラクター「NAGORI_CHECK」') && message.includes('2件')),
  );
  await save();
  trash = await request({ action: 'trash' });
  check(
    '削除したキャラクターの画像もゴミ箱へ移す',
    trash.some((item) => item.path === 'public/images/nagori_check/normal.png'),
  );
  check(
    '削除しても記事を書き換えない',
    (await request({ action: 'documents' })).some(
      (doc) => doc.path.endsWith('/nagori-character-check.md') && doc.text.includes('[!NAGORI_CHECK grin]'),
    ),
  );
  button('ブログに戻る').click();
  await until(() => document.querySelector('.manage-characters'));
  replace(before);
  await tick();
}
