import { isTauri } from '@tauri-apps/api/core';
import { Menu, type MenuOptions } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import type { EditorApi, EditorContextMenu } from '../editor/editor.ts';
import type { BlockKind } from '../editor/blockEdit.ts';
import type { Entry } from './navigation.ts';
import type { TrashItem } from './noteLists.ts';
import { failure } from './session.ts';

type MenuDeps = {
  selected: string;
  readonly starredPaths: string[];
  readonly editor: EditorApi | null;
  readonly documentKey: number;
  readonly blocked: boolean;
  notify(message: string): void;
  reveal(entry?: Entry): Promise<void>;
  toggleStar(path: string): void;
  startName(kind: 'markdown' | 'directory' | 'rename', entry?: Entry): Promise<void>;
  trash(entry: Entry): Promise<void>;
  restoreTrash(item: TrashItem): Promise<void>;
  deleteTrash(item: TrashItem): Promise<void>;
  insertImage(): Promise<void>;
  runCli(id: 'cli_install' | 'cli_uninstall'): Promise<void>;
  chooseProject(): Promise<void>;
  quickOpen(): Promise<void>;
  flush(): Promise<boolean>;
  workspaceSearchOpen(): Promise<void>;
  togglePreview(): void;
  toggleOutline(): void;
  toggleWritingMode(key: 'focusMode' | 'typewriterMode'): void;
  openSettings(): Promise<void>;
  zoomFont(kind: 'in' | 'out' | 'reset'): void;
};

export function createMenus(deps: MenuDeps) {
  // 開いているコンテキストメニュー。項目を選んだ知らせはpopupが戻った後に届くため、
  // 閉じるのは次のメニューを出す時と終了時に限る
  let openedMenu: Menu | undefined;
  // 右クリックメニューの項目の処理。Tauri 2.12のmacOSでは、項目ごとのaction(Channel)が呼ばれないことを確かめたため、
  // 項目のidをアプリ全体のメニューの知らせ(nagori:menu)で受け、ここから処理を呼ぶ。新しいメニューを出すたびに入れ替える
  let contextActions = new Map<string, () => void>();
  type ContextItems = NonNullable<MenuOptions['items']>;
  function contextItems(items: ContextItems): ContextItems {
    contextActions = new Map();
    const strip = (list: ContextItems): ContextItems =>
      list.map((entry) => {
        if (!entry || typeof entry !== 'object' || 'rid' in entry) return entry;
        const item = entry as { id?: string; action?: () => void; items?: ContextItems };
        if (item.items) return { ...item, items: strip(item.items) } as (typeof list)[number];
        if (!item.action) return entry;
        const id = `context:${contextActions.size}:${item.id ?? ''}`;
        contextActions.set(id, item.action);
        const { action: _action, ...rest } = item;
        return { ...rest, id } as (typeof list)[number];
      });
    return strip(items);
  }
  async function popupMenu(menu: Menu, at?: LogicalPosition) {
    const previous = openedMenu;
    openedMenu = menu;
    await previous?.close().catch(() => undefined);
    await menu.popup(at);
  }
  async function contextMenu(event: MouseEvent, entry: Entry) {
    event.preventDefault();
    deps.selected = entry.path;
    const menu = await Menu.new({
      items: contextItems([
        { id: 'reveal', text: 'Finderで表示', action: () => void deps.reveal(entry) },
        ...(entry.kind === 'markdown'
          ? [
              {
                id: 'star',
                text: deps.starredPaths.includes(entry.path) ? 'スターを外す' : 'スターを付ける',
                action: () => deps.toggleStar(entry.path),
              },
            ]
          : []),
        {
          id: 'rename',
          text: '名前を変更（参照は更新しません）',
          enabled: entry.kind !== 'symlink',
          action: () => void deps.startName('rename', entry),
        },
        {
          id: 'trash',
          text: entry.kind === 'directory' ? 'フォルダと配下をゴミ箱に移動' : 'ゴミ箱に移動',
          enabled: entry.kind !== 'symlink',
          action: () => void deps.trash(entry),
        },
      ]),
    });
    await popupMenu(menu);
  }
  async function trashContextMenu(event: MouseEvent, item: TrashItem) {
    event.preventDefault();
    const menu = await Menu.new({
      items: contextItems([
        { id: 'restore', text: '元に戻す', action: () => void deps.restoreTrash(item) },
        { id: 'delete', text: '完全に削除', action: () => void deps.deleteTrash(item) },
      ]),
    });
    await popupMenu(menu);
  }
  async function editorContextMenu(context: EditorContextMenu) {
    if (!isTauri() || !deps.editor) return;
    const source = deps.editor,
      key = deps.documentKey;
    const active = () => source === deps.editor && key === deps.documentKey && source.contextState().revision === context.revision;
    const item = (kind: BlockKind, text: string, enabled = context.block) => ({
      id: `editor-${kind}`,
      text,
      enabled,
      action: () => {
        if (active()) source.block(kind, context.revision, context.position);
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
            if (active() && source.contextState().editable) void deps.insertImage();
          },
        },
      );
    try {
      const menu = await Menu.new({ items: contextItems(items) });
      if (active()) await popupMenu(menu, new LogicalPosition(context.x, context.y));
    } catch (error) {
      deps.notify(failure(error).message);
    }
  }
  async function menuAction(action: string) {
    const contextAction = contextActions.get(action);
    if (contextAction) {
      contextAction();
      return;
    }
    if (deps.blocked) return;
    if (action === 'cli-install') await deps.runCli('cli_install');
    else if (action === 'cli-uninstall') await deps.runCli('cli_uninstall');
    else if (action === 'open-project') await deps.chooseProject();
    else if (action === 'new-markdown') await deps.startName('markdown');
    else if (action === 'new-folder') await deps.startName('directory');
    else if (action === 'image-insert') await deps.insertImage();
    else if (action === 'quick-open') await deps.quickOpen();
    else if (action === 'save') await deps.flush();
    else if (action === 'find') deps.editor?.find();
    else if (action === 'workspace-search') await deps.workspaceSearchOpen();
    else if (action === 'preview-toggle') deps.togglePreview();
    else if (action === 'outline-toggle') deps.toggleOutline();
    else if (action === 'focus-toggle') deps.toggleWritingMode('focusMode');
    else if (action === 'typewriter-toggle') deps.toggleWritingMode('typewriterMode');
    else if (action === 'settings-open') await deps.openSettings();
    else if (action === 'font-larger') deps.zoomFont('in');
    else if (action === 'font-smaller') deps.zoomFont('out');
    else if (action === 'font-reset') deps.zoomFont('reset');
    else if (['bold', 'italic', 'strike', 'code', 'link'].includes(action))
      deps.editor?.format(action as 'bold' | 'italic' | 'strike' | 'code' | 'link');
  }

  return {
    contextMenu,
    trashContextMenu,
    editorContextMenu,
    menuAction,
    contextItems,
    close: () => openedMenu?.close().catch(() => undefined),
  };
}
