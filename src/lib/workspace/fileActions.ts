import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { containsPath, renamedPath, parentPath, type Entry, type Naming } from './navigation.ts';
import { setStarred, renameStarred, removeStarred, renameOpened, removeOpened, type TrashItem } from './noteLists.ts';
import { failure, type EditSession } from './session.ts';
import type { Settings } from './settings.ts';
import type { EditorApi } from '../editor/editor.ts';
import type { SidebarView } from '../components/SidebarNav.svelte';

type FileActionDeps = {
  busy: boolean;
  composing: boolean;
  project: string;
  readonly rootDirectory: string;
  view: SidebarView;
  expanded: string[];
  selected: string;
  naming: Naming | null;
  renameInput: HTMLInputElement | undefined;
  current: Entry | null;
  session: EditSession | null;
  settings: Settings;
  trashItems: TrashItem[];
  rows: Entry[];
  editor: EditorApi | null;
  imageUrl: string;
  operation(action: () => Promise<void>, needsSave?: boolean): Promise<boolean | undefined>;
  notify(message: string): void;
  list(path: string): Promise<void>;
  loadEntry(entry: Entry): Promise<void>;
  refreshTree(): Promise<void>;
  refreshIndex(): Promise<Entry[]>;
  persist(): Promise<void>;
  releaseImages(): void;
  blobImage(path: string): Promise<string>;
  clearDocument(): void;
  loadTrash(): Promise<void>;
};

