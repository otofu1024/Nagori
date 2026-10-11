// スライダーの色の付いた部分を、つまみの中心で止めるCSSの値を返す
// ネイティブの描画は色の端がつまみの中心からずれるため、CSSのcalc()で位置を揃える。つまみの直径は設定画面のCSSと同じ18px
export const THUMB_SIZE = 18;

export function rangeFill(value: number, range: { min: number; max: number }, thumb = THUMB_SIZE): string {
  const ratio = (value - range.min) / (range.max - range.min);
  return `calc(${thumb / 2}px + (100% - ${thumb}px) * ${ratio})`;
}
