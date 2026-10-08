<script lang="ts">
  import Icon from './Icon.svelte';
  import { RANGES, TRASH_RETENTION_OPTIONS, type Settings, type TrashRetentionDays } from './settings.ts';

  let {
    dialog = $bindable(),
    settings,
    onChange,
    onReset,
    onClose,
  }: {
    dialog?: HTMLDialogElement;
    settings: Settings;
    onChange: () => void;
    onReset: () => void;
    onClose: () => void;
  } = $props();

  type Section = 'display' | 'editor' | 'sidebar' | 'trash';
  const sections: Array<{ id: Section; label: string }> = [
    { id: 'display', label: '表示' },
    { id: 'editor', label: 'エディタ' },
    { id: 'sidebar', label: 'サイドバー' },
    { id: 'trash', label: 'ゴミ箱' },
  ];
  let section = $state<Section>('display');
  const retentionLabel = (days: TrashRetentionDays) => (days === null ? '無期限' : `${days}日`);
  function parseRetention(value: string): TrashRetentionDays {
    return value === 'null' ? null : (Number(value) as TrashRetentionDays);
  }
</script>

<dialog class="settings-dialog" bind:this={dialog} onclose={onClose} aria-labelledby="settings-title">
  <header class="settings-header">
    <h2 id="settings-title">設定</h2>
    <button class="icon-button" aria-label="設定を閉じる" title="設定を閉じる" onclick={() => dialog?.close()}><Icon name="close" size={16} /></button>
  </header>
  <div class="settings-body">
    <nav class="settings-nav" aria-label="設定の項目">
      {#each sections as item (item.id)}
        <button type="button" aria-current={section === item.id ? 'true' : undefined} onclick={() => (section = item.id)}>{item.label}</button>
      {/each}
    </nav>
    <div class="settings-panel">
      {#if section === 'display'}
        <fieldset>
          <legend>テーマ</legend>
          <label><input type="radio" name="theme" value="light" bind:group={settings.theme} onchange={onChange} /> ライト</label>
          <label><input type="radio" name="theme" value="dark" bind:group={settings.theme} onchange={onChange} /> ダーク</label>
          <label><input type="radio" name="theme" value="system" bind:group={settings.theme} onchange={onChange} /> macOSに合わせる</label>
        </fieldset>
        <label class="range-row">本文の文字サイズ <output>{settings.fontSize}px</output>
          <input type="range" min={RANGES.fontSize.min} max={RANGES.fontSize.max} step="1" bind:value={settings.fontSize} onchange={onChange} />
        </label>
        <label class="range-row">本文の幅 <output>{settings.editorWidth}px</output>
          <input type="range" min={RANGES.editorWidth.min} max={RANGES.editorWidth.max} step="10" bind:value={settings.editorWidth} onchange={onChange} />
        </label>
        <label class="range-row">行間 <output>{settings.lineHeight.toFixed(1)}</output>
          <input type="range" min={RANGES.lineHeight.min} max={RANGES.lineHeight.max} step="0.1" bind:value={settings.lineHeight} onchange={onChange} />
        </label>
        <fieldset>
          <legend>字体</legend>
          <label><input type="radio" name="font" value="sans" bind:group={settings.fontFamily} onchange={onChange} /> ゴシック</label>
          <label><input type="radio" name="font" value="serif" bind:group={settings.fontFamily} onchange={onChange} /> 明朝</label>
        </fieldset>
      {:else if section === 'editor'}
        <label class="range-row">自動保存までの時間 <output>{(settings.autosaveDelay / 1000).toFixed(1)}秒</output>
          <input type="range" min={RANGES.autosaveDelay.min} max={RANGES.autosaveDelay.max} step="100" bind:value={settings.autosaveDelay} onchange={onChange} />
        </label>
        <fieldset>
          <legend>記事を開いた時の表示</legend>
          <label><input type="radio" name="start" value="edit" checked={!settings.startInPreview} onchange={() => { settings.startInPreview = false; onChange(); }} /> Live Preview</label>
          <label><input type="radio" name="start" value="preview" checked={settings.startInPreview} onchange={() => { settings.startInPreview = true; onChange(); }} /> Preview</label>
        </fieldset>
        <label class="check-row"><input type="checkbox" bind:checked={settings.focusMode} onchange={onChange} /> 集中モード</label>
        <label class="check-row"><input type="checkbox" bind:checked={settings.typewriterMode} onchange={onChange} /> タイプライター表示</label>
        <label class="check-row"><input type="checkbox" bind:checked={settings.headingRule} onchange={onChange} /> 見出し1〜3の下線を表示</label>
      {:else if section === 'sidebar'}
        <label class="range-row">最近編集の件数 <output>{settings.recentEditedCount}件</output>
          <input type="range" min={RANGES.recentEditedCount.min} max={RANGES.recentEditedCount.max} step="1" bind:value={settings.recentEditedCount} onchange={onChange} />
        </label>
        <label class="check-row"><input type="checkbox" bind:checked={settings.outlineVisible} onchange={onChange} /> 目次を表示する</label>
      {:else}
        <label class="select-row">ゴミ箱の保存期限
          <select value={String(settings.trashRetentionDays)} onchange={(event) => { settings.trashRetentionDays = parseRetention(event.currentTarget.value); onChange(); }}>
            {#each TRASH_RETENTION_OPTIONS as days (String(days))}
              <option value={String(days)}>{retentionLabel(days)}</option>
            {/each}
          </select>
        </label>
        <p class="settings-note">期限を過ぎたものは、ワークスペースを開いた時にmacOSのゴミ箱へ送ります。</p>
      {/if}
    </div>
  </div>
  <footer class="settings-footer">
    <button type="button" onclick={onReset}>すべて初期値に戻す</button>
  </footer>
</dialog>

<style>
  .settings-dialog { width: min(720px, calc(100% - 40px)); max-width: 720px; height: min(640px, calc(100vh - 80px)); padding: 0; display: flex; flex-direction: column; overflow: hidden; }
  /* 高さを決めた中で、上下の帯が縮んで中身が切れないようにする。アプリのfooter(状態表示の32px)の指定も打ち消す */
  .settings-header, .settings-footer { flex: none; }
  .settings-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--border); }
  .settings-header h2 { font-size: 18px; font-weight: 650; color: var(--heading); margin: 0; }
  .settings-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 150px minmax(0, 1fr); }
  .settings-nav { display: flex; flex-direction: column; gap: 4px; padding: 14px 10px; border-right: 1px solid var(--border); background: var(--sidebar); overflow: auto; }
  .settings-nav button { text-align: left; border: none; background: none; padding: 9px 12px; border-radius: 9px; color: var(--muted); font-size: 14px; }
  .settings-nav button:hover { background: var(--hover); color: var(--text); }
  .settings-nav button[aria-current='true'] { background: var(--accent-soft); color: var(--accent); font-weight: 650; }
  .settings-panel { min-width: 0; overflow: auto; padding: 20px 24px 24px; display: grid; gap: 18px; align-content: start; font-size: 14px; }
  .settings-panel fieldset { border: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .settings-panel legend { color: var(--muted); font-size: 13px; margin-bottom: 8px; padding: 0; }
  .settings-panel label { display: flex; align-items: center; gap: 8px; color: var(--text); }
  .settings-panel .range-row { flex-wrap: wrap; gap: 8px; }
  .range-row output { margin-left: auto; color: var(--muted); font-size: 13px; }
  .range-row input[type='range'] { flex: 0 0 100%; width: 100%; accent-color: var(--accent); margin: 0; }
  .select-row { justify-content: space-between; }
  .select-row select { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; }
  .settings-note { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
  .settings-panel input[type='radio'], .settings-panel input[type='checkbox'] { accent-color: var(--accent); width: 16px; height: 16px; margin: 0; }
  .settings-footer { height: auto; font-size: inherit; color: inherit; display: flex; justify-content: flex-start; padding: 14px 22px; border-top: 1px solid var(--border); }
  .settings-footer button { font-size: 13px; padding: 8px 11px; border: 1px solid var(--border); }
  @media (max-width: 560px) {
    .settings-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .settings-nav { flex-direction: row; overflow-x: auto; border-right: none; border-bottom: 1px solid var(--border); padding: 10px 12px; }
    .settings-nav button { white-space: nowrap; }
  }
</style>
