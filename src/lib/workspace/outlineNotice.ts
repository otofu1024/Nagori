// 目次ボタンがオンなのに幅が足りず目次を隠している時だけ、本文の上に案内を出す。
export function outlineNoticeVisible(state: {
  plain: boolean;
  previewOnly: boolean;
  outlineVisible: boolean;
  headingCount: number;
  showOutline: boolean;
}): boolean {
  return !state.plain && !state.previewOnly && state.outlineVisible && state.headingCount > 0 && !state.showOutline;
}
