import { frontMatter, markdownParser, walk, type Span } from './markdown.ts';

export type BlockKind = 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'ordered' | 'task' | 'quote' | 'table' | 'rule';
export type BlockPlan = { changes: { from: number; to: number; insert: string }[]; selection: Span };
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

// 右クリックした位置の行で判定する。記号を入れる行がコード・数式・Front Matterの中なら使えない
export function blockAvailability(text: string, position: number): { block: boolean; heading: boolean } {
  const selected = selectedLines(lines(text), { from: position, to: position }), front = frontMatter(text);
  let block = !front || !selected.some(line => overlaps(front, line)), heading = true;
  walk(markdownParser.parse(text).topNode, node => {
    if (!selected.some(line => overlaps(node, line))) return false;
    if (/^(?:FencedCode|CodeBlock|MathBlock|MathUnclosed|DisplayMath)$/.test(node.name)) block = false;
    if (/^(?:BulletList|OrderedList|Blockquote|Table)$/.test(node.name)) heading = false;
  });
  return { block, heading: block && heading };
}

const markers = { heading1: '# ', heading2: '## ', heading3: '### ', bullet: '- ', ordered: '1. ', task: '- [ ] ', quote: '> ' } as const;

// 右クリックした位置に記号を入れる。選択範囲の文字は書き換えず、挿入位置は position とする
export function blockEdit(text: string, position: number, kind: BlockKind): BlockPlan | null {
  const availability = blockAvailability(text, position);
  if (!availability.block || kind.startsWith('heading') && !availability.heading) return null;
  const all = lines(text), line = selectedLines(all, { from: position, to: position })[0];
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const head = line.text.slice(0, position - line.from), tail = line.text.slice(position - line.from);
  if (kind === 'table' || kind === 'rule') {
    const index = all.indexOf(line), prev = all[index - 1], next = all[index + 1];
    const content = kind === 'rule' ? '---' : ['| 列1 | 列2 | 列3 |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |'].join(newline);
    // 行の途中なら前後の文字と分けるために空行を入れ、行頭・行末なら前後の段落との間に空行を入れる
    const lead = head.trim() ? head + newline.repeat(2) : head;
    const trail = tail.trim() ? newline.repeat(2) + tail : tail;
    const before = !head.trim() && prev?.text.trim() ? newline : '';
    const after = !tail.trim() && next?.text.trim() ? newline : '';
    const start = line.from + before.length + lead.length;
    const cursor = start + (kind === 'table' ? 2 : content.length);
    return { changes: [{ from: line.from, to: line.to, insert: before + lead + content + trail + after }], selection: { from: cursor, to: kind === 'table' ? cursor + 2 : cursor } };
  }
  const marker = markers[kind];
  // 行頭・空行ならその位置に記号を置く。行の途中なら改行してから記号を置く
  const insert = head.trim() ? newline + marker : marker;
  const cursor = position + insert.length;
  return { changes: [{ from: position, to: position, insert }], selection: { from: cursor, to: cursor } };
}
