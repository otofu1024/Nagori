import { SIDEBAR, OUTLINE, EDITOR_WIDTH, storedPaneWidth } from './paneWidths.ts';
import { OPENED_LIMIT, RECENT_FILE_LIMIT } from './noteLists.ts';
type Theme = 'light' | 'dark';
// 'system'はmacOSの外観に従うことを表す。保存した値は変えず、表示する時に決める
// starredとrecentFilesとrecentOpenedAtは、ワークスペースのルートの絶対パスをキーに持つ。ウィンドウごとのフォルダの記録を、ほかのフォルダと混ぜない
// starredはスターを付けた記事の相対パスを新しい順に、recentFilesは最近開いた記事の相対パスを新しい順に持つ
export type Settings = {
  theme: Theme | 'system'; fontSize: number; recentFiles: Record<string, string[]>; sidebarWidth: number; outlineWidth: number; outlineVisible: boolean; focusMode: boolean; typewriterMode: boolean; starred: Record<string, string[]>;
  // 記事を最後に開いた時刻（ミリ秒）を、ルートごとに相対パスごとに持つ。最近見たノートの並びに使う
  recentOpenedAt: Record<string, Record<string, number>>;
  // 設定画面の項目。範囲外の値は読み込み時に範囲の端へ直す
  editorWidth: number; lineHeight: number; fontFamily: FontFamily; autosaveDelay: number; startInPreview: boolean; headingRule: boolean; recentEditedCount: number; trashRetentionDays: TrashRetentionDays;
  // オンの時、拡大縮小のショートカットとピンチで本文の文字サイズを変える
  zoomFontSize: boolean;
  // オンの時、本文の幅はウィンドウの空きに合わせて決める。editorWidthは手動の値として残す
  autoEditorWidth: boolean;
  blogFeatures: boolean;
  blogArticleHeader: boolean; blogLinkCardsEnabled: boolean; blogCharactersEnabled: boolean; blogBodyTheme: boolean; blogIndentOnEnter: boolean;
};
type FontFamily = 'sans' | 'serif';
export type TrashRetentionDays = 7 | 14 | 30 | 60 | 90 | null;
export const TRASH_RETENTION_OPTIONS: TrashRetentionDays[] = [7, 14, 30, 60, 90, null];
export const RANGES = {
  fontSize: { min: 12, max: 32 },
  editorWidth: EDITOR_WIDTH,
  lineHeight: { min: 1.4, max: 2.4 },
  autosaveDelay: { min: 300, max: 5000 },
  recentEditedCount: { min: 10, max: 50 },
} as const;
export const defaults: Settings = {
  theme: 'system', fontSize: 19, recentFiles: {}, sidebarWidth: SIDEBAR.initial, outlineWidth: OUTLINE.initial, outlineVisible: true, focusMode: false, typewriterMode: false, starred: {}, recentOpenedAt: {},
  editorWidth: 720, lineHeight: 1.9, fontFamily: 'sans', autosaveDelay: 500, startInPreview: false, headingRule: true, recentEditedCount: 30, trashRetentionDays: 30, zoomFontSize: false, autoEditorWidth: false, blogFeatures: true, blogArticleHeader: true, blogLinkCardsEnabled: true, blogCharactersEnabled: true, blogBodyTheme: true, blogIndentOnEnter: true,
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

// ルートごとの記録を読む。型が違うルートは捨てる
export const ROOT_KEYS = ['starred', 'recentFiles', 'recentOpenedAt'] as const;
function readRoots<T>(value: unknown, readItem: (item: unknown) => T | null): Record<string, T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([root, item]) => {
    const parsed = readItem(item);
    return parsed === null ? [] : [[root, parsed] as const];
  }));
}

function readPaths(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : null;
}

// 開いた時刻の記録は、数値だけを新しい順に上限まで残す
function readOpened(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
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
  settings.starred = readRoots(settings.starred, readPaths);
  settings.recentFiles = readRoots(settings.recentFiles, (item) => readPaths(item)?.slice(0, RECENT_FILE_LIMIT) ?? null);
  settings.recentOpenedAt = readRoots(settings.recentOpenedAt, readOpened);
  settings.trashRetentionDays = (TRASH_RETENTION_OPTIONS as unknown[]).includes(settings.trashRetentionDays) ? settings.trashRetentionDays : defaults.trashRetentionDays;
  settings.zoomFontSize = flag(settings.zoomFontSize, defaults.zoomFontSize);
  settings.autoEditorWidth = flag(settings.autoEditorWidth, defaults.autoEditorWidth);
  settings.blogFeatures = flag(settings.blogFeatures, defaults.blogFeatures);
  settings.blogArticleHeader = flag(settings.blogArticleHeader, defaults.blogArticleHeader);
  settings.blogLinkCardsEnabled = flag(settings.blogLinkCardsEnabled, defaults.blogLinkCardsEnabled);
  settings.blogCharactersEnabled = flag(settings.blogCharactersEnabled, defaults.blogCharactersEnabled);
  settings.blogBodyTheme = flag(settings.blogBodyTheme, defaults.blogBodyTheme);
  settings.blogIndentOnEnter = flag(settings.blogIndentOnEnter, defaults.blogIndentOnEnter);
  return settings;
}

