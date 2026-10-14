export const blogThemes = [
  { id: 'standard', name: '標準' },
  { id: 'mono', name: 'モノクロ' },
  { id: 'washi', name: '和紙' },
  { id: 'dusk', name: '夕闇' },
] as const;
export type BlogThemeId = typeof blogThemes[number]['id'];
export const themeName = (id: string | null) => blogThemes.find(theme => theme.id === id)?.name ?? (id && /^custom-[1-9]\d*$/.test(id) ? `カスタム${id.slice(7)}` : '未登録');
export type ThemeSnapshot = {
  baseline: string;
  preset: BlogThemeId | null;
  current: string | null;
  customs: { id: string; name: string }[];
  history: { id: string; savedAt: number; preset: BlogThemeId | null; theme: string | null }[];
};
export type ThemeSaved = { baseline: string; cleanupErrors: string[] };
