// 表示モード切り替え前のスクロール状態。
export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

// 末尾付近とみなす許容差（px）。小数のscrollTopによる丸め誤差を吸収する。
const BOTTOM_TOLERANCE = 2;

export function isAtBottom(m: ScrollMetrics): boolean {
  return m.scrollHeight - m.clientHeight - m.scrollTop <= BOTTOM_TOLERANCE;
}

// 切り替え後に設定するscrollTopを返す。
// 末尾にいた場合は、切り替えで高さが変わっても新しい末尾へ合わせる。
// ピクセル固定で戻すと、高さが縮んだ時に末尾へ丸められ、戻した時に差分だけ末尾からずれる。
export function restoredScrollTop(before: ScrollMetrics, after: Omit<ScrollMetrics, 'scrollTop'>): number {
  if (isAtBottom(before)) return Math.max(0, after.scrollHeight - after.clientHeight);
  return before.scrollTop;
}
