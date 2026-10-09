import { EditorView, layer, RectangleMarker } from '@codemirror/view';
import { previewOnlyField } from './livePreview.ts';

// 選択の塗りを、文字の高さだけに収めて本文の下へ描くレイヤー。
// 標準の::selectionは行ボックス全体を塗るため、行間が広いと色が上下へ伸びて見える。
// そこで標準の選択は透明にし(Editor.svelteのCSS)、ここでテキストノードごとの矩形を描く。
export function selectionTextLayer() {
  return layer({
    above: false,
    class: 'nagori-selection-layer',
    markers: view => selectionMarkers(view),
    // ウィンドウ幅や文字サイズ・行間の変更で折り返しが変わった時も矩形を描き直す
    update: update => update.selectionSet || update.docChanged || update.viewportChanged || update.geometryChanged,
  });
}

function selectionMarkers(view: EditorView): RectangleMarker[] {
  const range = view.state.selection.main;
  // プレビューは読み取り専用のため、標準の選択表示をそのまま使う
  if (range.empty || view.state.field(previewOnlyField, false)) return [];
  const from = Math.max(range.from, view.viewport.from), to = Math.min(range.to, view.viewport.to);
  if (from >= to) return [];
  // RectangleMarkerは、スクロール領域の左上を基準にした座標を取る
  const box = view.scrollDOM.getBoundingClientRect();
  const left = box.left - view.scrollDOM.scrollLeft, top = box.top - view.scrollDOM.scrollTop;
  return textRects(view, from, to).map(rect => new RectangleMarker('nagori-selection', rect.left - left, rect.top - top, rect.width, rect.height));
}

// 範囲内のテキストノードごとに矩形を集める。
// Range.getClientRects()に範囲を渡すと、範囲内に丸ごと含まれる行の要素も返り、行間を含む高さで塗られてしまうため、テキストノードだけを対象にする。
// テキストの矩形は行の高さ(line-height)に関係なく、フォントの高さで返る。
function textRects(view: EditorView, from: number, to: number): DOMRect[] {
  const start = view.domAtPos(from), end = view.domAtPos(to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    // テキストノードの端が選択の端と一致しない時は、選択の範囲に切り詰める
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    rects.push(...part.getClientRects());
  }
  return rects;
}
