<script lang="ts">
  import { tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import { failure } from './session.ts';
  import { parentPath } from './navigation.ts';
  import { compositionGate } from './composition.ts';
  import { DEBOUNCE_MS, FILE_LIMIT, groupMatches, hitOf, latestOnly, matchCount, segments, shouldSearch, type SearchHit, type SearchMatch, type SearchResponse } from './workspaceSearch.ts';

  let {
    open = $bindable(false),
    onOpen,
  }: {
    open?: boolean;
    onOpen: (hit: SearchHit) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let input = $state<HTMLInputElement>();
  let query = $state('');
  let caseSensitive = $state(false);
  let regexp = $state(false);
  let response = $state<SearchResponse | null>(null);
  let error = $state('');
  let searching = $state(false);
  let highlighted = $state(0);
  // 閉じた時にフォーカスを戻す先
  let returnFocus: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const latest = latestOnly();
  // 変換中は検索せず、確定した時に検索する
  const composition = compositionGate(() => schedule());
  const groups = $derived(groupMatches(response?.results ?? []));
  // ↑↓とEnterで選ぶ順番。描画と同じ並びにする
  const rows = $derived(groups.flatMap((group) => group.rows.map((row) => ({ path: group.file.path, ...row }))));
  const total = $derived(matchCount(response?.results ?? []));
  const status = $derived.by(() => {
    if (error) return error;
    if (searching && !response) return '検索中…';
    if (!shouldSearch(query)) return query ? '英字・数字は2文字以上で検索します。' : 'ワークスペース内の本文を検索します。';
    if (!response) return '';
    if (!total) return '一致する本文はありません。';
    const files = response.results.length;
    return `${total.toLocaleString()} 件の一致（${files.toLocaleString()} ファイル）`;
  });

  export async function show(focus: HTMLElement | null) {
    query = '';
    response = null;
    error = '';
    highlighted = 0;
    composition.reset();
    open = true;
    await tick();
    dialog.showModal();
    returnFocus = focus?.isConnected ? focus : null;
    input?.focus();
  }

  export function close(restore = true) {
    const focus = returnFocus;
    returnFocus = null;
    latest.cancel();
    clearTimeout(timer);
    searching = false;
    open = false;
    dialog.close();
    if (restore && focus?.isConnected) focus.focus();
  }

  // 検索の条件を変えた時や入力の時に、少し待ってから検索する
  function schedule() {
    clearTimeout(timer);
    highlighted = 0;
    if (!shouldSearch(query)) {
      latest.cancel();
      response = null;
      error = '';
      searching = false;
      return;
    }
    searching = true;
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  }

  async function run() {
    const id = latest.start();
    const text = query;
    try {
      const result = await invoke<SearchResponse>('workspace_search', { query: text, caseSensitive, regexp });
      if (!latest.isCurrent(id)) return;
      response = result;
      error = '';
      highlighted = 0;
    } catch (cause) {
      if (!latest.isCurrent(id)) return;
      response = null;
      error = failure(cause).message;
    } finally {
      if (latest.isCurrent(id)) searching = false;
    }
  }

  function choose(path: string, match: SearchMatch) {
    close(false);
    onOpen(hitOf(path, match));
  }

  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, Math.min(total - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1)));
      document.getElementById('search-' + highlighted)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      const row = rows[highlighted];
      if (!row) return;
      event.preventDefault();
      choose(row.path, row.match);
    }
  }
</script>

<dialog
  class="quick-panel search-panel"
  bind:this={dialog}
  onkeydown={keydown}
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  aria-label="ワークスペース全体を検索"
>
  <div class="quick-input">
    <Icon name="search" size={20} />
    <input
      bind:this={input}
      bind:value={query}
      oninput={(event) => composition.input((event as Event & { isComposing?: boolean }).isComposing)}
      oncompositionstart={() => composition.start()}
      oncompositionend={() => composition.end()}
      placeholder="本文を検索…"
      aria-label="本文を検索"
      aria-invalid={!!error}
    />
    <button
      type="button"
      class="search-toggle"
      aria-pressed={caseSensitive}
      onclick={() => {
        caseSensitive = !caseSensitive;
        schedule();
      }}>大文字と小文字を区別</button
    >
    <button
      type="button"
      class="search-toggle"
      aria-pressed={regexp}
      onclick={() => {
        regexp = !regexp;
        schedule();
      }}>正規表現</button
    >
  </div>
  <div class="quick-label" class:search-error={!!error} aria-live="polite">{status}</div>
  <div class="quick-results">
    {#each groups as group (group.file.path)}
      <div class="search-file">
        <strong>{group.file.name}</strong>
        {#if parentPath(group.file.path)}<small>{parentPath(group.file.path)}</small>{/if}
      </div>
      {#each group.rows as row (row.index)}
        <button id={'search-' + row.index} class="search-row" class:highlighted={row.index === highlighted} onclick={() => choose(group.file.path, row.match)}>
          <span class="search-line">{row.match.line}</span>
          <span class="search-excerpt">{#each segments(row.match.preview, row.match.ranges) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
        </button>
      {/each}
      {#if group.rows.length >= FILE_LIMIT}<p class="search-note">このファイルは{FILE_LIMIT}件までを表示しています。</p>{/if}
    {/each}
    {#if response?.truncated}<p class="search-note">500件で打ち切りました。検索語を絞ってください。</p>{/if}
  </div>
  <div class="quick-hint">↑ ↓ 選択　 ↵ 開く <span>ワークスペース内のMarkdownとテキスト</span></div>
</dialog>

<style>
  .search-panel { width: 680px; }
  .search-toggle { font-size: 12px; padding: 5px 9px; white-space: nowrap; }
  .search-toggle[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
  .search-toggle:focus-visible, .search-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .search-error { color: var(--danger); }
  .search-file { padding: 12px 12px 4px; }
  .search-file strong { display: block; font-size: 13px; font-weight: 600; }
  .search-file small { display: block; font-size: 12px; color: var(--muted); margin-top: 3px; }
  .search-row { width: 100%; display: flex; align-items: baseline; gap: 12px; padding: 7px 12px 7px 24px; text-align: left; font-size: 13px; }
  .search-row.highlighted { background: var(--accent-soft); color: var(--accent); }
  .search-line { min-width: 3.5em; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; }
  .search-excerpt { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .search-excerpt mark { background: var(--selection); color: inherit; font-weight: 600; border-radius: 3px; }
  .search-note { font-size: 12px; color: var(--muted); padding: 6px 12px 10px 24px; }
  @media (max-width: 720px) { .search-panel { width: auto; } }
</style>
