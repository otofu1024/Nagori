<script lang="ts">
  import Icon from './Icon.svelte';
  import { activityScrollbar } from './activityScrollbar.ts';
  import type { Entry, Naming } from './navigation.ts';

  type Row = Entry & { depth: number };

  let {
    project,
    rows,
    expanded,
    current,
    selected,
    busy,
    naming = $bindable(),
    nameInput = $bindable(),
    onSelect,
    onToggle,
    onContextMenu,
    onRename,
    onTrash,
    onCommitName,
  }: {
    project: string;
    rows: Row[];
    expanded: string[];
    current: string | undefined;
    selected: string;
    busy: boolean;
    naming: Naming | null;
    nameInput?: HTMLInputElement;
    onSelect: (entry: Entry) => void;
    onToggle: (entry: Entry) => void;
    onContextMenu: (event: MouseEvent, entry: Entry) => void;
    onRename: (entry: Entry) => void;
    onTrash: (entry: Entry) => void;
    onCommitName: () => void;
  } = $props();

  const indent = (row: Row) => `${12 + row.depth * 16}px`;
  // 開いているファイルを含むフォルダか。同じ階層で当てはまるのは多くても1つ
  const onPath = (row: Row) => !!current && current.startsWith(row.path + '/');

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onCommitName();
  }

  function rowKeydown(event: KeyboardEvent, row: Row) {
    const open = expanded.includes(row.path);
    if (event.key === 'F2') {
      event.preventDefault();
      if (row.kind !== 'symlink') onRename(row);
    } else if (event.shiftKey && event.key === 'F10') {
      event.preventDefault();
      onContextMenu(event as unknown as MouseEvent, row);
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && event.metaKey && row.kind !== 'symlink') {
      event.preventDefault();
      onTrash(row);
    } else if (row.kind === 'directory' && ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open))) {
      event.preventDefault();
      onToggle(row);
    }
  }
</script>

<nav use:activityScrollbar class="file-tree" aria-label="プロジェクト内のファイル">
  {#if !project}<p class="tree-empty">フォルダを開くと、<br />記事がここに並びます。</p>{/if}
  {#if naming && naming.kind !== 'rename'}
    <form class="inline-name new-name" onsubmit={submit}>
      <small>{naming.parent || 'プロジェクト直下'}に{naming.kind === 'markdown' ? '記事' : 'フォルダ'}を作成</small>
      <input
        aria-label="新しい名前"
        bind:this={nameInput}
        bind:value={naming.value}
        onkeydown={(event) => {
          if (event.key === 'Escape') naming = null;
        }}
      />
      <button type="submit" disabled={busy}>作成</button>
      {#if naming.error}<small class="error-text">{naming.error}</small>{/if}
    </form>
  {/if}
  {#each rows as row (row.path)}
    {#if naming?.kind === 'rename' && naming.entry?.path === row.path}
      <form class="inline-name" style:padding-left={indent(row)} onsubmit={submit}>
        <input aria-label="名前を変更" bind:this={nameInput} bind:value={naming.value} />
        <button type="submit" disabled={busy}>↵</button>
        {#if naming.error}<small class="error-text">{naming.error}</small>{/if}
      </form>
    {:else}
      <button
        class="tree-row"
        class:active={current === row.path}
        class:selected={selected === row.path}
        style:padding-left={indent(row)}
        title={row.path}
        disabled={busy}
        onclick={() => onSelect(row)}
        oncontextmenu={(event) => onContextMenu(event, row)}
        onkeydown={(event) => rowKeydown(event, row)}
      >
        <span class="file-icon" class:folder={row.kind === 'directory'}>
          {#if row.kind === 'directory'}
            <span class="tree-chevron"><Icon name={expanded.includes(row.path) ? 'down' : 'right'} size={12} /></span>
            <!-- 2色の塗りのフォルダ。開いているファイルを含むフォルダだけミント、ほかは青 -->
            <svg class="folder-glyph" class:on-path={onPath(row)} viewBox="0 0 24 20" width="22" height="18" aria-hidden="true">
              <path class="folder-back" d="M2 4a2 2 0 0 1 2-2h5.2l2 2.2H20a2 2 0 0 1 2 2V8H2z" />
              <path class="folder-front" d="M2 7.2h20V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
            </svg>
          {:else}
            <Icon name={row.kind === 'image' ? 'image' : row.kind === 'symlink' ? 'external' : 'file'} />
          {/if}
        </span>
        <span class="file-name">{row.name}</span>
      </button>
    {/if}
  {/each}
  {#if project && !rows.length}<p class="tree-empty">まだファイルがありません。<br />＋ から最初の記事を。</p>{/if}
</nav>
