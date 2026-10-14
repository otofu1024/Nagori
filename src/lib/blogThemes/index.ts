export const blogThemes = [
  { id: 'standard', name: '標準' },
  { id: 'mono', name: 'モノクロ' },
  { id: 'washi', name: '和紙' },
  { id: 'dusk', name: '夕闇' },
] as const;
export type BlogThemeId = typeof blogThemes[number]['id'];
export const themeName = (id: string | null) => blogThemes.find(theme => theme.id === id)?.name ?? 'カスタム';
export type ThemeSnapshot = {
  baseline: string;
  preset: BlogThemeId | null;
  history: { id: string; savedAt: number; preset: BlogThemeId | null }[];
};
export type ThemeSaved = { baseline: string; cleanupErrors: string[] };
