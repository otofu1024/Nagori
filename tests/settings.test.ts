import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, startupSettings, nextTheme, resolvedTheme, resetPreferences, editorStyle, type Settings } from '../src/lib/settings.ts';

test('集中モードとタイプライター表示は旧設定でオフになり、独立して保存・復元できる', () => {
  const { focusMode: _, typewriterMode: __, ...legacy } = defaults;
  assert.equal(startupSettings(legacy).focusMode, false);
  assert.equal(startupSettings(legacy).typewriterMode, false);
  for (const focusMode of [false, true]) for (const typewriterMode of [false, true]) {
    const saved = { ...defaults, theme: 'light' as const, focusMode, typewriterMode };
    assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved))), saved);
  }
});

test('目次は初期状態と旧設定で表示し、保存した表示・非表示を復元する', () => {
  assert.equal(defaults.outlineVisible, true);
  const { outlineVisible: _, ...legacy } = defaults;
  assert.equal(startupSettings(legacy).outlineVisible, true);
  for (const outlineVisible of [true, false]) {
    const saved = { ...defaults, theme: 'dark' as const, fontSize: 17, outlineVisible };
    assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved))), saved);
  }
});

test('スターは旧設定で空になり、ワークスペースごとに保存・復元できる', () => {
  assert.deepEqual(defaults.starred, {});
  const { starred: _, ...legacy } = defaults;
  assert.deepEqual(startupSettings(legacy).starred, {});
  const saved = { ...defaults, theme: 'light' as const, starred: { '/Users/me/notes': ['a.md', 'posts/b.md'], '/Users/me/other': [] } };
  assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved))), saved);
});

test('first launch keeps system so the appearance follows macOS, and the toggle pins a fixed theme', () => {
  for (const dark of [false, true]) {
    const first = startupSettings(defaults);
    assert.equal(first.theme, 'system');
    assert.equal(resolvedTheme(first.theme, dark), dark ? 'dark' : 'light');
    assert.equal(first.fontSize, 19);
    const stored = JSON.parse(JSON.stringify(first)) as Settings;
    const restarted = startupSettings(stored);
    assert.equal(restarted.theme, 'system');
    // 表示中の配色の反対へ固定する。保存した固定値はOSの切り替えに左右されない
    restarted.theme = nextTheme(resolvedTheme(restarted.theme, dark));
    assert.equal(restarted.theme, dark ? 'light' : 'dark');
    assert.equal(startupSettings(JSON.parse(JSON.stringify(restarted))).theme, restarted.theme);
    assert.equal(resolvedTheme(restarted.theme, !dark), restarted.theme);
  }
});

test('undecided theme keeps system and resolves to the OS appearance without changing project or custom sizes', () => {
  const saved: Settings = { ...defaults, theme: 'system', fontSize: 17, lastProject: '/fixture', lastFile: 'a.md', recentFiles: ['a.md'] };
  assert.deepEqual(startupSettings(saved), saved);
  assert.equal(resolvedTheme('system', true), 'dark');
  assert.equal(resolvedTheme('system', false), 'light');
  for (const size of [12, 16, 17, 18, 24, 32]) assert.equal(startupSettings({ ...defaults, theme: 'light', fontSize: size }).fontSize, size);
  assert.equal(startupSettings({ ...defaults, theme: 'light', fontSize: 40 }).fontSize, 32);
});

test('スターは既定で空で、古い設定に項目がなくても空として読み、保存した一覧を復元する', () => {
  assert.deepEqual(defaults.starred, {});
  const { starred: _, ...legacy } = defaults;
  assert.deepEqual(startupSettings(legacy).starred, {});
  const saved = { ...defaults, theme: 'light' as const, starred: { '/project': ['草稿/記事.md', '別.md'] } };
  assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved))), saved);
});

