<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { activityScrollbar } from '../editor/activityScrollbar.ts';
  import type { EditorApi } from '../editor/editor.ts';
  import {
    reviewFeatures,
    reviewAis,
    reviewRequest,
    reviewTarget,
    parseReviewResult,
    reviewLocation,
    rewriteLocation,
    correctionChanges,
    suggestionChanges,
    rewriteDiff,
    type ReviewAi,
    type ReviewFeature,
    type ReviewResult,
    type ReviewSnapshot,
  } from '../workspace/blogReview.ts';
  import { blogTagCandidates } from '../workspace/blogNewPost.ts';
  import type { GraphArticle } from '../workspace/graph.ts';
  import { failure } from '../workspace/session.ts';

  let {
    ai,
    getEditor,
    revision,
    disabled = false,
    visible = true,
    path,
  }: {
    ai: ReviewAi | null;
    getEditor: () => EditorApi | null;
    revision: number;
    disabled?: boolean;
    visible?: boolean;
    path: string;
  } = $props();
  let feature = $state<ReviewFeature>('proofread');
  let phase = $state<'idle' | 'running' | 'cancelling' | 'cancelled' | 'done' | 'error'>('idle');
  let message = $state('');
  let result = $state.raw<ReviewResult | null>(null);
  let snapshot = $state.raw<ReviewSnapshot | null>(null);
  let dismissed = $state<number[]>([]);
  let adopted = $state(false);
  let runningAi = $state<ReviewAi | null>(null);
  let runId: string | null = null,
    disposed = false,
    commandStarted = false;
  const isCancelling = () => phase === 'cancelling';
  const running = $derived(phase === 'running' || phase === 'cancelling');
  const target = $derived(snapshot ? reviewTarget(snapshot, feature) : null);
  const diff = $derived(target && result?.rewritten !== undefined ? rewriteDiff(target.original, result.rewritten) : null);
  const current = $derived.by(() => {
    revision;
    return getEditor()?.reviewSnapshot() ?? null;
  });
  const rewritePosition = $derived(snapshot && current ? rewriteLocation(current.text, snapshot) : null);

  async function run() {
    const editor = getEditor();
    if (!editor || !ai || disabled || running) return;
    snapshot = editor.reviewSnapshot();
    runningAi = ai;
    result = null;
    dismissed = [];
    adopted = false;
    message = '';
    phase = 'running';
    const id = (runId = crypto.randomUUID()),
      selected = feature,
      selectedAi = ai;
    try {
      const tags =
        selected === 'suggest'
          ? blogTagCandidates((await invoke<GraphArticle[]>('workspace_graph_documents')).filter((article) => article.path !== path))
          : [];
      if (disposed || runId !== id || phase !== 'running') return;
      snapshot = editor.reviewSnapshot();
      const request = reviewRequest(snapshot, selected, tags);
      commandStarted = true;
      const answer = await invoke('blog_review_run', { id, ai: selectedAi, request });
      if (disposed || runId !== id) return;
      if (isCancelling()) {
        phase = 'cancelled';
        return;
      }
      result = parseReviewResult(selected, answer);
      phase = 'done';
    } catch (error) {
      if (disposed || runId !== id) return;
      if (isCancelling() || failure(error).code === 'CANCELLED') phase = 'cancelled';
      else {
        phase = 'error';
        message = failure(error).message.slice(0, 240);
      }
    } finally {
      if (runId === id) {
        runId = null;
        commandStarted = false;
        if (!disposed && isCancelling()) phase = 'cancelled';
      }
    }
  }
  async function cancel() {
    if (!runId || phase !== 'running') return;
    phase = 'cancelling';
    try {
      if (commandStarted) await invoke('blog_review_cancel', { id: runId });
    } catch (error) {
      if (!disposed) {
        message = failure(error).message.slice(0, 240);
        phase = 'error';
      }
    }
  }
  function adopt(changes: import('../workspace/frontMatter.ts').TextChange[], expected: string) {
    if (disabled || running || !getEditor()?.applyReview(expected, changes)) {
      message = '本文が変わったため採用できません。';
      return false;
    }
    message = '';
    return true;
  }
  function correct(index: number) {
    const issue = result?.issues?.[index],
      current = getEditor()?.reviewSnapshot().text;
    if (!issue || current === undefined) return;
    try {
      if (adopt(correctionChanges(current, issue), current)) dismissed = [...dismissed, index];
    } catch (error) {
      message = failure(error).message;
    }
  }
  function selectIssue(index: number) {
    const editor = getEditor(),
      issue = result?.issues?.[index];
    if (!editor || !issue || disabled) return;
    const location = reviewLocation(editor.reviewSnapshot().text, issue.original);
    if (!location.reason) editor.selectReviewRange(location.from, location.to);
  }
  function suggest(key: 'description' | 'tags' | 'title', value: string) {
    const current = getEditor()?.reviewSnapshot().text;
    if (current === undefined) return;
    try {
      adopt(suggestionChanges(current, key, value), current);
    } catch (error) {
      message = failure(error).message;
    }
  }
  function rewrite() {
    const current = getEditor()?.reviewSnapshot();
    if (!snapshot || !current || result?.rewritten === undefined) return;
    const location = rewriteLocation(current.text, snapshot);
    if (location.reason) {
      message = location.reason;
      return;
    }
    if (adopt([{ from: location.from, to: location.to, insert: result.rewritten }], current.text)) adopted = true;
  }
  onDestroy(() => {
    disposed = true;
    if (runId && commandStarted) void invoke('blog_review_cancel', { id: runId }).catch(() => {});
  });
