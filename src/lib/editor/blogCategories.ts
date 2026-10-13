import { typescriptLanguage } from '@codemirror/lang-javascript';
import type { SyntaxNode } from '@lezer/common';

export type BlogCategory = { key: string; label: string };
function children(node: SyntaxNode) {
  const nodes: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) nodes.push(child);
  return nodes;
}
function literal(source: string, node: SyntaxNode | null): string | null {
  if (!node || !['String', 'PropertyDefinition'].includes(node.name)) return null;
  const text = source.slice(node.from, node.to);
  if (node.name === 'PropertyDefinition') return text;
  try {
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
  } catch {
    return null;
  }
}
// 設定ファイルを実行せず、CATEGORIESのオブジェクトに直接書かれたキーと表示名だけを読む。
export function readBlogCategories(source: string | null): BlogCategory[] | null {
  if (!source) return null;
  const tree = typescriptLanguage.parser.parse(source);
  let object: SyntaxNode | null = null;
  let invalid = false;
  tree.iterate({
    enter(node) {
      if (node.type.isError) invalid = true;
      if (node.name !== 'VariableDeclaration') return;
      const parts = children(node.node);
      if (!parts.some((part) => part.name === 'VariableDefinition' && source.slice(part.from, part.to) === 'CATEGORIES')) return;
      const value = parts[parts.findIndex((part) => part.name === 'Equals') + 1];
      object = value?.name === 'ObjectExpression' ? value : value?.firstChild?.name === 'ObjectExpression' ? value.firstChild : null;
    },
  });
  if (invalid || !object) return null;
  const categories: BlogCategory[] = [];
  for (const property of children(object)) {
    if (['{', '}', ','].includes(property.name)) continue;
    const key = literal(source, property.firstChild);
    const value = property.getChild('ObjectExpression');
    const labelNode = value && children(value).find((part) => part.name === 'Property' && literal(source, part.firstChild) === 'label');
    const label = labelNode ? literal(source, labelNode.getChild('String')) : null;
    if (key === null || label === null || categories.some((category) => category.key === key)) return null;
    categories.push({ key, label });
  }
  return categories.length ? categories : null;
}
