import type { SyntaxNode, Tree } from '@lezer/common';
import type { FormatKind } from './editor.ts';
import { children, frontMatter, intersects, walk, markdownParser, parseChanged, type Span } from './markdown.ts';
import { inlineContent, linkTarget, references } from './markdownInline.ts';

const formatNode = { bold: 'StrongEmphasis', italic: 'Emphasis', strike: 'Strikethrough', code: 'InlineCode', link: 'Link' };
const decorated = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link', 'Image']);
export type FormatPlan = {
  reason?: string;
  from: number;
  to: number;
  text: string;
  selection: Span;
  changes?: { from: number; to: number; insert: string }[];
  existingLink?: string;
  linkText?: string;
};
// treeを渡すと、変更後の本文もその木からの差分解析で確かめる(表示用)。省略すると全文解析で確かめる(本文を変える時用)
export function formatPlan(text: string, selection: Span, kind: FormatKind, given?: Tree): FormatPlan {
  const tree = given ?? markdownParser.parse(text);
  if (kind === 'link' || selection.from === selection.to) return singleFormatPlan(text, selection, kind, tree, given);
  const spans: Span[] = [],
    formats: SyntaxNode[] = [],
    front = frontMatter(text);
  walk(tree.topNode, (node) => {
    if (!intersects(node, selection) && node.name !== 'Document') return false;
    if (front && intersects(front, node) && node.name !== 'Document') return false;
    if (/^(?:FencedCode|CodeBlock|HTMLBlock|Table|LinkReference|MathBlock|MathUnclosed)$/.test(node.name)) return false;
    if (decorated.has(node.name)) formats.push(node);
    if (!(node.name === 'Paragraph' || node.name === 'Task' || /^(?:ATXHeading|SetextHeading)/.test(node.name))) return;
    // 見出し・タスク・引用の記号を除き、本文の区間だけを取り出す
    const marks: SyntaxNode[] = [];
    walk(node, (n) => {
      if (/^(?:HeaderMark|TaskMarker|QuoteMark)$/.test(n.name)) marks.push(n);
    });
    let at = node.from;
    // 段落の先頭の字下げを含む選択は、従来どおり空白ごとコードにできる
    if (node.name === 'Paragraph' && selection.from < at && /^[ \t]{0,3}$/.test(text.slice(selection.from, at))) at = selection.from;
    const start = at;
    for (const mark of [...marks, { from: node.to, to: node.to }]) {
      let from = Math.max(at, selection.from),
        to = Math.min(mark.from, selection.to);
      if (at !== start) while (from < to && /[ \t]/.test(text[from])) from++;
      if (mark.from !== node.to) while (to > from && /\s/.test(text[to - 1])) to--;
      if (kind === 'code') {
        // Inline Codeは段落内でも行ごとに扱う
        for (const line of text.slice(from, to).split('\n')) {
          const end = from + line.replace(/\r$/, '').length;
          if (from < end) spans.push({ from, to: end });
          from += line.length + 1;
        }
      } else {
        while (from < to && /\s/.test(text[from])) from++;
        while (to > from && /\s/.test(text[to - 1])) to--;
        if (from < to) spans.push({ from, to });
      }
      at = mark.to;
    }
  });
  const enclosed = spans.map((span) => formats.some((n) => n.name === formatNode[kind] && n.from <= span.from && n.to >= span.to));
  const plans = spans.map((span) => singleFormatPlan(text, span, kind, tree, given));
  // 飛ばす区間は付け外しの判定に含めない。混在時だけ装飾済みの区間を付け直す
  if (plans.some((plan, i) => !plan.reason && !enclosed[i])) {
    for (let i = 0; i < plans.length; i++)
      if (!plans[i].reason && enclosed[i]) plans[i] = singleFormatPlan(text, spans[i], kind, tree, given, true);
  }
  const usable: FormatPlan[] = [];
  for (const plan of plans) {
    if (!plan.reason && !usable.some((p) => intersects(p, plan))) usable.push(plan);
  }
  if (!usable.length) {
    const denied = plans.find((p) => p.reason) ?? singleFormatPlan(text, selection, kind, tree, given);
    return denied.reason ? denied : { ...denied, reason: 'テキストを選択してください', text: '' };
  }
  if (usable.length === 1) return usable[0];
  const changes = usable.map((p) => ({ from: p.from, to: p.to, insert: p.text }));
  const first = usable[0],
    last = usable.at(-1)!;
  let insert = '',
    at = first.from,
    offset = 0;
  for (const plan of usable) {
    insert += text.slice(at, plan.from) + plan.text;
    at = plan.to;
    if (plan !== last) offset += plan.text.length - (plan.to - plan.from);
  }
  return {
    from: first.from,
    to: last.to,
    text: insert,
    changes,
    selection: { from: first.selection.from, to: last.selection.to + offset },
  };
}
function singleFormatPlan(text: string, selection: Span, kind: FormatKind, tree: Tree, given?: Tree, forceApply = false): FormatPlan {
  // 太字・斜体・取り消し線では、選択範囲の前後の空白を外してから付ける(記号の内側に空白があると装飾にならないため)
  if (kind === 'bold' || kind === 'italic' || kind === 'strike') {
    let { from, to } = selection;
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    if (from < to) selection = { from, to };
  }
  const denied = (reason: string): FormatPlan => ({ reason, ...selection, text: '', selection });
  if (selection.from === selection.to) return denied('テキストを選択してください');
  const front = frontMatter(text);
  if (front && intersects(front, selection)) return denied('Front Matterはソースのまま編集してください');
  const nodes: SyntaxNode[] = [];
  walk(tree.topNode, (node) => {
    if (intersects(node, selection)) nodes.push(node);
    else if (node.name !== 'Document') return false;
  });
  if (nodes.some((n) => /^(?:InlineMath|DisplayMath|MathBlock|MathUnclosed)$/.test(n.name)))
    return denied('数式は元のLaTeX記法で編集してください');
  if (nodes.some((n) => n.name === 'TaskMarker')) return denied('チェック記号を除いて選択してください');
  if (nodes.some((n) => /^(?:FencedCode|CodeBlock|HTMLBlock|HTMLTag|Table|LinkReference)$/.test(n.name)))
    return denied('コード・表・HTML・参照定義内には適用できません');
  const blocks = nodes.filter((n) => n.name === 'Paragraph' || n.name === 'Task' || /^(?:ATXHeading|SetextHeading)/.test(n.name));
  if (
    blocks.length !== 1 ||
    selection.to > blocks[0].to ||
    (selection.from < blocks[0].from && !/^[ \t]{0,3}$/.test(text.slice(selection.from, blocks[0].from)))
  )
    return denied('単一段落内を選択してください');
  const formats = nodes.filter((n) => decorated.has(n.name));
  const block = blocks[0],
    name = formatNode[kind];
  if (kind === 'link') {
    // リンクは入力欄で表示テキストとURLを扱うため、装飾をまたぐ選択は従来どおり止める
    const target = formats.find(
      (n) =>
        n.name === 'Link' &&
        ((selection.from === n.from && selection.to === n.to) ||
          (selection.from === inlineContent(n).from && selection.to === inlineContent(n).to)),
    );
    if (target && formats.length === 1) {
      const content = inlineContent(target),
        plain = text.slice(content.from, content.to);
      return {
        from: target.from,
        to: target.to,
        text: plain,
        selection: { from: target.from, to: target.from + plain.length },
        existingLink: linkTarget(target, text, references(tree, text)) ?? '',
        linkText: plain,
      };
    }
    if (formats.length) return denied('装飾境界をまたぐ選択や混在した装飾は変更できません');
    const plain = text.slice(selection.from, selection.to);
    return { ...selection, text: plain, selection, linkText: plain };
  }
  // 同じ装飾の中だけを選んだ時は、その装飾を外す
  const enclosing = formats.filter((n) => n.name === name && n.from <= selection.from && n.to >= selection.to).at(-1);
  if (enclosing && !forceApply) {
    const content = inlineContent(enclosing);
    let plain = text.slice(content.from, content.to);
    if (kind === 'code' && plain.startsWith(' ') && plain.endsWith(' ') && /\S/.test(plain)) plain = plain.slice(1, -1);
    return { from: enclosing.from, to: enclosing.to, text: plain, selection: { from: enclosing.from, to: enclosing.from + plain.length } };
  }
  // 選択範囲にかかる同じ装飾を取り込んで範囲を広げる。広げた先でまた同じ装飾にかかれば繰り返す
  let from = selection.from,
    to = selection.to;
  const sameIn = () => {
    const found: SyntaxNode[] = [];
    walk(block, (n) => {
      if (n.name === name && n.from < to && n.to > from) found.push(n);
    });
    return found;
  };
  for (let grown = true; grown;) {
    grown = false;
    for (const n of sameIn())
      if (n.from < from || n.to > to) {
        from = Math.min(from, n.from);
        to = Math.max(to, n.to);
        grown = true;
      }
  }
  const same = sameIn();
  // ほかの種類の装飾は、範囲の中に丸ごと入るか、範囲を丸ごと含む時だけ残して付ける
  const others: SyntaxNode[] = [];
  walk(block, (n) => {
    if (decorated.has(n.name) && n.name !== name && n.from < to && n.to > from) others.push(n);
  });
  if (others.some((n) => !(n.from >= from && n.to <= to) && !(n.from <= from && n.to >= to)))
    return denied('ほかの装飾の境界をまたぐ選択には適用できません');
  if (kind === 'code' && others.some((n) => n.from >= from && n.to <= to)) return denied('装飾を含む範囲はInline Codeにできません');
  // 取り込んだ同じ装飾の記号を外した本文を作る
  const marks = same
    .flatMap((n) => children(n).filter((c) => /^(?:EmphasisMark|StrikethroughMark|CodeMark)$/.test(c.name)))
    .sort((a, b) => a.from - b.from);
  let plain = '',
    at = from;
  for (const mark of marks) {
    plain += text.slice(at, mark.from);
    at = mark.to;
  }
  plain += text.slice(at, to);
  if (kind === 'code') {
    if (plain.includes('\n')) return denied('Inline Codeは単一行だけに適用できます');
    const runs = [...plain.matchAll(/`+/g)].map((m) => m[0].length),
      delimiter = '`'.repeat(Math.max(0, ...runs) + 1);
    const padding =
      plain.startsWith('`') || plain.endsWith('`') || (plain.startsWith(' ') && plain.endsWith(' ') && /\S/.test(plain)) ? ' ' : '';
    const insert = delimiter + padding + plain + padding + delimiter;
    return {
      from,
      to,
      text: insert,
      selection: { from: from + delimiter.length + padding.length, to: from + delimiter.length + padding.length + plain.length },
    };
  }
  if (!plain.trim() || /^\s|\s$/.test(plain)) return denied('装飾する文字の前後の空白を除いて選択してください');
  const delimiter = kind === 'bold' ? '**' : kind === 'italic' ? '*' : '~~';
  const insert = delimiter + plain + delimiter;
  // 周囲の記号と結び付いて、意図した装飾にならない場合は止める
  const changed = text.slice(0, from) + insert + text.slice(to);
  let valid = false;
  const checked = given
    ? parseChanged(given, changed, [{ fromA: from, toA: to, fromB: from, toB: from + insert.length }])
    : markdownParser.parse(changed);
  walk(checked.topNode, (n) => {
    if (n.name === name && n.from === from && n.to === from + insert.length) valid = true;
  });
  if (!valid) return denied('周囲のMarkdown記号と衝突するため適用できません');
  return { from, to, text: insert, selection: { from: from + delimiter.length, to: from + delimiter.length + plain.length } };
}
