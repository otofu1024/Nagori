<script lang="ts">
  import { untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { confirm } from '@tauri-apps/plugin-dialog';
  import { blogThemes, themeName, type ThemeSnapshot, type ThemeSaved } from '../blogThemes/index.ts';

  let { project, active = true, disabled = false, themeCss = null, onSaved = () => {} }: {
    project: string;
    disabled?: boolean;
    active?: boolean;
    themeCss?: string | null;
    onSaved?: () => void | Promise<void>;
  } = $props();
  let snapshot = $state<ThemeSnapshot | null>(null);
  let selected = $state('');
  let loading = $state(false);
  let pending = $state(false);
  let error = $state('');
  let request = 0;
  const unavailable = $derived(!active || disabled || loading || pending || !snapshot);

  async function reload() {
    const root = project, token = ++request;
    if (!active || disabled || !root) { snapshot = null; loading = false; return; }
    loading = true;
    try {
      const result = await invoke<ThemeSnapshot>('blog_themes_read', { project: root });
      if (token !== request || root !== project) return;
      snapshot = result;
      selected = result.current ?? '';
      error = '';
    } catch (issue) {
      if (token === request && root === project) {
        snapshot = null;
        error = (issue as { message?: string }).message ?? String(issue);
      }
    } finally { if (token === request) loading = false; }
  }
  $effect(() => { project; active; disabled; themeCss; untrack(() => { void reload(); }); });

  async function change(id?: string) {
    if (unavailable || !snapshot || (!id && !selected)) return;
    // 確認中に外で変わった内容を、新しい基準で上書きしない。
    const root = project, baseline = snapshot.baseline, preset = selected;
    pending = true;
    error = '';
    try {
      const message = id ? 'この履歴のtheme.cssに戻しますか？' : `「${themeName(preset)}」でtheme.cssを置き換えますか？`;
      if (!await confirm(message, { title: 'ブログのテーマ', kind: 'warning', okLabel: id ? '戻す' : '適用', cancelLabel: 'キャンセル' })) return;
      if (root !== project || !active || disabled) return;
      const result = await invoke<ThemeSaved>(id ? 'blog_themes_restore' : 'blog_themes_apply', { project: root, baseline, ...(id ? { id } : { preset }) });
      if (root !== project) return;
      await onSaved();
      await reload();
      if (result.cleanupErrors.length) error = `テーマは保存しました。履歴の整理に失敗しました。${result.cleanupErrors.join('、')}`;
    } catch (issue) {
      if (root === project) error = (issue as { message?: string }).message ?? String(issue);
    } finally { pending = false; }
  }
  async function removeCustom(id: string) {
    if (unavailable) return;
    const root = project;
    pending = true;
    error = '';
    try {
      if (!await confirm(`「${themeName(id)}」を削除しますか？`, { title: 'ブログのテーマ', kind: 'warning', okLabel: '削除', cancelLabel: 'キャンセル' })) return;
      if (root !== project || !active || disabled) return;
      const result = await invoke<ThemeSnapshot>('blog_themes_delete', { project: root, id });
      if (root !== project) return;
      // 削除直後の再読み込みでは、今使っているカスタムをすぐに保存し直してしまう。
      snapshot = result;
      selected = result.current ?? '';
    } catch (issue) {
      if (root === project) error = (issue as { message?: string }).message ?? String(issue);
    } finally { pending = false; }
  }
</script>

<div class="blog-themes" aria-busy={loading || pending}>
  <label class="theme-row">テーマ
    <select aria-label="ブログのテーマ" bind:value={selected} disabled={unavailable}>
      {#if !snapshot?.current}<option value="" disabled>未登録</option>{/if}
      {#each blogThemes as theme (theme.id)}<option value={theme.id}>{theme.name}</option>{/each}
      {#each snapshot?.customs ?? [] as theme (theme.id)}<option value={theme.id}>{theme.name}</option>{/each}
    </select>
    <button type="button" disabled={unavailable || !selected || selected === snapshot?.current} onclick={() => void change()}>適用</button>
  </label>
  {#if snapshot}<output aria-label="現在のテーマ">現在のテーマ {themeName(snapshot.current)}</output>{/if}
  {#if snapshot?.customs.length}
    <details class="custom-themes">
      <summary>カスタムテーマ</summary>
      <ul>
        {#each snapshot.customs as theme (theme.id)}
          <li><span>{theme.name}</span><button type="button" disabled={unavailable} onclick={() => void removeCustom(theme.id)}>削除</button></li>
        {/each}
      </ul>
    </details>
  {/if}
  <details class="theme-history">
    <summary>テーマの履歴</summary>
    {#if snapshot?.history.length}
      <ul>
        {#each snapshot.history as entry (entry.id)}
          <li>
            <time datetime={new Date(entry.savedAt).toISOString()}>{new Date(entry.savedAt).toLocaleString('ja-JP')}</time>
            <span>{themeName(entry.theme)}</span>
            <button type="button" disabled={unavailable} onclick={() => void change(entry.id)}>戻す</button>
          </li>
        {/each}
      </ul>
    {:else}<span class="empty-history">履歴なし</span>{/if}
  </details>
  {#if error}<p role="alert">{error}</p><button type="button" disabled={disabled || pending || loading} onclick={() => void reload()}>再読み込み</button>{/if}
</div>

<style>
  .blog-themes { display: grid; gap: 10px; }
  .theme-row { display: flex; align-items: center; gap: 8px; }
  select { flex: 1; min-width: 0; font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; }
  button { padding: 6px 10px; border: 1px solid var(--border); }
  output, .empty-history { color: var(--muted); font-size: 13px; }
  summary { cursor: pointer; }
  ul { list-style: none; margin: 10px 0 0; padding: 0; max-height: 180px; overflow: auto; }
  li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  time { flex: 1; font-size: 12px; color: var(--muted); }
  p { margin: 0; color: var(--danger); }
</style>
