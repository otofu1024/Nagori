export const SIDEBAR = { min: 200, max: 420, initial: 272 };
export const OUTLINE = { min: 180, max: 360, initial: 220 };
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

export function paneLayout(width: number, sidebarWidth: number, outlineWidth: number, sidebarVisible: boolean, editorWidth = 720) {
  const space = editorSpace(editorWidth);
  const sidebarMax = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, Math.floor(width - space)));
  const sidebar = sidebarVisible ? resizePane(sidebarWidth, SIDEBAR.min, sidebarMax) : 0;
  const available = width - sidebar - space;
  const outlineMax = Math.max(OUTLINE.min, Math.min(OUTLINE.max, Math.floor(available)));
  return {
    sidebar,
    sidebarMax,
    outline: resizePane(outlineWidth, OUTLINE.min, outlineMax),
    outlineMax,
    showOutline: available >= OUTLINE.min,
  };
}
