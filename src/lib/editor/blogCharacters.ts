import { readCharacterConfig, validateCharacters, normalizeExpression } from '../workspace/blogCharacterManager.ts';
export { normalizeExpression } from '../workspace/blogCharacterManager.ts';
export type BlogExpression = { expression: string; label: string; src: string };
export type BlogCharacter = { name: string; defaultExpression: string; lookup: Record<string, BlogExpression> };
export type BlogCharacters = Record<string, BlogCharacter>;

export function readBlogCharacters(source: string | null): BlogCharacters | null {
  if (!source) return null;
  try {
    const { characters } = readCharacterConfig(source);
    if (validateCharacters(characters).length) return null;
    const table: BlogCharacters = Object.create(null);
    for (const character of characters) {
      const lookup: Record<string, BlogExpression> = Object.create(null);
      for (const item of character.expressions) {
        for (const alias of [item.expression, ...item.aliases]) lookup[normalizeExpression(alias)] = item;
      }
      table[character.key.toUpperCase()] = {
        name: character.name,
        defaultExpression: normalizeExpression(character.defaultExpression),
        lookup,
      };
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