export function createFileActions(deps: FileActionDeps) {
  type CliStatus = { message: string };
  // nagoriコマンドの登録と解除。結果と失敗理由は通知で示す
  async function runCli(id: 'cli_install' | 'cli_uninstall') {
    if (deps.busy || deps.composing) return;
    await deps.operation(async () => {
      try {
        deps.notify((await invoke<CliStatus>(id)).message);
      } catch (error) {
        const problem = failure(error);
        deps.notify(problem.code === 'CANCELLED' ? '操作をキャンセルしました。' : problem.message);
      }
    }, false);
  }
  function selectedFolder() {
    const entry = deps.rows.find((item) => item.path === deps.selected);
    const folder = entry?.kind === 'directory' ? entry.path : parentPath(deps.selected);
    return !deps.rootDirectory || containsPath(deps.rootDirectory, folder) ? folder : deps.rootDirectory;
  }
  async function startName(kind: 'markdown' | 'directory' | 'rename', entry?: Entry) {
    if (deps.busy) return;
    // 作成と名前変更は File Tree で行うので、フォルダの表示に戻す
    deps.view = 'tree';
    const parent = kind === 'rename' ? parentPath(entry!.path) : selectedFolder();
    if (parent && !deps.expanded.includes(parent)) {
      await deps.list(parent);
      deps.expanded = [...deps.expanded, parent];
    }
    deps.naming = {
      kind,
      parent,
      entry,
      value: kind === 'rename' ? entry!.name : kind === 'markdown' ? 'untitled.md' : '新しいフォルダ',
      error: '',
    };
    await tick();
    deps.renameInput?.focus();
    deps.renameInput?.select();
  }
  async function commitName() {
    if (!deps.naming || deps.busy) return;
    const request = deps.naming;
    if (!request.value.trim() || /[\/\0]/.test(request.value) || ['.', '..'].includes(request.value)) {
      deps.naming = { ...request, error: '有効な名前を入力してください。' };
      return;
    }
    await deps.operation(async () => {
      try {
        if (request.kind === 'rename') {
          const old = request.entry!.path;
          const entry = await invoke<Entry>('file_rename', { path: old, newName: request.value });
          await followMove(old, entry);
          deps.notify('名前を変更しました。リンク・画像の参照は自動更新されません。');
        } else {
          let name = request.value;
          if (request.kind === 'markdown' && !/\.(md|markdown)$/i.test(name)) name += '.md';
          const path = request.parent ? request.parent + '/' + name : name;
          const entry = await invoke<Entry>('file_create', { path, kind: request.kind });
          deps.selected = entry.path;
          if (entry.kind === 'markdown') await deps.loadEntry(entry);
        }
        deps.naming = null;
        await deps.refreshTree();
        await deps.refreshIndex();
        void deps.persist();
      } catch (error) {
        deps.naming = { ...request, error: failure(error).message };
      }
    });
  }
  // 名前の変更と移動の後、開いている記事・最近開いたファイル・スター・開いているフォルダのパスを更新する
  async function followMove(old: string, entry: Entry) {
    if (deps.current?.path === old && entry.kind !== deps.current.kind) await deps.loadEntry(entry);
    else if (deps.current && containsPath(old, deps.current.path)) {
      deps.current = {
        ...deps.current,
        path: renamedPath(deps.current.path, old, entry.path),
        name: deps.current.path === old ? entry.name : deps.current.name,
      };
      if (deps.session) deps.session.path = deps.current.path;
      deps.releaseImages();
      if (deps.session) deps.editor?.refreshImages();
      else if (deps.current.kind === 'image') deps.imageUrl = await deps.blobImage(deps.current.path);
    }
    // 最近見た記録とスターは、今のワークスペースのルートの分だけを直す
    if (deps.project) {
      const root = deps.project;
      deps.settings.recentFiles[root] = (deps.settings.recentFiles[root] ?? []).map((path) => renamedPath(path, old, entry.path));
      deps.settings.recentOpenedAt[root] = renameOpened(deps.settings.recentOpenedAt[root] ?? {}, old, entry.path);
      deps.settings.starred = renameStarred(deps.settings.starred, root, old, entry.path);
    }
    deps.expanded = deps.expanded.map((path) => renamedPath(path, old, entry.path));
    deps.selected = entry.path;
  }
  // ドラッグで項目を別のフォルダへ移す。一番上へ移す時はtoDirectoryを空にする。同じ名前があれば移さない
  async function move(entry: Entry, toDirectory: string) {
    await deps.operation(async () => {
      const moved = await invoke<Entry>('file_move', { path: entry.path, toDirectory });
      await followMove(entry.path, moved);
      if (toDirectory && !deps.expanded.includes(toDirectory)) {
        await deps.list(toDirectory);
        deps.expanded = [...deps.expanded, toDirectory];
      }
      await deps.refreshTree();
      await deps.refreshIndex();
      void deps.persist();
      deps.notify(`「${moved.name}」を移動しました。`);
    });
  }

  // アプリ内のゴミ箱へ移す。復元はゴミ箱の一覧から行える
  async function trash(entry: Entry) {
    await deps.operation(async () => {
      await invoke('file_trash', { path: entry.path });
      if (deps.current && containsPath(entry.path, deps.current.path)) {
        deps.clearDocument();
      }
      if (deps.project) {
        const root = deps.project;
        deps.settings.recentFiles[root] = (deps.settings.recentFiles[root] ?? []).filter((path) => !containsPath(entry.path, path));
        deps.settings.recentOpenedAt[root] = removeOpened(deps.settings.recentOpenedAt[root] ?? {}, entry.path);
        deps.settings.starred = removeStarred(deps.settings.starred, root, entry.path);
      }
      deps.expanded = deps.expanded.filter((path) => !containsPath(entry.path, path));
      deps.selected = '';
      await deps.refreshTree();
      await deps.refreshIndex();
      void deps.loadTrash();
      void deps.persist();
      deps.notify(`「${entry.name}」をゴミ箱に移動しました。ゴミ箱から元に戻せます`);
    });
  }
  // ゴミ箱の項目を元の場所へ戻す。戻せない時はoperationが理由を通知する
  async function restoreTrash(item: TrashItem) {
    await deps.operation(async () => {
      const entry = await invoke<Entry>('trash_restore', { id: item.id });
      await deps.refreshTree();
      await deps.refreshIndex();
      await deps.loadTrash();
      deps.notify(`「${entry.name}」を元の場所に戻しました。`);
    });
  }
  // ゴミ箱の項目をmacOSのゴミ箱へ送る。アプリのゴミ箱からは外れる
  async function deleteTrash(item: TrashItem) {
    if (deps.busy) return;
    if (
      !(await confirm(`「${item.name}」をmacOSのゴミ箱へ移します。Nagoriのゴミ箱からは消えます。`, {
        title: '完全に削除',
        kind: 'warning',
        okLabel: '完全に削除',
        cancelLabel: 'キャンセル',
      }))
    )
      return;
    await deps.operation(async () => {
      await invoke('trash_delete', { id: item.id });
      await deps.loadTrash();
      deps.notify(`「${item.name}」をmacOSのゴミ箱へ移しました。`);
    });
  }
  // 今のワークスペースのゴミ箱の項目をすべて、macOSのゴミ箱へ送る
  async function emptyTrash() {
    if (deps.busy || !deps.trashItems.length) return;
    const count = deps.trashItems.length;
    if (
      !(await confirm(`ゴミ箱の${count}件をmacOSのゴミ箱へ移します。Nagoriのゴミ箱からは消えます。`, {
        title: 'ゴミ箱を空にする',
        kind: 'warning',
        okLabel: 'ゴミ箱を空にする',
        cancelLabel: 'キャンセル',
      }))
    )
      return;
    await deps.operation(async () => {
      await invoke('trash_empty');
      await deps.loadTrash();
      deps.notify(`ゴミ箱の${count}件をmacOSのゴミ箱へ移しました。`);
    });
  }
  // スターの付け外し。ワークスペースのルートごとに、記事の相対パスを保存する
  function toggleStar(path: string) {
    if (!deps.project) return;
    const on = !(deps.settings.starred[deps.project] ?? []).includes(path);
    deps.settings.starred = setStarred(deps.settings.starred, deps.project, path, on);
    void deps.persist();
  }
  async function reveal(entry?: Entry) {
    try {
      await invoke('workspace_reveal', { path: entry?.path ?? '' });
    } catch (error) {
      deps.notify(failure(error).message);
    }
  }

  return { runCli, startName, commitName, move, trash, restoreTrash, deleteTrash, emptyTrash, toggleStar, reveal };
}
