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
