import { typescriptLanguage } from '@codemirror/lang-javascript';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { SyntaxNode } from '@lezer/common';

export type ExpressionDraft = { expression: string; label: string; src: string; aliases: string[] };
export type CharacterDraft = { key: string; name: string; defaultExpression: string; expressions: ExpressionDraft[] };
export type CharacterIssue = { character: number; expression?: number; field: string; message: string };
export const normalizeExpression = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[!！?？]+$/, '');
const reserved = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
function children(node: SyntaxNode) {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result.filter((child) => !['LineComment', 'BlockComment'].includes(child.name));
}
function string(source: string, node: SyntaxNode): string {
  const text = source.slice(node.from, node.to);
  if (node.name === 'PropertyDefinition') return text;
  if (node.name !== 'String') throw Error('文字列ではありません。');
  // JavaScriptの文字列のエスケープだけを解釈し、設定のコードは実行しない。
  return text.slice(1, -1).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|.)/gs, (_, escape: string) => {
    if (escape.startsWith('u{')) return String.fromCodePoint(parseInt(escape.slice(2, -1), 16));
    if (/^[ux][0-9a-fA-F]+$/.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (/^[1-9]$/.test(escape)) throw Error('古い形式の文字列エスケープは読めません。');
    return (
      ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r\n': '' } as Record<string, string>)[escape] ??
      escape
    );
  });
}
function literal(source: string, node: SyntaxNode): unknown {
  if (node.name === 'String') return string(source, node);
  const parts = children(node).filter((part) => !['{', '}', '[', ']', ','].includes(part.name));
  if (node.name === 'ArrayExpression') return parts.map((part) => literal(source, part));
  if (node.name !== 'ObjectExpression') throw Error('CHARACTERSにはオブジェクトと文字列と別名の配列を直接書いてください。');
  const object: Record<string, unknown> = Object.create(null);
  for (const part of parts) {
    let fields = children(part);
    // __proto__も普通の項目としてNodeに読ませるため、文字列だけの計算プロパティを認める。
    if (fields.length === 5 && fields[0].name === '[' && fields[1].name === 'String' && fields[2].name === ']')
      fields = fields.slice(1).filter((field) => field.name !== ']');
    if (part.name !== 'Property' || fields.length !== 3 || fields[1].name !== ':')
      throw Error('CHARACTERSに読めないプロパティがあります。');
    const key = string(source, fields[0]);
    if (Object.hasOwn(object, key)) throw Error(`キー「${key}」が重複しています。`);
    object[key] = literal(source, fields[2]);
  }
  return object;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('CHARACTERSの設定の形を読めません。');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('CHARACTERSの項目に文字列以外が含まれています。');
  return value;
}
function fields(object: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(object).some((key) => !allowed.includes(key))) throw Error('CHARACTERSに対応していない項目があります。');
}
// 書き換える範囲は値のオブジェクトだけ。型注釈、コメント、前後の設定には触れない。
export function readCharacterConfig(source: string): { characters: CharacterDraft[]; from: number; to: number } {
  const tree = typescriptLanguage.parser.parse(source);
  let invalid = false;
  tree.iterate({
    enter(node) {
      if (node.type.isError) invalid = true;
    },
  });
  if (invalid) throw Error('config.tsの構文を読めません。');
  let value: SyntaxNode | undefined;
  for (const exported of children(tree.topNode)) {
    if (exported.name !== 'ExportDeclaration') continue;
    for (const declaration of children(exported)) {
      if (declaration.name !== 'VariableDeclaration') continue;
      const parts = children(declaration);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].name !== 'VariableDefinition' || source.slice(parts[i].from, parts[i].to) !== 'CHARACTERS') continue;
        if (value) throw Error('CHARACTERSが重複しています。');
        if (parts[0]?.name !== 'const') throw Error('CHARACTERSはexport constで書いてください。');
        const equals = parts[i + 1]?.name === 'TypeAnnotation' ? i + 2 : i + 1;
        let assigned = parts[equals + 1];
        if (parts[equals]?.name !== 'Equals') throw Error('CHARACTERSの値がありません。');
        // as constとsatisfiesの型指定は値から分離する。関数呼び出しや変数参照は拒否する。
        while (assigned?.name === 'BinaryExpression' && ['as', 'satisfies'].includes(children(assigned)[1]?.name))
          assigned = children(assigned)[0];
        if (assigned?.name !== 'ObjectExpression') throw Error('CHARACTERSが直接書かれたオブジェクトではありません。');
        value = assigned;
      }
    }
  }
  if (!value) throw Error('export const CHARACTERSがありません。');
  const object = record(literal(source, value));
  const characters = Object.entries(object).map(([key, raw]) => {
    const character = record(raw);
    fields(character, ['name', 'defaultExpression', 'expressions']);
    return {
      key,
      name: text(character.name),
      defaultExpression: normalizeExpression(text(character.defaultExpression)),
      expressions: Object.entries(record(character.expressions)).map(([expression, raw]) => {
        const item = record(raw);
        fields(item, ['src', 'label', 'aliases']);
        if (item.aliases !== undefined && !Array.isArray(item.aliases)) throw Error('別名は文字列の配列にしてください。');
        return {
          expression,
          label: text(item.label),
          src: text(item.src),
          aliases: ((item.aliases as unknown[] | undefined) ?? []).map(text),
        };
      }),
    };
  });
  return { characters, from: value.from, to: value.to };
}
export function validateCharacters(characters: CharacterDraft[]): CharacterIssue[] {
  const issues: CharacterIssue[] = [],
    keys = new Map<string, number>();
  characters.forEach((character, c) => {
    const issue = (field: string, message: string, expression?: number) => issues.push({ character: c, expression, field, message });
    const key = character.key.toUpperCase();
    if (!/^[A-Za-z0-9_-]+$/.test(character.key)) issue('key', '英数字、_、-だけを使ってください。');
    if (reserved.includes(key)) issue('key', 'アラートの予約語は使えません。');
    if (keys.has(key)) {
      issue('key', 'キーが重複しています。');
      issues.push({ character: keys.get(key)!, field: 'key', message: 'キーが重複しています。' });
    }
    keys.set(key, c);
    const ids = new Map<string, { field: string; expression: number }>();
    character.expressions.forEach((item, e) => {
      for (const [field, values] of [
        ['expression', [item.expression]],
        ['aliases', item.aliases],
      ] as const) {
        for (const alias of values) {
          const id = normalizeExpression(alias);
          if (!id || /[\]\r\n]/.test(alias)) issue(field, '空の名前、]、改行は使えません。', e);
          const previous = ids.get(id);
          if (previous) {
            issue(field, '表情名か別名が重複しています。', e);
            issue(previous.field, '表情名か別名が重複しています。', previous.expression);
          }
          ids.set(id, { field, expression: e });
        }
      }
    });
    if (!character.expressions.some((item) => normalizeExpression(item.expression) === normalizeExpression(character.defaultExpression)))
      issue('defaultExpression', '表情の中から選んでください。');
  });
  return issues;
}
export function writeCharacterConfig(source: string, characters: CharacterDraft[]): string {
  const { from, to } = readCharacterConfig(source);
  if (validateCharacters(characters).length) throw Error('キャラクターの項目を確認してください。');
  const value = Object.fromEntries(
    characters.map((character) => [
      character.key,
      {
        name: character.name,
        defaultExpression: normalizeExpression(character.defaultExpression),
        expressions: Object.fromEntries(
          character.expressions.map((item) => [
            item.expression,
            { src: item.src, label: item.label, ...(item.aliases.length ? { aliases: item.aliases } : {}) },
          ]),
        ),
      },
    ]),
  );
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const serialized = JSON.stringify(value, null, 2).replace(/^(\s*)"__proto__":/gm, '$1["__proto__"]:');
  return source.slice(0, from) + serialized.replace(/\n/g, newline) + source.slice(to);
}
export function characterImagePath(key: string, expression: string, filename: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(key) || reserved.includes(key.toUpperCase())) throw Error('画像のキャラクターのキーを確認してください。');
  if (!expression.trim() || expression === '.' || expression === '..' || /[/\\:%?#\x00-\x1f\x7f]/.test(expression))
    throw Error('画像の表情名に区切り文字、%、?、#、制御文字は使えません。');
  const extension = /\.([^.]+)$/.exec(filename)?.[1];
  if (!extension || !/^(png|jpe?g|gif|webp)$/i.test(extension)) throw Error('画像はPNG、JPEG、GIF、WebPにしてください。');
  return `/images/${key.toLowerCase()}/${expression}.${extension}`;
}
export function publicImagePath(src: string): string | null {
  if (!src.startsWith('/') || src.startsWith('//') || /[?#\\\x00]/.test(src)) return null;
  if (src.split('/').some((part) => part === '..' || part === '.')) return null;
  return 'public' + src;
}
export function unusedCharacterImages(before: CharacterDraft[], after: CharacterDraft[]): string[] {
  const used = new Set(after.flatMap((character) => character.expressions.map((item) => publicImagePath(item.src))));
  return [
    ...new Set(
      before
        .flatMap((character) => character.expressions.map((item) => publicImagePath(item.src)))
        .filter((path): path is string => !!path && !used.has(path)),
    ),
  ];
}
// 引用の最初の段落だけを数える。コード、通常の文章、引用の途中にある記法は対象外。
export function countCharacterUsage(documents: { text: string }[], character: CharacterDraft, expression?: ExpressionDraft): number {
  let count = 0;
  for (const document of documents) {
    const source = document.text.replace(/^(?:\uFEFF)?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/, '');
    markdownLanguage.parser.parse(source).iterate({
      enter(node) {
        if (node.name !== 'Blockquote') return;
        const paragraph = children(node.node).find((child) => child.name !== 'QuoteMark');
        if (paragraph?.name !== 'Paragraph') return;
        const first = source.slice(paragraph.from, paragraph.to).split(/\r?\n/)[0];
        const match = /^\[!([A-Za-z0-9_-]+)(?:[ 　]+([^\]\n]*))?\][ \t]*$/.exec(first);
        if (!match || match[1].toUpperCase() !== character.key.toUpperCase()) return;
        if (!expression) {
          count++;
          return;
        }
        const id = normalizeExpression(match[2]?.trim() || character.defaultExpression);
        if ([expression.expression, ...expression.aliases].some((alias) => normalizeExpression(alias) === id)) count++;
      },
    });
  }
  return count;
}

export type PendingCharacterImage = { character: CharacterDraft; expression: ExpressionDraft; filename: string; data: number[] };
export type CharacterSnapshot = { text: string; baseline: string; readonly: boolean };
export type CharacterSave = { baseline: string; cleanupErrors: string[] };
export type CharacterStorage = {
  read(): Promise<CharacterSnapshot>;
  documents(): Promise<{ text: string }[]>;
  imageBaseline(path: string): Promise<string | null>;
  save(request: {
    text: string;
    baseline: string;
    images: { path: string; data: number[]; baseline: string | null }[];
    removedImages: string[];
  }): Promise<CharacterSave>;
};
// 画面も将来のMCPも、この処理へ保存を渡す。入出力だけを呼び出し元で差し替える。
export function createCharacterManager(storage: CharacterStorage) {
  return {
    async load() {
      const snapshot = await storage.read();
      return { snapshot, characters: readCharacterConfig(snapshot.text).characters };
    },
    async usage(character: CharacterDraft, expression?: ExpressionDraft) {
      return countCharacterUsage(await storage.documents(), character, expression);
    },
    async save(
      snapshot: CharacterSnapshot,
      characters: CharacterDraft[],
      pending: PendingCharacterImage[],
      confirmOverwrite: (path: string) => Promise<boolean>,
    ) {
      const copy = characters.map((character) => ({
        ...character,
        defaultExpression: normalizeExpression(character.defaultExpression),
        expressions: character.expressions.map((item) => ({ ...item, aliases: [...item.aliases] })),
      }));
      const images: { path: string; data: number[]; baseline: string | null }[] = [];
      const issues = validateCharacters(copy);
      for (const image of pending) {
        const c = characters.indexOf(image.character),
          e = image.character.expressions.indexOf(image.expression);
        if (c < 0 || e < 0) continue;
        try {
          copy[c].expressions[e].src = characterImagePath(image.character.key, image.expression.expression, image.filename);
        } catch (reason) {
          issues.push({ character: c, expression: e, field: 'src', message: reason instanceof Error ? reason.message : String(reason) });
        }
      }
      if (issues.length) return { issues };
      const text = writeCharacterConfig(snapshot.text, copy);
      for (const image of pending) {
        const c = characters.indexOf(image.character),
          e = image.character.expressions.indexOf(image.expression);
        if (c < 0 || e < 0) continue;
        const path = publicImagePath(copy[c].expressions[e].src)!;
        if (images.some((item) => item.path === path)) throw Error('画像の保存先が重複しています。');
        const baseline = await storage.imageBaseline(path);
        if (baseline !== null && !(await confirmOverwrite(path))) return { cancelled: true };
        images.push({ path, data: image.data, baseline });
      }
      const result = await storage.save({
        text,
        baseline: snapshot.baseline,
        images,
        removedImages: unusedCharacterImages(readCharacterConfig(snapshot.text).characters, copy),
      });
      return { snapshot: { ...snapshot, text, baseline: result.baseline }, characters: copy, cleanupErrors: result.cleanupErrors };
    },
  };
}
