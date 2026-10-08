<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Entry } from './navigation.ts';
  import { canTrash, dragSource, endDrag, isInternalDrag } from './fileDrag.ts';

  // treeはフォルダ（File Tree）の表示。ほかは一覧に切り替える
  export type SidebarView = 'tree' | 'all' | 'starred' | 'recent' | 'trash';
  type Counts = Record<'all' | 'starred' | 'recent' | 'trash', number>;

  let { view, counts, onSelect, onTrash }: {
    view: SidebarView;
    counts: Counts;
    onSelect: (view: SidebarView) => void;
    onTrash: (entry: Entry) => void;
  } = $props();

  // ゴミ箱の上に、ドラッグ中の項目があるか
  let trashHot = $state(false);
  function trashOver(event: DragEvent) {
    const entry = dragSource();
    if (!entry || !isInternalDrag(event) || !canTrash(entry)) {
      trashHot = false;
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    trashHot = true;
  }
  // 離した項目を、右クリックの「ゴミ箱に移動」と同じ処理でゴミ箱へ移す
  function trashDrop(event: DragEvent) {
    const entry = dragSource();
    const accepted = !!entry && isInternalDrag(event) && canTrash(entry);
    endDrag();
    trashHot = false;
    if (!accepted) return;
    event.preventDefault();
    onTrash(entry!);
  }

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
      class:drop-target={item.view === 'trash' && trashHot}
      aria-current={view === item.view ? 'true' : undefined}
      onclick={() => choose(item.view)}
      ondragover={item.view === 'trash' ? trashOver : undefined}
      ondragleave={item.view === 'trash' ? () => (trashHot = false) : undefined}
      ondrop={item.view === 'trash' ? trashDrop : undefined}
    >
      <span class="file-icon"><Icon name={item.icon} size={17} /></span>
      <span class="nav-label">{item.label}</span>
      {#if item.view !== 'trash' || count > 0}<small class="nav-count">{count}</small>{/if}
    </button>
  {/each}
</nav>
