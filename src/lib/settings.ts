export type Theme = 'light' | 'dark';
export type Settings = { lastProject: string | null; lastFile: string | null; theme: Theme | 'system'; fontSize: number; recentFiles: string[]; appearanceVersion?: number };
export const defaults: Settings = { lastProject: null, lastFile: null, theme: 'system', fontSize: 19, recentFiles: [], appearanceVersion: 1 };

export function startupSettings(saved: Settings, prefersDark: () => boolean): Settings {
  const settings = { ...defaults, ...saved };
  if (settings.theme === 'system') settings.theme = prefersDark() ? 'dark' : 'light';
  if ((saved.appearanceVersion ?? 0) < 1 && settings.fontSize === 17) settings.fontSize = 19;
  settings.fontSize = Math.min(32, Math.max(12, settings.fontSize));
  settings.appearanceVersion = 1;
  return settings;
}

export function nextTheme(theme: Settings['theme']): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
