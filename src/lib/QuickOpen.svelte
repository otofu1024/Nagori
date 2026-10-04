<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { candidates, type Entry } from './navigation.ts';

  let {
    entries,
    recent,
    open = $bindable(false),
    onOpen,
  }: {
    entries: Entry[];
    recent: string[];
    open?: boolean;
    onOpen: (entry: Entry) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let input = $state<HTMLInputElement>();
  let query = $state('');
  let highlighted = $state(0);
  // 閉じた時にフォーカスを戻す先
  let returnFocus: HTMLElement | null = null;
  const results = $derived(candidates(entries, query, recent));

  export async function show(focus: HTMLElement | null) {
    query = '';
    highlighted = 0;
    open = true;
    await tick();
    dialog.showModal();
    returnFocus = focus?.isConnected ? focus : null;
    input?.focus();
  }

  export function close(restore = true) {
    const focus = returnFocus;
    returnFocus = null;
    open = false;
    dialog.close();
    if (restore && focus?.isConnected) focus.focus();
  }

  // 開いている記事を閉じた時など、戻り先のフォーカスを捨てる
  export function forgetFocus() {
    returnFocus = null;
  }

  function choose(entry: Entry) {
    close(false);
    onOpen(entry);
  }

  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, Math.min(results.length - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1)));
      document.getElementById('quick-' + highlighted)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && results[highlighted]) {
      event.preventDefault();
      choose(results[highlighted]);
    }
  }
</script>

<dialog
  class="quick-panel"
  bind:this={dialog}
  onkeydown={keydown}
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  aria-label="Quick Open"
>
  <div class="quick-input">
    <Icon name="search" size={20} />
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => (highlighted = 0)}
      placeholder="ファイル名やパスで検索…"
      aria-label="ファイルを検索"
    />
    <kbd>esc</kbd>
  </div>
  <div class="quick-label">{query ? '検索結果' : '最近開いたファイル'}</div>
  <div class="quick-results">
    {#each results as entry, i}
      <button id={'quick-' + i} class:highlighted={i === highlighted} onclick={() => choose(entry)}>
        <span class="file-icon"><Icon name={entry.kind === 'image' ? 'image' : 'file'} /></span>
        <span><strong>{entry.name}</strong><small>{entry.path}</small></span>
        {#if i === highlighted}<kbd>↵</kbd>{/if}
      </button>
    {/each}
    {#if !results.length}
      <p>{query ? '一致するファイルがありません。' : '最近開いたファイルはありません。名前を入力して検索できます。'}</p>
    {/if}
  </div>
  <div class="quick-hint">↑ ↓ 選択　 ↵ 開く <span>プロジェクト内のMarkdownと画像</span></div>
</dialog>
