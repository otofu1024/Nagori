import type { EditorApi } from '../editor/editor.ts';

type DialogDeps = {
  settingsOpen: boolean;
  readonly settingsLoaded: boolean;
  readonly settingsDialog: HTMLDialogElement | undefined;
  readonly editor: EditorApi | null;
};

export function createSettingsDialog(deps: DialogDeps) {
  let settingsReturn: HTMLElement | null = null;
  // 設定画面を開く。閉じた時に、開く前にフォーカスのあった要素へ戻す
  async function openSettings() {
    if (deps.settingsOpen || !deps.settingsLoaded || !deps.settingsDialog) return;
    settingsReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    deps.settingsOpen = true;
    deps.settingsDialog.showModal();
  }
  function closeSettings() {
    deps.settingsDialog?.close();
  }
  function settingsClosed() {
    deps.settingsOpen = false;
    const target = settingsReturn;
    settingsReturn = null;
    if (target?.isConnected) target.focus();
    else deps.editor?.focus();
  }

  return { openSettings, closeSettings, settingsClosed };
}
