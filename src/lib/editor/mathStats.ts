// 数式描画の計測用カウンタ。globalThis.__NAGORI_MATH_STATS__ が true の時だけ有効で、通常利用では何も記録しない。
export type MathStats = { renderStarts: number; discards: number };
const stats: MathStats = { renderStarts: 0, discards: 0 };
const enabled = () => (globalThis as { __NAGORI_MATH_STATS__?: unknown }).__NAGORI_MATH_STATS__ === true;

// renderMathが実際に変換へ進んだ回数を数える。
export function countRenderStart() { if (enabled()) stats.renderStarts++; }
// 全mountの撤去で結果を破棄した回数を数える。
export function countDiscard() { if (enabled()) stats.discards++; }
export function readMathStats(): MathStats { return { ...stats }; }
export function resetMathStats() { stats.renderStarts = 0; stats.discards = 0; }
