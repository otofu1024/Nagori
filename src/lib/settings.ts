import { SIDEBAR, OUTLINE, storedPaneWidth } from './paneWidths.ts';
export type Theme = 'light' | 'dark';
// 'system'は初回起動でテーマが未決定であることを表す
// starredはワークスペースのルートの絶対パスをキーに、スターを付けた記事の相対パスを新しい順に持つ
export type Settings = { lastProject: string | null; lastFile: string | null; theme: Theme | 'system'; fontSize: number; recentFiles: string[]; sidebarWidth: number; outlineWidth: number; outlineVisible: boolean; focusMode: boolean; typewriterMode: boolean; starred: Record<string, string[]> };
export const defaults: Settings = { lastProject: null, lastFile: null, theme: 'system', fontSize: 19, recentFiles: [], sidebarWidth: SIDEBAR.initial, outlineWidth: OUTLINE.initial, outlineVisible: true, focusMode: false, typewriterMode: false, starred: {} };

export function startupSettings(saved: Partial<Settings>, prefersDark: () => boolean): Settings {
  const settings = { ...defaults, ...saved };
  if (settings.theme === 'system') settings.theme = prefersDark() ? 'dark' : 'light';
  settings.fontSize = Math.min(32, Math.max(12, settings.fontSize));
  settings.sidebarWidth = storedPaneWidth(settings.sidebarWidth, SIDEBAR);
  settings.outlineWidth = storedPaneWidth(settings.outlineWidth, OUTLINE);
  return settings;
}

export function nextTheme(theme: Settings['theme']): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