test('設定画面の項目は、古い設定では初期値になり、保存した値を復元する', () => {
  const { editorWidth: _, lineHeight: __, fontFamily: ___, autosaveDelay: ____, startInPreview: _____, headingRule: ______, recentEditedCount: _______, trashRetentionDays: ________, recentOpenedAt: _________, ...legacy } = defaults;
  const restored = startupSettings(legacy);
  assert.equal(restored.editorWidth, 720);
  assert.equal(restored.lineHeight, 1.9);
  assert.equal(restored.fontFamily, 'sans');
  assert.equal(restored.autosaveDelay, 500);
  assert.equal(restored.startInPreview, false);
  assert.equal(restored.headingRule, true);
  assert.equal(restored.recentEditedCount, 30);
  assert.deepEqual(restored.recentOpenedAt, {});
  assert.equal(restored.trashRetentionDays, 30);
  const saved: Settings = { ...defaults, theme: 'system', editorWidth: 880, lineHeight: 2.2, fontFamily: 'serif', autosaveDelay: 1500, startInPreview: true, headingRule: false, recentEditedCount: 42, trashRetentionDays: null, recentOpenedAt: { 'a.md': 1700000000000 } };
  assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved))), saved);
});

test('設定画面の範囲外の数値と型が違う値は初期値にし、文字サイズは範囲の端へ直す', () => {
  const restored = startupSettings({
    ...defaults,
    editorWidth: 2000, lineHeight: 0.5, autosaveDelay: 100, recentEditedCount: 99, fontSize: 40,
    fontFamily: 'comic' as never, startInPreview: 'yes' as never, headingRule: 0 as never,
  });
  assert.equal(restored.editorWidth, 720);
  assert.equal(restored.lineHeight, 1.9);
  assert.equal(restored.autosaveDelay, 500);
  assert.equal(restored.recentEditedCount, 30);
  assert.equal(restored.fontSize, 32);
  assert.equal(restored.fontFamily, 'sans');
  assert.equal(restored.startInPreview, false);
  assert.equal(restored.headingRule, true);
  const low = startupSettings({ ...defaults, editorWidth: 100, autosaveDelay: 99999, recentEditedCount: 1, lineHeight: 9 });
  assert.deepEqual([low.editorWidth, low.autosaveDelay, low.recentEditedCount, low.lineHeight], [720, 500, 30, 1.9]);
  assert.equal(startupSettings({ ...defaults, editorWidth: Number.NaN, lineHeight: '1.9' as never }).editorWidth, 720);
  assert.equal(startupSettings({ ...defaults, lineHeight: '1.9' as never }).lineHeight, 1.9);
});

test('ゴミ箱の保存期限は7・14・30・60・90日か無期限だけを受け付け、それ以外は30日にする', () => {
  for (const days of [7, 14, 30, 60, 90, null] as const) assert.equal(startupSettings({ ...defaults, trashRetentionDays: days }).trashRetentionDays, days);
  for (const days of [0, 5, 45, 365, '30', undefined]) assert.equal(startupSettings({ ...defaults, trashRetentionDays: days as never }).trashRetentionDays, 30);
});

test('すべて初期値に戻しても、最近開いたファイル・最近見たノートの記録・スター・ワークスペースは残る', () => {
  const current: Settings = {
    ...defaults, theme: 'dark', fontSize: 25, editorWidth: 900, lineHeight: 2.3, fontFamily: 'serif', autosaveDelay: 2000,
    startInPreview: true, headingRule: false, recentEditedCount: 12, trashRetentionDays: 90,
    outlineVisible: false, focusMode: true, typewriterMode: true, sidebarWidth: 380, outlineWidth: 300,
    lastProject: '/work', lastFile: 'a.md', recentFiles: ['a.md', 'b/c.md'], starred: { '/work': ['a.md'] }, recentOpenedAt: { 'b/c.md': 1700000000000 },
  };
  const reset = resetPreferences(current);
  assert.deepEqual(reset, { ...defaults, lastProject: '/work', lastFile: 'a.md', recentFiles: ['a.md', 'b/c.md'], starred: { '/work': ['a.md'] }, recentOpenedAt: { 'b/c.md': 1700000000000 } });
  assert.notEqual(reset.starred, current.starred);
  assert.equal(reset.theme, 'system');
});

