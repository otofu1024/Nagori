import type { Tree } from '@lezer/common';
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

// 右クリックした位置、または選択が触れる行で判定する。記号を入れる行がコード・数式・Front Matterの中なら使えない
function availabilityOf(text: string, selection: Span, given?: Tree): { block: boolean; heading: boolean; table: boolean } {
  const selected = selectedLines(lines(text), selection), front = frontMatter(text);
  let block = !front || !selected.some(line => overlaps(front, line)), heading = true, table = false;
  walk((given ?? markdownParser.parse(text)).topNode, node => {
    if (!selected.some(line => overlaps(node, line))) return false;
    if (/^(?:FencedCode|CodeBlock|MathBlock|MathUnclosed|DisplayMath)$/.test(node.name)) block = false;
    if (/^(?:BulletList|OrderedList|Blockquote|Table)$/.test(node.name)) heading = false;
    if (node.name === 'Table') table = true;
  });
  return { block, heading: block && heading, table };
}
export function blockAvailability(text: string, position: number | Span): { block: boolean; heading: boolean } {
  const { block, heading } = availabilityOf(text, typeof position === 'number' ? { from: position, to: position } : position);
  return { block, heading };
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

export type ListKind = 'bullet' | 'ordered';
// 行頭の記号。タスクの「[ ] 」は箇条書きの一種として、チェックの状態を残す
const itemMarker = /^(?:([-+*])(?:[ \t]+(\[[ xX]\]))?|(\d+)[.)])(?=[ \t]|$)[ \t]*/;
const headingMarker = /^#{1,6}(?=[ \t]|$)[ \t]*/;
const closingHashes = /[ \t]+#+[ \t]*$/;
const quoteMarker = /^(?:>[ \t]?)+/;

// 字下げの後ろの記号から、リストの種類を返す。タスクは箇条書きとして数える
function listType(text: string): ListKind | null {
  const marker = itemMarker.exec(text.replace(/^[ \t]*/, ''));
  return marker ? (marker[3] ? 'ordered' : 'bullet') : null;
}

// 選択が触れる行(空行を除く)を、箇条書きか番号付きリストにする。すでに全部その種類なら記号を外す。
// 見出しと引用は記号を外してからリストにし、表・コード・数式・Front Matterを含む時は変えない
export function listPlan(text: string, selection: Span, kind: ListKind, given?: Tree): BlockPlan | null {
  const availability = availabilityOf(text, selection, given);
  if (!availability.block || availability.table) return null;
  const targets = selectedLines(lines(text), selection).filter(line => line.text.trim());
  if (!targets.length) return null;
  const removing = targets.every(line => listType(line.text) === kind);
  const changes: BlockPlan['changes'] = [];
  let number = 0;
  for (const line of targets) {
    const indent = /^[ \t]*/.exec(line.text)![0];
    let body = line.text.slice(indent.length), insert: string;
    if (removing) {
      insert = indent + body.replace(itemMarker, '');
    } else {
      body = body.replace(quoteMarker, '');
      const heading = headingMarker.exec(body);
      if (heading) body = body.slice(heading[0].length).replace(closingHashes, '');
      const marker = itemMarker.exec(body);
      const check = marker?.[2];
      body = body.slice(marker?.[0].length ?? 0);
      // 番号付きは空行を除いて上から1から振る。箇条書きは元がタスクならチェックを残す
      const prefix = kind === 'ordered' ? `${++number}. ` : check ? `- ${check} ` : '- ';
      insert = indent + prefix + body;
    }
    if (insert !== line.text) changes.push({ from: line.from, to: line.to, insert });
  }
  if (!changes.length) return null;
  // 変換後は、触れていた行の全体を選ぶ。変更は選んだ行の中にだけ入るため、末尾の位置は変更量を足して求める
  const delta = changes.reduce((sum, change) => sum + change.insert.length - (change.to - change.from), 0);
  return { changes, selection: { from: targets[0].from, to: targets.at(-1)!.to + delta } };
}
