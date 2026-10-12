import { isMap, isScalar, isSeq, parseDocument, Scalar, type Node } from 'yaml';

export type TextChange = { from: number; to: number; insert: string };
function document(text: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
  if (!opening) throw new Error('先頭にFront Matterがありません。本文で---の区切りを追加してください。');
  const closing = /^---[ \t]*\r?$/m.exec(text.slice(opening[0].length));
  if (!closing) throw new Error('Front Matterを閉じる---がありません。');
  const start = opening[0].length,
    end = start + closing.index;
  const source = text.slice(start, end),
    doc = parseDocument(source, { keepSourceTokens: true });
  if (doc.errors.length) throw new Error('Front MatterのYAMLを読めません: ' + doc.errors[0].message);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error('Front Matterには項目名と値を記述してください。');
  const closingEnd = end + closing[0].length;
  return {
    start,
    end,
    bodyFrom: closingEnd + (text[closingEnd] === '\n' ? 1 : 0),
    source,
    doc,
    newline: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

export type Property = { key: string; value: unknown; editable: boolean; source: string };
export function readProperties(text: string): { properties: Property[]; bodyFrom: number } | null {
  try {
    const { doc, bodyFrom, source } = document(text);
    const values = doc.toJS({ maxAliasCount: 50 }) ?? {};
    const properties = isMap(doc.contents)
      ? doc.contents.items.map((pair) => {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('項目名は文字列で入力してください。');
          const key = pair.key.value,
            node = pair.value,
            value = values[key];
          const editable =
            (isScalar(node) &&
              !node.anchor &&
              (typeof value === 'string' ||
                typeof value === 'boolean' ||
                (typeof value === 'number' && Number.isFinite(value)) ||
                value === null)) ||
            (isSeq(node) && !node.anchor && node.items.every((item) => isScalar(item) && !item.anchor && typeof item.value === 'string'));
          return { key, value, editable, source: node?.range ? source.slice(node.range[0], node.range[1]) : '' };
        })
      : [];
    return { properties, bodyFrom };
  } catch {
    return null;
  }
}

function scalarText(value: string | boolean | number, previous?: Node | null): string {
  if (typeof value !== 'string') return String(value);
  if (isScalar(previous) && previous.type === Scalar.QUOTE_SINGLE && !value.includes('\n')) return "'" + value.replaceAll("'", "''") + "'";
  if (isScalar(previous) && previous.type === Scalar.QUOTE_DOUBLE) return JSON.stringify(value);
  // YAMLとして別の型になる文字列や、改行を含む文字列は引用符で囲む。
  const parsed = parseDocument(value);
  return value && !/[\r\n]/.test(value) && !parsed.errors.length && isScalar(parsed.contents) && parsed.contents.value === value
    ? value
    : JSON.stringify(value);
}

export function patchFrontMatter(text: string, key: string, value: string | string[] | boolean | number | undefined): TextChange[] {
  const read = readProperties(text);
  if (!read) throw new Error('Front MatterのYAMLを読めません。本文で編集してください。');
  const previous = read.properties.find((property) => property.key === key);
  if (previous && !previous.editable) throw new Error('この項目は本文で編集してください。');
  if (previous && JSON.stringify(previous.value) === JSON.stringify(value)) return [];
  if (!key.trim() || /[\r\n]/.test(key)) throw new Error('項目名を1行で入力してください。');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('有限の数字を入力してください。');
  const { start, end, source, doc, newline } = document(text);
  const pair = isMap(doc.contents) ? doc.contents.items.find((pair) => isScalar(pair.key) && pair.key.value === key) : undefined;
  const node = pair?.value;
  const changes: TextChange[] = [];
  const change = (from: number, to: number, insert: string) => changes.push({ from: start + from, to: start + to, insert });
  const encoded = Array.isArray(value)
    ? '[' + value.map((item, i) => scalarText(item, isSeq(node) ? (node.items[i] as Node | null) : undefined)).join(', ') + ']'
    : value === undefined
      ? ''
      : scalarText(value, node as Node | null);
  if (!pair) {
    if (value !== undefined) {
      if (isMap(doc.contents) && doc.contents.flow) throw new Error('フロー形式のFront Matterへの項目追加は本文で編集してください。');
      changes.push({ from: end, to: end, insert: `${scalarText(key)}: ${encoded}${newline}` });
    }
    return changes;
  }
  if (!isScalar(pair.key) || !pair.key.range || (node && !isScalar(node) && !isSeq(node)))
    throw new Error('この項目のYAMLは設定欄から書き換えられません。本文で編集してください。');
  if ((node && 'anchor' in node && node.anchor) || (isSeq(node) && node.items.some((item) => !isScalar(item) || item.anchor)))
    throw new Error('アンカー付きの項目は本文で編集してください。');
  if (value === undefined) {
    if (isMap(doc.contents) && doc.contents.flow) throw new Error('フロー形式のFront Matterからの項目削除は本文で編集してください。');
    // 値の行だけを取り除き、コメント行と後続の項目は残す。
    const from = source.lastIndexOf('\n', pair.key.range[0] - 1) + 1;
    const to = node?.range?.[2] ?? source.indexOf('\n', pair.key.range[1]) + 1;
    const removed = source.slice(from, to);
    const comments = removed.split(/\r?\n/).filter((line) => /^\s*#/.test(line));
    if (isScalar(node) && node.comment) comments.unshift('#' + node.comment);
    change(from, to, comments.length ? comments.join(newline) + newline : '');
  } else if (isSeq(node) && Array.isArray(value) && node.items.length === value.length && node.items.every(isScalar)) {
    node.items.forEach((item, i) => {
      if (isScalar(item) && item.range && item.value !== value[i]) change(item.range[0], item.range[1], scalarText(value[i], item));
    });
  } else if (isSeq(node) && Array.isArray(value) && !node.flow && value.length) {
    node.items.forEach((item, i) => {
      if (!isScalar(item) || !item.range) return;
      if (i < value.length) {
        if (item.value !== value[i]) change(item.range[0], item.range[1], scalarText(value[i], item));
      } else {
        const from = source.lastIndexOf('\n', item.range[0] - 1) + 1;
        const indent = /^\s*/.exec(source.slice(from, item.range[0]))![0];
        change(from, item.range[2], item.comment ? indent + '#' + item.comment + newline : '');
      }
    });
    if (value.length > node.items.length) {
      const indent = /^\s*/.exec(source.slice(source.lastIndexOf('\n', node.range![0] - 1) + 1, node.range![0]))![0];
      change(
        node.range![2],
        node.range![2],
        value
          .slice(node.items.length)
          .map((item) => indent + '- ' + scalarText(item) + newline)
          .join(''),
      );
    }
  } else if (isSeq(node) && Array.isArray(value) && !node.flow) {
    const from = pair.key.range[1] + 1;
    const to = node.range![2];
    const original = source.slice(from, to);
    const comments = original.split(/\r?\n/).filter((line) => /^\s*#/.test(line));
    // 要素数が変わった時も、削った要素のコメントは独立した行に残す。
    for (const item of node.items) if (isScalar(item) && item.comment) comments.push('  #' + item.comment);
    const lines = value.map((item, i) => `  - ${scalarText(item, node.items[i] as Node | null)}`);
    change(
      from,
      to,
      value.length
        ? newline + [...comments, ...lines].join(newline) + newline
        : ' []' + newline + (comments.length ? comments.join(newline) + newline : ''),
    );
  } else if (isSeq(node) && node.range && Array.isArray(value)) {
    const comments: string[] = [];
    const collect = (token: unknown) => {
      if (!token || typeof token !== 'object') return;
      if ('type' in token && token.type === 'comment' && 'source' in token && 'offset' in token && Number(token.offset) < node.range![1])
        comments.push(String(token.source));
      else
        for (const child of Object.values(token))
          if (Array.isArray(child)) child.forEach(collect);
          else collect(child);
    };
    collect(node.srcToken);
    change(
      node.range[0],
      node.range[2],
      encoded + source.slice(node.range[1], node.range[2]) + (comments.length ? comments.join(newline) + newline : ''),
    );
  } else if (isScalar(node) && node.range && (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED)) {
    const headerEnd = source.indexOf('\n', node.range[0]);
    const header = source.slice(node.range[0], headerEnd).replace(/\r$/, '');
    const comment = /[ \t]+#.*$/.exec(header)?.[0] ?? '';
    change(node.range[0], node.range[1], encoded + comment + newline);
  } else if (isScalar(node) && node.value === null && node.range?.[0] === node.range?.[1]) {
    change(pair.key.range[1] + 1, pair.key.range[1] + 1, ' ' + encoded);
  } else if (node?.range) {
    change(node.range[0], node.range[1], encoded);
  } else {
    change(pair.key.range[1] + 1, pair.key.range[1] + 1, ' ' + encoded);
  }
  const updated = changes.reduceRight((result, edit) => result.slice(0, edit.from) + edit.insert + result.slice(edit.to), text);
  const check = readProperties(updated);
  if (!check || JSON.stringify(check.properties.find((property) => property.key === key)?.value) !== JSON.stringify(value))
    throw new Error('コメントを保ったまま書き換えられません。本文で編集してください。');
  return changes;
}
