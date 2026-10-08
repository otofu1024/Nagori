import { SIDEBAR, OUTLINE, storedPaneWidth } from './paneWidths.ts';
import { OPENED_LIMIT } from './noteLists.ts';
export type Theme = 'light' | 'dark';
// 'system'はmacOSの外観に従うことを表す。保存した値は変えず、表示する時に決める
// starredはワークスペースのルートの絶対パスをキーに、スターを付けた記事の相対パスを新しい順に持つ
export type Settings = {
  lastProject: string | null; lastFile: string | null; theme: Theme | 'system'; fontSize: number; recentFiles: string[]; sidebarWidth: number; outlineWidth: number; outlineVisible: boolean; focusMode: boolean; typewriterMode: boolean; starred: Record<string, string[]>;
  // 記事を最後に開いた時刻（ミリ秒）を相対パスごとに持つ。最近見たノートの並びに使う
  recentOpenedAt: Record<string, number>;
  // 設定画面の項目。範囲外の値は読み込み時に範囲の端へ直す
  editorWidth: number; lineHeight: number; fontFamily: FontFamily; autosaveDelay: number; startInPreview: boolean; headingRule: boolean; recentEditedCount: number; trashRetentionDays: TrashRetentionDays;
};
export type FontFamily = 'sans' | 'serif';
export type TrashRetentionDays = 7 | 14 | 30 | 60 | 90 | null;
export const TRASH_RETENTION_OPTIONS: TrashRetentionDays[] = [7, 14, 30, 60, 90, null];
export const RANGES = {
  fontSize: { min: 12, max: 32 },
  editorWidth: { min: 560, max: 1000 },
  lineHeight: { min: 1.4, max: 2.4 },
  autosaveDelay: { min: 300, max: 5000 },
  recentEditedCount: { min: 10, max: 50 },
} as const;
export const defaults: Settings = {
  lastProject: null, lastFile: null, theme: 'system', fontSize: 19, recentFiles: [], sidebarWidth: SIDEBAR.initial, outlineWidth: OUTLINE.initial, outlineVisible: true, focusMode: false, typewriterMode: false, starred: {}, recentOpenedAt: {},
  editorWidth: 720, lineHeight: 1.9, fontFamily: 'sans', autosaveDelay: 500, startInPreview: false, headingRule: true, recentEditedCount: 30, trashRetentionDays: 30,
};

function clamp(value: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

// 設定画面で足した数値は、Rust側の読み込みと同じく、範囲外なら初期値へ戻す
function inRange(value: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// 開いた時刻の記録は、数値だけを新しい順に上限まで残す
function readOpened(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  return Object.fromEntries(entries.sort(([, a], [, b]) => b - a).slice(0, OPENED_LIMIT));
}

export function startupSettings(saved: Partial<Settings>): Settings {
  const settings = { ...defaults, ...saved };
  settings.fontSize = clamp(settings.fontSize, defaults.fontSize, RANGES.fontSize);
  settings.sidebarWidth = storedPaneWidth(settings.sidebarWidth, SIDEBAR);
  settings.outlineWidth = storedPaneWidth(settings.outlineWidth, OUTLINE);
  settings.editorWidth = Math.round(inRange(settings.editorWidth, defaults.editorWidth, RANGES.editorWidth));
  settings.lineHeight = inRange(settings.lineHeight, defaults.lineHeight, RANGES.lineHeight);
  settings.fontFamily = settings.fontFamily === 'serif' ? 'serif' : 'sans';
  settings.autosaveDelay = Math.round(inRange(settings.autosaveDelay, defaults.autosaveDelay, RANGES.autosaveDelay));
  settings.startInPreview = flag(settings.startInPreview, defaults.startInPreview);
  settings.headingRule = flag(settings.headingRule, defaults.headingRule);
  settings.recentEditedCount = Math.round(inRange(settings.recentEditedCount, defaults.recentEditedCount, RANGES.recentEditedCount));
  settings.recentOpenedAt = readOpened(settings.recentOpenedAt);
  settings.trashRetentionDays = (TRASH_RETENTION_OPTIONS as unknown[]).includes(settings.trashRetentionDays) ? settings.trashRetentionDays : defaults.trashRetentionDays;
  return settings;
}

// 表示に使う配色。'system'はmacOSの外観に合わせ、ライトかダークに決める
export function resolvedTheme(theme: Settings['theme'], prefersDark: boolean): Theme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

// 「すべて初期値に戻す」。最近見たノートの記録・スター・ワークスペースは残す
export function resetPreferences(current: Settings): Settings {
  return {
    ...defaults,
    lastProject: current.lastProject,
    lastFile: current.lastFile,
    recentFiles: [...current.recentFiles],
    starred: structuredClone(current.starred),
    recentOpenedAt: { ...current.recentOpenedAt },
  };
}

// 本文の見た目に使うCSS変数の値
export function editorStyle(settings: Pick<Settings, 'editorWidth' | 'lineHeight' | 'fontFamily'>): string {
  const family = settings.fontFamily === 'serif' ? "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', serif" : "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif";
  return `--editor-width:${settings.editorWidth}px;--editor-line-height:${settings.lineHeight};--editor-family:${family}`;
}
