import { failure, type EditSession, type OpenedDocument } from './session.ts';

// App.svelteの保存・外部更新確認・終了の呼び出し順を、IPCとDOMを注入して扱う。
export type AppFlowDeps = {
  getSession: () => EditSession | null;
  isBusy: () => boolean;
  setBusy: (value: boolean) => void;
  isComposing: () => boolean;
  cancelSave: () => void;
  settleComposition: () => Promise<void>;
  showProblem: () => Promise<void>;
  openDocument: (path: string) => Promise<OpenedDocument>;
  replaceText: (text: string) => void;
  notify: (message: string) => void;
  persist: () => Promise<void>;
  settingsQueue: () => Promise<unknown>;
  exitApp: () => Promise<void>;
  // 操作の終了時に再開する、ファイルツリー更新と開く要求の処理
  resumeTree: () => void;
  resumeOpenRequests: () => void;
  // 外部更新確認の再実行を次のタスクへ回す
  defer: (run: () => void) => void;
};

export class AppFlow {
  externalQueued = false;
  private externalChecking = false;
  private deps: AppFlowDeps;
  constructor(deps: AppFlowDeps) { this.deps = deps; }

  // 保存の共通経路。手動保存、操作前の保存、終了前の保存はすべてここを通る
  async flush(): Promise<boolean> {
    const d = this.deps;
    d.cancelSave();
    await d.settleComposition();
    const session = d.getSession();
    if (!session) return true;
    const ok = await session.flush();
    if (!ok && session.issue) await d.showProblem();
    return ok;
  }

  async operation(action: () => Promise<void>, needsSave = true): Promise<boolean | undefined> {
    const d = this.deps;
    if (d.isBusy()) return;
    await d.settleComposition();
    if (d.isBusy()) return;
    d.setBusy(true);
    try {
      if (needsSave && !await this.flush()) return false;
      await action();
      return true;
    } catch (error) {
      d.notify(failure(error).message);
      return false;
    } finally {
      d.setBusy(false);
      d.resumeTree();
      if (this.externalQueued) { this.externalQueued = false; void this.checkExternal(); }
      d.resumeOpenRequests();
    }
  }

  // 保留中の外部更新確認を、操作中でも変換中でもないときだけ再開する
  resumeExternal() {
    if (this.externalQueued && !this.deps.isBusy() && !this.deps.isComposing()) {
      this.externalQueued = false;
      void this.checkExternal();
    }
  }

  async checkExternal() {
    const d = this.deps;
    if (d.isBusy() || this.externalChecking || d.isComposing()) { this.externalQueued = true; return; }
    const target = d.getSession();
    if (!target) return;
    const baseline = target.baseline, generation = target.generation;
    this.externalChecking = true;
    try {
      if (target.isSaving) { this.externalQueued = true; return; }
      const fresh = await d.openDocument(target.path);
      if (d.getSession() !== target || d.isBusy()) return;
      if (d.isComposing()) { this.externalQueued = true; return; }
      if (target.isSaving || target.baseline !== baseline || target.generation !== generation) { this.externalQueued = true; return; }
      if (fresh.baseline === target.baseline) return;
      if (target.dirty || target.issue) {
        target.block({ code: 'CONFLICT', message: 'ディスク側に変更があります。自動保存を停止しました。' });
        d.cancelSave();
        await d.showProblem();
      } else {
        target.reload(fresh);
        d.replaceText(fresh.text);
        d.notify('外部の変更を読み込みました。');
      }
    } catch (error) {
      if (d.getSession() === target && !d.isBusy() && target.baseline === baseline && target.generation === generation && !target.isSaving) {
        if (d.isComposing()) { this.externalQueued = true; return; }
        target.block(error);
        d.cancelSave();
        await d.showProblem();
      }
    } finally {
      this.externalChecking = false;
      if (this.externalQueued && !d.isBusy() && !d.isComposing() && d.getSession()?.status !== 'saving') {
        this.externalQueued = false;
        d.defer(() => void this.checkExternal());
      }
    }
  }

  // Cmd+Q、Cmd+W、閉じる、Dock終了はすべてこの経路で、保存に成功したときだけ終了する
  async quit() {
    const d = this.deps;
    await this.operation(async () => {
      await d.persist();
      await d.settingsQueue();
      await d.exitApp();
    });
  }
}
