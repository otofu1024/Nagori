<script lang="ts">
  import Icon from './Icon.svelte';
  let { outlineVisible, outlineAvailable, outlineLabel, gitAvailable, gitVisible, disabled, onOutline, onGit }: {
    outlineVisible: boolean; outlineAvailable: boolean; outlineLabel: string; gitAvailable: boolean; gitVisible: boolean;
    disabled: boolean; onOutline: () => void; onGit: () => void;
  } = $props();
</script>

{#if outlineAvailable || gitAvailable}
  <div class="right-pane-tabs" role="group" aria-label="右の欄">
    {#if outlineAvailable}
      <button class="mode-toggle outline-toggle" aria-pressed={outlineVisible} aria-label={outlineLabel} title={outlineLabel} {disabled} onclick={onOutline}><Icon name="outline" size={16} /></button>
    {/if}
    {#if gitAvailable}
      <button class="mode-toggle git-toggle" aria-pressed={gitVisible} aria-label={gitVisible ? 'Gitを隠す' : 'Gitを表示'} title={gitVisible ? 'Gitを隠す' : 'Gitを表示'} {disabled} onclick={onGit}><Icon name="branch" size={16} /></button>
    {/if}
  </div>
{/if}

<style>
  .right-pane-tabs { display: flex; flex-shrink: 0; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
  .right-pane-tabs .mode-toggle { border: 0; border-radius: 0; margin: 0; }
  .right-pane-tabs button + button { border-left: 1px solid var(--border); }
  .right-pane-tabs button[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); }
</style>
