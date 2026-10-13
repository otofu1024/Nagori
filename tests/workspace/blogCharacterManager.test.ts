import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCharacterConfig,
  writeCharacterConfig,
  validateCharacters,
  countCharacterUsage,
  characterImagePath,
  unusedCharacterImages,
  createCharacterManager,
  type CharacterDraft,
  type CharacterStorage,
} from '../../src/lib/workspace/blogCharacterManager.ts';
const source = `// 前のコメント\nexport const TITLE = 'ブログ';\nexport const CHARACTERS = {
  NAGORI: { name: 'なごり', defaultExpression: 'normal', expressions: {
    normal: { src: '/images/nagori/normal.png', label: '通常', aliases: ['通常'] },
    smile: { src: '/images/nagori/smile.png', label: '笑顔', aliases: ['笑顔'] }
  } }
} as const; // 後のコメント\nexport const AFTER = ['順序', '保持'];\n`;
const characters = () => readCharacterConfig(source).characters;

test('CHARACTERSの値だけを書き換え、コメントと並びと型指定を残す', () => {
  for (const input of [source, source.replace(/\n/g, '\r\n')]) {
    const { from, to, characters } = readCharacterConfig(input);
    characters[0].name = '新しい名前';
    const output = writeCharacterConfig(input, characters);
    const next = readCharacterConfig(output);
    assert.equal(output.slice(0, next.from), input.slice(0, from));
    assert.equal(output.slice(next.to), input.slice(to));
    assert.equal(next.characters[0].name, '新しい名前');
    assert.ok(input.includes('\r\n') === output.includes('\r\n'));
    assert.deepEqual(readCharacterConfig(writeCharacterConfig(input, [])).characters, []);
  }
  assert.deepEqual(readCharacterConfig('export const CHARACTERS: Record<string, unknown> = {};').characters, []);
  assert.equal(readCharacterConfig(source.replace("'なごり'", "'な\\u3054り'")).characters[0].name, 'なごり');
  assert.equal(readCharacterConfig(source.replace("'なごり'", "'it\\'s \\\"ok\\\"'")).characters[0].name, 'it\'s "ok"');
});
test('設定を実行せず、欠落と読めない形と重複を拒否する', () => {
  for (const input of [
    'export const TITLE = "例";',
    'const CHARACTERS = {};',
    'export const CHARACTERS = run();',
    'export const CHARACTERS = elsewhere;',
    'export const CHARACTERS = { ...other };',
    'export const CHARACTERS = { get NAGORI() { return {}; } };',
    'export const CHARACTERS = {}; export const CHARACTERS = {};',
    source.replace("name: 'なごり'", 'name: run()'),
    source.replace('normal: { src:', 'normal: { unknown: "値", src:'),
    source.replace("['通常']", '[alias]'),
    source.replace('} as const;', '} as const + run();'),
  ])
    assert.throws(() => writeCharacterConfig(input, characters()), undefined, input);
});
test('キーの文字と予約語、表情と別名の正規化後の重複、標準の表情を検証する', () => {
  assert.deepEqual(validateCharacters(characters()), []);
  for (const key of ['', 'なごり', 'bad key', 'Note', 'TIP', 'important', 'WARNING', 'caution']) {
    const list = characters();
    list[0].key = key;
    assert.ok(
      validateCharacters(list).some((issue) => issue.field === 'key'),
      key,
    );
  }
  const duplicate = characters();
  duplicate.push({ ...duplicate[0], key: 'nagori' });
  assert.equal(validateCharacters(duplicate).filter((issue) => issue.field === 'key').length, 2);
  const list = characters();
  list[0].expressions[1].aliases = [' NORMAL！？ ', '通常!'];
  const issues = validateCharacters(list);
  assert.ok(issues.some((issue) => issue.field === 'aliases' && issue.expression === 1));
  assert.ok(issues.some((issue) => issue.field === 'expression' && issue.expression === 0));
  list[0].defaultExpression = 'missing';
  assert.ok(validateCharacters(list).some((issue) => issue.field === 'defaultExpression'));
  list[0].expressions = [];
  assert.ok(validateCharacters(list).length);
  assert.deepEqual(validateCharacters([]), []);
});
test('記事内の引用からキー、標準の表情、別名を数え、コードと途中の記法を除く', () => {
  const character = characters()[0];
  const documents = [
    {
      text: `---\ntitle: 見本\nexample: '> [!NAGORI]'\n---\n> [!NAGORI]\n> 通常\n\n> [!nagori 通常！]\n> 別名\n\n> [!NAGORI SMILE?]\n> 笑顔\n\n> [!OTHER]\n> 他\n\n> 先の行\n> [!NAGORI]\n\n\`\`\`md\n> [!NAGORI]\n\`\`\`\n\n    > [!NAGORI]\n\n[!NAGORI]\n`,
    },
  ];
  assert.equal(countCharacterUsage(documents, character), 3);
  assert.equal(countCharacterUsage(documents, character, character.expressions[0]), 2);
  assert.equal(countCharacterUsage(documents, character, character.expressions[1]), 1);
});
test('画像の保存先は小文字のキーと表情名と元の拡張子を使う', () => {
  assert.equal(characterImagePath('NAGORI', '笑顔', 'source.JPEG'), '/images/nagori/笑顔.JPEG');
  for (const [key, expression, filename] of [
    ['NOTE', 'normal', 'a.png'],
    ['../bad', 'normal', 'a.png'],
    ['NAGORI', '../bad', 'a.png'],
    ['NAGORI', 'bad\\name', 'a.png'],
    ['NAGORI', 'normal', 'a.svg'],
  ])
    assert.throws(() => characterImagePath(key, expression, filename));
});
test('画像を共有している表情とpublic外の画像は削除の対象にしない', () => {
  const before = characters();
  const after = characters();
  after[0].expressions[1].src = before[0].expressions[0].src;
  after[0].expressions.shift();
  assert.deepEqual(unusedCharacterImages(before, after), ['public/images/nagori/smile.png']);
  before[0].expressions.push(
    { expression: 'remote', label: '', src: 'https://example.com/a.png', aliases: [] },
    { expression: 'outside', label: '', src: '/../secret.png', aliases: [] },
  );
  assert.deepEqual(unusedCharacterImages(before, after), ['public/images/nagori/smile.png']);
});
function storage() {
  const calls: string[] = [];
  let saved: Parameters<CharacterStorage['save']>[0] | undefined;
  const port: CharacterStorage = {
    read: async () => ({ text: source, baseline: 'before', readonly: false }),
    documents: async () => [],
    imageBaseline: async (path) => {
      calls.push(path);
      return 'old-image';
    },
    save: async (request) => {
      calls.push('save');
      saved = request;
      return { baseline: 'after', cleanupErrors: [] };
    },
  };
  return { calls, port, request: () => saved };
}
test('不正な入力と上書きのキャンセルでは設定も画像も保存しない', async () => {
  const { calls, port } = storage(),
    manager = createCharacterManager(port),
    loaded = await manager.load();
  loaded.characters[0].key = 'NOTE';
  assert.ok('issues' in (await manager.save(loaded.snapshot, loaded.characters, [], async () => true)));
  assert.deepEqual(calls, []);
  loaded.characters[0].key = 'NAGORI';
  const pending = [{ character: loaded.characters[0], expression: loaded.characters[0].expressions[0], filename: 'new.PNG', data: [1] }];
  assert.ok('cancelled' in (await manager.save(loaded.snapshot, loaded.characters, pending, async () => false)));
  assert.ok(!calls.includes('save'));
});
test('画像を保存時の名前でコピーし、基準と未使用の画像だけをストレージへ渡す', async () => {
  const mock = storage(),
    manager = createCharacterManager(mock.port),
    loaded = await manager.load();
  const character = loaded.characters[0],
    expression = character.expressions[0];
  const pending = [{ character, expression, filename: 'new.PNG', data: [1, 2] }];
  character.key = 'RENAMED';
  expression.expression = '笑顔';
  character.defaultExpression = '笑顔';
  character.expressions.pop();
  const result = await manager.save(loaded.snapshot, loaded.characters, pending, async () => true);
  assert.ok('snapshot' in result);
  assert.equal(mock.request()?.images[0].path, 'public/images/renamed/笑顔.PNG');
  assert.equal(mock.request()?.images[0].baseline, 'old-image');
  assert.equal(mock.request()?.baseline, 'before');
  assert.equal(readCharacterConfig(mock.request()!.text).characters[0].expressions[0].src, '/images/renamed/笑顔.PNG');
  assert.equal(expression.src, '/images/nagori/normal.png');
});