</script>

<section hidden={!visible} use:activityScrollbar class="blog-review" aria-label="添削">
  <h2>添削</h2>
  <div class="review-controls">
    <select
      aria-label="添削の機能"
      bind:value={feature}
      disabled={running}
      onchange={() => {
        result = null;
        phase = 'idle';
        message = '';
      }}
    >
      {#each Object.entries(reviewFeatures) as [key, item]}<option value={key}>{item.label}</option>{/each}
    </select>
    <button type="button" onclick={() => void run()} disabled={disabled || !ai || running}>{reviewFeatures[feature].label}</button>
    {#if running}<button type="button" onclick={() => void cancel()} disabled={phase === 'cancelling'}>取り消す</button>{/if}
  </div>
  <div class="review-status" role="status">
    {#if !ai}添削のAIが見つかりません。
    {:else if phase === 'running'}{reviewAis.find((item) => item.id === runningAi)?.label}で実行中…
    {:else if phase === 'cancelling'}取り消し中…
    {:else if phase === 'cancelled'}取り消しました。
    {:else if phase === 'error'}失敗しました。{/if}
    {#if message}<p>{message}</p>{/if}
  </div>
  {#if result?.issues}
    {#if !result.issues.length}<p>指摘はありません。</p>{/if}
    <ol class="review-issues">
      {#each result.issues as issue, index}
        {#if !dismissed.includes(index)}
          {@const location = reviewLocation(current?.text ?? '', issue.original)}
          <li>
            <button class="review-quote" type="button" disabled={!!location.reason || disabled} onclick={() => selectIssue(index)}
              >{issue.original}</button
            >
            <p class="review-replacement">{issue.replacement}</p>
            <p>{issue.reason}</p>
            {#if location.reason}<p class="review-missing">{location.reason}</p>{/if}
            <div class="review-actions">
              <button type="button" disabled={disabled || !!location.reason} onclick={() => correct(index)}>直す</button><button
                type="button"
                onclick={() => (dismissed = [...dismissed, index])}>無視する</button
              >
            </div>
          </li>
        {/if}
      {/each}
    </ol>
  {:else if diff}
    <div class="review-diff">
      <div>
        <h3>元の文</h3>
        <pre>{diff.prefix}<del>{diff.removed}</del>{diff.suffix}</pre>
      </div>
      <div>
        <h3>案</h3>
        <pre>{diff.prefix}<ins>{diff.added}</ins>{diff.suffix}</pre>
      </div>
    </div>
    {#if result?.checks?.length}<h3>確認事項</h3>
      <ul>
        {#each result.checks as item}<li>{item}</li>{/each}
      </ul>{/if}
    {#if rewritePosition?.reason && !adopted}<p>{rewritePosition.reason}</p>{/if}
    <button type="button" disabled={disabled || !rewritePosition || !!rewritePosition.reason || adopted} onclick={rewrite}
      >{adopted ? '採用済み' : '採用する'}</button
    >
    <button type="button" onclick={() => (result = null)}>見送る</button>
  {:else if result?.descriptions}
    {#each [{ key: 'description', label: '説明文', values: result.descriptions }, { key: 'tags', label: 'タグ', values: result.tags ?? [] }, { key: 'title', label: 'タイトル', values: result.titles ?? [] }] as group}
      <h3>{group.label}</h3>
      <ul class="review-suggestions">
        {#each group.values as value}<li>
            <button type="button" {disabled} onclick={() => suggest(group.key as 'description' | 'tags' | 'title', value)}>{value}</button>
          </li>{/each}
      </ul>
    {/each}
  {/if}
</section>

<style>
  .blog-review {
    flex: 0 0 var(--outline-width, 220px);
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 24px 12px;
    color: var(--muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  h2 {
    font-size: 14px;
    color: var(--heading);
    margin: 8px 0 16px;
  }
  h3 {
    color: var(--heading);
    font-size: 13px;
    margin: 16px 0 8px;
  }
  .review-controls,
  .review-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  button,
  select {
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 6px 8px;
    background: var(--surface);
    color: var(--heading);
    max-width: 100%;
  }
  .review-status {
    margin-top: 12px;
  }
  p {
    white-space: pre-wrap;
  }
  ul,
  ol {
    padding: 0;
    list-style: none;
  }
  .review-issues > li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .review-quote,
  .review-suggestions button {
    text-align: left;
    white-space: pre-wrap;
    width: 100%;
  }
  .review-replacement {
    color: var(--heading);
  }
  .review-missing {
    color: var(--danger);
  }
  .review-diff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .review-diff > div {
    min-width: 0;
  }
  pre {
    white-space: pre-wrap;
    font-family: inherit;
    margin: 0;
  }
  del {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
  }
  ins {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    text-decoration: none;
  }
  .review-suggestions li {
    margin: 6px 0;
  }
</style>
