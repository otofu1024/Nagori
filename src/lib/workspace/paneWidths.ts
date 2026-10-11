export const SIDEBAR = { min: 200, max: 420, initial: 272 };
export const OUTLINE = { min: 180, max: 360, initial: 220 };
// 本文の幅の範囲。settings.tsのRANGESと、自動の幅の計算で同じ値を使う
export const EDITOR_WIDTH = { min: 560, max: 1000 };
// 本文720pxと左右の余白128pxを確保する。本文の幅を変えた時は editorSpace で求める。
export const EDITOR_SPACE = 848;
const EDITOR_PADDING = 128;

export function editorSpace(editorWidth: number): number {
  return editorWidth + EDITOR_PADDING;
}

export function storedPaneWidth(width: number, range: typeof SIDEBAR): number {
  return Number.isFinite(width) && width >= range.min && width <= range.max ? Math.round(width) : range.initial;
}

export function resizePane(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}

// 自動の時は、本文の幅をウィンドウの空きに合わせて決める。outlineOpenは目次を表示中かどうか
// 自動の時のサイドバーと目次の上限は、本文を最小幅にした時の空きで求める。本文はその残りを使う
export function paneLayout(width: number, sidebarWidth: number, outlineWidth: number, sidebarVisible: boolean, editorWidth = 720, { auto = false, outlineOpen = false } = {}) {
  const space = editorSpace(auto ? EDITOR_WIDTH.min : editorWidth);
  const sidebarMax = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, Math.floor(width - space)));
  const sidebar = sidebarVisible ? resizePane(sidebarWidth, SIDEBAR.min, sidebarMax) : 0;
  const available = width - sidebar - space;
  const outlineMax = Math.max(OUTLINE.min, Math.min(OUTLINE.max, Math.floor(available)));
  const outline = resizePane(outlineWidth, OUTLINE.min, outlineMax);
  const showOutline = available >= OUTLINE.min;
  // 目次を表示している時だけ、その幅を本文の空きから引く
  const shownOutline = outlineOpen && showOutline ? outline : 0;
  return {
    sidebar,
    sidebarMax,
    outline,
    outlineMax,
    showOutline,
    editorWidth: auto ? resizePane(width - sidebar - shownOutline - EDITOR_PADDING, EDITOR_WIDTH.min, EDITOR_WIDTH.max) : editorWidth,
  };
}
