import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDEBAR, OUTLINE, EDITOR_SPACE, EDITOR_WIDTH, editorSpace, storedPaneWidth, resizePane, paneLayout } from '../src/lib/paneWidths.ts';
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

test('本文の幅に余白128pxを足した分を、目次と並ぶ幅として確保する', () => {
  assert.equal(EDITOR_SPACE, editorSpace(720));
  assert.equal(editorSpace(560), 688);
  assert.equal(editorSpace(1000), 1128);
  // 本文を広げると、目次が出る最小のウィンドウ幅が広がる
  const narrowest = (editorWidth: number) => {
    for (let width = 800; width <= 2400; width++) if (paneLayout(width, 272, 220, true, editorWidth).showOutline) return width;
    throw new Error('no width');
  };
  assert.equal(narrowest(560), 272 + 688 + 180);
  assert.equal(narrowest(720), 272 + 848 + 180);
  assert.equal(narrowest(1000), 272 + 1128 + 180);
  // 本文の幅を省略した時は720pxとして扱う
  assert.deepEqual(paneLayout(1470, 328, 360, true), paneLayout(1470, 328, 360, true, 720));
});

test('本文を広げた時はサイドバーの上限が狭くなり、目次の上限も本文の幅に合わせて変わる', () => {
  // 1500pxで本文1000pxの時は、サイドバーの上限が372pxになり、目次の場所が残らない
  const wide = paneLayout(1500, 420, 360, true, 1000);
  assert.equal(wide.sidebarMax, 372);
  assert.equal(wide.sidebar, 372);
  assert.equal(wide.showOutline, false);
  // 本文720pxなら、サイドバーは420pxのまま目次が232pxまで残る
  const standard = paneLayout(1500, 420, 360, true, 720);
  assert.equal(standard.sidebar, 420);
  assert.equal(standard.outlineMax, 232);
  assert.equal(standard.showOutline, true);
});

const auto = { auto: true, outlineOpen: true };

test('自動の時は目次の有無で本文の幅が変わり、手動の時は本文の幅をそのまま返す', () => {
  // サイドバーと目次の分を引いた残りに本文を合わせる
  assert.equal(paneLayout(1300, 272, 220, true, 720, auto).editorWidth, 680);
  // 目次を閉じると、目次の分が本文に戻る
  assert.equal(paneLayout(1300, 272, 220, true, 720, { auto: true, outlineOpen: false }).editorWidth, 900);
  // サイドバーを隠すと、サイドバーの分も本文に戻る
  assert.equal(paneLayout(1300, 272, 220, false, 720, auto).editorWidth, 952);
  // 手動の時は、自動の計算をせず本文の幅をそのまま返す
  assert.equal(paneLayout(1300, 272, 220, true, 720).editorWidth, 720);
  assert.equal(paneLayout(1300, 272, 220, true, 720, { auto: false, outlineOpen: true }).editorWidth, 720);
});

test('自動の時、狭いウィンドウでは本文を560pxに止める', () => {
  const narrow = paneLayout(800, 272, 220, true, 720, auto);
  assert.equal(narrow.sidebar, 200);
  assert.equal(narrow.showOutline, false);
  assert.equal(narrow.editorWidth, EDITOR_WIDTH.min);
  // 目次を閉じていても、空きが560pxに届かなければ止める
  assert.equal(paneLayout(800, 272, 220, true, 720, { auto: true, outlineOpen: false }).editorWidth, EDITOR_WIDTH.min);
});

test('自動の時、広いウィンドウでは本文を1000pxに止める', () => {
  assert.equal(paneLayout(2000, 272, 220, true, 720, auto).editorWidth, EDITOR_WIDTH.max);
  assert.equal(paneLayout(2000, 272, 220, false, 720, { auto: true, outlineOpen: false }).editorWidth, EDITOR_WIDTH.max);
});

test('自動の時も、目次を出せるかは本文の最小幅560pxで判断する', () => {
  // 272pxのサイドバーと本文560px、余白128px、目次の最小180pxを足した1140pxから目次を出す
  const showOutlineAt = (width: number) => paneLayout(width, 272, 220, true, 1000, auto).showOutline;
  assert.equal(showOutlineAt(1139), false);
  assert.equal(showOutlineAt(1140), true);
  const minimum = paneLayout(1140, 272, 220, true, 720, auto);
  assert.equal(minimum.outline, OUTLINE.min);
  assert.equal(minimum.editorWidth, EDITOR_WIDTH.min);
  // 手動の本文の幅が広くても、判断には使わない
  assert.equal(paneLayout(1139, 272, 220, true, 1000).showOutline, false);
  // 目次を閉じている時は、表示に関係なく残りの空きに本文を合わせる
  assert.equal(paneLayout(1139, 272, 220, true, 720, { auto: true, outlineOpen: false }).editorWidth, 739);
});

test('自動の時も、本文の幅は範囲に収まり、目次を出している時は目次の幅を空きから引く', () => {
  for (const width of [1000, 1050, 1140, 1300, 1600, 2000]) {
    for (const sidebarVisible of [false, true]) {
      for (const outline of [180, 220, 360]) {
        for (const outlineOpen of [false, true]) {
          const layout = paneLayout(width, 420, outline, sidebarVisible, 720, { auto: true, outlineOpen });
          const sidebar = sidebarVisible ? layout.sidebar : 0;
          const editor = layout.editorWidth;
          assert.ok(editor >= EDITOR_WIDTH.min && editor <= EDITOR_WIDTH.max);
          if (outlineOpen && layout.showOutline && editor > EDITOR_WIDTH.min && editor < EDITOR_WIDTH.max) {
            assert.equal(editor, width - sidebar - layout.outline - 128);
          }
        }
      }
    }
  }
});
