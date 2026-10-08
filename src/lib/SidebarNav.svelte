<script lang="ts">
  import Icon from './Icon.svelte';

  // treeはフォルダ（File Tree）の表示。ほかは一覧に切り替える
  export type SidebarView = 'tree' | 'all' | 'starred' | 'recent' | 'trash';
  type Counts = Record<'all' | 'starred' | 'recent' | 'trash', number>;

  let { view, counts, onSelect }: {
    view: SidebarView;
    counts: Counts;
    onSelect: (view: SidebarView) => void;
  } = $props();

  const items = [
    { view: 'all', label: 'すべてのノート', icon: 'file' },
    { view: 'starred', label: 'スター付き', icon: 'star' },
    { view: 'recent', label: '最近見たノート', icon: 'clock' },
    { view: 'trash', label: 'ゴミ箱', icon: 'trash' },
  ] as const;

  // 選んでいるナビをもう一度押すと、フォルダの表示に戻る
  const choose = (next: SidebarView) => onSelect(view === next ? 'tree' : next);
</script>

<nav class="sidebar-nav" aria-label="ノートの一覧">
  {#each items as item (item.view)}
    {@const count = counts[item.view]}
    <button
      class="nav-row"
      class:active={view === item.view}
      aria-current={view === item.view ? 'true' : undefined}
      onclick={() => choose(item.view)}
    >
      <span class="file-icon"><Icon name={item.icon} size={17} /></span>
      <span class="nav-label">{item.label}</span>
      {#if item.view !== 'trash' || count > 0}<small class="nav-count">{count}</small>{/if}
    </button>
  {/each}
</nav>
