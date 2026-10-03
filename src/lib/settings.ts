export type Theme = 'light' | 'dark';
// 'system'は初回起動でテーマが未決定であることを表す
export type Settings = { lastProject: string | null; lastFile: string | null; theme: Theme | 'system'; fontSize: number; recentFiles: string[] };
export const defaults: Settings = { lastProject: null, lastFile: null, theme: 'system', fontSize: 19, recentFiles: [] };

export function startupSettings(saved: Settings, prefersDark: () => boolean): Settings {
  const settings = { ...defaults, ...saved };
  if (settings.theme === 'system') settings.theme = prefersDark() ? 'dark' : 'light';
  settings.fontSize = Math.min(32, Math.max(12, settings.fontSize));
  return settings;
}

export function nextTheme(theme: Settings['theme']): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
