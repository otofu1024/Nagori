import { frontMatter, markdownParser, walk, type Span } from './markdown.ts';

export type BlockKind = 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'ordered' | 'task' | 'quote' | 'table' | 'rule';
export type BlockPlan = { changes: { from: number; to: number; insert: string }[]; selection?: Span };
type Line = Span & { text: string; end: number };

function lines(text: string): Line[] {
  return [...text.matchAll(/([^\r\n]*)(\r\n|\n|$)/g)]
    .filter(match => match.index < text.length || match.index === 0 || /\n$/.test(text))
    .map(match => ({ from: match.index, to: match.index + match[1].length, end: match.index + match[0].length, text: match[1] }));
}
function selectedLines(all: Line[], selection: Span) {
  const at = (pos: number) => all.findIndex(line => pos < line.end || line.end === line.to && pos === line.to);
  return all.slice(at(selection.from), at(selection.to > selection.from ? selection.to - 1 : selection.to) + 1);
}
function overlaps(span: Span, line: Line) { return span.from <= line.to && span.to > line.from; }

// 選択が触れる行全体で判定する。記号の直前や行末でも保護する
export function blockAvailability(text: string, selection: Span): { block: boolean; heading: boolean } {
  const selected = selectedLines(lines(text), selection), front = frontMatter(text);
  let block = !front || !selected.some(line => overlaps(front, line)), heading = true;
  walk(markdownParser.parse(text).topNode, node => {
    if (!selected.some(line => overlaps(node, line))) return false;
    if (/^(?:FencedCode|CodeBlock|MathBlock|MathUnclosed|DisplayMath)$/.test(node.name)) block = false;
    if (/^(?:BulletList|OrderedList|Blockquote|Table)$/.test(node.name)) heading = false;
  });
  return { block, heading: block && heading };
}

const listMarker = /^(?:[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/;
const marker = { bullet: /^[-+*][ \t]+(?![ \t]|\[[ xX]\][ \t]+)/, ordered: /^\d+[.)][ \t]+/, task: /^[-+*][ \t]+\[[ xX]\][ \t]+/, quote: /^>[ \t]?/ };

export function blockEdit(text: string, selection: Span & { head?: number }, kind: BlockKind): BlockPlan | null {
  const availability = blockAvailability(text, selection);
  const heading = kind.startsWith('heading') || kind === 'paragraph';
  if (!availability.block || heading && !availability.heading) return null;
  const all = lines(text), selected = selectedLines(all, selection);
  if (kind === 'table' || kind === 'rule') {
    const line = selectedLines(all, { from: selection.head ?? selection.to, to: selection.head ?? selection.to })[0];
    const next = all[all.indexOf(line) + 1], newline = text.includes('\r\n') ? '\r\n' : '\n';
    const before = newline + (line.text.trim() ? newline : '');
    const content = kind === 'rule' ? '---' : ['| 列1 | 列2 | 列3 |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |'].join(newline);
    const after = next ? (next.text.trim() ? newline : '') : newline + newline;
    const insert = before + content + after, from = line.to;
    const cursor = from + before.length + (kind === 'table' ? 2 : content.length);
    return { changes: [{ from, to: from, insert }], selection: { from: cursor, to: cursor + (kind === 'table' ? 2 : 0) } };
  }
  const nonempty = selected.filter(line => line.text.trim());
  const toggle = !heading && nonempty.length > 0 && nonempty.every(line => marker[kind as keyof typeof marker].test(line.text.trimStart()));
  let number = 0;
  const changes: BlockPlan['changes'] = [];
  for (const line of selected) {
    const indent = /^[ \t]*/.exec(line.text)![0], body = line.text.slice(indent.length);
    let insert: string;
    if (heading) {
      let content = body.replace(/^#{1,6}(?:[ \t]+|$)/, '');
      if (kind === 'paragraph' && content !== body) content = content.replace(/[ \t]+#+[ \t]*$/, '');
      insert = indent + (kind === 'paragraph' ? '' : '#'.repeat(Number(kind.at(-1))) + ' ') + content;
    } else {
      if (!body.trim()) continue;
      const content = body.replace(kind === 'quote' ? marker.quote : listMarker, '');
      const prefix = toggle ? '' : kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : kind === 'quote' ? '> ' : `${++number}. `;
      insert = indent + prefix + content;
    }
    if (insert !== line.text) changes.push({ from: line.from, to: line.to, insert });
  }
  return { changes };
}