test('本文の見た目はCSS変数に直し、字体と幅と行間を反映する', () => {
  const sans = editorStyle({ editorWidth: 720, lineHeight: 1.9, fontFamily: 'sans' });
  assert.match(sans, /--editor-width:720px/);
  assert.match(sans, /--editor-line-height:1\.9/);
  assert.match(sans, /Hiragino Sans/);
  const serif = editorStyle({ editorWidth: 640, lineHeight: 2, fontFamily: 'serif' });
  assert.match(serif, /--editor-width:640px/);
  assert.match(serif, /Hiragino Mincho ProN/);
  assert.match(serif, /YuMincho/);
});

test('開いた時刻の記録は、数値だけを新しい順に200件まで残し、壊れた値は捨てる', () => {
  const many = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`${index}.md`, index]));
  const restored = startupSettings({ ...defaults, recentOpenedAt: { ...many, 'bad.md': 'x' as never, 'nan.md': Number.NaN } });
  assert.equal(Object.keys(restored.recentOpenedAt).length, 200);
  assert.equal(restored.recentOpenedAt['249.md'], 249);
  assert.equal(restored.recentOpenedAt['0.md'], undefined);
  assert.equal('bad.md' in restored.recentOpenedAt, false);
  assert.deepEqual(startupSettings({ ...defaults, recentOpenedAt: [] as never }).recentOpenedAt, {});
  assert.deepEqual(startupSettings({ ...defaults, recentOpenedAt: null as never }).recentOpenedAt, {});
});

test('設定画面の項目は既定値で始まり、古い設定では既定値で読む', () => {
  assert.equal(defaults.editorWidth, 720);
  assert.equal(defaults.lineHeight, 1.9);
  assert.equal(defaults.fontFamily, 'sans');
  assert.equal(defaults.autosaveDelay, 500);
  assert.equal(defaults.startInPreview, false);
  assert.equal(defaults.headingRule, true);
  assert.equal(defaults.recentEditedCount, 30);
  assert.equal(defaults.trashRetentionDays, 30);
  assert.deepEqual(defaults.recentOpenedAt, {});
  const legacy = { theme: 'dark' as const, fontSize: 17 };
  assert.deepEqual(startupSettings(legacy, () => false), { ...defaults, theme: 'dark', fontSize: 17 });
});

test('設定画面の範囲内の値と最近開いた時刻は保存したとおりに復元する', () => {
  const saved = {
    ...defaults,
    theme: 'light' as const,
    editorWidth: 1000,
    lineHeight: 2.4,
    fontFamily: 'serif' as const,
    autosaveDelay: 5000,
    startInPreview: true,
    headingRule: false,
    recentEditedCount: 50,
    trashRetentionDays: null,
    recentOpenedAt: { 'posts/a.md': 1700000000000, 'b.md': 1700000001000 },
  };
  assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved)), () => true), saved);
  for (const days of [7, 14, 30, 60, 90]) {
    assert.equal(startupSettings({ ...defaults, trashRetentionDays: days }, () => false).trashRetentionDays, days);
  }
});

test('設定画面の範囲外の値は読み込み時に初期値へ戻す', () => {
  const broken = {
    editorWidth: 559,
    lineHeight: 2.5,
    fontFamily: 'mono' as unknown as 'sans',
    autosaveDelay: 299,
    recentEditedCount: 9,
    trashRetentionDays: 45,
  };
  const restored = startupSettings({ ...defaults, ...broken }, () => false);
  assert.equal(restored.editorWidth, 720);
  assert.equal(restored.lineHeight, 1.9);
  assert.equal(restored.fontFamily, 'sans');
  assert.equal(restored.autosaveDelay, 500);
  assert.equal(restored.recentEditedCount, 30);
  assert.equal(restored.trashRetentionDays, 30);
  assert.equal(startupSettings({ ...defaults, editorWidth: 1001 }, () => false).editorWidth, 720);
  assert.equal(startupSettings({ ...defaults, lineHeight: 1.4 }, () => false).lineHeight, 1.4);
});
