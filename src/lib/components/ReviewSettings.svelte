<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { reviewAis, reviewEfforts, type ReviewAi } from '../workspace/blogReview.ts';
  import type { Settings } from '../workspace/settings.ts';
  let { settings, available, active, disabled, onChange }: { settings: Settings; available: ReviewAi[]; active: boolean; disabled: boolean; onChange: () => void } = $props();
  let loading = $state(false);
  const models = $derived(settings.blogReviewModels[settings.blogReviewAi ?? ''] ?? []);
  $effect(() => {
    const ai = settings.blogReviewAi;
    if (!active || !ai) return;
    let disposed = false;
    loading = true;
    void invoke<string[]>('blog_review_models', { ai }).then(list => {
      if (disposed) return;
      settings.blogReviewModels = { ...settings.blogReviewModels, [ai]: list };
      onChange();
    }).catch(() => {}).finally(() => { if (!disposed) loading = false; });
    return () => { disposed = true; };
  });
</script>
<fieldset class="review-settings" disabled={disabled}>
  <legend>添削のAI</legend>
  <label>AI<select aria-label="添削のAI" bind:value={settings.blogReviewAi} onchange={() => { settings.blogReviewModel = ''; settings.blogReviewEffort = ''; onChange(); }}>
    {#if !available.length}<option value={null}>見つかりません</option>{/if}
    {#each reviewAis.filter(ai => available.includes(ai.id)) as ai}<option value={ai.id}>{ai.label}</option>{/each}
  </select></label>
  <label>モデル<input aria-label="添削のモデル" list="review-models" placeholder="AIの標準" bind:value={settings.blogReviewModel} onchange={onChange} maxlength="200" disabled={!settings.blogReviewAi} aria-busy={loading} /></label>
  <datalist id="review-models"><option value="">AIの標準</option>{#each models as model}<option value={model}>{model}</option>{/each}</datalist>
  <label>考える深さ<select aria-label="添削の考える深さ" bind:value={settings.blogReviewEffort} onchange={onChange} disabled={!settings.blogReviewAi}>
    <option value="">AIの標準</option>{#each reviewEfforts as effort}<option value={effort}>{effort}</option>{/each}
  </select></label>
</fieldset>
<style>
  .review-settings { border: 0; padding: 0; margin: 0; display: grid; gap: 10px; min-width: 0; }
  legend { color: var(--muted); font-size: 13px; margin-bottom: 8px; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  select, input { width: 65%; min-width: 0; font: inherit; padding: 6px 9px; color: var(--text); border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
</style>
