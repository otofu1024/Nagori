<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { activityScrollbar } from '../editor/activityScrollbar.ts';
  import type { EditorApi } from '../editor/editor.ts';
  import { reviewAis, reviewRequest, parseReviewResult, orderedIssues, reviewLocation, correctionChanges, suggestionChanges, reviewDiff, type ReviewAi, type ReviewFeature, type ReviewResult } from '../workspace/blogReview.ts';
  import { reviewSkills } from '../review/skills.ts';
  import { blogTagCandidates } from '../workspace/blogNewPost.ts';
  import type { GraphArticle } from '../workspace/graph.ts';
  import { failure } from '../workspace/session.ts';

  let { ai, model = '', effort = '', onSettings, getEditor, revision, disabled = false, visible = true, path }: {
    ai: ReviewAi | null; model?: string; effort?: string; onSettings: () => void; getEditor: () => EditorApi | null; revision: number; disabled?: boolean; visible?: boolean; path: string;
  } = $props();
  let feature = $state<ReviewFeature>('review');
  let phase = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  let message = $state('');
  let result = $state.raw<ReviewResult | null>(null);
  let resultId = $state('');
  let seconds = $state(0);
  let runId: string | null = null, disposed = false, commandStarted = false;
  const current = $derived.by(() => { revision; return getEditor()?.reviewSnapshot() ?? null; });
  const issues = $derived(orderedIssues(current?.text ?? '', result?.issues ?? []).filter(item => !current?.dismissed?.includes(`${resultId}:${item.index}`)));
  $effect(() => {
    if (phase !== 'running') return;
    const started = Date.now();
    seconds = 0;
    const timer = setInterval(() => { seconds = Math.floor((Date.now() - started) / 1000); }, 1000);
    return () => clearInterval(timer);
  });
  function switchFeature(next: ReviewFeature) {
    if (phase === 'running') return;
    feature = next; result = null; phase = 'idle'; message = '';
  }
  async function run() {
    const editor = getEditor();
    if (!editor || !ai || disabled || phase === 'running') return;
    result = null; message = ''; phase = 'running'; seconds = 0;
    const id = runId = crypto.randomUUID(), selected = feature, selectedAi = ai, selectedModel = model, selectedEffort = effort;
    try {
      const tags = selected === 'suggest' ? blogTagCandidates((await invoke<GraphArticle[]>('workspace_graph_documents')).filter(article => article.path !== path)) : [];
      if (disposed || runId !== id) return;
      const request = { ...reviewRequest(editor.reviewSnapshot(), selected, reviewSkills, tags), model: selectedModel, effort: selectedEffort };
      commandStarted = true;
      const answer = await invoke('blog_review_run', { id, ai: selectedAi, request });
      if (disposed || runId !== id) return;
      result = parseReviewResult(selected, answer); resultId = id; phase = 'done';
    } catch (error) {
      if (disposed || runId !== id) return;
      if (failure(error).code === 'CANCELLED') phase = 'idle';
      else { phase = 'error'; message = failure(error).message.slice(0, 240); }
    } finally { if (runId === id) { runId = null; commandStarted = false; } }
  }
  async function cancel() {
    const id = runId, started = commandStarted;
    if (!id) return;
    runId = null; commandStarted = false; phase = 'idle'; result = null; message = '';
    if (started) try { await invoke('blog_review_cancel', { id }); }
    catch (error) { if (!disposed && !runId) { phase = 'error'; message = failure(error).message.slice(0, 240); } }
  }
  function correct(index: number) {
    const editor = getEditor(), issue = result?.issues?.[index];
    if (!editor || !issue || disabled) return;
    const text = editor.reviewSnapshot().text;
    try { editor.applyReview(text, correctionChanges(text, issue), `${resultId}:${index}`); }
    catch (error) { message = failure(error).message; }
  }
  function ignore(index: number) {
    const editor = getEditor();
    if (!disabled && editor) editor.applyReview(editor.reviewSnapshot().text, [], `${resultId}:${index}`);
  }
  function select(index: number) {
    const editor = getEditor(), issue = result?.issues?.[index];
    if (!editor || !issue || disabled) return;
    const location = reviewLocation(editor.reviewSnapshot().text, issue.quote);
    if (!location.reason) editor.selectReviewRange(location.from, location.to);
  }
  function suggest(key: 'description' | 'tags' | 'title', value: string) {
    const editor = getEditor();
    if (!editor || disabled) return;
    const text = editor.reviewSnapshot().text;
    try { editor.applyReview(text, suggestionChanges(text, key, value)); }
    catch (error) { message = failure(error).message; }
  }
  onDestroy(() => { disposed = true; if (runId && commandStarted) void invoke('blog_review_cancel', { id: runId }).catch(() => {}); });
</script>

