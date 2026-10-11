// マウスの動きと実際のスクロールだけで表示を延長する。領域の幅やスクロール位置は変更しない。
export function activityScrollbar(node: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  const show = () => {
    if (!active) { node.classList.add('scrollbar-active'); active = true; }
    clearTimeout(timer);
    timer = setTimeout(() => { node.classList.remove('scrollbar-active'); active = false; }, 1000);
  };
  node.classList.add('activity-scrollbar');
  node.addEventListener('mousemove', show, { passive: true, capture: true });
  node.addEventListener('scroll', show, { passive: true });
  return {
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('mousemove', show, true);
      node.removeEventListener('scroll', show);
      node.classList.remove('activity-scrollbar', 'scrollbar-active');
    },
  };
}
