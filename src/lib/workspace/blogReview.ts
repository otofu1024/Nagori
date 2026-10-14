import { readProperties, patchFrontMatter, type TextChange } from './frontMatter.ts';

export type ReviewAi = 'agy' | 'claude' | 'codex';
export const reviewAis: { id: ReviewAi; label: string }[] = [
  { id: 'agy', label: 'Antigravity' }, { id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' },
];
export type ReviewFeature = 'review' | 'suggest';
export const reviewKinds = ['誤り', '表記ゆれ', '読みやすさ', 'つながり', '公開前の確認', '事実の確認'] as const;
export type ReviewIssue = { kind: typeof reviewKinds[number]; quote: string; replacement: string; reason: string };
export type ReviewResult = { issues?: ReviewIssue[]; descriptions?: string[]; tags?: string[]; titles?: string[] };
export type ReviewSnapshot = { text: string; from: number; to: number; dismissed?: readonly string[] };
export type ReviewSkills = { common: string; review: { instruction: string; schema: object }; suggest: { instruction: string; schema: object } };
export const reviewEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export function resolvedReviewAi(saved: unknown, available: ReviewAi[]): ReviewAi | null {
  return available.includes(saved as ReviewAi) ? saved as ReviewAi : reviewAis.find(ai => available.includes(ai.id))?.id ?? null;
}
function bodyStart(text: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
  const closing = opening && /^---[ \t]*\r?$/m.exec(text.slice(opening[0].length));
  if (!opening || !closing) return 0;
  const end = opening[0].length + closing.index + closing[0].length;
  return end + (text[end] === '\n' ? 1 : 0);
}
export function reviewRequest(snapshot: ReviewSnapshot, feature: ReviewFeature, skills: ReviewSkills, tags: string[] = []) {
  const bodyFrom = bodyStart(snapshot.text);
  const body = snapshot.text.slice(bodyFrom);
  if (!body.trim()) throw new Error('本文がありません。');
  const data = { body, frontMatter: snapshot.text.slice(0, bodyFrom), ...(feature === 'suggest' ? { existingTags: tags } : {}) };
  return { feature, schema: skills[feature].schema, prompt: skills.common + '\n' + skills[feature].instruction + '\n' + JSON.stringify(data) };
}

// AIの答えは、スキーマと同じ形と文字数を確かめてから表示する。
export function parseReviewResult(feature: ReviewFeature, input: unknown): ReviewResult {
  const fail = () => { throw new Error('AIの答えの形式が違います。'); };
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown, min = 0, max = 2 * 1024 * 1024): v is string => typeof v === 'string' && Array.from(v).length >= min && Array.from(v).length <= max;
  const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(key => key in v);
  const list = (v: unknown, min: number, max: number, length = 2 * 1024 * 1024): v is string[] => Array.isArray(v) && v.length >= min && v.length <= max && v.every(item => text(item, 1, length));
  if (!object(input)) return fail();
  if (feature === 'review' && keys(input, ['issues']) && Array.isArray(input.issues) && input.issues.length <= 100 && input.issues.every(issue =>
    object(issue) && keys(issue, ['kind', 'quote', 'replacement', 'reason']) && reviewKinds.includes(issue.kind as ReviewIssue['kind']) && text(issue.quote, 1) && text(issue.replacement) && text(issue.reason, 1))) return { issues: input.issues as ReviewIssue[] };
  if (feature === 'suggest' && keys(input, ['descriptions', 'tags', 'titles']) && list(input.descriptions, 2, 2, 80) && list(input.tags, 3, 5) && new Set(input.tags).size === input.tags.length && list(input.titles, 3, 3, 30))
    return { descriptions: input.descriptions, tags: input.tags, titles: input.titles };
  return fail();
}
export function reviewLocation(text: string, quote: string) {
  const start = bodyStart(text);
  const from = quote ? text.indexOf(quote, start) : -1;
  const reason = from < 0 ? '本文で見つからない' : text.indexOf(quote, from + 1) >= 0 ? '本文に複数あります' : '';
  return { from, to: from + quote.length, reason };
}
export function orderedIssues(text: string, issues: ReviewIssue[]) {
  return issues.map((issue, index) => ({ issue, index, location: reviewLocation(text, issue.quote) }))
    .sort((a, b) => (a.location.from < 0 ? Infinity : a.location.from) - (b.location.from < 0 ? Infinity : b.location.from) || a.index - b.index);
}
export function correctionChanges(text: string, issue: ReviewIssue): TextChange[] {
  const location = reviewLocation(text, issue.quote);
  if (location.reason) throw new Error(location.reason);
  // 確認だけの指摘は、空の案で本文を削除しない。
  if (!issue.replacement && ['公開前の確認', '事実の確認'].includes(issue.kind)) return [];
  return [{ from: location.from, to: location.to, insert: issue.replacement }];
}
export function suggestionChanges(text: string, key: 'title' | 'description' | 'tags', value: string): TextChange[] {
  const tags = readProperties(text)?.properties.find(property => property.key === 'tags')?.value;
  return patchFrontMatter(text, key, key === 'tags' ? [...new Set([...(Array.isArray(tags) ? tags : typeof tags === 'string' && tags ? [tags] : []), value])] : value);
}
export function reviewDiff(original: string, replacement: string) {
  const previous = Array.from(original), next = Array.from(replacement);
  let from = 0, oldEnd = previous.length, newEnd = next.length;
  while (from < oldEnd && from < newEnd && previous[from] === next[from]) from++;
  while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  return { prefix: previous.slice(0, from).join(''), removed: previous.slice(from, oldEnd).join(''), added: next.slice(from, newEnd).join(''), suffix: previous.slice(oldEnd).join('') };
}
