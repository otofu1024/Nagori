import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDEBAR, OUTLINE, EDITOR_SPACE, storedPaneWidth, resizePane, paneLayout } from '../src/lib/paneWidths.ts';
import { defaults, startupSettings } from '../src/lib/settings.ts';

test('保存した幅の範囲、初期値、古い設定を読み込む', () => {
  for (const range of [SIDEBAR, OUTLINE]) {
    for (const width of [range.min, range.initial, range.max]) assert.equal(storedPaneWidth(width, range), width);
    for (const width of [range.min - 1, range.max + 1, NaN, Infinity]) assert.equal(storedPaneWidth(width, range), range.initial);
  }
  const { sidebarWidth, outlineWidth, ...old } = defaults;
  const restored = startupSettings(old as typeof defaults, () => false);
  assert.equal(restored.sidebarWidth, 272);
  assert.equal(restored.outlineWidth, 220);
  assert.equal(startupSettings({ ...defaults, sidebarWidth: 421, outlineWidth: 179 }, () => false).sidebarWidth, 272);
  assert.equal(startupSettings({ ...defaults, sidebarWidth: 421, outlineWidth: 179 }, () => false).outlineWidth, 220);
});

test('ドラッグと矢印キーの幅を範囲に収める', () => {
  assert.equal(resizePane(150, 200, 420), 200);
  assert.equal(resizePane(450, 200, 420), 420);
  assert.equal(resizePane(282, 200, 420), 282);
  assert.equal(resizePane(210, 180, 360), 210);
});

test('目次の最小幅で表示を切り替え、サイドバー非表示でも幅を縮める', () => {
  assert.equal(paneLayout(272 + 1027.9, 272, 220, true).showOutline, false);
  const minimum = paneLayout(272 + 1028, 272, 220, true);
  assert.equal(minimum.showOutline, true);
  assert.equal(minimum.outline, 180);
  const noSidebar = paneLayout(1028, 420, 360, false);
  assert.equal(noSidebar.showOutline, true);
  assert.equal(noSidebar.outline, 180);
  assert.equal(noSidebar.sidebar, 0);
});

test('保存した目次360pxを1470pxの画面に収め、広げると元の幅へ戻す', () => {
  const saved = { ...defaults, sidebarWidth: 328, outlineWidth: 360 };
  for (const [width, showOutline, outline] of [[1470, true, 294], [1355, false, 180], [1536, true, 360]] as const) {
    const layout = paneLayout(width, saved.sidebarWidth, saved.outlineWidth, true);
    assert.equal(layout.sidebar, 328);
    assert.equal(layout.showOutline, showOutline);
    assert.equal(layout.outline, outline);
  }
  assert.equal(saved.outlineWidth, 360);
});

test('縮めた目次の表示幅を起点にドラッグと矢印キーで幅を変える', () => {
  const layout = paneLayout(1470, 328, 360, true);
  const resized = resizePane(layout.outline - 10, OUTLINE.min, layout.outlineMax);
  assert.equal(resized, 284);
  assert.equal(paneLayout(1470, 328, resized, true).outline, 284);
});

test('目次を縮めてから隠し、本文の余白を含めた848pxを残す', () => {
  const narrow = paneLayout(1120, 420, 220, true);
  assert.equal(narrow.sidebar, 272);
  assert.equal(narrow.showOutline, false);
  for (const sidebarVisible of [false, true]) {
    for (const width of [1048, 1120, 1340, 1500, 1800, 1340.5]) {
      for (const sidebar of [200, 272, 420]) {
        for (const outline of [180, 220, 360]) {
          const layout = paneLayout(width, sidebar, outline, sidebarVisible);
          assert.ok(width - layout.sidebar - (layout.showOutline ? layout.outline : 0) >= EDITOR_SPACE);
          assert.ok(layout.outline >= OUTLINE.min && layout.outline <= outline);
          assert.ok(layout.sidebarMax >= 200 && layout.sidebarMax <= 420);
          assert.ok(layout.outlineMax >= 180 && layout.outlineMax <= 360);
        }
      }
    }
  }
  assert.equal(paneLayout(720, 272, 220, true).sidebar, 200);
  assert.equal(paneLayout(720, 272, 220, true).showOutline, false);
});
