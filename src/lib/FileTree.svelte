<script lang="ts">
  import Icon from './Icon.svelte';
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

<nav class="file-tree" aria-label="プロジェクト内のファイル">
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
            <Icon name={expanded.includes(row.path) ? 'folder-open' : 'folder'} />
          {:else}
            <Icon name={row.kind === 'image' ? 'image' : row.kind === 'symlink' ? 'external' : 'file'} />
          {/if}
        </span>
        <span class="file-name">{row.name}</span>
        {#if current === row.path}<span class="active-dot" aria-hidden="true"></span>{/if}
      </button>
    {/if}
  {/each}
  {#if project && !rows.length}<p class="tree-empty">まだファイルがありません。<br />＋ から最初の記事を。</p>{/if}
</nav>
