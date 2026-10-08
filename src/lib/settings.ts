import { SIDEBAR, OUTLINE, storedPaneWidth } from './paneWidths.ts';
export type Theme = 'light' | 'dark';
export type FontFamily = 'sans' | 'serif';
// 'system'は初回起動でテーマが未決定であることを表す
// starredはワークスペースのルートの絶対パスをキーに、スターを付けた記事の相対パスを新しい順に持つ
// trashRetentionDaysはゴミ箱の保存期限(日)。nullは無期限
// recentOpenedAtはワークスペース基準の相対パスをキーに、最後に開いた時刻(ミリ秒)を持つ
export type Settings = { lastProject: string | null; lastFile: string | null; theme: Theme | 'system'; fontSize: number; recentFiles: string[]; sidebarWidth: number; outlineWidth: number; outlineVisible: boolean; focusMode: boolean; typewriterMode: boolean; starred: Record<string, string[]>; editorWidth: number; lineHeight: number; fontFamily: FontFamily; autosaveDelay: number; startInPreview: boolean; headingRule: boolean; recentEditedCount: number; trashRetentionDays: number | null; recentOpenedAt: Record<string, number> };

// 設定画面の数値の範囲。範囲外の値は読み込み時に初期値へ戻す(Rust側の読み込みと同じ扱い)
export const RANGES = {
  editorWidth: { min: 560, max: 1000, initial: 720 },
  lineHeight: { min: 1.4, max: 2.4, initial: 1.9 },
  autosaveDelay: { min: 300, max: 5000, initial: 500 },
  recentEditedCount: { min: 10, max: 50, initial: 30 },
};
// ゴミ箱の保存期限として選べる日数。nullは無期限
export const RETENTION_DAYS = [7, 14, 30, 60, 90];

export const defaults: Settings = { lastProject: null, lastFile: null, theme: 'system', fontSize: 19, recentFiles: [], sidebarWidth: SIDEBAR.initial, outlineWidth: OUTLINE.initial, outlineVisible: true, focusMode: false, typewriterMode: false, starred: {}, editorWidth: RANGES.editorWidth.initial, lineHeight: RANGES.lineHeight.initial, fontFamily: 'sans', autosaveDelay: RANGES.autosaveDelay.initial, startInPreview: false, headingRule: true, recentEditedCount: RANGES.recentEditedCount.initial, trashRetentionDays: 30, recentOpenedAt: {} };

function inRange(value: number, range: { min: number; max: number; initial: number }): number {
  return Number.isFinite(value) && value >= range.min && value <= range.max ? value : range.initial;
}

export function startupSettings(saved: Partial<Settings>, prefersDark: () => boolean): Settings {
  const settings = { ...defaults, ...saved };
  if (settings.theme === 'system') settings.theme = prefersDark() ? 'dark' : 'light';
  settings.fontSize = Math.min(32, Math.max(12, settings.fontSize));
  settings.sidebarWidth = storedPaneWidth(settings.sidebarWidth, SIDEBAR);
  settings.outlineWidth = storedPaneWidth(settings.outlineWidth, OUTLINE);
  settings.editorWidth = inRange(settings.editorWidth, RANGES.editorWidth);
  settings.lineHeight = inRange(settings.lineHeight, RANGES.lineHeight);
  settings.autosaveDelay = inRange(settings.autosaveDelay, RANGES.autosaveDelay);
  settings.recentEditedCount = inRange(settings.recentEditedCount, RANGES.recentEditedCount);
  if (settings.fontFamily !== 'serif') settings.fontFamily = 'sans';
  if (settings.trashRetentionDays !== null && !RETENTION_DAYS.includes(settings.trashRetentionDays)) settings.trashRetentionDays = 30;
  return settings;
}

export function nextTheme(theme: Settings['theme']): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
