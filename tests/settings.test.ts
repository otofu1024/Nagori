import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, startupSettings, nextTheme, type Settings } from '../src/lib/settings.ts';

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

test('legacy system and 17px migrate without changing project or custom sizes', () => {
  const legacy: Settings = { ...defaults, theme: 'system', appearanceVersion: 0, fontSize: 17, lastProject: '/fixture', lastFile: 'a.md', recentFiles: ['a.md'] };
  assert.deepEqual(startupSettings(legacy, () => true), { ...legacy, theme: 'dark', fontSize: 19, appearanceVersion: 1 });
  assert.equal(legacy.theme, 'system');
  assert.equal(legacy.fontSize, 17);
  const migrated = startupSettings(legacy, () => true);
  migrated.fontSize = 17;
  assert.equal(startupSettings(JSON.parse(JSON.stringify(migrated)), () => false).fontSize, 17);
  const withoutMarker = { ...legacy };
  delete withoutMarker.appearanceVersion;
  assert.equal(startupSettings(withoutMarker, () => false).fontSize, 19);
  for (const size of [12, 16, 18, 24, 32]) assert.equal(startupSettings({ ...defaults, theme: 'light', fontSize: size }, () => true).fontSize, size);
});
