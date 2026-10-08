import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineNoticeVisible } from '../src/lib/outlineNotice.ts';
import { paneLayout } from '../src/lib/paneWidths.ts';

const shown = { plain: false, previewOnly: false, outlineVisible: true, headingCount: 3, showOutline: false };

test('目次がオンで見出しがあり、幅が足りない時だけ案内を出す', () => {
  assert.equal(outlineNoticeVisible(shown), true);
});

test('目次をオフ、幅が足りる、見出しなし、plain、Previewでは出さない', () => {
  assert.equal(outlineNoticeVisible({ ...shown, outlineVisible: false }), false);
  assert.equal(outlineNoticeVisible({ ...shown, showOutline: true }), false);
  assert.equal(outlineNoticeVisible({ ...shown, headingCount: 0 }), false);
  assert.equal(outlineNoticeVisible({ ...shown, plain: true }), false);
  assert.equal(outlineNoticeVisible({ ...shown, previewOnly: true }), false);
});

test('本文の幅で案内が出入りする境界は目次の表示と対になる', () => {
  const sidebar = 272;
  const hidden = paneLayout(sidebar + 1027.9, sidebar, 220, true);
  const visible = paneLayout(sidebar + 1028, sidebar, 220, true);
  const base = { plain: false, previewOnly: false, outlineVisible: true, headingCount: 2 };
  assert.equal(outlineNoticeVisible({ ...base, showOutline: hidden.showOutline }), true);
  assert.equal(outlineNoticeVisible({ ...base, showOutline: visible.showOutline }), false);
});
