<script lang="ts">
  import Icon from './Icon.svelte';
  import { activityScrollbar } from './activityScrollbar.ts';
  import { recentPages, type Entry } from './navigation.ts';

  let { recent, entries, current, busy, onSelect }: {
    recent: string[];
    entries: Entry[];
    current: string | undefined;
    busy: boolean;
    onSelect: (entry: Entry) => void;
  } = $props();
  let collapsed = $state(false);
  const pages = $derived(recentPages(recent, entries));
</script>

<section class="recent-files" aria-label="最近見たページ">
  <button class="recent-heading" aria-expanded={!collapsed} aria-controls="recent-pages" onclick={() => collapsed = !collapsed}>
    <Icon name={collapsed ? 'right' : 'down'} size={12} />
    <span>最近見たページ</span>
  </button>
  <nav id="recent-pages" class="recent-list" aria-label="最近見たファイル" hidden={collapsed} use:activityScrollbar>
    {#each pages as entry (entry.path)}
      <button class="tree-row" class:active={current === entry.path} aria-current={current === entry.path ? 'page' : undefined} title={entry.path} disabled={busy} onclick={() => onSelect(entry)}>
        <span class="file-icon"><Icon name={entry.kind === 'image' ? 'image' : entry.kind === 'symlink' ? 'external' : 'file'} /></span>
        <span class="recent-label"><span class="file-name">{entry.name}</span>{#if entry.parent}<small>{entry.parent}</small>{/if}</span>
      </button>
    {/each}
  </nav>
</section>