<section hidden={!visible} class="blog-review" aria-label="添削">
  <div class="review-controls">
    <div class="review-tabs" role="tablist" aria-label="添削の機能">
      <button role="tab" aria-selected={feature === 'review'} aria-controls="review-results" disabled={phase === 'running'} onclick={() => switchFeature('review')}>添削</button>
      <button role="tab" aria-selected={feature === 'suggest'} aria-controls="review-results" disabled={phase === 'running'} onclick={() => switchFeature('suggest')}>提案</button>
    </div>
    <div class="review-execution">
      {#if phase === 'running'}
        <button class="review-run" onclick={() => void cancel()}>取り消す</button>
        <span class="review-progress" role="status"><span class="review-spinner" aria-hidden="true"></span><span>{seconds}秒</span></span>
      {:else}<button class="review-run" disabled={disabled || !ai} onclick={() => void run()}>{phase === 'error' ? 'もう一度' : feature === 'review' ? '添削する' : '提案する'}</button>{/if}
    </div>
  </div>
  <div id="review-results" class="review-results" role="tabpanel" aria-label={feature === 'review' ? '添削の結果' : '提案の結果'} use:activityScrollbar>
    <div class="review-content">
    {#if phase === 'error'}<div class="review-error" role="alert"><p>うまくいきませんでした</p><p>{message}</p></div>
    {:else if phase === 'done'}
      {#if result?.issues}
        {#if !issues.length}<p class="review-empty">指摘はありません</p>{/if}
        <ol class="review-issues">
          {#each issues as { issue, index, location } (index)}
            {@const confirmation = !issue.replacement && (issue.kind === '公開前の確認' || issue.kind === '事実の確認')}
            {@const diff = reviewDiff(issue.quote, confirmation ? issue.quote : issue.replacement)}
            <li class="review-card" class:review-missing={!!location.reason}>
              <span class="review-kind" class:error-kind={issue.kind === '誤り'} class:variant-kind={issue.kind === '表記ゆれ'}>{issue.kind}</span>
              <button class="review-diff" disabled={disabled || !!location.reason} title={location.reason || undefined} onclick={() => select(index)}>{diff.prefix}{#if diff.removed}<del>{diff.removed}</del>{/if}{#if diff.added}<ins>{diff.added}</ins>{/if}{diff.suffix}</button>
              <p class="review-reason" title={issue.reason}>{issue.reason}</p>
              <div class="review-actions"><button class="review-correct" disabled={disabled || !!location.reason || confirmation} onclick={() => correct(index)}>直す</button><button disabled={disabled} onclick={() => ignore(index)}>無視</button></div>
            </li>
          {/each}
        </ol>
      {:else if result?.descriptions}
        {#each [{ key: 'description', label: '説明', values: result.descriptions }, { key: 'tags', label: 'タグ', values: result.tags ?? [] }, { key: 'title', label: 'タイトル', values: result.titles ?? [] }] as group}
          <h3>{group.label}</h3><ul class="review-suggestions">{#each group.values as value}<li><button {disabled} onclick={() => suggest(group.key as 'description' | 'tags' | 'title', value)}>{value}</button></li>{/each}</ul>
        {/each}
      {/if}
      {#if message}<p class="review-error" role="alert">{message}</p>{/if}
    {/if}
    </div>
  </div>
  <footer><button class="review-ai" onclick={onSettings}>{reviewAis.find(item => item.id === ai)?.label ?? 'AI'}{#if model} · {model}{/if}</button></footer>
</section>

<style>
  .blog-review { flex: 0 0 var(--outline-width, 220px); min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--surface); color: var(--text); font-size: 13px; font-weight: 400; overflow-wrap: anywhere; }
  .blog-review[hidden] { display: none; }
  .review-controls { flex: none; padding: 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .review-tabs { display: flex; gap: 10px; }
  .review-tabs button { border-radius: 0; padding: 8px 4px; color: var(--muted); border-bottom: 2px solid transparent; }
  .review-tabs button[aria-selected='true'] { color: var(--accent); border-bottom-color: var(--accent); }
  .review-execution { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .review-run { background: var(--accent); color: var(--surface); border-radius: 8px; padding: 7px 12px; }
  .review-progress { display: flex; gap: 7px; align-items: center; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .review-spinner { width: 15px; height: 15px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: review-spin 0.8s linear infinite; }
  @keyframes review-spin { to { transform: rotate(360deg); } }
  .review-results { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
  /* スクロールバーの継承色を結果の文字へ伝えない。 */
  .review-content { color: var(--text); }
  .review-issues, .review-suggestions { padding: 0; margin: 0; list-style: none; display: grid; gap: 10px; }
  .review-card { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
  .review-kind { display: inline-block; color: var(--muted); background: var(--hover); border-radius: 12px; padding: 3px 9px; font-size: 11px; }
  .review-kind.error-kind { background: color-mix(in srgb, var(--danger) 16%, var(--surface)); color: var(--danger); }
  .review-kind.variant-kind { background: color-mix(in srgb, #e9aa32 22%, var(--surface)); color: color-mix(in srgb, #bd8220 75%, var(--text)); }
  .review-diff { display: block; width: 100%; text-align: left; white-space: pre-wrap; padding: 0; margin: 10px 0 7px; border-radius: 0; color: var(--text); font-weight: 400; font-size: inherit; line-height: 1.8; }
  .review-diff:hover { background: transparent; }
  .review-diff:disabled { opacity: 1; }
  del, ins { color: inherit; padding: 1px 2px; border-radius: 3px; }
  del { background: color-mix(in srgb, var(--danger) 17%, transparent); }
  ins { background: color-mix(in srgb, #51b977 20%, transparent); text-decoration: none; }
  .review-reason { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 0 8px; line-height: 1.6; }
  .review-actions { display: flex; justify-content: flex-end; gap: 7px; }
  .review-actions button { border: 1px solid var(--border); padding: 4px 10px; border-radius: 7px; font-size: 12px; }
  .review-actions .review-correct { color: var(--accent); border-color: var(--accent); }
  .review-missing { opacity: 0.5; }
  h3 { font-size: 12px; font-weight: 400; color: var(--muted); margin: 10px 0; }
  .review-suggestions { margin-bottom: 18px; }
  .review-suggestions button { border: 1px solid var(--border); border-radius: 10px; width: 100%; padding: 10px; text-align: left; color: var(--text); font-weight: 400; line-height: 1.8; }
  .review-error p, .review-empty { margin: 0 0 8px; }
  footer { flex: none; padding: 8px 12px; text-align: right; }
  .review-ai { color: var(--muted); font-size: 11px; padding: 4px 0; text-align: right; }
</style>