test('__proto__もNodeで普通のキャラクターと表情として読める形に書き出す', async () => {
  const list = characters();
  list[0].key = '__proto__';
  list[0].expressions[0].expression = '__proto__';
  list[0].defaultExpression = '__proto__';
  const output = writeCharacterConfig('export const CHARACTERS = {};', list);
  assert.deepEqual(readCharacterConfig(output).characters, list);
  const module = await import('data:text/javascript,' + encodeURIComponent(output));
  assert.ok(Object.hasOwn(module.CHARACTERS, '__proto__'));
  assert.ok(Object.hasOwn(module.CHARACTERS.__proto__.expressions, '__proto__'));
  assert.throws(() => readCharacterConfig('export const CHARACTERS = {[run()]: {}};'));
});

test('標準の表情はブログの照合に合わせて正規化し、表情名と画像名は保つ', async () => {
  const list = characters();
  list[0].expressions[0].expression = 'NORMAL！';
  list[0].defaultExpression = 'NORMAL！';
  assert.deepEqual(validateCharacters(list), []);
  const output = writeCharacterConfig('export const CHARACTERS = {};', list);
  const loaded = readCharacterConfig(output).characters[0];
  assert.equal(loaded.defaultExpression, 'normal');
  assert.equal(loaded.expressions[0].expression, 'NORMAL！');
  const module = await import('data:text/javascript,' + encodeURIComponent(output));
  const lookup = new Map(
    Object.entries(module.CHARACTERS.NAGORI.expressions).map(([key, value]) => [
      key
        .trim()
        .toLowerCase()
        .replace(/[!！?？]+$/, ''),
      value,
    ]),
  );
  assert.ok(lookup.get(module.CHARACTERS.NAGORI.defaultExpression));
});
