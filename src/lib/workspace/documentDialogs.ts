import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { failure, type EditSession, type Failure, type OpenedDocument } from './session.ts';
import { pushRecentFile, recordOpened } from './noteLists.ts';
import type { Settings } from './settings.ts';
import type { Entry } from './navigation.ts';
import type { EditorApi } from '../editor/editor.ts';

type DocumentDialogDeps = {
  session: EditSession | null;
  issue: Failure | null;
  disk: OpenedDocument | null;
  diskLabel: string;
  errorDialog: HTMLDialogElement | undefined;
  saveAsDialog: HTMLDialogElement | undefined;
  saveAsInput: HTMLInputElement | undefined;
  saveAsPath: string;
  saveAsError: string;
  busy: boolean;
  current: Entry | null;
  selected: string;
  settings: Settings;
  project: string;
  editor: EditorApi | null;
  openRequestsQueued: boolean;
  settleComposition(): Promise<void>;
  flush(): Promise<boolean>;
  releaseImages(): void;
  syncSession(): void;
  refreshTree(): Promise<void>;
  refreshIndex(): Promise<Entry[]>;
  persist(): Promise<void>;
  scheduleSave(): void;
  notify(message: string): void;
  drainOpenRequests(): Promise<void>;
  clearDocument(): void;
};

export function createDocumentDialogs(deps: DocumentDialogDeps) {
  async function showProblem() {
    const target = deps.session;
    if (!target?.issue) return;
    deps.issue = target.issue;
    deps.disk = null;
    deps.diskLabel = '';
    if (deps.issue.code === 'CONFLICT') {
      try {
        const fresh = await invoke<OpenedDocument>('document_open', { path: target.path });
        if (deps.session !== target || !target.issue) return;
        deps.disk = fresh;
        deps.diskLabel = fresh.text.slice(0, 500);
      } catch {}
    }
    await tick();
    if (deps.session !== target || !target.issue) return;
    if (!deps.errorDialog?.open) deps.errorDialog?.showModal();
  }
  async function reloadDisk() {
    const target = deps.session;
    if (!target) return;
    try {
      if (
        !(await confirm('編集中の内容を破棄して、最新のディスク内容を採用します。Undo履歴もリセットされます。', {
          title: 'ディスク内容を採用',
          kind: 'warning',
          okLabel: '採用する',
          cancelLabel: 'キャンセル',
        }))
      )
        return;
      const fresh = await invoke<OpenedDocument>('document_open', { path: target.path });
      if (deps.session !== target) return;
      target.reload(fresh);
      deps.editor?.replaceText(fresh.text);
      deps.errorDialog?.close();
    } catch (error) {
      if (deps.session === target) target.block(error);
    }
  }
  async function overwriteDisk() {
    const target = deps.session,
      expected = deps.disk?.baseline;
    if (!target || !expected) return;
    if (
      !(await confirm('ディスク側の変更を失います。編集中の内容で上書きしますか？', {
        title: '編集内容で上書き',
        kind: 'warning',
        okLabel: '上書きする',
        cancelLabel: 'キャンセル',
      }))
    )
      return;
    try {
      const fresh = await invoke<OpenedDocument>('document_open', { path: target.path });
      if (deps.session !== target) return;
      if (fresh.baseline !== expected) {
        deps.disk = fresh;
        deps.diskLabel = fresh.text.slice(0, 500);
        deps.notify('ディスクが再変更されました。最新内容を確認し、もう一度選択してください。');
        return;
      }
      deps.session.baseline = fresh.baseline;
      deps.session.retry();
      deps.errorDialog?.close();
      if (!(await deps.flush())) await showProblem();
    } catch (error) {
      if (deps.session === target) target.block(error);
    }
  }
  async function retrySave() {
    if (!deps.session) return;
    deps.session.retry();
    deps.errorDialog?.close();
    await deps.flush();
  }
  async function beginSaveAs() {
    if (!deps.session) return;
    deps.saveAsPath = deps.session.path.replace(/\.(md|markdown)$/i, '-copy.md');
    deps.saveAsError = '';
    deps.saveAsDialog?.showModal();
    deps.saveAsInput?.focus();
    deps.saveAsInput?.select();
  }
  async function commitSaveAs() {
    if (!deps.session || deps.busy) return;
    await deps.settleComposition();
    if (!deps.session || deps.busy) return;
    deps.busy = true;
    try {
      const text = deps.session.text,
        gen = deps.session.generation;
      const opened = await invoke<OpenedDocument>('document_save_as', { sourcePath: deps.session.path, path: deps.saveAsPath, text });
      deps.session.path = opened.path;
      deps.session.baseline = opened.baseline;
      deps.session.savedGeneration = gen;
      deps.session.issue = null;
      deps.session.readonly = opened.readonly;
      deps.current = { path: opened.path, name: opened.path.split('/').at(-1)!, kind: 'markdown' };
      deps.selected = opened.path;
      deps.releaseImages();
      deps.editor?.refreshImages();
      // 最近見た記録は、今のワークスペースのルートの分だけを更新する
      const root = deps.project;
      deps.settings.recentFiles[root] = pushRecentFile(deps.settings.recentFiles[root] ?? [], opened.path);
      deps.settings.recentOpenedAt[root] = recordOpened(deps.settings.recentOpenedAt[root] ?? {}, opened.path);
      deps.syncSession();
      deps.saveAsDialog?.close();
      deps.errorDialog?.close();
      await deps.refreshTree();
      await deps.refreshIndex();
      void deps.persist();
      if (deps.session.dirty) deps.scheduleSave();
      deps.notify('別名で保存しました。');
    } catch (error) {
      deps.saveAsError = failure(error).message;
    } finally {
      deps.busy = false;
      if (deps.openRequestsQueued) void deps.drainOpenRequests();
    }
  }
  async function discardAndClose() {
    const target = deps.session;
    if (!target) return;
    if (
      target.dirty &&
      !(await confirm('未保存の編集内容を破棄して閉じます。', {
        title: '未保存内容を破棄',
        kind: 'warning',
        okLabel: '破棄して閉じる',
        cancelLabel: 'キャンセル',
      }))
    )
      return;
    if (deps.session !== target) return;
    deps.clearDocument();
    deps.errorDialog?.close();
    void deps.persist();
  }

  return { showProblem, reloadDisk, overwriteDisk, retrySave, beginSaveAs, commitSaveAs, discardAndClose };
}
