<script lang="ts">
  import { tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import { blogTagCandidates, createBlogPost, newPostErrors } from '../workspace/blogNewPost.ts';
  import { readBlogCategories, type BlogCategory } from '../editor/blogCategories.ts';
  import type { Entry } from '../workspace/navigation.ts';
  import { failure } from '../workspace/session.ts';

  let {
    project,
    busy,
    operation,
    onCreated,
  }: {
    project: string;
    busy: boolean;
    operation: (action: () => Promise<void>) => Promise<boolean | undefined>;
    onCreated: (entry: Entry) => Promise<void>;
  } = $props();
  let dialog: HTMLDialogElement;
  let titleInput: HTMLInputElement;
  let title = $state(''),
    description = $state(''),
    category = $state(''),
    tag = $state('');
  let tags = $state<string[]>([]),
    candidates = $state<string[]>([]);
  let categories = $state<BlogCategory[] | null>(null);
  let error = $state(''),
    loading = $state(false),
    creating = $state(false);
  let composing = false;
  let root = '';
  let request = 0;
  const input = $derived({ title, description, category, tags });
  const invalid = $derived(Object.values(newPostErrors(input, categories)).some(Boolean));

  async function show() {
    root = project;
    const currentRequest = ++request;
    title = '';
    description = '';
    category = '';
    tag = '';
    tags = [];
    candidates = [];
    categories = null;
    error = '';
    composing = false;
    loading = true;
    dialog.showModal();
    await tick();
    titleInput.focus();
    try {
      const [config, documents] = await Promise.all([
        invoke<string | null>('workspace_blog_config'),
        invoke<{ tags: string[] }[]>('workspace_graph_documents').catch(() => []),
      ]);
      if (currentRequest !== request || root !== project || !dialog.open) return;
      categories = readBlogCategories(config);
      if (!categories) throw new Error('src/config.tsのカテゴリを読めません。');
      candidates = blogTagCandidates(documents);
    } catch (reason) {
      if (currentRequest === request) error = failure(reason).message;
    } finally {
      if (currentRequest === request) loading = false;
    }
  }
  function addTag(value = tag) {
    const added = value.trim();
    if (added && !tags.includes(added)) tags = [...tags, added];
    tag = '';
  }
  function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key !== 'Enter') return;
    if (composing || event.isComposing || event.keyCode === 229) {
      event.preventDefault();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      event.preventDefault();
      if ((event.target as HTMLElement).id === 'new-post-tag') addTag();
    }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (composing || creating || busy || loading || invalid || root !== project) return;
    creating = true;
    error = '';
    await operation(async () => {
      let entry: Entry;
      try {
        const values = { ...input, tags: tag.trim() && !tags.includes(tag.trim()) ? [...tags, tag.trim()] : tags };
        entry = await createBlogPost(
          {
            config: () => invoke<string | null>('workspace_blog_config'),
            create: (date, text) => invoke<Entry>('blog_post_create', { expectedRoot: root, date, text }),
          },
          values,
        );
      } catch (reason) {
        error = failure(reason).message;
        return;
      }
      dialog.close();
      await onCreated(entry);
    });
    creating = false;
  }
</script>

<button aria-label="新しい記事" title="新しい記事" disabled={!project || busy} onclick={() => void show()}>
  <Icon name="file-plus" size={17} />
</button>
<dialog
  class="new-post-dialog"
  bind:this={dialog}
  aria-labelledby="new-post-heading"
  onkeydown={keydown}
  oncompositionstart={() => {
    composing = true;
  }}
  oncompositionend={() => {
    composing = false;
  }}
  oncancel={(event) => {
    if (creating) event.preventDefault();
  }}
  onclose={() => {
    request++;
  }}
>
  <form onsubmit={submit}>
    <h2 id="new-post-heading">新しい記事</h2>
    <label for="new-post-title">タイトル</label>
    <input id="new-post-title" bind:this={titleInput} bind:value={title} required disabled={creating} />
    <label for="new-post-description">説明</label>
    <input id="new-post-description" bind:value={description} required disabled={creating} />
    <label for="new-post-category">カテゴリ</label>
    <select id="new-post-category" bind:value={category} required disabled={creating || loading}>
      <option value="">カテゴリ</option>
      {#each categories ?? [] as item (item.key)}<option value={item.key}>{item.label}</option>{/each}
    </select>
    <label for="new-post-tag">タグ</label>
    <div class="tag-input">
      <input id="new-post-tag" bind:value={tag} list="new-post-tags" disabled={creating} />
      <datalist id="new-post-tags"
        >{#each candidates as candidate}<option value={candidate}></option>{/each}</datalist
      >
      <button type="button" disabled={creating || !tag.trim()} onclick={() => addTag()}>追加</button>
    </div>
    <div class="tags">
      {#each tags as selectedTag}
        <button
          type="button"
          disabled={creating}
          aria-label={`${selectedTag}を削除`}
          onclick={() => {
            tags = tags.filter((value) => value !== selectedTag);
          }}>{selectedTag}<Icon name="close" size={12} /></button
        >
      {/each}
    </div>
    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" disabled={creating} onclick={() => dialog.close()}>キャンセル</button>
      <button class="primary" type="submit" disabled={creating || busy || loading || invalid}>作成</button>
    </div>
  </form>
</dialog>

<style>
  .new-post-dialog {
    max-width: 460px;
  }
  label {
    display: block;
    margin: 14px 0 6px;
    font-size: 13px;
  }
  input,
  select {
    width: 100%;
    font-size: 14px;
  }
  .tag-input {
    display: flex;
    gap: 8px;
  }
  .tag-input input {
    min-width: 0;
    flex: 1;
  }
  .tag-input button,
  .tags button {
    border: 1px solid var(--border);
    padding: 6px 10px;
    font-size: 13px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .tags button {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
