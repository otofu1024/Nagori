<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resizePane } from './paneWidths.ts';

  let {
    label,
    value,
    min,
    max,
    initial,
    direction = 1,
    onChange,
    onCommit,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    initial: number;
    direction?: number;
    onChange: (width: number) => void;
    onCommit: () => void;
  } = $props();
  let dragging = $state(false);
  let pointer: number | null = null;
  let startX = 0,
    startWidth = 0;

  function finish() {
    if (pointer === null) return;
    pointer = null;
    dragging = false;
    document.documentElement.classList.remove('pane-resizing');
    onCommit();
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || pointer !== null) return;
    // 本文のフォーカスとIMEを保ち、ドラッグによる選択を防ぐ。
    event.preventDefault();
    pointer = event.pointerId;
    startX = event.clientX;
    startWidth = value;
    (event.currentTarget as HTMLElement).setPointerCapture(pointer);
    dragging = true;
    document.documentElement.classList.add('pane-resizing');
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    onChange(resizePane(startWidth + (event.clientX - startX) * direction, min, max));
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onChange(resizePane(value + (event.key === 'ArrowRight' ? 10 : -10) * direction, min, max));
    onCommit();
  }
  onDestroy(finish);
</script>

<!-- フォーカス可能なseparatorは幅を変える操作部品。Svelteの静的判定では非操作要素になる。 -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="pane-resizer"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation="vertical"
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuetext={`${value}px`}
  title={`${label}。左右の矢印キーで変更、ダブルクリックで初期値に戻す`}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={(event) => {
    if (event.pointerId === pointer) {
      move(event);
      finish();
    }
  }}
  onpointercancel={finish}
  onlostpointercapture={finish}
  onkeydown={keydown}
  ondblclick={() => {
    onChange(initial);
    onCommit();
  }}
></div>
