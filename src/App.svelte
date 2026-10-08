<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { Menu, type MenuOptions } from '@tauri-apps/api/menu';
  import { LogicalPosition } from '@tauri-apps/api/dpi';
  import { open, confirm } from '@tauri-apps/plugin-dialog';
  import Editor from './lib/Editor.svelte';
  import Outline from './lib/Outline.svelte';
  import OutlineNotice from './lib/OutlineNotice.svelte';
  import { outlineNoticeVisible } from './lib/outlineNotice.ts';
  import PaneResizer from './lib/PaneResizer.svelte';
  import { SIDEBAR, OUTLINE, paneLayout } from './lib/paneWidths.ts';
  import type { OutlineHeading } from './lib/outline.ts';
  import Icon from './lib/Icon.svelte';
  import QuickOpen from './lib/QuickOpen.svelte';
  import FileTree from './lib/FileTree.svelte';
  import SidebarNav, { type SidebarView } from './lib/SidebarNav.svelte';
  import NoteList from './lib/NoteList.svelte';
  import TrashList from './lib/TrashList.svelte';
  import { allNotes, recentlyEdited, starredNotes, setStarred, renameStarred, removeStarred, recordOpened, renameOpened, removeOpened, type NoteItem, type TrashItem } from './lib/noteLists.ts';
  import ProblemDialog from './lib/ProblemDialog.svelte';
  import SaveAsDialog from './lib/SaveAsDialog.svelte';
  import nagoriIcon from './lib/assets/nagori-icon.png';
  import nagoriWordmark from './lib/assets/nagori-wordmark.png';
  import nagoriWordmarkDark from './lib/assets/nagori-wordmark-dark.png';
  import type { EditorApi, EditorContextMenu } from './lib/editor';
  import type { BlockKind } from './lib/blockEdit';
  import { EditSession, failure, type OpenedDocument } from './lib/session';
  import { AppFlow } from './lib/appFlow';
  import { containsPath, renamedPath, parentPath, localLink, type Entry, type Naming } from './lib/navigation';
  import { imageMime } from './lib/image';
  import { imageDropReason, importDroppedImages, preventFileNavigation } from './lib/imageDrop';

  import SettingsDialog from './lib/SettingsDialog.svelte';
  import { defaults, startupSettings, resolvedTheme, nextTheme, resetPreferences, editorStyle, type Settings } from './lib/settings';
  type OpenRequest = { workspace: string; path: string | null };
  type CliStatus = { message: string };
  let settings = $state<Settings>({ ...defaults, theme: 'light' });
  let settingsLoaded = $state(false);
  // macOSの外観。theme が 'system' の時だけ使う
  let systemDark = $state(false),
    settingsOpen = $state(false),
    settingsDialog = $state<HTMLDialogElement>();
  let settingsReturn: HTMLElement | null = null;
  const theme = $derived(resolvedTheme(settings.theme, systemDark));
  let project = $state(''),
    current = $state<Entry | null>(null),
    initialText = $state(''),
    documentKey = $state(0);
  let session = $state.raw<EditSession | null>(null);
  let editor: EditorApi | null = null;
  let outline = $state.raw<OutlineHeading[]>([]),
    outlinePosition = $state(-1);
  let status = $state('saved'),
    chars = $state(0),
    readonly = $state(false),
    issue = $state<ReturnType<typeof failure> | null>(null);
  let tree = $state<Record<string, Entry[]>>({}),
    expanded = $state<string[]>(['']),
    selected = $state('');
  let index = $state<Entry[]>([]),
    // サイドバーの表示。フォルダ以外は一覧に切り替える。保存はしない
    view = $state<SidebarView>('tree'),
    trashItems = $state<TrashItem[]>([]),
    busy = $state(false),
    starting = $state(true),
    notice = $state(''),
    contentError = $state('');
  let sidebarVisible = $state(true);
  let shellWidth = $state(0);
  let sidebarDraft = $state<number | null>(null),
    outlineDraft = $state<number | null>(null);
  const outlineWidth = $derived(outlineDraft ?? settings.outlineWidth);
  const layout = $derived(paneLayout(shellWidth, sidebarDraft ?? settings.sidebarWidth, outlineWidth, sidebarVisible, settings.editorWidth));
  const outlineLabel = $derived(settings.outlineVisible
    ? outline.length && !layout.showOutline ? '幅が足りないため目次を隠しています' : '目次を隠す'
    : '目次を表示');
  let previewOnly = $state(false),
    imageUrl = $state(''),
    imageDimensions = $state('');
  let composing = $state(false),
    compositionWaiters: Array<() => void> = [],
    autosave: ReturnType<typeof setTimeout> | undefined;
  let fsTimer: ReturnType<typeof setTimeout> | undefined, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let openRequestsQueued = false,
    openingRequest = false;
  const imageUrls = new Set<string>();
  const imageCache = new Map<string, Promise<string>>();
  let imageEpoch = 0,
    treeQueued = false,
    imagesQueued = false;
  let quick = $state(false),
    quickPanel: QuickOpen;
  let errorDialog = $state<HTMLDialogElement>(),
    saveAsDialog = $state<HTMLDialogElement>(),
    saveAsInput = $state<HTMLInputElement>();
  let renameInput = $state<HTMLInputElement>();
  let disk = $state.raw<OpenedDocument | null>(null),
    diskLabel = $state('');
  let naming = $state<Naming | null>(null);
  let saveAsPath = $state(''),
    saveAsError = $state('');
  const rows = $derived.by(() => {
    const out: Array<Entry & { depth: number }> = [];
    const walk = (path: string, depth: number) => {
      for (const entry of tree[path] ?? []) {
        out.push({ ...entry, depth });
        if (entry.kind === 'directory' && expanded.includes(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  });
  const labels: Record<string, string> = {
    saved: '保存済み',
    dirty: '未保存',
    saving: '保存中…',
    error: '保存失敗',
    conflict: '競合',
    missing: 'ファイルが見つかりません',
  };
  // Markdown以外のファイルを、ただのテキストとして開いているか
  const plain = $derived(current?.kind === 'other');
  const outlineNotice = $derived(outlineNoticeVisible({ plain, previewOnly, outlineVisible: settings.outlineVisible, headingCount: outline.length, showOutline: layout.showOutline }));
  const projectName = $derived(project.split('/').filter(Boolean).at(-1) ?? 'Workspace');
  const starredPaths = $derived(settings.starred[project] ?? []);
  const allList = $derived(allNotes(index));
  const starredList = $derived(starredNotes(starredPaths, index));
  const recentList = $derived(recentlyEdited(index, settings.recentOpenedAt, settings.recentEditedCount));
  const navCounts = $derived({ all: allList.length, starred: starredList.length, recent: recentList.length, trash: trashItems.length });
  // ナビで選んだ一覧の見出し。フォルダの表示のときは使わない
  const viewTitles: Record<Exclude<SidebarView, 'tree'>, string> = { all: 'すべてのノート', starred: 'スター付き', recent: '最近編集', trash: 'ゴミ箱' };
  const starred = $derived(!!current && starredPaths.includes(current.path));
  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  function notify(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 5000);
  }
  function syncSession() {
    if (!session) return;
    status = session.status;
    issue = session.issue;
    readonly = session.readonly;
    chars = session.text.length;
  }
  function cancelSave() {
    clearTimeout(autosave);
    autosave = undefined;
  }
  function scheduleSave() {
    cancelSave();
    if (!session || session.issue || composing) return;
    autosave = setTimeout(() => {
      void session?.flush().then((ok) => {
        if (!ok && session?.issue) void showProblem();
        flow.resumeExternal();
      });
    }, settings.autosaveDelay);
  }
  function changed(text: string) {
    session?.edit(text);
    scheduleSave();
  }
  function composition(active: boolean) {
    composing = active;
    if (session) session.composing = active;
    if (active) cancelSave();
    else {
      for (const resolve of compositionWaiters.splice(0)) resolve();
      scheduleSave();
      if (treeQueued && !busy) void processChanges();
      flow.resumeExternal();
    }
  }
  async function settleComposition() {
    if (composing) await new Promise<void>((resolve) => compositionWaiters.push(resolve));
  }
  function flush() {
    return flow.flush();
  }
  function operation(action: () => Promise<void>, needsSave = true) {
    return flow.operation(action, needsSave);
  }
  async function drainOpenRequests() {
    if (!openRequestsQueued || starting || busy || openingRequest || session?.issue || errorDialog?.open || saveAsDialog?.open) return;
    openingRequest = true;
    if (quick) quickPanel.close(false);
    try {
      while (openRequestsQueued) {
        openRequestsQueued = false;
        let empty = false;
        const opened = await operation(async () => {
          let request: OpenRequest | null;
          try {
            request = await invoke<OpenRequest | null>('open_request_take');
          } catch (error) {
            if (failure(error).code === 'INTERNAL') throw error;
            notify(failure(error).message);
            return;
          }
          if (!request) {
            empty = true;
            return;
          }
          try {
            await openProject(request.workspace, request.path);
            if (request.path && current?.path !== request.path) throw new Error('指定されたファイルを開けません: ' + request.path);
          } catch (error) {
            notify(failure(error).message);
          }
        });
        if (empty) {
          if (openRequestsQueued) queueMicrotask(() => void drainOpenRequests());
          break;
        }
        openRequestsQueued = true;
        if (!opened) break;
      }
    } finally {
      openingRequest = false;
    }
  }
  async function processChanges() {
    if (busy || composing) return;
    const root = project,
      refreshImages = imagesQueued;
    treeQueued = false;
    imagesQueued = false;
    try {
      await refreshTree();
      await refreshIndex();
      if (root !== project || busy || composing) {
        treeQueued = true;
        imagesQueued ||= refreshImages;
        return;
      }
      if (refreshImages && session) {
        releaseImages();
        editor?.refreshImages();
      }
      if (refreshImages && current?.kind === 'image') {
        const target = current,
          key = documentKey;
        const url = await blobImage(target.path);
        if (current !== target || documentKey !== key) {
          URL.revokeObjectURL(url);
          imageUrls.delete(url);
        } else {
          if (imageUrl) URL.revokeObjectURL(imageUrl);
          imageUrl = url;
        }
      }
      await checkExternal();
    } catch (error) {
      notify(failure(error).message);
    }
  }
  let settingsQueue = Promise.resolve();
  const flow = new AppFlow({
    getSession: () => session,
    isBusy: () => busy,
    setBusy: (value) => (busy = value),
    isComposing: () => composing,
    cancelSave,
    settleComposition,
    showProblem,
    openDocument: (path) => invoke<OpenedDocument>('document_open', { path }),
    replaceText: (text) => editor?.replaceText(text),
    notify,
    persist: async () => {
      await persist();
    },
    settingsQueue: () => settingsQueue,
    exitApp: () => invoke('app_exit'),
    resumeTree: () => {
      if (treeQueued) void processChanges();
    },
    resumeOpenRequests: () => {
      if (openRequestsQueued && !openingRequest) void drainOpenRequests();
    },
    defer: (run) => void setTimeout(run, 0),
  });
  function persist() {
    if (!settingsLoaded) return settingsQueue;
    const snapshot = JSON.parse(JSON.stringify(settings));
    settingsQueue = settingsQueue
      .then(() => invoke<void>('settings_save', { settings: snapshot }))
      .catch((error) => notify('設定を保存できません: ' + failure(error).message));
    return settingsQueue;
  }
  function commitPane(pane: 'sidebar' | 'outline') {
    if (pane === 'sidebar' && sidebarDraft !== null) {
      settings.sidebarWidth = sidebarDraft;
      sidebarDraft = null;
    } else if (pane === 'outline' && outlineDraft !== null) {
      settings.outlineWidth = outlineDraft;
      outlineDraft = null;
    } else return;
    void persist();
  }
  async function list(path: string) {
    const root = project;
    const entries = await invoke<Entry[]>('workspace_list', { path });
    if (root === project) tree = { ...tree, [path]: entries };
  }
  // 展開中のフォルダだけを読み直す。プロジェクト全体の索引はQuick Openとファイル復元の時だけ作る
  async function refreshTree() {
    for (const path of expanded) {
      try {
        await list(path);
      } catch {
        if (path === '') throw new Error('プロジェクトフォルダを読み込めません。');
        tree = { ...tree, [path]: [] };
      }
    }
  }
  async function refreshIndex() {
    const root = project;
    const entries = await invoke<Entry[]>('workspace_index');
    if (root === project) index = entries;
    return entries;
  }
  // ゴミ箱の一覧を読み直す。失敗は通知だけにし、ゴミ箱以外の操作は止めない
  async function loadTrash() {
    const root = project;
    try {
      const items = await invoke<TrashItem[]>('trash_list');
      if (root === project) trashItems = items;
    } catch (error) {
      notify(failure(error).message);
    }
  }
  async function toggle(entry: Entry) {
    if (expanded.includes(entry.path)) expanded = expanded.filter((path) => path !== entry.path);
    else {
      try {
        await list(entry.path);
        expanded = [...expanded, entry.path];
      } catch (error) {
        notify(failure(error).message);
      }
    }
  }
  function releaseImages() {
    imageEpoch++;
    imageCache.clear();
    for (const url of imageUrls) URL.revokeObjectURL(url);
    imageUrls.clear();
    imageUrl = '';
    imageDimensions = '';
  }
  function clearDocument() {
    cancelSave();
    quickPanel?.forgetFocus();
    session = null;
    editor = null;
    outline = [];
    outlinePosition = -1;
    current = null;
    initialText = '';
    issue = null;
    status = 'saved';
    readonly = false;
    chars = 0;
    contentError = '';
    documentKey++;
    releaseImages();
  }
  async function blobImage(path: string, documentPath?: string) {
    const bytes = new Uint8Array(await invoke<ArrayBuffer>('image_read', { path, documentPath }));
    const url = URL.createObjectURL(new Blob([bytes], { type: imageMime(bytes) }));
    imageUrls.add(url);
    return url;
  }
  async function resolveImage(ref: string) {
    const epoch = imageEpoch,
      path = current?.path;
    if (!path) throw new Error('記事を開いてください。');
    const key = path + '\0' + ref,
      cached = imageCache.get(key);
    if (cached) return cached;
    const promise = blobImage(ref, path).then((url) => {
      if (epoch !== imageEpoch || path !== current?.path) {
        URL.revokeObjectURL(url);
        imageUrls.delete(url);
        throw new Error('記事が切り替わりました。');
      }
      return url;
    });
    imageCache.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      if (imageCache.get(key) === promise) imageCache.delete(key);
      throw error;
    }
  }
  // 保存した記事の更新日時を今にして、最近編集の一覧へ反映する
  async function saveDocument(path: string, text: string, baseline: string) {
    const result = await invoke<{ baseline: string }>('document_save', { path, text, baseline });
    index = index.map((entry) => (entry.path === path ? { ...entry, modified: Date.now() } : entry));
    return result;
  }
  async function loadEntry(entry: Entry) {
    clearDocument();
    current = entry;
    // 記事を開いた時の表示は設定に従う
    if (entry.kind === 'markdown') previewOnly = settings.startInPreview;
    selected = entry.path;
    try {
      if (entry.kind === 'markdown' || entry.kind === 'other') {
        // Markdown以外も、Rust側でテキストと判断できれば同じ流れで編集する
        const opened = await invoke<OpenedDocument>('document_open', { path: entry.path });
        initialText = opened.text;
        session = new EditSession(opened, saveDocument, syncSession);
        syncSession();
      } else if (entry.kind === 'image') imageUrl = await blobImage(entry.path);
      else contentError = 'シンボリックリンクは表示のみです。';
    } catch (error) {
      contentError = failure(error).message;
    }
    settings.lastFile = entry.path;
    settings.recentFiles = [entry.path, ...settings.recentFiles.filter((path) => path !== entry.path)].slice(0, 30);
    if (entry.kind === 'markdown') settings.recentOpenedAt = recordOpened(settings.recentOpenedAt, entry.path);
    void persist();
    await tick();
    editor?.focus();
  }
  async function selectEntry(entry: Entry) {
    if (entry.kind === 'directory') {
      selected = entry.path;
      await toggle(entry);
      return;
    }
    if (entry.path === current?.path) return;
    await operation(() => loadEntry(entry));
  }
  async function chooseProject() {
    await operation(async () => {
      const picked = await open({ directory: true, multiple: false, title: 'プロジェクトフォルダを開く' });
      if (typeof picked !== 'string') return;
      await openProject(picked);
    });
  }
  async function openProject(path: string, restoreFile?: string | null) {
    const root = await invoke<string>('workspace_open', { path });
    clearDocument();
    project = root;
    tree = {};
    expanded = [''];
    selected = '';
    index = [];
    view = 'tree';
    trashItems = [];
    settings.lastProject = root;
    settings.lastFile = null;
    settings.recentFiles = [];
    settings.recentOpenedAt = {};
    await refreshTree();
    const entries = await refreshIndex();
    void loadTrash();
    void persist();
    if (restoreFile) {
      const entry = entries.find((item) => item.path === restoreFile);
      if (entry) {
        const parent = parentPath(entry.path);
        const folders = parent.split('/').filter(Boolean);
        let built = '';
        for (const name of folders) {
          built = built ? built + '/' + name : name;
          await list(built);
          expanded = [...expanded, built];
        }
        await loadEntry(entry);
      }
    }
  }
  async function quickOpen() {
    if (!project || busy || composing || errorDialog?.open || saveAsDialog?.open) return;
    const focus = document.activeElement as HTMLElement | null;
    try {
      const root = project,
        entries = await invoke<Entry[]>('workspace_index');
      if (root !== project || busy || composing || errorDialog?.open || saveAsDialog?.open) return;
      index = entries;
      await quickPanel.show(focus);
    } catch (error) {
      notify(failure(error).message);
    }
  }
  // nagoriコマンドの登録と解除。結果と失敗理由は通知で示す
  async function runCli(id: 'cli_install' | 'cli_uninstall') {
    if (busy || composing) return;
    await operation(async () => {
      try {
        notify((await invoke<CliStatus>(id)).message);
      } catch (error) {
        const problem = failure(error);
        notify(problem.code === 'CANCELLED' ? '操作をキャンセルしました。' : problem.message);
      }
    }, false);
  }
  function selectedFolder() {
    const entry = rows.find((item) => item.path === selected);
    return entry?.kind === 'directory' ? entry.path : parentPath(selected);
  }
  async function startName(kind: 'markdown' | 'directory' | 'rename', entry?: Entry) {
    if (busy) return;
    // 作成と名前変更は File Tree で行うので、フォルダの表示に戻す
    view = 'tree';
    const parent = kind === 'rename' ? parentPath(entry!.path) : selectedFolder();
    if (parent && !expanded.includes(parent)) {
      await list(parent);
      expanded = [...expanded, parent];
    }
    naming = {
      kind,
      parent,
      entry,
      value: kind === 'rename' ? entry!.name : kind === 'markdown' ? 'untitled.md' : '新しいフォルダ',
      error: '',
    };
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
  async function commitName() {
    if (!naming || busy) return;
    const request = naming;
    if (!request.value.trim() || /[\/\0]/.test(request.value) || ['.', '..'].includes(request.value)) {
      naming = { ...request, error: '有効な名前を入力してください。' };
      return;
    }
    await operation(async () => {
      try {
        if (request.kind === 'rename') {
          const old = request.entry!.path;
          const entry = await invoke<Entry>('file_rename', { path: old, newName: request.value });
          if (current?.path === old && entry.kind !== current.kind) await loadEntry(entry);
          else if (current && containsPath(old, current.path)) {
            current = {
              ...current,
              path: renamedPath(current.path, old, entry.path),
              name: request.entry!.kind === 'directory' ? current.name : entry.name,
            };
            if (session) session.path = current.path;
            settings.lastFile = current.path;
            releaseImages();
            if (session) editor?.refreshImages();
            else if (current.kind === 'image') imageUrl = await blobImage(current.path);
          }
          settings.recentFiles = settings.recentFiles.map((path) => renamedPath(path, old, entry.path));
          settings.recentOpenedAt = renameOpened(settings.recentOpenedAt, old, entry.path);
          if (project) settings.starred = renameStarred(settings.starred, project, old, entry.path);
          expanded = expanded.map((path) => renamedPath(path, old, entry.path));
          selected = entry.path;
          notify('名前を変更しました。リンク・画像の参照は自動更新されません。');
        } else {
          let name = request.value;
          if (request.kind === 'markdown' && !/\.(md|markdown)$/i.test(name)) name += '.md';
          const path = request.parent ? request.parent + '/' + name : name;
          const entry = await invoke<Entry>('file_create', { path, kind: request.kind });
          selected = entry.path;
          if (entry.kind === 'markdown') await loadEntry(entry);
        }
        naming = null;
        await refreshTree();
        await refreshIndex();
        void persist();
      } catch (error) {
        naming = { ...request, error: failure(error).message };
      }
    });
  }
  // アプリ内のゴミ箱へ移す。復元はゴミ箱の一覧から行える
  async function trash(entry: Entry) {
    await operation(async () => {
      await invoke('file_trash', { path: entry.path });
      if (current && containsPath(entry.path, current.path)) {
        clearDocument();
        settings.lastFile = null;
      }
      settings.recentFiles = settings.recentFiles.filter((path) => !containsPath(entry.path, path));
      settings.recentOpenedAt = removeOpened(settings.recentOpenedAt, entry.path);
      if (project) settings.starred = removeStarred(settings.starred, project, entry.path);
      expanded = expanded.filter((path) => !containsPath(entry.path, path));
      selected = '';
      await refreshTree();
      await refreshIndex();
      void loadTrash();
      void persist();
      notify(`「${entry.name}」をゴミ箱に移動しました。ゴミ箱から元に戻せます`);
    });
  }
  // ゴミ箱の項目を元の場所へ戻す。戻せない時はoperationが理由を通知する
  async function restoreTrash(item: TrashItem) {
    await operation(async () => {
      const entry = await invoke<Entry>('trash_restore', { id: item.id });
      await refreshTree();
      await refreshIndex();
      await loadTrash();
      notify(`「${entry.name}」を元の場所に戻しました。`);
    });
  }
  // ゴミ箱の項目をmacOSのゴミ箱へ送る。アプリのゴミ箱からは外れる
  async function deleteTrash(item: TrashItem) {
    if (busy) return;
    if (
      !(await confirm(`「${item.name}」をmacOSのゴミ箱へ移します。Nagoriのゴミ箱からは消えます。`, {
        title: '完全に削除',
        kind: 'warning',
        okLabel: '完全に削除',
        cancelLabel: 'キャンセル',
      }))
    )
      return;
    await operation(async () => {
      await invoke('trash_delete', { id: item.id });
      await loadTrash();
      notify(`「${item.name}」をmacOSのゴミ箱へ移しました。`);
    });
  }
  // 今のワークスペースのゴミ箱の項目をすべて、macOSのゴミ箱へ送る
  async function emptyTrash() {
    if (busy || !trashItems.length) return;
    const count = trashItems.length;
    if (
      !(await confirm(`ゴミ箱の${count}件をmacOSのゴミ箱へ移します。Nagoriのゴミ箱からは消えます。`, {
        title: 'ゴミ箱を空にする',
        kind: 'warning',
        okLabel: 'ゴミ箱を空にする',
        cancelLabel: 'キャンセル',
      }))
    )
      return;
    await operation(async () => {
      await invoke('trash_empty');
      await loadTrash();
      notify(`ゴミ箱の${count}件をmacOSのゴミ箱へ移しました。`);
    });
  }
  // スターの付け外し。ワークスペースのルートごとに、記事の相対パスを保存する
  function toggleStar(path: string) {
    if (!project) return;
    const on = !(settings.starred[project] ?? []).includes(path);
    settings.starred = setStarred(settings.starred, project, path, on);
    void persist();
  }
  async function reveal(entry?: Entry) {
    try {
      await invoke('workspace_reveal', { path: entry?.path ?? '' });
    } catch (error) {
      notify(failure(error).message);
    }
  }
  async function contextMenu(event: MouseEvent, entry: Entry) {
    event.preventDefault();
    selected = entry.path;
    const menu = await Menu.new({
      items: [
        { id: 'reveal', text: 'Finderで表示', action: () => void reveal(entry) },
        ...(entry.kind === 'markdown'
          ? [{ id: 'star', text: starredPaths.includes(entry.path) ? 'スターを外す' : 'スターを付ける', action: () => toggleStar(entry.path) }]
          : []),
        {
          id: 'rename',
          text: '名前を変更（参照は更新しません）',
          enabled: entry.kind !== 'symlink',
          action: () => void startName('rename', entry),
        },
        {
          id: 'trash',
          text: entry.kind === 'directory' ? 'フォルダと配下をゴミ箱に移動' : 'ゴミ箱に移動',
          enabled: entry.kind !== 'symlink',
          action: () => void trash(entry),
        },
      ],
    });
    try {
      await menu.popup();
    } finally {
      await menu.close();
    }
  }
  async function trashContextMenu(event: MouseEvent, item: TrashItem) {
    event.preventDefault();
    const menu = await Menu.new({
      items: [
        { id: 'restore', text: '元に戻す', action: () => void restoreTrash(item) },
        { id: 'delete', text: '完全に削除', action: () => void deleteTrash(item) },
      ],
    });
    try {
      await menu.popup();
    } finally {
      await menu.close();
    }
  }
  async function editorContextMenu(context: EditorContextMenu) {
    if (!isTauri() || !editor) return;
    const source = editor,
      key = documentKey;
    const active = () => source === editor && key === documentKey && source.contextState().revision === context.revision;
    const item = (kind: BlockKind, text: string, enabled = context.block) => ({
      id: `editor-${kind}`,
      text,
      enabled,
      action: () => {
        if (active()) source.block(kind, context.revision);
      },
    });
    const items: NonNullable<MenuOptions['items']> = [
      context.editable ? { item: 'Cut', text: '切り取り' } : { id: 'editor-cut-disabled', text: '切り取り', enabled: false },
      { item: 'Copy', text: 'コピー' },
      context.editable ? { item: 'Paste', text: '貼り付け' } : { id: 'editor-paste-disabled', text: '貼り付け', enabled: false },
      { item: 'SelectAll', text: 'すべてを選択' },
    ];
    if (!context.plain)
      items.push(
        { item: 'Separator' },
        {
          text: '見出し',
          items: [
            item('heading1', '見出し1', context.heading),
            item('heading2', '見出し2', context.heading),
            item('heading3', '見出し3', context.heading),
            item('paragraph', '本文', context.heading),
          ],
        },
        { text: 'リスト', items: [item('bullet', '箇条書き'), item('ordered', '番号付きリスト'), item('task', 'タスクリスト')] },
        item('quote', '引用'),
        item('table', '表を挿入'),
        item('rule', '区切り線を挿入'),
        { item: 'Separator' },
        {
          id: 'editor-image',
          text: '画像を挿入…',
          enabled: context.editable,
          action: () => {
            if (active() && source.contextState().editable) void insertImage();
          },
        },
      );
    let menu: Menu | undefined;
    try {
      menu = await Menu.new({ items });
      if (active()) await menu.popup(new LogicalPosition(context.x, context.y));
    } catch (error) {
      notify(failure(error).message);
    } finally {
      await menu?.close();
    }
  }
  async function insertImage() {
    if (!session || session.readonly || previewOnly || current?.kind !== 'markdown') return;
    await operation(async () => {
      const picked = await open({
        multiple: false,
        title: '画像を挿入',
        filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (typeof picked !== 'string') return;
      const result = await invoke<{ path: string; markdown: string }>('image_insert', { sourcePath: picked, documentPath: session!.path });
      editor?.insertText(result.markdown);
      await refreshTree();
    }, false);
  }
  // コピーした画像を、記事と同じフォルダのassetsへ保存して、カーソルの位置に記法を入れる
  async function pasteImage(image: File) {
    if (!session || session.readonly || previewOnly || current?.kind !== 'markdown') return;
    const documentPath = session.path;
    await operation(async () => {
      const bytes = new Uint8Array(await image.arrayBuffer());
      const result = await invoke<{ path: string; markdown: string }>('image_paste', bytes, {
        headers: { 'x-document-path': encodeURIComponent(documentPath) },
      });
      editor?.insertText(result.markdown);
      await refreshTree();
    }, false);
  }
  async function dropImages(images: File[]): Promise<string | null> {
    const target = session;
    const reason = imageDropReason({ plain: current?.kind !== 'markdown', readonly, busy, saving: target?.isSaving ?? false, composing, previewOnly, saved: !!target?.path });
    if (reason) { notify(reason); return null; }
    let markdown: string | null = null;
    await operation(async () => {
      markdown = await importDroppedImages(images, bytes => invoke<{ markdown: string }>('image_paste', bytes, { headers: { 'x-document-path': encodeURIComponent(target!.path) } }));
      await refreshTree();
    }, false);
    await tick();
    return session === target ? markdown : null;
  }
  async function link(href: string) {
    try {
      if (/^https?:\/\//i.test(href)) {
        await invoke('external_open', { url: href });
        return;
      }
      if (!current) return;
      const path = localLink(current.path, href);
      await selectEntry({ path, name: path.split('/').at(-1)!, kind: 'markdown' });
    } catch (error) {
      notify(failure(error).message);
    }
  }
  async function showProblem() {
    const target = session;
    if (!target?.issue) return;
    issue = target.issue;
    disk = null;
    diskLabel = '';
    if (issue.code === 'CONFLICT') {
      try {
        const fresh = await invoke<OpenedDocument>('document_open', { path: target.path });
        if (session !== target || !target.issue) return;
        disk = fresh;
        diskLabel = fresh.text.slice(0, 500);
      } catch {}
    }
    await tick();
    if (session !== target || !target.issue) return;
    if (!errorDialog?.open) errorDialog?.showModal();
  }
  async function reloadDisk() {
    const target = session;
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
      if (session !== target) return;
      target.reload(fresh);
      editor?.replaceText(fresh.text);
      errorDialog?.close();
    } catch (error) {
      if (session === target) target.block(error);
    }
  }
  async function overwriteDisk() {
    const target = session,
      expected = disk?.baseline;
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
      if (session !== target) return;
      if (fresh.baseline !== expected) {
        disk = fresh;
        diskLabel = fresh.text.slice(0, 500);
        notify('ディスクが再変更されました。最新内容を確認し、もう一度選択してください。');
        return;
      }
      session.baseline = fresh.baseline;
      session.retry();
      errorDialog?.close();
      if (!(await flush())) await showProblem();
    } catch (error) {
      if (session === target) target.block(error);
    }
  }
  async function retrySave() {
    if (!session) return;
    session.retry();
    errorDialog?.close();
    await flush();
  }
  async function beginSaveAs() {
    if (!session) return;
    saveAsPath = session.path.replace(/\.(md|markdown)$/i, '-copy.md');
    saveAsError = '';
    saveAsDialog?.showModal();
    saveAsInput?.focus();
    saveAsInput?.select();
  }
  async function commitSaveAs() {
    if (!session || busy) return;
    await settleComposition();
    if (!session || busy) return;
    busy = true;
    try {
      const text = session.text,
        gen = session.generation;
      const opened = await invoke<OpenedDocument>('document_save_as', { sourcePath: session.path, path: saveAsPath, text });
      session.path = opened.path;
      session.baseline = opened.baseline;
      session.savedGeneration = gen;
      session.issue = null;
      session.readonly = opened.readonly;
      current = { path: opened.path, name: opened.path.split('/').at(-1)!, kind: 'markdown' };
      selected = opened.path;
      releaseImages();
      editor?.refreshImages();
      settings.lastFile = opened.path;
      settings.recentFiles = [opened.path, ...settings.recentFiles.filter((path) => path !== opened.path)].slice(0, 30);
      settings.recentOpenedAt = recordOpened(settings.recentOpenedAt, opened.path);
      syncSession();
      saveAsDialog?.close();
      errorDialog?.close();
      await refreshTree();
      await refreshIndex();
      void persist();
      if (session.dirty) scheduleSave();
      notify('別名で保存しました。');
    } catch (error) {
      saveAsError = failure(error).message;
    } finally {
      busy = false;
      if (openRequestsQueued) void drainOpenRequests();
    }
  }
  async function discardAndClose() {
    const target = session;
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
    if (session !== target) return;
    clearDocument();
    settings.lastFile = null;
    errorDialog?.close();
    void persist();
  }
  function checkExternal() {
    return flow.checkExternal();
  }
  function quit() {
    return flow.quit();
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (quick) return;
    if (errorDialog?.open || saveAsDialog?.open) return;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === ',') {
      event.preventDefault();
      if (settingsOpen) closeSettings();
      else void openSettings();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      void quickOpen();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void flush();
    }
    if (event.key === 'Escape' && naming) naming = null;
  }
  function togglePreview() {
    if (!busy && !composing && current?.kind === 'markdown' && session) previewOnly = !previewOnly;
  }
  function toggleWritingMode(key: 'focusMode' | 'typewriterMode') {
    if (starting || !settingsLoaded || composing || editor?.isComposing()) return;
    settings[key] = !settings[key];
    void persist();
  }
  // 設定画面を開く。閉じた時に、開く前にフォーカスのあった要素へ戻す
  async function openSettings() {
    if (settingsOpen || !settingsLoaded || !settingsDialog) return;
    settingsReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    settingsOpen = true;
    settingsDialog.showModal();
  }
  function closeSettings() {
    settingsDialog?.close();
  }
  function settingsClosed() {
    settingsOpen = false;
    const target = settingsReturn;
    settingsReturn = null;
    if (target?.isConnected) target.focus();
    else editor?.focus();
  }
  function applySettings() {
    if (starting || !settingsLoaded) return;
    void persist();
  }
  async function resetSettings() {
    if (!settingsLoaded) return;
    const ok = await confirm('表示・エディタ・サイドバー・ゴミ箱の設定を初期値に戻します。最近編集の記録、スター、ワークスペースは消しません。', {
      title: '設定を初期値に戻す',
      kind: 'warning',
      okLabel: '初期値に戻す',
      cancelLabel: 'キャンセル',
    });
    if (!ok) return;
    Object.assign(settings, resetPreferences(settings));
    sidebarDraft = null;
    outlineDraft = null;
    void persist();
  }
  function toggleOutline() {
    if (starting || !settingsLoaded) return;
    settings.outlineVisible = !settings.outlineVisible;
    void persist();
  }
  async function menuAction(action: string) {
    if (errorDialog?.open || saveAsDialog?.open || quick) return;
    if (action === 'cli-install') await runCli('cli_install');
    else if (action === 'cli-uninstall') await runCli('cli_uninstall');
    else if (action === 'open-project') await chooseProject();
    else if (action === 'new-markdown') await startName('markdown');
    else if (action === 'new-folder') await startName('directory');
    else if (action === 'image-insert') await insertImage();
    else if (action === 'quick-open') await quickOpen();
    else if (action === 'save') await flush();
    else if (action === 'find') editor?.find();
    else if (action === 'preview-toggle') togglePreview();
    else if (action === 'outline-toggle') toggleOutline();
    else if (action === 'focus-toggle') toggleWritingMode('focusMode');
    else if (action === 'typewriter-toggle') toggleWritingMode('typewriterMode');
    else if (action === 'settings-open') await openSettings();
    else if (['bold', 'italic', 'strike', 'code', 'link'].includes(action))
      editor?.format(action as 'bold' | 'italic' | 'strike' | 'code' | 'link');
  }
  onMount(() => {
    const unlisteners: Array<() => void> = [];
    const focused = () => void checkExternal();
    window.addEventListener('focus', focused);
    void (async () => {
      if (!isTauri()) {
        starting = false;
        contentError = 'Nagoriはデスクトップアプリです。npm run tauri dev で起動してください。';
        return;
      }
      try {
        unlisteners.push(
          await listen<{ paths: string[]; project: string }>('nagori:fs-changed', (event) => {
            if (event.payload.project !== project) return;
            treeQueued = true;
            imagesQueued ||= event.payload.paths.some((path) => /\.(png|jpe?g|gif|webp)$/i.test(path));
            clearTimeout(fsTimer);
            fsTimer = setTimeout(() => void processChanges(), 150);
          }),
        );
        unlisteners.push(await listen<string>('nagori:fs-error', (event) => notify('ファイル監視のエラー: ' + event.payload)));
        unlisteners.push(await listen('nagori:quit-requested', () => void quit()));
        unlisteners.push(
          await listen('nagori:open-requested', () => {
            openRequestsQueued = true;
            void drainOpenRequests();
          }),
        );
        unlisteners.push(await listen<{ action: string }>('nagori:menu', (event) => void menuAction(event.payload.action)));
        const saved = await invoke<Settings>('settings_get');
        settings = startupSettings(saved);
        settingsLoaded = true;
        if (JSON.stringify(settings) !== JSON.stringify(saved)) await persist();
        const requested = await invoke<OpenRequest | null>('open_request_take');
        if (requested) {
          await openProject(requested.workspace, requested.path);
          if (requested.path && current?.path !== requested.path) throw new Error('指定されたファイルを開けません: ' + requested.path);
        } else if (settings.lastProject) {
          const recent = settings.recentFiles,
            last = settings.lastFile;
          try {
            await openProject(settings.lastProject, last);
            settings.recentFiles = [...new Set([...(settings.lastFile ? [settings.lastFile] : []), ...recent])];
            void persist();
          } catch (error) {
            project = '';
            notify('前回のプロジェクトを開けません: ' + failure(error).message);
          }
        }
      } catch (error) {
        notify(failure(error).message);
      } finally {
        starting = false;
        performance.mark('nagori-ready');
        openRequestsQueued = true;
        void drainOpenRequests();
      }
    })();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = () => (systemDark = media.matches);
    followSystem();
    media.addEventListener('change', followSystem);
    return () => {
      media.removeEventListener('change', followSystem);
      quickPanel?.forgetFocus();
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener('focus', focused);
      cancelSave();
      clearTimeout(fsTimer);
      releaseImages();
    };
  });
</script>

<svelte:window onkeydown={keydown} ondragover={preventFileNavigation} ondrop={preventFileNavigation} />
<div
  class="app-shell"
  class:working={busy}
  class:sidebar-hidden={!sidebarVisible}
  bind:clientWidth={shellWidth}
  style={`--sidebar-width:${layout.sidebar}px;--outline-width:${layout.outline}px`}
>
  <header class="global-bar" data-tauri-drag-region="deep">
    <div class="brand">
      <img class="brand-icon" src={nagoriIcon} alt="" width="36" height="36" />
      <img class="brand-wordmark brand-wordmark-light" src={nagoriWordmark} alt="Nagori" width="108" height="36" />
      <img class="brand-wordmark brand-wordmark-dark" src={nagoriWordmarkDark} alt="Nagori" width="108" height="36" />
    </div>
    <button class="quick-button" onclick={() => void quickOpen()} disabled={!project || busy} aria-label="ファイル名・パスで検索"
      ><Icon name="search" /> <span>ファイル名・パスで検索…</span><kbd>⌘ P</kbd></button
    >
    <div class="global-actions">
      <span class="status" class:problem={!!issue} aria-live="polite"
        >{#if session}<span class="status-dot" class:unsaved={status === 'dirty' || status === 'saving'} aria-hidden="true"></span><span
            class="status-label"
            title={readonly ? '読み取り専用' : labels[status]}>{readonly ? '読み取り専用' : labels[status]}</span
          >{#if issue}<button onclick={() => void showProblem()}>対応する</button>{/if}{:else}<span class="local-label"
            >ローカルのMarkdown</span
          >{/if}</span
      >
      <button
        class="icon-button"
        disabled={starting || !settingsLoaded}
        aria-label={theme === 'dark' ? 'ライトモードに切り替える' : 'ダークモードに切り替える'}
        title={theme === 'dark' ? 'ライトモードに切り替える' : 'ダークモードに切り替える'}
        onclick={() => {
          // 押した時の表示の反対に固定する
          settings.theme = nextTheme(theme);
          void persist();
        }}><Icon name={theme === 'dark' ? 'moon' : 'sun'} /></button
      >
      <button
        class="icon-button"
        aria-label={sidebarVisible ? 'サイドバーを隠す' : 'サイドバーを表示'}
        title={sidebarVisible ? 'サイドバーを隠す' : 'サイドバーを表示'}
        aria-controls="file-sidebar"
        aria-expanded={sidebarVisible}
        onclick={() => (sidebarVisible = !sidebarVisible)}><Icon name="sidebar" /></button
      >
    </div>
  </header>
  <aside id="file-sidebar" class="sidebar" aria-label="ファイルと設定" hidden={!sidebarVisible}>
    <div class="workspace-heading">
      <span title={project}>{project ? projectName : 'WORKSPACE'}</span>
      <div class="tree-actions">
        <button aria-label="記事を作成" title="記事を作成" disabled={!project || busy} onclick={() => void startName('markdown')}
          ><Icon name="plus" size={17} /></button
        ><button aria-label="フォルダを作成" title="フォルダを作成" disabled={!project || busy} onclick={() => void startName('directory')}
          ><Icon name="folder-plus" size={17} /></button
        >
      </div>
    </div>
    {#if project}
      <SidebarNav {view} counts={navCounts} onSelect={(next) => (view = next)} />
    {/if}
    {#if view === 'tree'}
      <div class="folders-heading">フォルダ</div>
    {:else}
      <div class="list-heading">
        <button class="back-button" aria-label="フォルダに戻る" title="フォルダに戻る" onclick={() => (view = 'tree')}><Icon name="back" size={16} /></button>
        <span class="list-title">{viewTitles[view]}</span>
        {#if view === 'trash' && trashItems.length}
          <button class="list-action" disabled={busy} onclick={() => void emptyTrash()}>ゴミ箱を空にする</button>
        {/if}
      </div>
    {/if}
    {#if view === 'tree'}
      <FileTree
        {project}
        {rows}
        {expanded}
        current={current?.path}
        {selected}
        {busy}
        bind:naming
        bind:nameInput={renameInput}
        onSelect={(entry) => void selectEntry(entry)}
        onToggle={(entry) => void toggle(entry)}
        onContextMenu={(event, entry) => void contextMenu(event, entry)}
        onRename={(entry) => void startName('rename', entry)}
        onTrash={(entry) => void trash(entry)}
        onCommitName={() => void commitName()}
      />
    {:else if view === 'trash'}
      <TrashList
        items={trashItems}
        {busy}
        onRestore={(item) => void restoreTrash(item)}
        onDelete={(item) => void deleteTrash(item)}
        onContextMenu={(event, item) => void trashContextMenu(event, item)}
      />
    {:else}
      <NoteList
        label={view === 'all' ? 'すべてのノート' : view === 'starred' ? 'スター付きのノート' : '最近編集したノート'}
        notes={view === 'all' ? allList : view === 'starred' ? starredList : recentList}
        current={current?.path}
        {busy}
        dated={view === 'recent'}
        empty={view === 'all' ? 'Markdownの記事はまだありません。' : view === 'starred' ? 'スターを付けた記事はここに並びます。' : '最近編集した記事はここに並びます。'}
        onSelect={(entry) => void selectEntry(entry)}
        onContextMenu={(event, entry) => void contextMenu(event, entry)}
      />
    {/if}
    <div class="sidebar-bottom">
      <button class="open-folder" onclick={() => void chooseProject()} disabled={busy || starting}
        ><Icon name="folder-open" size={17} />{project ? '別のフォルダを開く' : 'フォルダを開く'}</button
      >
      <button class="settings-button" disabled={starting || !settingsLoaded} aria-haspopup="dialog" aria-expanded={settingsOpen} onclick={() => void openSettings()}
        ><Icon name="settings" size={16} />設定</button
      >
    </div>
  </aside>
  {#if sidebarVisible && settingsLoaded}
    <div class="sidebar-boundary">
      <PaneResizer
        label="サイドバーの幅"
        value={layout.sidebar}
        min={SIDEBAR.min}
        max={layout.sidebarMax}
        initial={SIDEBAR.initial}
        onChange={(width) => (sidebarDraft = width)}
        onCommit={() => commitPane('sidebar')}
      />
    </div>
  {/if}
  <main>
    <header class="editor-header">
      <div class="breadcrumb">
        <Icon name={current?.kind === 'image' ? 'image' : 'file'} size={17} /><span>{project ? projectName : 'Nagori'}</span
        >{#if current}<span class="slash">/</span><strong title={current.path}>{current.path}</strong>{/if}
      </div>
      <div class="header-actions">
        {#if (current?.kind === 'markdown' || plain) && session}<span class="char-count">{chars.toLocaleString()} 文字</span>{#if !plain}<button
              class="mode-toggle"
              aria-pressed={previewOnly}
              aria-label={previewOnly ? 'Live Previewで編集する' : 'Previewで閲覧する'}
              title={previewOnly ? 'Live Previewで編集する' : 'Previewで閲覧する'}
              disabled={busy || composing}
              onclick={togglePreview}>{previewOnly ? 'Preview' : 'Live Preview'}</button
            >
            <button
              class="mode-toggle star-toggle"
              aria-pressed={starred}
              aria-label="スター"
              title={starred ? 'スターを外す' : 'スターを付ける'}
              disabled={busy || composing || current?.kind !== 'markdown'}
              onclick={() => current && toggleStar(current.path)}><Icon name="star" size={16} /></button
            >
            <button
              class="mode-toggle outline-toggle"
              aria-pressed={settings.outlineVisible}
              aria-label={outlineLabel}
              title={outlineLabel}
              disabled={starting || !settingsLoaded}
              onclick={toggleOutline}><Icon name="outline" size={16} /></button
            >{/if}
          {/if}
      </div>
    </header>
    <section class="content" aria-label="記事の編集とプレビュー">
      {#if starting}<div class="empty-state">
          <span class="welcome-mark"><Icon name="file" size={44} /></span>
          <p>書く場所を、準備しています。</p>
        </div>
      {:else if contentError}<div class="empty-state">
          <span class="state-icon"><Icon name="file" size={42} /></span>
          <h1>{current?.name ?? 'Nagori'}</h1>
          <p>{contentError}</p>
          {#if project}<button onclick={() => void reveal(current ?? undefined)}>Finderで表示</button>{/if}
        </div>
      {:else if (current?.kind === 'markdown' || plain) && session}<div class="document-body">
          <div class="editor-column">
            <OutlineNotice visible={outlineNotice} />
            <Editor
              {initialText}
              {documentKey}
              saving={status === 'saving'}
              {readonly}
              {busy}
              {plain}
              previewOnly={previewOnly && !plain}
              focus={settings.focusMode}
              typewriter={settings.typewriterMode}
              fontSize={settings.fontSize}
              editorStyle={editorStyle(settings)}
              headingRule={settings.headingRule}
              onChange={changed}
              onComposition={composition}
              onSave={() => void flush()}
              onLink={(href) => void link(href)}
              onContextMenu={(context) => void editorContextMenu(context)}
              onPasteImage={plain ? undefined : (image) => void pasteImage(image)}
              onDropImages={dropImages}
              onImageError={notify}
              {resolveImage}
              onReady={(api) => (editor = api)}
              onOutline={(headings) => (outline = headings)}
              onOutlinePosition={(index) => (outlinePosition = index)}
            />
          </div>
          {#if !plain && settings.outlineVisible && outline.length && layout.showOutline}
            <div class="outline-boundary">
              <PaneResizer
                label="目次の幅"
                value={layout.outline}
                min={OUTLINE.min}
                max={layout.outlineMax}
                initial={OUTLINE.initial}
                direction={-1}
                onChange={(width) => (outlineDraft = width)}
                onCommit={() => commitPane('outline')}
              />
            </div>
            <Outline headings={outline} active={outlinePosition} onNavigate={(index) => editor?.goToHeading(index)} />
          {/if}
        </div>
      {:else if current?.kind === 'image'}<div class="image-preview">
          <img
            src={imageUrl}
            alt={current.name}
            onload={(event) => {
              const image = event.currentTarget as HTMLImageElement;
              imageDimensions = `${image.naturalWidth} × ${image.naturalHeight}`;
            }}
          />
          <p>{current.name}<span>{imageDimensions}</span></p>
        </div>
      {:else}<div class="empty-state welcome">
          <span class="welcome-mark"><Icon name="file" size={44} /></span>
          <div class="eyebrow">A LITTLE SPACE TO WRITE</div>
          <h1>言葉の、居場所。</h1>
          <p>
            {project
              ? '左のファイルを選ぶか、最初の記事を作ってみましょう。'
              : 'いつものフォルダで、思考をほどく。\nMarkdownを書くための、静かな場所。'}
          </p>
          <button class="primary" onclick={() => (project ? void startName('markdown') : void chooseProject())} disabled={busy}
            >{project ? '＋ 新しい記事' : 'フォルダを開く'}</button
          ><small>{project ? '⌘ P で、記事をすばやく探せます。' : 'Markdown · ローカル保存 · macOS'}</small>
        </div>{/if}
    </section>
  </main>
</div>
{#if notice}<div class="toast" role="status">
    {notice}<button aria-label="通知を閉じる" onclick={() => (notice = '')}><Icon name="close" size={15} /></button>
  </div>{/if}
<QuickOpen
  bind:this={quickPanel}
  bind:open={quick}
  entries={index}
  recent={settings.recentFiles}
  onOpen={(entry) => void selectEntry(entry)}
/>
<ProblemDialog
  bind:dialog={errorDialog}
  {issue}
  {diskLabel}
  canOverwrite={!!disk}
  onReload={() => void reloadDisk()}
  onOverwrite={() => void overwriteDisk()}
  onRetry={() => void retrySave()}
  onSaveAs={() => void beginSaveAs()}
  onDiscard={() => void discardAndClose()}
  onClose={() => {
    editor?.focus();
    if (openRequestsQueued) void drainOpenRequests();
  }}
/>
<SettingsDialog
  bind:dialog={settingsDialog}
  settings={settings}
  onChange={applySettings}
  onReset={() => void resetSettings()}
  onClose={settingsClosed}
/>
<SaveAsDialog
  bind:dialog={saveAsDialog}
  bind:input={saveAsInput}
  bind:path={saveAsPath}
  error={saveAsError}
  {busy}
  onSubmit={() => void commitSaveAs()}
  onClose={() => {
    if (openRequestsQueued) void drainOpenRequests();
  }}
/>
