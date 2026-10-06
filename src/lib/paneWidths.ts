export const SIDEBAR = { min: 200, max: 420, initial: 272 };
export const OUTLINE = { min: 180, max: 360, initial: 220 };
// 本文720pxと左右の余白128pxを確保する。
export const EDITOR_SPACE = 848;

export function storedPaneWidth(width: number, range: typeof SIDEBAR): number {
  return Number.isFinite(width) && width >= range.min && width <= range.max ? Math.round(width) : range.initial;
}

export function resizePane(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}

export function paneLayout(width: number, sidebarWidth: number, outlineWidth: number, sidebarVisible: boolean) {
  const sidebarMax = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, Math.floor(width - EDITOR_SPACE)));
  const sidebar = sidebarVisible ? resizePane(sidebarWidth, SIDEBAR.min, sidebarMax) : 0;
  const available = width - sidebar - EDITOR_SPACE;
  return {
    sidebar,
    sidebarMax,
    outlineMax: Math.max(OUTLINE.min, Math.min(OUTLINE.max, Math.floor(available))),
    showOutline: available >= outlineWidth,
  };
}
