<script lang="ts">
  let {
    dialog = $bindable(),
    input = $bindable(),
    path = $bindable(),
    error,
    busy,
    onSubmit,
    onClose,
  }: {
    dialog?: HTMLDialogElement;
    input?: HTMLInputElement;
    path: string;
    error: string;
    busy: boolean;
    onSubmit: () => void;
    onClose: () => void;
  } = $props();
</script>

<dialog class="save-as-dialog" bind:this={dialog} onclose={onClose}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <h2>別名で保存</h2>
    <p>プロジェクト内の相対パスを入力してください。既存ファイルは上書きしません。</p>
    <input aria-label="保存先の相対パス" bind:this={input} bind:value={path} />
    {#if error}<p class="error-text">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" onclick={() => dialog?.close()}>キャンセル</button>
      <button class="primary" type="submit" disabled={busy}>保存</button>
    </div>
  </form>
</dialog>
