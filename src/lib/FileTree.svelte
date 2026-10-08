<script lang="ts">
  import Icon from './Icon.svelte';
  import { activityScrollbar } from './activityScrollbar.ts';
  import type { Entry, Naming } from './navigation.ts';
  import { beginDrag, dragSource, endDrag, HOLD_OPEN_MS, isInternalDrag, moveBlock } from './fileDrag.ts';

  type Row = Entry & { depth: number };
  type Drop = { path: string; row?: Row };

  let {
    project,
    rows,
    expanded,
    current,
    selected,
    busy,
    dragEnabled,
    naming = $bindable(),
    nameInput = $bindable(),
    onSelect,
    onToggle,
    onContextMenu,
    onRename,
    onTrash,
    onMove,
    onCommitName,
  }: {
    project: string;
    rows: Row[];
    expanded: string[];
    current: string | undefined;
    selected: string;
    busy: boolean;
    dragEnabled: boolean;
    naming: Naming | null;
    nameInput?: HTMLInputElement;
    onSelect: (entry: Entry) => void;
    onToggle: (entry: Entry) => void;
    onContextMenu: (event: MouseEvent, entry: Entry) => void;
    onRename: (entry: Entry) => void;
    onTrash: (entry: Entry) => void;
    onMove: (entry: Entry, toDirectory: string) => void;
    onCommitName: () => void;
  } = $props();

  const indent = (row: Row) => `${12 + row.depth * 16}px`;
  // 開いているファイルを含むフォルダか。同じ階層で当てはまるのは多くても1つ
  const onPath = (row: Row) => !!current && current.startsWith(row.path + '/');

  // 離せる場所。フォルダの行、またはフォルダ直下の空いた所（''は一番上）
  let dropTarget = $state<string | null>(null);
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  // 落とした先を要素から求める。ファイルの行と名前の入力欄は対象外（null）
  function dropAt(event: DragEvent): Drop | null {
    const element = event.target instanceof Element ? event.target.closest('.tree-row, .inline-name') : null;
    if (!element) return { path: '' };
    if (!element.classList.contains('tree-row') || element.getAttribute('data-kind') !== 'directory') return null;
    const path = element.getAttribute('data-path') ?? '';
    return { path, row: rows.find((row) => row.path === path) };
  }
  function setDrop(drop: Drop | null) {
    const path = drop?.path ?? null;
    if (path === dropTarget) return;
    clearTimeout(holdTimer);
    dropTarget = path;
    // 閉じたフォルダの上に少し止めると開く
    if (drop?.row && !expanded.includes(drop.row.path)) {
      const row = drop.row;
      holdTimer = setTimeout(() => onToggle(row), HOLD_OPEN_MS);
    }
  }
  function dragStart(event: DragEvent, row: Row) {
    if (!dragEnabled || row.kind === 'symlink') {
      event.preventDefault();
      return;
    }
    beginDrag(event, row);
  }
  function dragOver(event: DragEvent) {
    const entry = dragSource();
    const drop = dropAt(event);
    if (!entry || !isInternalDrag(event) || !drop || moveBlock(entry, drop.path)) {
      setDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    setDrop(drop);
  }
  function dragLeave(event: DragEvent) {
    // 子要素の間を移っただけなら、目印は消さない。WebKitはrelatedTargetを返さないことがあるため、座標で見る
    const box = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    if (box && event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom) return;
    setDrop(null);
  }
  function drop(event: DragEvent) {
    const entry = dragSource();
    const target = dropAt(event);
    const accepted = !!entry && isInternalDrag(event) && !!target && !moveBlock(entry, target.path);
    endDrag();
    setDrop(null);
    if (!accepted) return;
    event.preventDefault();
    onMove(entry!, target!.path);
  }
  // Escで取り消したり、移動の後に離したりした時に、ドラッグの状態を戻す
  function dragEnd() {
    endDrag();
    setDrop(null);
  }

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

<svelte:window ondragend={dragEnd} />
<nav
  use:activityScrollbar
  class="file-tree"
  class:drop-root={dropTarget === ''}
  aria-label="プロジェクト内のファイル"
  ondragover={dragOver}
  ondragleave={dragLeave}
  ondrop={drop}
>
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
        class:drop-target={dropTarget === row.path}
        style:padding-left={indent(row)}
        title={row.path}
        data-path={row.path}
        data-kind={row.kind}
        draggable={dragEnabled && row.kind !== 'symlink' ? 'true' : 'false'}
        disabled={busy}
        onclick={() => onSelect(row)}
        oncontextmenu={(event) => onContextMenu(event, row)}
        onkeydown={(event) => rowKeydown(event, row)}
        ondragstart={(event) => dragStart(event, row)}
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
