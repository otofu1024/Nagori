<script lang="ts">
  // 案内の領域は表示のたびに作り直さず、常に置いておく。中身が出た時だけ読み上げられる。
  let { visible = false }: { visible?: boolean } = $props();
</script>

<div class="outline-notice" class:shown={visible} aria-live="polite">
  {#if visible}
    <div class="outline-notice-card">
      <p class="outline-notice-title">画面の幅が足りないため、目次を表示できません</p>
      <p class="outline-notice-hint">ウィンドウを広げるか、サイドバーを狭くしてください</p>
    </div>
  {/if}
</div>

<style>
  /* 本文の列の上の流れに場所を取り、本文の文字と重ならないようにする */
  .outline-notice { flex: 0 0 auto; display: flex; justify-content: flex-end; min-width: 0; }
  .outline-notice.shown { padding: 12px 16px 0; }
  .outline-notice-card { max-width: 100%; padding: 9px 13px; border-radius: var(--radius); background: var(--panel); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .outline-notice-card p { margin: 0; }
  .outline-notice-title { font-size: 13px; line-height: 1.6; font-weight: 600; color: var(--heading); }
  .outline-notice-hint { font-size: 12px; line-height: 1.6; color: var(--muted); }
</style>
