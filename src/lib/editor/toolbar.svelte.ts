import { EditorSelection, type ChangeSet } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { formatPlan, linkMarkdown, markdownParser, reparse, type FormatPlan } from './markdown.ts';
import { listPlan, type ListKind } from './blockEdit.ts';
import { typingFormatPlan } from './typingFormat.ts';
import type { FormatKind } from './editor.ts';

type ToolbarDeps = {
  readonly plain: boolean;
  readonly readonly: boolean;
  readonly busy: boolean;
  readonly previewOnly: boolean;
  readonly composition: boolean;
  readonly view: EditorView | undefined;
  readonly root: HTMLDivElement;
};

export function createToolbar(deps: ToolbarDeps) {
  let toolbar = $state<{ top: number; left: number; plans: Record<FormatKind, FormatPlan>; lists: Record<ListKind, boolean> } | null>(null);
  let linkDialog = $state(false),
    linkText = $state(''),
    linkUrl = $state(''),
    linkError = $state('');
  let pendingLink: FormatPlan | undefined;

  let revision = 0,
    pendingRevision = -1;
  // 装飾の判定に使う構文木。本文の変更はためておき、判定が必要になった時に差分だけ解析する
  let parsed: { tree: Tree; pending: ChangeSet | null } | null = null;

  const kinds: FormatKind[] = ['bold', 'italic', 'strike', 'link', 'code'];
  const labels = { bold: '太字', italic: '斜体', strike: '取り消し線', link: 'リンク', code: 'Inline Code' };
  const listKinds: ListKind[] = ['bullet', 'ordered'];
  const listLabels = { bullet: '箇条書きにする', ordered: '番号付きリストにする' };

  // 差分解析の木を最新の本文へ合わせて返す
  function currentTree(text: string) {
    if (!parsed) parsed = { tree: markdownParser.parse(text), pending: null };
    else if (parsed.pending) parsed = { tree: reparse(parsed.tree, text, parsed.pending), pending: null };
    return parsed.tree;
  }
  function plans() {
    if (!deps.view) return null;
    const range = deps.view.state.selection.main,
      text = deps.view.state.doc.toString(),
      tree = currentTree(text);
    return Object.fromEntries(kinds.map((kind) => [kind, formatPlan(text, range, kind, tree)])) as Record<FormatKind, FormatPlan>;
  }
  function listStates(): Record<ListKind, boolean> | null {
    if (!deps.view) return null;
    const range = deps.view.state.selection.main,
      text = deps.view.state.doc.toString(),
      tree = currentTree(text);
    return Object.fromEntries(listKinds.map((kind) => [kind, !!listPlan(text, range, kind, tree)])) as Record<ListKind, boolean>;
  }
  function updateToolbar() {
    // テキストファイルではMarkdownの装飾ツールバーを出さない
    if (deps.plain) {
      toolbar = null;
      return;
    }
    const toolbarFocused = !!deps.root?.querySelector('.floating-toolbar')?.contains(document.activeElement);
    if (
      !deps.view ||
      deps.view.state.readOnly ||
      deps.composition ||
      deps.view.composing ||
      linkDialog ||
      deps.view.state.selection.main.empty ||
      (!deps.view.hasFocus && !toolbarFocused)
    ) {
      toolbar = null;
      return;
    }
    const coords = deps.view.coordsAtPos(deps.view.state.selection.main.head);
    if (!coords) {
      toolbar = null;
      return;
    }
    const viewport = deps.view.scrollDOM.getBoundingClientRect();
    if (coords.bottom <= viewport.top || coords.top >= viewport.bottom || coords.right <= viewport.left || coords.left >= viewport.right) {
      toolbar = null;
      return;
    }
    const bounds = deps.root.getBoundingClientRect();
    toolbar = {
      top: Math.max(4, coords.top - bounds.top - 44),
      left: Math.max(8, Math.min(coords.left - bounds.left, bounds.width - 270)),
      plans: plans()!,
      lists: listStates()!,
    };
  }
  function apply(kind: FormatKind) {
    if (deps.plain) return;
    if (
      !deps.view ||
      deps.view.state.readOnly ||
      deps.readonly ||
      deps.busy ||
      deps.previewOnly ||
      deps.composition ||
      deps.view.composing ||
      deps.view.compositionStarted ||
      linkDialog
    )
      return;
    if (deps.view.state.selection.main.empty && (kind === 'bold' || kind === 'italic')) {
      const plan = typingFormatPlan(deps.view.state, kind);
      if (plan) {
        deps.view.dispatch(plan);
        // 履歴に操作後の位置を記録し、Redoでも記号の真ん中へ戻す。
        deps.view.dispatch({ selection: deps.view.state.selection, userEvent: 'input.format' });
        deps.view.focus();
        updateToolbar();
      }
      return;
    }
    // 表示用の判定は差分解析の木を使うため、本文を変える前に全文解析で判定し直す
    const plan = formatPlan(deps.view.state.doc.toString(), deps.view.state.selection.main, kind);
    if (!plan || plan.reason) return;
    if (kind === 'link') {
      pendingLink = plan;
      pendingRevision = revision;
      linkText = plan.linkText ?? '';
      linkUrl = plan.existingLink ?? '';
      linkError = '';
      linkDialog = true;
      toolbar = null;
      return;
    }
    deps.view.dispatch({
      changes: plan.changes ?? { from: plan.from, to: plan.to, insert: plan.text },
      selection: EditorSelection.range(plan.selection.from, plan.selection.to),
      userEvent: 'input.format',
    });
    deps.view.focus();
    updateToolbar();
  }
  function applyList(kind: ListKind) {
    if (deps.plain) return;
    if (
      !deps.view ||
      deps.view.state.readOnly ||
      deps.readonly ||
      deps.busy ||
      deps.previewOnly ||
      deps.composition ||
      deps.view.composing ||
      deps.view.compositionStarted ||
      linkDialog
    )
      return;
    // 本文を変える前に全文で判定し直す
    const plan = listPlan(deps.view.state.doc.toString(), deps.view.state.selection.main, kind);
    if (!plan) return;
    // 変換した行全体を選び直し、1回の取り消しで戻せるように履歴を区切る
    deps.view.dispatch({
      changes: plan.changes,
      selection: EditorSelection.range(plan.selection.from, plan.selection.to),
      userEvent: 'input.format',
      annotations: isolateHistory.of('full'),
    });
    deps.view.focus();
    updateToolbar();
  }
  function finishLink(event: SubmitEvent) {
    event.preventDefault();
    if (!deps.view || !pendingLink || deps.view.state.readOnly || deps.composition || deps.view.composing) return;
    if (pendingRevision !== revision) {
      dismissLink();
      return;
    }
    try {
      const insert = linkMarkdown(linkText, linkUrl);
      deps.view.dispatch({
        changes: { from: pendingLink.from, to: pendingLink.to, insert },
        selection: { anchor: pendingLink.from + insert.length },
        userEvent: 'input.format',
      });
      dismissLink();
    } catch (error) {
      linkError = String(error);
    }
  }
  function focusInput(node: HTMLInputElement) {
    node.focus();
  }
  function linkKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissLink();
    }
    if (event.key === 'Tab') {
      const form = event.currentTarget as HTMLElement,
        fields = [...form.querySelectorAll<HTMLElement>('input, button')];
      const first = fields[0],
        last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  function dismissLink() {
    linkDialog = false;
    pendingLink = undefined;
    deps.view?.focus();
    updateToolbar();
  }

  function clearLink() {
    linkDialog = false;
    pendingLink = undefined;
  }
  function changed(changes: ChangeSet) {
    revision++;
    if (parsed) parsed.pending = parsed.pending ? parsed.pending.compose(changes) : changes;
    if (linkDialog) clearLink();
  }
  function reset() {
    clearLink();
    linkError = '';
    revision++;
    parsed = null;
  }
  return {
    get toolbar() {
      return toolbar;
    },
    set toolbar(value) {
      toolbar = value;
    },
    get linkDialog() {
      return linkDialog;
    },
    get linkText() {
      return linkText;
    },
    set linkText(value) {
      linkText = value;
    },
    get linkUrl() {
      return linkUrl;
    },
    set linkUrl(value) {
      linkUrl = value;
    },
    get linkError() {
      return linkError;
    },
    kinds,
    labels,
    listKinds,
    listLabels,
    updateToolbar,
    apply,
    applyList,
    finishLink,
    focusInput,
    linkKeys,
    dismissLink,
    clearLink,
    changed,
    reset,
  };
}
