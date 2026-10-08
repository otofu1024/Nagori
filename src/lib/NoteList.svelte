<script lang="ts">
  import Icon from './Icon.svelte';
  import { activityScrollbar } from './activityScrollbar.ts';
  import { formatNoteDate, type NoteItem } from './noteLists.ts';

  // すべてのノート・スター付き・最近見たノートで使う、記事の一覧
  let { label, notes, current, busy, empty, dated = false, onSelect, onContextMenu }: {
    label: string;
    notes: NoteItem[];
    current: string | undefined;
    busy: boolean;
    empty: string;
    dated?: boolean;
    onSelect: (entry: NoteItem) => void;
    onContextMenu: (event: MouseEvent, entry: NoteItem) => void;
  } = $props();

  function rowKeydown(event: KeyboardEvent, note: NoteItem) {
    if (event.shiftKey && event.key === 'F10') {
      event.preventDefault();
      onContextMenu(event as unknown as MouseEvent, note);
    }
  }
</script>

<nav class="note-list" aria-label={label} use:activityScrollbar>
  {#if !notes.length}<p class="tree-empty">{empty}</p>{/if}
  {#each notes as note (note.path)}
    <button
      class="tree-row"
      class:active={current === note.path}
      aria-current={current === note.path ? 'page' : undefined}
      title={note.path}
      disabled={busy}
      onclick={() => onSelect(note)}
      oncontextmenu={(event) => onContextMenu(event, note)}
      onkeydown={(event) => rowKeydown(event, note)}
    >
      <span class="file-icon"><Icon name="file" /></span>
      <span class="recent-label">
        <span class="file-name">{note.name}</span>
        {#if note.parent || (dated && note.modified !== undefined)}
          <small>{[note.parent, dated && note.modified !== undefined ? formatNoteDate(note.modified) : ''].filter(Boolean).join(' · ')}</small>
        {/if}
      </span>
    </button>
  {/each}
</nav>
