<script lang="ts">
  import type { Failure } from './session.ts';

  let {
    dialog = $bindable(),
    issue,
    diskLabel,
    canOverwrite,
    onReload,
    onOverwrite,
    onRetry,
    onSaveAs,
    onDiscard,
    onClose,
  }: {
    dialog?: HTMLDialogElement;
    issue: Failure | null;
    diskLabel: string;
    canOverwrite: boolean;
    onReload: () => void;
    onOverwrite: () => void;
    onRetry: () => void;
    onSaveAs: () => void;
    onDiscard: () => void;
    onClose: () => void;
  } = $props();

  const title = $derived(
    issue?.code === 'CONFLICT'
      ? '外部の変更と競合しています'
      : issue?.code === 'MISSING'
        ? 'ファイルが見つかりません'
        : '保存できませんでした',
  );
</script>

<dialog class="error-dialog" bind:this={dialog} onclose={onClose}>
  <h2>{title}</h2>
  <p>{issue?.message}</p>
  <p class="muted">編集中の内容は、この画面に保持しています。</p>
  {#if diskLabel}
    <details>
      <summary>ディスク側の最新内容（先頭部分）</summary>
      <pre>{diskLabel}</pre>
    </details>
  {/if}
  <div class="dialog-actions">
    {#if issue?.code === 'CONFLICT'}
      <button onclick={onReload}>ディスク内容を採用</button>
      <button class="danger" disabled={!canOverwrite} onclick={onOverwrite}>編集内容で上書き</button>
    {:else if issue?.code !== 'MISSING'}
      <button onclick={onRetry}>再試行</button>
    {/if}
    <button class="primary" onclick={onSaveAs}>別名保存…</button>
    <button onclick={onDiscard}>記事を閉じる…</button>
    <button onclick={() => dialog?.close()}>あとで対応</button>
  </div>
</dialog>
