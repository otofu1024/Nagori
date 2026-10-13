import { typescriptLanguage } from '@codemirror/lang-javascript';
import type { SyntaxNode } from '@lezer/common';

export type BlogExpression = { expression: string; label: string; src: string };
export type BlogCharacter = { name: string; defaultExpression: string; lookup: Record<string, BlogExpression> };
export type BlogCharacters = Record<string, BlogCharacter>;
export const normalizeExpression = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[!！?？]+$/, '');
function children(node: SyntaxNode) {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}
function string(source: string, node: SyntaxNode): string {
  const text = source.slice(node.from, node.to);
  if (node.name === 'PropertyDefinition') return text;
  if (node.name !== 'String') throw Error('文字列ではありません');
  return JSON.parse(
    text[0] === "'"
      ? '"' +
          text
            .slice(1, -1)
            .replace(/\\'/g, "'")
            .replace(/(?<!\\)"/g, '\\"') +
          '"'
      : text,
  );
}
function literal(source: string, node: SyntaxNode): unknown {
  if (node.name === 'String') return string(source, node);
  const parts = children(node).filter((part) => !['{', '}', '[', ']', ',', 'LineComment', 'BlockComment'].includes(part.name));
  if (node.name === 'ArrayExpression') return parts.map((part) => literal(source, part));
  if (node.name !== 'ObjectExpression') throw Error('直接書かれたオブジェクトではありません');
  const object: Record<string, unknown> = Object.create(null);
  for (const part of parts) {
    const fields = children(part);
    if (part.name !== 'Property' || fields.length !== 3 || fields[1].name !== ':') throw Error('読めないプロパティです');
    const key = string(source, fields[0]);
    if (Object.hasOwn(object, key)) throw Error('キーが重複しています');
    object[key] = literal(source, fields[2]);
  }
  return object;
}
// TypeScriptは実行せず、CHARACTERSに直接書かれたオブジェクト、文字列、別名の配列だけを読む。
export function readBlogCharacters(source: string | null): BlogCharacters | null {
  if (!source) return null;
  try {
    let value: SyntaxNode | null = null;
    let invalid = false;
    typescriptLanguage.parser.parse(source).iterate({
      enter(node) {
        if (node.type.isError) invalid = true;
        if (node.name !== 'VariableDeclaration') return;
        const parts = children(node.node);
        if (!parts.some((part) => part.name === 'VariableDefinition' && source.slice(part.from, part.to) === 'CHARACTERS')) return;
        const assigned = parts[parts.findIndex((part) => part.name === 'Equals') + 1];
        if (value) throw Error('CHARACTERSが重複しています');
        value =
          assigned?.name === 'ObjectExpression' ? assigned : assigned?.firstChild?.name === 'ObjectExpression' ? assigned.firstChild : null;
      },
    });
    if (invalid || !value) return null;
    const object = literal(source, value) as Record<
      string,
      { name: string; defaultExpression: string; expressions: Record<string, { src: string; label: string; aliases?: string[] }> }
    >;
    const table: BlogCharacters = Object.create(null);
    for (const [rawKey, character] of Object.entries(object)) {
      const key = rawKey.toUpperCase();
      if (!/^[A-Za-z0-9_-]+$/.test(rawKey) || ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].includes(key)) return null;
      if (
        typeof character.name !== 'string' ||
        typeof character.defaultExpression !== 'string' ||
        !character.expressions ||
        Array.isArray(character.expressions)
      )
        return null;
      const lookup: Record<string, BlogExpression> = Object.create(null);
      for (const [expression, item] of Object.entries(character.expressions)) {
        if (typeof item.src !== 'string' || typeof item.label !== 'string' || (item.aliases !== undefined && !Array.isArray(item.aliases)))
          return null;
        for (const alias of [expression, ...(item.aliases ?? [])]) {
          if (typeof alias !== 'string') return null;
          const id = normalizeExpression(alias);
          if (Object.hasOwn(lookup, id)) return null;
          lookup[id] = { expression, label: item.label, src: item.src };
        }
      }
      table[key] = { name: character.name, defaultExpression: character.defaultExpression, lookup };
    }
    return table;
  } catch {
    return null;
  }
}
export function talkMarker(text: string, characters: BlogCharacters | null | undefined) {
  const match = /^\[!([A-Za-z0-9_-]+)(?:[ 　]+([^\]\n]*))?\][ \t]*(?:\n|$)/.exec(text);
  const character = match && characters?.[match[1].toUpperCase()];
  if (!character || !match) return null;
  const expression = character.lookup[match[2]?.trim() ? normalizeExpression(match[2]) : character.defaultExpression];
  return expression ? { key: match[1].toUpperCase(), character, expression, body: text.slice(match[0].length) } : null;
}
