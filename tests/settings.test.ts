import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, startupSettings, nextTheme, type Settings } from '../src/lib/settings.ts';

test('集中モードとタイプライター表示は旧設定でオフになり、独立して保存・復元できる', () => {
  const { focusMode: _, typewriterMode: __, ...legacy } = defaults;
  assert.equal(startupSettings(legacy, () => false).focusMode, false);
  assert.equal(startupSettings(legacy, () => false).typewriterMode, false);
  for (const focusMode of [false, true]) for (const typewriterMode of [false, true]) {
    const saved = { ...defaults, theme: 'light' as const, focusMode, typewriterMode };
    assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved)), () => true), saved);
  }
});

test('目次は初期状態と旧設定で表示し、保存した表示・非表示を復元する', () => {
  assert.equal(defaults.outlineVisible, true);
  const { outlineVisible: _, ...legacy } = defaults;
  assert.equal(startupSettings(legacy, () => false).outlineVisible, true);
  for (const outlineVisible of [true, false]) {
    const saved = { ...defaults, theme: 'dark' as const, fontSize: 17, outlineVisible };
    assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved)), () => false), saved);
  }
});

test('スターは旧設定で空になり、ワークスペースごとに保存・復元できる', () => {
  assert.deepEqual(defaults.starred, {});
  const { starred: _, ...legacy } = defaults;
  assert.deepEqual(startupSettings(legacy, () => false).starred, {});
  const saved = { ...defaults, theme: 'light' as const, starred: { '/Users/me/notes': ['a.md', 'posts/b.md'], '/Users/me/other': [] } };
  assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved)), () => true), saved);
});

test('first launch resolves OS once; stored theme survives OS changes and toggles directly', () => {
  for (const dark of [false, true]) {
    const first = startupSettings(defaults, () => dark);
    assert.equal(first.theme, dark ? 'dark' : 'light');
    assert.equal(first.fontSize, 19);
    const stored = JSON.parse(JSON.stringify(first)) as Settings;
    const restarted = startupSettings(stored, () => { throw new Error('stored theme must not read OS'); });
    assert.equal(restarted.theme, first.theme);
    restarted.theme = nextTheme(restarted.theme);
    assert.equal(restarted.theme, dark ? 'light' : 'dark');
    assert.equal(startupSettings(JSON.parse(JSON.stringify(restarted)), () => !dark).theme, restarted.theme);
  }
});

test('undecided theme resolves once without changing project or custom sizes', () => {
  const saved: Settings = { ...defaults, theme: 'system', fontSize: 17, lastProject: '/fixture', lastFile: 'a.md', recentFiles: ['a.md'] };
  assert.deepEqual(startupSettings(saved, () => true), { ...saved, theme: 'dark' });
  assert.equal(saved.theme, 'system');
  for (const size of [12, 16, 17, 18, 24, 32]) assert.equal(startupSettings({ ...defaults, theme: 'light', fontSize: size }, () => true).fontSize, size);
  assert.equal(startupSettings({ ...defaults, theme: 'light', fontSize: 40 }, () => true).fontSize, 32);
});

test('スターは既定で空で、古い設定に項目がなくても空として読み、保存した一覧を復元する', () => {
  assert.deepEqual(defaults.starred, {});
  const { starred: _, ...legacy } = defaults;
  assert.deepEqual(startupSettings(legacy, () => false).starred, {});
  const saved = { ...defaults, theme: 'light' as const, starred: { '/project': ['草稿/記事.md', '別.md'] } };
  assert.deepEqual(startupSettings(JSON.parse(JSON.stringify(saved)), () => true), saved);
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
