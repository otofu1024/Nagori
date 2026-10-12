<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { createDocumentDialogs } from './lib/workspace/documentDialogs.ts';
  import { createSettingsDialog } from './lib/workspace/settingsDialog.ts';
  import { createFontZoom } from './lib/workspace/fontZoom.ts';
  import { createFileActions } from './lib/workspace/fileActions.ts';
  import { createMenus } from './lib/workspace/menus.ts';
  import { open, confirm } from '@tauri-apps/plugin-dialog';
  import Editor from './lib/editor/Editor.svelte';
  import Outline from './lib/components/Outline.svelte';
  import OutlineNotice from './lib/components/OutlineNotice.svelte';
  import { outlineNoticeVisible } from './lib/workspace/outlineNotice.ts';
  import { COMPOSITION_SETTLE_LIMIT_MS } from './lib/editor/composition.ts';
  import PaneResizer from './lib/components/PaneResizer.svelte';
  import { SIDEBAR, OUTLINE, paneLayout } from './lib/workspace/paneWidths.ts';
  import type { OutlineHeading } from './lib/workspace/outline.ts';
  import Icon from './lib/components/Icon.svelte';
  import QuickOpen from './lib/components/QuickOpen.svelte';
  import WorkspaceSearch from './lib/components/WorkspaceSearch.svelte';
  import type { SearchHit } from './lib/workspace/workspaceSearch.ts';
  import FileTree from './lib/components/FileTree.svelte';
  import SidebarNav, { type SidebarView } from './lib/components/SidebarNav.svelte';
  import NoteList from './lib/components/NoteList.svelte';
  import TrashList from './lib/components/TrashList.svelte';
  import { endDrag, rootDrop } from './lib/workspace/fileDrag.ts';
  import { allNotes, recentlyEdited, starredNotes, recordOpened, type NoteItem, type TrashItem } from './lib/workspace/noteLists.ts';
  import ProblemDialog from './lib/components/ProblemDialog.svelte';
  import SaveAsDialog from './lib/components/SaveAsDialog.svelte';
  import nagoriIcon from './lib/assets/nagori-icon.png';
  import type { EditorApi } from './lib/editor/editor';
  import { EditSession, failure, type OpenedDocument } from './lib/workspace/session';
  import { AppFlow } from './lib/workspace/appFlow';
  import { parentPath, localLink, type Entry, type Naming } from './lib/workspace/navigation';
  import { createImageLoader } from './lib/workspace/imageLoader.ts';
  import { imageDropReason, importDroppedImages, preventFileNavigation } from './lib/workspace/imageDrop';

  import SettingsDialog from './lib/components/SettingsDialog.svelte';
  import { defaults, startupSettings, resolvedTheme, nextTheme, resetPreferences, editorStyle, type Settings } from './lib/workspace/settings';
  type OpenRequest = { workspace: string; path: string | null };
  let settings = $state<Settings>({ ...defaults, theme: 'light' });
  let settingsLoaded = $state(false);
  // macOSの外観。theme が 'system' の時だけ使う
  let systemDark = $state(false),
    settingsOpen = $state(false),
    settingsDialog = $state<HTMLDialogElement>();
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
  // 索引とゴミ箱は丸ごと置き換えるだけなので、要素ごとのProxyを作らないraw状態にする
  let index = $state.raw<Entry[]>([]),
    // サイドバーの表示。フォルダ以外は一覧に切り替える。保存はしない
    view = $state<SidebarView>('tree'),
    trashItems = $state.raw<TrashItem[]>([]),
    busy = $state(false),
    starting = $state(true),
    notice = $state(''),
    contentError = $state('');
  let sidebarVisible = $state(true);
  let shellWidth = $state(0);
  let sidebarDraft = $state<number | null>(null),
    outlineDraft = $state<number | null>(null);
  const outlineWidth = $derived(outlineDraft ?? settings.outlineWidth);
  // Markdown以外のファイルを、ただのテキストとして開いているか
  const plain = $derived(current?.kind === 'other');
  // 目次を実際に表示しているか。本文の幅を自動で決める時に、目次の分の空きを引くかどうかに使う
  const outlineOpen = $derived(!plain && settings.outlineVisible && outline.length > 0);
  const layout = $derived(paneLayout(shellWidth, sidebarDraft ?? settings.sidebarWidth, outlineWidth, sidebarVisible, settings.editorWidth, { auto: settings.autoEditorWidth, outlineOpen }));
  const outlineLabel = $derived(settings.outlineVisible
    ? outline.length && !layout.showOutline ? '幅が足りないため目次を隠しています' : '目次を隠す'
    : '目次を表示');
  const focusLabel = $derived(settings.focusMode ? '集中モードをオフにする' : '集中モードをオンにする');
  let previewOnly = $state(false),
    imageUrl = $state(''),
    imageDimensions = $state('');
  let composing = $state(false),
    compositionWaiters: Array<() => void> = [],
    autosave: ReturnType<typeof setTimeout> | undefined;
  let fsTimer: ReturnType<typeof setTimeout> | undefined, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let openRequestsQueued = false,
    openingRequest = false;
  const images = createImageLoader(() => current?.path);
  const { blobImage, resolveImage } = images;
  let treeQueued = false,
    imagesQueued = false;
  let quick = $state(false),
    quickPanel: QuickOpen;
  let searchOpen = $state(false),
    workspaceSearch: WorkspaceSearch;
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
  const outlineNotice = $derived(outlineNoticeVisible({ plain, previewOnly, outlineVisible: settings.outlineVisible, headingCount: outline.length, showOutline: layout.showOutline }));
  const projectName = $derived(project.split('/').filter(Boolean).at(-1) ?? 'Workspace');
  const starredPaths = $derived(settings.starred[project] ?? []);
  const allList = $derived(allNotes(index));
  const starredList = $derived(starredNotes(starredPaths, index));
  const recentList = $derived(recentlyEdited(index, settings.recentOpenedAt, settings.recentEditedCount));
  const navCounts = $derived({ all: allList.length, starred: starredList.length, recent: recentList.length, trash: trashItems.length });
  // ナビで選んだ一覧の見出し。フォルダの表示のときは使わない
  const viewTitles: Record<Exclude<SidebarView, 'tree'>, string> = { all: 'すべてのノート', starred: 'スター付き', recent: '最近見たノート', trash: 'ゴミ箱' };
  const starred = $derived(!!current && starredPaths.includes(current.path));
  // ドラッグで項目を移したり、ゴミ箱へ移したりできる時か。読み取り専用・保存中・処理中・日本語変換中は止める
  const dragReady = $derived(!busy && !composing && !readonly && status !== 'saving');
  let rootHot = $state(false);
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
    if (!composing) return;
    // compositionend が来ない時も保存や終了が止まらないよう、上限を過ぎたら変換が終わったものとして先へ進める
    // Editor 側の変換の状態も戻し、装飾の更新が止まらないようにする
    const limit = setTimeout(() => { editor?.endComposition(); composition(false); }, COMPOSITION_SETTLE_LIMIT_MS);
    await new Promise<void>((resolve) => compositionWaiters.push(() => {
      clearTimeout(limit);
      resolve();
    }));
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
          images.discard(url);
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
    showProblem: () => showProblem(),
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
    images.releaseImages();
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
  // 保存した記事の更新日時を今にして、最近見たノートの一覧へ反映する
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
  // ワークスペース全体の本文検索を開く。プロジェクトがない時や、ほかの操作の途中では開かない
  async function workspaceSearchOpen() {
    if (!project || busy || composing || searchOpen || quick || errorDialog?.open || saveAsDialog?.open) return;
    await workspaceSearch.show(document.activeElement as HTMLElement | null);
  }
  // 検索結果の記事を開き、一致した所を選んで画面へ寄せる。開く処理と保存の待ち合わせは選択の処理に任せる
  async function openSearchHit(hit: SearchHit) {
    const entry = index.find((item) => item.path === hit.path);
    if (!entry) {
      notify('検索結果のファイルが見つかりません: ' + hit.path);
      return;
    }
    await selectEntry(entry);
    if (current?.path !== hit.path) return;
    await tick();
    editor?.revealRange(hit.line, hit.column, hit.length);
  }
  const { runCli, startName, commitName, move, trash, restoreTrash, deleteTrash, emptyTrash, toggleStar, reveal } = createFileActions({
    get busy() { return busy; },
    get composing() { return composing; },
    get project() { return project; },
    get view() { return view; }, set view(value) { view = value; },
    get expanded() { return expanded; }, set expanded(value) { expanded = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get naming() { return naming; }, set naming(value) { naming = value; },
    get renameInput() { return renameInput; },
    get current() { return current; }, set current(value) { current = value; },
    get session() { return session; }, set session(value) { session = value; },
    get settings() { return settings; }, set settings(value) { settings = value; },
    get trashItems() { return trashItems; },
    get rows() { return rows; },
    get editor() { return editor; },
    get imageUrl() { return imageUrl; }, set imageUrl(value) { imageUrl = value; },
    operation, notify, list, loadEntry, refreshTree, refreshIndex, persist, releaseImages, blobImage, clearDocument, loadTrash,
  });
  // ワークスペースの名前へ離すと、一番上へ移す
  function rootDragOver(event: DragEvent) {
    rootHot = rootDrop(event) !== null;
    if (!rootHot) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  }
  function rootDropped(event: DragEvent) {
    const entry = rootDrop(event);
    rootHot = false;
    endDrag();
    if (!entry) return;
    event.preventDefault();
    void move(entry, '');
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
  const { showProblem, reloadDisk, overwriteDisk, retrySave, beginSaveAs, commitSaveAs, discardAndClose } = createDocumentDialogs({
    get session() { return session; },
    get issue() { return issue; }, set issue(value) { issue = value; },
    get disk() { return disk; }, set disk(value) { disk = value; },
    get diskLabel() { return diskLabel; }, set diskLabel(value) { diskLabel = value; },
    get errorDialog() { return errorDialog; },
    get saveAsDialog() { return saveAsDialog; },
    get saveAsInput() { return saveAsInput; },
    get saveAsPath() { return saveAsPath; }, set saveAsPath(value) { saveAsPath = value; },
    get saveAsError() { return saveAsError; }, set saveAsError(value) { saveAsError = value; },
    get busy() { return busy; }, set busy(value) { busy = value; },
    get current() { return current; }, set current(value) { current = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get settings() { return settings; },
    get editor() { return editor; },
    get openRequestsQueued() { return openRequestsQueued; },
    settleComposition, flush, releaseImages, syncSession, refreshTree, refreshIndex, persist, scheduleSave, notify, drainOpenRequests, clearDocument,
  });
  function checkExternal() {
    return flow.checkExternal();
  }
  function quit() {
    return flow.quit();
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (quick || searchOpen) return;
    if (errorDialog?.open || saveAsDialog?.open) return;
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      void workspaceSearchOpen();
      return;
    }
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
    // 拡大縮小の設定がオフの時は、ショートカットとして扱わず、何もしない
    if ((event.metaKey || event.ctrlKey) && !event.altKey && settings.zoomFontSize && ['=', '+', '-', '0'].includes(event.key)) {
      event.preventDefault();
      zoomFont(event.key === '0' ? 'reset' : event.key === '-' ? 'out' : 'in');
      return;
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
  // 文字サイズを変えられるのは、設定が有効で、IME変換中でもなく、入力を妨げる画面を開いていない時だけ
  function zoomAvailable() {
    return settings.zoomFontSize && settingsLoaded && !starting && !composing && !editor?.isComposing() && !quick && !searchOpen && !errorDialog?.open && !saveAsDialog?.open;
  }
  const fontZoom = createFontZoom(() => settings, zoomAvailable, persist);
  $effect(() => { if (settings.zoomFontSize) return fontZoom.mountWheel(); });
  function zoomFont(kind: 'in' | 'out' | 'reset') { fontZoom.zoomFont(kind); }
  function toggleWritingMode(key: 'focusMode' | 'typewriterMode') {
    if (starting || !settingsLoaded || composing || editor?.isComposing()) return;
    settings[key] = !settings[key];
    void persist();
  }
  const { openSettings, closeSettings, settingsClosed } = createSettingsDialog({
    get settingsOpen() { return settingsOpen; }, set settingsOpen(value) { settingsOpen = value; },
    get settingsLoaded() { return settingsLoaded; }, get settingsDialog() { return settingsDialog; }, get editor() { return editor; },
  });
  function applySettings() {
    if (starting || !settingsLoaded) return;
    void persist();
  }
  async function resetSettings() {
    if (!settingsLoaded) return;
    const ok = await confirm('表示・エディタ・サイドバー・ゴミ箱の設定を初期値に戻します。最近見たノートの記録、スター、ワークスペースは消しません。', {
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
  const { contextMenu, trashContextMenu, editorContextMenu, menuAction, close: closeMenus } = createMenus({
    get selected() { return selected; }, set selected(value) { selected = value; },
    get starredPaths() { return starredPaths; }, get editor() { return editor; }, get documentKey() { return documentKey; },
    get blocked() { return !!(errorDialog?.open || saveAsDialog?.open || quick || searchOpen); },
    notify, reveal, toggleStar, startName, trash, restoreTrash, deleteTrash, insertImage, runCli, chooseProject, quickOpen,
    flush, workspaceSearchOpen, togglePreview, toggleOutline, toggleWritingMode, openSettings, zoomFont,
  });
  onMount(() => {
    const unlisteners: Array<() => void> = [];
    const focused = () => void checkExternal();
    window.addEventListener('focus', focused);
    const releaseZoom = fontZoom.mount();
    void (async () => {
      if (!isTauri()) {
        starting = false;
        contentError = 'NagoriEditorはデスクトップアプリです。npm run tauri dev で起動してください。';
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
      void closeMenus();
      quickPanel?.forgetFocus();
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener('focus', focused);
      releaseZoom();
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
      <span class="brand-wordmark">NagoriEditor</span>
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
    <div class="workspace-heading" role="presentation" class:drop-target={rootHot} ondragover={rootDragOver} ondragleave={() => (rootHot = false)} ondrop={rootDropped}>
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
      <SidebarNav {view} counts={navCounts} onSelect={(next) => (view = next)} onTrash={(entry) => void trash(entry)} />
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
        dragEnabled={dragReady}
        bind:naming
        bind:nameInput={renameInput}
        onSelect={(entry) => void selectEntry(entry)}
        onToggle={(entry) => void toggle(entry)}
        onContextMenu={(event, entry) => void contextMenu(event, entry)}
        onRename={(entry) => void startName('rename', entry)}
        onTrash={(entry) => void trash(entry)}
        onMove={(entry, toDirectory) => void move(entry, toDirectory)}
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
        label={view === 'all' ? 'すべてのノート' : view === 'starred' ? 'スター付きのノート' : '最近見たノート'}
        notes={view === 'all' ? allList : view === 'starred' ? starredList : recentList}
        current={current?.path}
        {busy}
        dragEnabled={dragReady}
        dated={view === 'recent'}
        empty={view === 'all' ? 'Markdownの記事はまだありません。' : view === 'starred' ? 'スターを付けた記事はここに並びます。' : '最近見た記事はここに並びます。'}
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
        <Icon name={current?.kind === 'image' ? 'image' : 'file'} size={17} /><span>{project ? projectName : 'NagoriEditor'}</span
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
              class="mode-toggle focus-toggle"
              aria-pressed={settings.focusMode}
              aria-label={focusLabel}
              title={focusLabel}
              disabled={starting || !settingsLoaded || composing}
              onclick={() => toggleWritingMode('focusMode')}><Icon name="focus" size={16} /></button
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
          <h1>{current?.name ?? 'NagoriEditor'}</h1>
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
              editorStyle={editorStyle({ ...settings, editorWidth: layout.editorWidth })}
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
<WorkspaceSearch bind:this={workspaceSearch} bind:open={searchOpen} onOpen={(hit) => void openSearchHit(hit)} />
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
