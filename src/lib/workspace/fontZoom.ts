import { defaults, stepFontSize, pinchFontSize, wheelFontSize, type Settings } from './settings.ts';

export function createFontZoom(settings: () => Settings, zoomAvailable: () => boolean, persist: () => Promise<void>) {
  let fontSizeSaveTimer: ReturnType<typeof setTimeout> | undefined;
  // ピンチとホイールは連続して届くので、止まってから保存する
  function changeFontSize(size: number, deferSave = false) {
    if (size === settings().fontSize) return;
    settings().fontSize = size;
    clearTimeout(fontSizeSaveTimer);
    if (deferSave) fontSizeSaveTimer = setTimeout(() => void persist(), 300);
    else void persist();
  }
  function zoomFont(kind: 'in' | 'out' | 'reset') {
    if (!zoomAvailable()) return;
    changeFontSize(kind === 'reset' ? defaults.fontSize : stepFontSize(settings().fontSize, kind === 'in' ? 1 : -1));
  }

  function mount() {
    // ピンチはWebKitのgesture*で届き、ctrl付きのwheelとしても届く。設定がオフの時は何もせず、標準の動きに任せる
    let pinchBase = settings().fontSize;
    const gestureStart = (event: Event) => {
      if (!settings().zoomFontSize) return;
      event.preventDefault();
      pinchBase = settings().fontSize;
    };
    const gestureChange = (event: Event) => {
      if (!settings().zoomFontSize) return;
      event.preventDefault();
      if (!zoomAvailable()) return;
      changeFontSize(pinchFontSize(settings().fontSize, pinchBase, (event as Event & { scale: number }).scale), true);
    };
    window.addEventListener('gesturestart', gestureStart);
    window.addEventListener('gesturechange', gestureChange);

    return () => {
      window.removeEventListener('gesturestart', gestureStart);
      window.removeEventListener('gesturechange', gestureChange);
      if (fontSizeSaveTimer !== undefined) {
        clearTimeout(fontSizeSaveTimer);
        void persist();
      }
    };
  }
  function mountWheel() {
    let wheelPending = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !settings().zoomFontSize) return;
      event.preventDefault();
      if (!zoomAvailable()) return;
      const next = wheelFontSize(settings().fontSize, wheelPending, event.deltaY);
      wheelPending = next.pending;
      changeFontSize(next.size, true);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    return () => window.removeEventListener('wheel', wheel);
  }
  return { zoomFont, mount, mountWheel };
}
