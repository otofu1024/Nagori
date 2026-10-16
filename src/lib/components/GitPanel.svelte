<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { activityScrollbar } from '../editor/activityScrollbar.ts';
  import { gitFile, type GitAction, type GitCommit, type GitStatus } from '../workspace/git.ts';
  let { message = $bindable(''), status, error, pullRequired, pending, disabled, onAction, onOpen, onDismiss }: {
    message?: string; status: GitStatus; error: string; pullRequired: boolean; pending: string; disabled: boolean;
    onAction: (action: GitAction, key: string) => Promise<boolean>; onOpen: (path: string) => void; onDismiss: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let undo = $state<GitCommit | null>(null);
  const staged = $derived(status.changes.filter(change => change.index !== '.'));
  const unstaged = $derived(status.changes.filter(change => change.worktree !== '.'));
  const locked = $derived(disabled || !!pending);
  const labels: Record<string, string> = { M: '変更', A: '追加', D: '削除', '?': '新規', R: '名前の変更', C: 'コピー', U: '競合', T: '種類の変更' };
  async function commit() {
    if (await onAction({ kind: 'commit', message }, 'commit')) message = '';
  }
  async function confirmUndo() {
    undo = status.lastCommit;
    await tick();
    dialog.showModal();
  }
  async function performUndo() {
    const target = undo;
    dialog.close();
    if (target?.undo) await onAction({ kind: 'undo', oid: target.oid, mode: target.undo }, 'undo');
  }
</script>

{#snippet spinner(key: string)}
  {#if pending === key}<span class="git-spinner" role="status" aria-label="実行中"></span>{/if}
{/snippet}

<section class="git-panel" aria-label="Git">
  <div class="git-title">Git</div>
  <div class="git-branch">
    <Icon name="branch" size={17} /><strong title={status.branch}>{status.branch === '(detached)' ? 'HEAD' : status.branch}</strong>
    {#if status.ahead}<span>{status.ahead}つ先</span>{/if}
    <button disabled={locked || !status.upstream} title={status.upstream ? 'push' : 'リモートがありません'} onclick={() => onAction({ kind: 'push' }, 'push')}>push{@render spinner('push')}</button>
  </div>
  {#if !status.upstream}<div class="git-muted git-remote">リモートがありません</div>{/if}
  {#if pullRequired}
    <div class="git-pull" role="alert">
      <p>GitHubに新しい変更があります</p>
      <div><button disabled={locked} onclick={onDismiss}>pullしない</button><button class="primary" disabled={locked} onclick={() => onAction({ kind: 'pull' }, 'pull')}>pullする{@render spinner('pull')}</button></div>
    </div>
  {:else if error}
    <div class="git-error" role="alert"><span title={error}>{error}</span><button aria-label="Gitのエラーを閉じる" onclick={onDismiss}><Icon name="close" size={14} /></button></div>
  {/if}
  <div class="git-commit">
    <textarea aria-label="コミットメッセージ" placeholder="コミットメッセージ" bind:value={message} disabled={locked} rows="2"></textarea>
    <button class="primary" disabled={locked || !message.trim() || !staged.length} onclick={commit}>コミット{@render spinner('commit')}</button>
  </div>
  <div class="git-lists" use:activityScrollbar>
    {#if !status.changes.length}<p class="git-empty">変更はありません</p>{/if}
    {#each [{ title: 'ステージした変更', rows: staged, staged: true }, { title: '変更', rows: unstaged, staged: false }] as group}
      {#if group.rows.length}
        <div class="git-section">
          <div class="git-section-title"><h3>{group.title}<span>{group.rows.length}</span></h3>
            <button disabled={locked} onclick={() => onAction({ kind: group.staged ? 'unstage' : 'stage', paths: group.rows.map(row => row.path) }, group.staged ? 'unstage-all' : 'stage-all')}>{group.staged ? '全部外す' : '全部入れる'}{@render spinner(group.staged ? 'unstage-all' : 'stage-all')}</button>
          </div>
          {#each group.rows as change (change.path)}
            {@const mark = group.staged ? change.index : change.worktree}
            {@const file = gitFile(change.path)}
            {@const key = (group.staged ? 'unstage:' : 'stage:') + change.path}
            <div class="git-file" data-path={change.path}>
              <span class="git-mark" data-status={mark} title={labels[mark] ?? mark}>{mark === '?' ? 'U' : mark}</span>
              <button class="git-file-open" disabled={locked || change.worktree === 'D' || (change.index === 'D' && change.worktree === '.')} title={change.path} onclick={() => onOpen(change.path)}><strong>{file.name}</strong>{#if file.directory}<span class="git-directory" title={file.directory}>{file.shortDirectory}</span>{/if}</button>
              <button class="git-stage" disabled={locked} aria-label={`${change.path}を${group.staged ? '外す' : '入れる'}`} title={group.staged ? '外す' : '入れる'} onclick={() => onAction({ kind: group.staged ? 'unstage' : 'stage', paths: [change.path] }, key)}>{#if pending === key}{@render spinner(key)}{:else}{group.staged ? '−' : '+'}{/if}</button>
            </div>
          {/each}
        </div>
      {/if}
    {/each}
  </div>
  <div class="git-last">
    <div><span class="git-muted">直前のコミット</span><strong title={status.lastCommit?.message}>{status.lastCommit?.message ?? 'コミットはありません'}</strong></div>
    <button disabled={locked || !status.lastCommit?.undo} title={status.lastCommit?.reason ?? '取り消す'} onclick={confirmUndo}>取り消す{@render spinner('undo')}</button>
  </div>
</section>

<dialog class="git-undo-dialog" bind:this={dialog} onclose={() => { if (!dialog.open) undo = null; }}>
  <h2>直前のコミットを取り消しますか</h2>
  <p>{#if undo?.undo === 'reset'}「{undo.message}」はまだpushしていません。コミットを消し、変更はステージした状態で残します。{:else if undo}「{undo.message}」はpush済みです。打ち消すコミットを作ります。{/if}</p>
  <div class="dialog-actions"><button onclick={() => dialog.close()}>キャンセル</button><button class="primary" onclick={performUndo}>取り消す</button></div>
</dialog>

<style>
  .git-panel { flex: 0 0 var(--outline-width); width: var(--outline-width); min-width: 0; height: 100%; display: flex; flex-direction: column; padding: 20px 14px 18px; color: var(--text); background: var(--panel); overflow: hidden; font-size: 12px; }
  .git-title { font-size: 14px; font-weight: 650; color: var(--heading); margin-bottom: 13px; }
  .git-panel button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--border); border-radius: 7px; font-size: 11px; padding: 6px 9px; flex-shrink: 0; }
  .git-branch { display: flex; align-items: center; gap: 9px; min-width: 0; margin-bottom: 10px; }
  .git-branch :global(svg) { color: var(--muted); flex-shrink: 0; }
  .git-branch strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .git-branch span, .git-muted { color: var(--muted); white-space: nowrap; font-size: 11px; }
  .git-branch button { margin-left: auto; }
  .git-remote { margin: 0 0 10px; }
  .git-commit { display: flex; flex-direction: column; gap: 9px; padding-bottom: 20px; }
  textarea { width: 100%; resize: vertical; min-height: 44px; max-height: 160px; font: inherit; line-height: 1.5; border: 1px solid var(--border); border-radius: 7px; padding: 9px; color: var(--text); background: transparent; }
  .git-commit button { font-size: 12px; padding: 9px; }
  .git-lists { flex: 1; min-height: 0; overflow: auto; }
  .git-section { border-top: 1px solid var(--border); padding: 15px 0; color: var(--text); }
  .git-section-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 7px; margin-bottom: 9px; }
  h3 { margin: 0; font-size: 12px; font-weight: 550; }
  h3 span { color: var(--muted); font-weight: 400; margin-left: 9px; }
  .git-section-title button { font-size: 10px; padding: 5px 7px; }
  .git-file { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 0; }
  .git-mark { display: grid; place-items: center; flex: 0 0 23px; height: 23px; border-radius: 5px; font-weight: 650; color: #9c6200; background: #fff0c7; }
  .git-mark[data-status='A'] { color: #487a24; background: #e6f1d7; }
  .git-mark[data-status='?'] { color: #00838a; background: #c7f3f1; }
  .git-mark[data-status='D'], .git-mark[data-status='U'] { color: #bd303a; background: #ffdcdf; }
  .git-mark[data-status='R'] { color: #4b57a2; background: #e9e6fc; }
  .git-file .git-file-open { flex: 1; min-width: 0; overflow: hidden; justify-content: flex-start; border: 0; padding: 3px 0; gap: 8px; text-align: left; }
  .git-file-open strong { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 65%; }
  .git-directory { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .git-file .git-stage { width: 26px; height: 27px; padding: 0; font-size: 17px; }
  .git-last { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--border); padding-top: 16px; margin-top: 8px; }
  .git-last div { min-width: 0; flex: 1; }
  .git-last strong { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 6px; }
  .git-empty { color: var(--muted); border-top: 1px solid var(--border); padding-top: 18px; }
  .git-pull, .git-error { border: 1px solid var(--border); border-radius: 7px; padding: 9px; margin-bottom: 10px; }
  .git-pull { background: #fff8e7; border-color: #e7c16f; }
  .git-pull p { margin: 0 0 9px; line-height: 1.5; }
  .git-pull div { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
  .git-error { display: flex; align-items: flex-start; gap: 5px; color: var(--danger); }
  .git-error span { white-space: pre-line; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.6; overflow-wrap: anywhere; flex: 1; }
  .git-error button { padding: 2px; border: 0; }
  .git-spinner { width: 11px; height: 11px; display: inline-block; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: git-spin .8s linear infinite; }
  @keyframes git-spin { to { transform: rotate(360deg); } }
  :global([data-theme='dark']) .git-mark { color: #f8cf64; background: #57471d; }
  :global([data-theme='dark']) .git-mark[data-status='A'] { color: #b3dc90; background: #304d28; }
  :global([data-theme='dark']) .git-mark[data-status='?'] { color: #6ee2dd; background: #16494e; }
  :global([data-theme='dark']) .git-mark[data-status='D'], :global([data-theme='dark']) .git-mark[data-status='U'] { color: #ffadb4; background: #61313c; }
  :global([data-theme='dark']) .git-mark[data-status='R'] { color: #c6baff; background: #393456; }
  :global([data-theme='dark']) .git-pull { background: #3c3425; border-color: #7c6539; }
</style>
