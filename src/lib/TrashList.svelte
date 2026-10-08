<script lang="ts">
  import Icon from './Icon.svelte';
  import { activityScrollbar } from './activityScrollbar.ts';
  import { formatNoteDate, type TrashItem } from './noteLists.ts';
  import { parentPath } from './navigation.ts';

  // アプリ内のゴミ箱の一覧。項目は開かず、戻す・完全に削除するだけ
  let { items, busy, onRestore, onDelete, onEmpty, onContextMenu }: {
    items: TrashItem[];
    busy: boolean;
    onRestore: (item: TrashItem) => void;
    onDelete: (item: TrashItem) => void;
    onEmpty: () => void;
    onContextMenu: (event: MouseEvent, item: TrashItem) => void;
  } = $props();

  const origin = (item: TrashItem) => parentPath(item.path) || 'プロジェクト直下';
  const iconName = (item: TrashItem) => (item.kind === 'directory' ? 'folder' : item.kind === 'image' ? 'image' : 'file');
</script>

<section class="trash-list" aria-label="ゴミ箱">
  {#if !items.length}
    <p class="tree-empty">ゴミ箱は空です</p>
  {:else}
    <div class="trash-actions">
      <button disabled={busy} onclick={onEmpty}>ゴミ箱を空にする</button>
    </div>
    <ul class="trash-items" use:activityScrollbar>
      {#each items as item (item.id)}
        <li class="trash-item" oncontextmenu={(event) => onContextMenu(event, item)}>
          <span class="file-icon"><Icon name={iconName(item)} /></span>
          <span class="recent-label">
            <span class="file-name" title={item.path}>{item.name}</span>
            <small>{origin(item)} · {formatNoteDate(item.deletedAt)}</small>
          </span>
          <button class="trash-button" aria-label="元に戻す: {item.name}" title="元に戻す" disabled={busy} onclick={() => onRestore(item)}><Icon name="restore" size={16} /></button>
          <button class="trash-button danger" aria-label="完全に削除: {item.name}" title="完全に削除" disabled={busy} onclick={() => onDelete(item)}><Icon name="trash" size={16} /></button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