// 文字サイズを1pxずつ増減する。範囲の端では止める
export function stepFontSize(size: number, delta: number): number {
  return Math.min(RANGES.fontSize.max, Math.max(RANGES.fontSize.min, size + delta));
}

// ピンチは、開始時の文字サイズに拡大率を掛けた目標へ1pxずつ寄せる。
// 目標との差が1px未満の間は動かさず、指の細かな揺れで文字サイズが震えないようにする
export function pinchFontSize(current: number, start: number, scale: number): number {
  const target = Math.min(RANGES.fontSize.max, Math.max(RANGES.fontSize.min, start * scale));
  if (target - current >= 1) return stepFontSize(current, 1);
  if (current - target >= 1) return stepFontSize(current, -1);
  return current;
}

// ctrl付きのホイールは、動きをpendingへ溜め、WHEEL_STEP分たまったら1px変える。
// 指を広げる(deltaYが負)と大きくする。1px変えたら溜めを捨て、大きな動きでも1回で1pxだけ変える
export const WHEEL_STEP = 12;
export function wheelFontSize(current: number, pending: number, deltaY: number): { size: number; pending: number } {
  const total = pending - deltaY;
  if (total >= WHEEL_STEP) return { size: stepFontSize(current, 1), pending: 0 };
  if (total <= -WHEEL_STEP) return { size: stepFontSize(current, -1), pending: 0 };
  return { size: current, pending: total };
}

// 表示に使う配色。'system'はmacOSの外観に合わせ、ライトかダークに決める
export function resolvedTheme(theme: Settings['theme'], prefersDark: boolean): Theme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

// 「すべて初期値に戻す」。最近見たノートの記録・スター・ワークスペースは残す。Svelteの状態は複製できないので、JSONで写す
export function resetPreferences(current: Settings): Settings {
  return {
    ...defaults,
    recentFiles: copyJson(current.recentFiles),
    starred: copyJson(current.starred),
    recentOpenedAt: copyJson(current.recentOpenedAt),
  };
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ルートごとの記録に、送られた差分を重ねる。nullのルートは外し、送られなかったルートは残す
export function applyRootPatch<T>(current: Record<string, T> = {}, patch: Record<string, T | null>): Record<string, T> {
  const next = { ...current };
  for (const [root, value] of Object.entries(patch)) {
    if (value === null) delete next[root];
    else next[root] = value;
  }
  return next;
}

// ルートごとに、前回保存した値から変わったものだけを取り出す。消えたルートはnullにする
function changedRoots<T>(previous: Record<string, T> = {}, next: Record<string, T> = {}): Record<string, T | null> {
  const changed: Record<string, T | null> = {};
  for (const root of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (JSON.stringify(previous[root]) === JSON.stringify(next[root])) continue;
    changed[root] = root in next ? next[root] : null;
  }
  return changed;
}

// 前回保存した設定と比べて、値が変わった項目だけを取り出す。ウィンドウごとに送る保存の中身に使う。
// ルートごとの項目は、変わったルートだけを入れる。ほかのルートは、ほかのウィンドウの変更を消さないよう送らない
export function changedSettings(previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if ((ROOT_KEYS as readonly string[]).includes(key)) {
      const roots = changedRoots(previous[key] as Record<string, unknown> | undefined, value as Record<string, unknown>);
      if (Object.keys(roots).length > 0) changed[key] = roots;
    } else if (JSON.stringify(previous[key]) !== JSON.stringify(value)) {
      changed[key] = value;
    }
  }
  return changed;
}

// 別のウィンドウが保存した項目を重ねる。ルートごとの項目は、送られたルートだけを差し替える
export function applyValues(target: Record<string, unknown>, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    target[key] = (ROOT_KEYS as readonly string[]).includes(key) ? applyRootPatch(target[key] as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
}

// 保存できなかった項目を前回保存した値へ戻す。ルートごとの項目は、送ったルートだけを戻す
export function rollbackSettings(current: Record<string, unknown>, previous: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const restored = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if ((ROOT_KEYS as readonly string[]).includes(key)) {
      const before = (previous[key] ?? {}) as Record<string, unknown>;
      const roots = Object.fromEntries(Object.keys(value as object).map((root) => [root, root in before ? before[root] : null]));
      restored[key] = applyRootPatch(restored[key] as Record<string, unknown>, roots);
    } else if (key in previous) {
      restored[key] = previous[key];
    } else {
      delete restored[key];
    }
  }
  return restored;
}

// 本文の見た目に使うCSS変数の値
export function editorStyle(settings: Pick<Settings, 'editorWidth' | 'lineHeight' | 'fontFamily'>): string {
  const family = settings.fontFamily === 'serif' ? "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', serif" : "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif";
  return `--editor-width:${settings.editorWidth}px;--editor-line-height:${settings.lineHeight};--editor-family:${family}`;
}
