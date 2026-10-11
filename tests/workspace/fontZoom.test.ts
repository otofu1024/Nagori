import test from 'node:test';
import assert from 'node:assert/strict';
import { createFontZoom } from '../../src/lib/workspace/fontZoom.ts';
import { defaults } from '../../src/lib/workspace/settings.ts';

test('ホイールの受け口を付け外ししてもピンチとキーのズームを保つ', () => {
  const target = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
  const settings = { ...defaults, zoomFontSize: true };
  let available = true;
  const zoom = createFontZoom(() => settings, () => available, async () => {});
  const release = zoom.mount();
  const wheel = (ctrlKey: boolean) => {
    const event = new Event('wheel', { cancelable: true });
    Object.assign(event, { ctrlKey, deltaY: -100 });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    assert.equal(wheel(true), false);
    let releaseWheel = zoom.mountWheel();
    assert.equal(wheel(false), false);
    assert.equal(settings.fontSize, defaults.fontSize);
    assert.equal(wheel(true), true);
    assert.ok(settings.fontSize > defaults.fontSize);
    releaseWheel();
    assert.equal(wheel(true), false);
    releaseWheel = zoom.mountWheel();
    available = false;
    const before = settings.fontSize;
    assert.equal(wheel(true), true);
    assert.equal(settings.fontSize, before);
    available = true;
    zoom.zoomFont('reset');
    assert.equal(settings.fontSize, defaults.fontSize);
    target.dispatchEvent(new Event('gesturestart', { cancelable: true }));
    const pinch = new Event('gesturechange', { cancelable: true });
    Object.assign(pinch, { scale: 1.5 });
    target.dispatchEvent(pinch);
    assert.equal(pinch.defaultPrevented, true);
    assert.ok(settings.fontSize > defaults.fontSize);
    settings.zoomFontSize = false;
    releaseWheel();
    assert.equal(wheel(true), false);
    const off = new Event('gesturechange', { cancelable: true });
    target.dispatchEvent(off);
    assert.equal(off.defaultPrevented, false);
  } finally {
    release();
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
