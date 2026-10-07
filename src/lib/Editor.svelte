<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { Compartment, EditorState, Prec, Transaction, EditorSelection, type ChangeSet } from '@codemirror/state';
  import type { Tree } from '@lezer/common';
  import { EditorView, keymap, highlightActiveLine, layer, RectangleMarker } from '@codemirror/view';
  import { history, historyKeymap, defaultKeymap, isolateHistory } from '@codemirror/commands';
  import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
  import { syntaxTree, syntaxTreeAvailable, forceParsing } from '@codemirror/language';
  import { extractHeadings, currentHeading, type OutlineHeading } from './outline.ts';
  import { openSearchPanel, closeSearchPanel } from '@codemirror/search';
  import { findExtension, findReplaceBlocked } from './findPanel.ts';
  import { restoredScrollTop } from './scrollRestore.ts';
  import { focusMode } from './focusMode.ts';
  import { activityScrollbar } from './activityScrollbar.ts';
  import { livePreview, previewOnlyMode, compositionMode, refreshImagesEffect } from './livePreview.ts';
  import { formatPlan, linkMarkdown, markdownExtensions, markdownParser, reparse, type FormatPlan } from './markdown.ts';
  import type { EditorApi, FormatKind, EditorContextState, EditorContextMenu } from './editor.ts';
  import { blockAvailability, blockEdit, type BlockKind } from './blockEdit.ts';
  import { clipboardImage } from './image.ts';
  import { imageDrop } from './imageDrop.ts';
  import { codeLanguage, codeHighlighting } from './codeLanguages.ts';

  let { initialText, documentKey, readonly = false, busy = false, saving = false, plain = false, previewOnly = false, focus = false, typewriter = false, fontSize = 19, onChange, onComposition, onSave, onLink, onPasteImage, onDropImages, onImageError, onContextMenu, resolveImage, onReady, onOutline, onOutlinePosition }: {
    onContextMenu?: (context: EditorContextMenu) => void;
    initialText: string; documentKey: string | number; readonly?: boolean; busy?: boolean; saving?: boolean; plain?: boolean; previewOnly?: boolean; focus?: boolean; typewriter?: boolean; fontSize?: number;
    onChange: (text: string) => void; onComposition: (active: boolean) => void; onSave: () => void;
    onLink: (href: string) => void; onPasteImage?: (image: File) => void; resolveImage: (reference: string) => Promise<string>; onReady: (api: EditorApi) => void;
    onOutline?: (headings: OutlineHeading[]) => void; onOutlinePosition?: (index: number) => void;
    onDropImages?: (images: File[]) => Promise<string | null>; onImageError?: (reason: string) => void;
  } = $props();
  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let view: EditorView | undefined;
  let toolbar = $state<{ top: number; left: number; plans: Record<FormatKind, FormatPlan> } | null>(null);
  let linkDialog = $state(false), linkText = $state(''), linkUrl = $state(''), linkError = $state('');
  let pendingLink: FormatPlan | undefined;
  let menuRevision = 0;
  let composition = false, revision = 0, pendingRevision = -1;
  // 装飾の判定に使う構文木。本文の変更はためておき、判定が必要になった時に差分だけ解析する
  let parsed: { tree: Tree; pending: ChangeSet | null } | null = null;
  const readOnlyConfig = new Compartment();
  const focusConfig = new Compartment();
  const kinds: FormatKind[] = ['bold', 'italic', 'strike', 'link', 'code'];
  const labels = { bold: '太字', italic: '斜体', strike: '取り消し線', link: 'リンク', code: 'Inline Code' };

  let headings: OutlineHeading[] = [], outlineTimer: ReturnType<typeof setTimeout> | undefined;
  let outlinePosition = -1;
  const outlineMeasureKey = {};
  function updateOutlinePosition() {
    const editor = view;
    if (!editor || plain) return;
    editor.requestMeasure({ key: outlineMeasureKey,
      read: () => {
        // 目次で移動した見出しは上端から少し下に置くため、上端より48px下を基準に今の節を決める
        const height = editor.scrollDOM.getBoundingClientRect().top - editor.documentTop + 48;
        const block = editor.lineBlockAtHeight(Math.max(0, height));
        return height < 0 ? -1 : currentHeading(headings, block.from - (block.top > height ? 1 : 0));
      },
      write: index => {
        if (view !== editor || index === outlinePosition) return;
        outlinePosition = index; onOutlinePosition?.(index);
      },
    });
  }
  function scheduleOutline() {
    clearTimeout(outlineTimer);
    if (plain) { headings = []; onOutline?.([]); onOutlinePosition?.(-1); return; }
    outlineTimer = setTimeout(() => {
      const editor = view;
      if (!editor) return;
      // 長文の末尾も含める。解析が未完なら短い時間ずつ進め、次回へ回す。
      if (!syntaxTreeAvailable(editor.state) && !forceParsing(editor, editor.state.doc.length, 20)) { scheduleOutline(); return; }
      headings = extractHeadings(syntaxTree(editor.state), editor.state.doc);
      onOutline?.(headings); updateOutlinePosition();
    }, 150);
  }
  function goToHeading(index: number) {
    if (!view || plain || busy || composition || view.composing) return;
    const heading = headings[index];
    if (!heading) return;
    const editor = view;
    if (!previewOnly) editor.dispatch({ selection: { anchor: heading.lineEnd } });
    editor.focus();
    // 選択変更後の通常の追従が終わってから、見出しを上端付近へ揃える。
    queueMicrotask(() => {
      if (view !== editor) return;
      // 見出しの行は上側にpaddingがあるため、文字の位置から余白を多めに取る
      editor.dispatch({ effects: EditorView.scrollIntoView(heading.from, { y: 'start', yMargin: 32 }) });
      updateOutlinePosition();
    });
  }

  function plans() {
    if (!view) return null;
    const range = view.state.selection.main, text = view.state.doc.toString();
    if (!parsed) parsed = { tree: markdownParser.parse(text), pending: null };
    else if (parsed.pending) parsed = { tree: reparse(parsed.tree, text, parsed.pending), pending: null };
    const tree = parsed.tree;
    return Object.fromEntries(kinds.map(kind => [kind, formatPlan(text, range, kind, tree)])) as Record<FormatKind, FormatPlan>;
  }
  function updateToolbar() {
    // テキストファイルではMarkdownの装飾ツールバーを出さない
    if (plain) { toolbar = null; return; }
    const toolbarFocused = !!root?.querySelector('.floating-toolbar')?.contains(document.activeElement);
    if (!view || view.state.readOnly || composition || view.composing || linkDialog || view.state.selection.main.empty || (!view.hasFocus && !toolbarFocused)) { toolbar = null; return; }
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (!coords) { toolbar = null; return; }
    const viewport = view.scrollDOM.getBoundingClientRect();
    if (coords.bottom <= viewport.top || coords.top >= viewport.bottom || coords.right <= viewport.left || coords.left >= viewport.right) { toolbar = null; return; }
    const bounds = root.getBoundingClientRect();
    toolbar = { top: Math.max(4, coords.top - bounds.top - 44), left: Math.max(8, Math.min(coords.left - bounds.left, bounds.width - 245)), plans: plans()! };
  }
  function apply(kind: FormatKind) {
    if (plain) return;
    if (!view || view.state.readOnly || composition || view.composing || linkDialog) return;
    // 表示用の判定は差分解析の木を使うため、本文を変える前に全文解析で判定し直す
    const plan = formatPlan(view.state.doc.toString(), view.state.selection.main, kind);
    if (!plan || plan.reason) return;
    if (kind === 'link') { pendingLink = plan; pendingRevision = revision; linkText = plan.linkText ?? ''; linkUrl = plan.existingLink ?? ''; linkError = ''; linkDialog = true; toolbar = null; return; }
    view.dispatch({ changes: plan.changes ?? { from: plan.from, to: plan.to, insert: plan.text }, selection: EditorSelection.range(plan.selection.from, plan.selection.to), userEvent: 'input.format' });
    view.focus(); updateToolbar();
  }
  function finishLink(event: SubmitEvent) {
    event.preventDefault();
    if (!view || !pendingLink || view.state.readOnly || composition || view.composing) return;
    if (pendingRevision !== revision) { dismissLink(); return; }
    try {
      const insert = linkMarkdown(linkText, linkUrl);
      view.dispatch({ changes: { from: pendingLink.from, to: pendingLink.to, insert }, selection: { anchor: pendingLink.from + insert.length }, userEvent: 'input.format' });
      dismissLink();
    } catch (error) { linkError = String(error); }
  }
  function focusInput(node: HTMLInputElement) { node.focus(); }
  function linkKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); dismissLink(); }
    if (event.key === 'Tab') {
      const form = event.currentTarget as HTMLElement, fields = [...form.querySelectorAll<HTMLElement>('input, button')];
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function dismissLink() { linkDialog = false; pendingLink = undefined; view?.focus(); updateToolbar(); }
  function setComposition(active: boolean) {
    composition = active; toolbar = null;
    if (active) onComposition(true);
    const editor = view;
    // CodeMirror queues its final DOM flush first. Rebuild preview and resume saves only after that flush.
    queueMicrotask(() => {
      if (!editor || view !== editor || composition !== active) return;
      editor.dispatch({ effects: compositionMode.of(active) });
      if (!active) { onComposition(false); updateToolbar(); }
    });
  }
  // 画像だけをコピーしていた時は、標準の貼り付けを止めて画像の取り込みに回す
  function pasteImage(event: ClipboardEvent, editor: EditorView) {
    const image = clipboardImage(event.clipboardData);
    if (!image || !onPasteImage) return false;
    event.preventDefault();
    if (!editor.state.readOnly && !composition && !editor.composing) onPasteImage(image);
    return true;
  }
  function contextState(): EditorContextState {
    const editable = !!view && !readonly && !busy && !previewOnly && !composition && !view.composing && !linkDialog;
    const availability = view && !plain && editable ? blockAvailability(view.state.doc.toString(), view.state.selection.main) : { block: false, heading: false };
    return { plain, editable, ...availability, revision: menuRevision };
  }
  function applyBlock(kind: BlockKind, expectedRevision: number) {
    if (!view || plain || !contextState().editable || expectedRevision !== menuRevision) return;
    const plan = blockEdit(view.state.doc.toString(), view.state.selection.main, kind);
    if (!plan || !plan.changes.length) return;
    view.dispatch({ changes: plan.changes, ...(plan.selection ? { selection: EditorSelection.range(plan.selection.from, plan.selection.to) } : {}), userEvent: 'input.format', annotations: isolateHistory.of('full') });
    view.focus(); updateToolbar();
  }
  function showContextMenu(event: MouseEvent | KeyboardEvent, editor: EditorView) {
    event.preventDefault();
    const composing = composition || editor.composing;
    const position = event instanceof MouseEvent ? editor.posAtCoords({ x: event.clientX, y: event.clientY }) : editor.state.selection.main.head;
    const range = editor.state.selection.main;
    // 選択の内側を右クリックした時は選択を保ち、外側ならクリック位置へ移す
    if (!composing && position !== null && (range.empty || position < range.from || position > range.to)) editor.dispatch({ selection: { anchor: position } });
    if (!composing) editor.focus();
    const coords = editor.coordsAtPos(editor.state.selection.main.head), bounds = editor.dom.getBoundingClientRect();
    onContextMenu?.({ ...contextState(), position: position ?? range.head, x: event instanceof MouseEvent ? event.clientX : coords?.left ?? bounds.left, y: event instanceof MouseEvent ? event.clientY : coords?.bottom ?? bounds.top });
    return true;
  }
  function createState(text: string) {
    return EditorState.create({ doc: text, extensions: [
      history(), highlightActiveLine(), EditorView.lineWrapping,
      imageDrop({ state: () => ({ plain, readonly, busy, saving, previewOnly, composing: composition, saved: !!onDropImages }), importImages: images => onDropImages?.(images) ?? Promise.resolve(null), notify: reason => onImageError?.(reason) }),
      focusConfig.of(focusMode(focus, typewriter, plain)),
      // 選択表示は標準のまま保ち、折り返しの上下はカーソルのassocで決める。
      layer({
        above: true, class: 'cm-cursorLayer',
        markers: editor => {
          const range = editor.state.selection.main;
          if (!editor.hasFocus || !range.empty || editor.state.readOnly || !editor.state.facet(EditorView.editable) || composition || editor.composing) return [];
          return RectangleMarker.forRange(editor, 'cm-cursor cm-cursor-primary', range);
        },
        update: (update, dom) => {
          if (update.docChanged || update.selectionSet || update.focusChanged || update.transactions.some(tr => tr.effects.some(e => e.is(compositionMode)))) {
            // 2つの標準アニメーションを交互に使い、入力と移動の直後は点灯へ戻す。
            dom.style.animationName = dom.style.animationName === 'cm-blink' ? 'cm-blink2' : 'cm-blink';
          }
          return update.transactions.length > 0 || update.focusChanged;
        },
      }),
      // テキストファイルはMarkdownとして解釈せず、Live Previewも付けない
      ...(plain ? [] : [
        markdown({ base: commonmarkLanguage, extensions: markdownExtensions, codeLanguages: codeLanguage, completeHTMLTags: false, pasteURLAsLink: false }),
        codeHighlighting,
        livePreview({ resolveImage: ref => resolveImage(ref), onLink: href => onLink(href) }),
      ]),
      findExtension(() => composition, readonly || busy || saving || previewOnly),
      readOnlyConfig.of([EditorState.readOnly.of(readonly || busy), EditorView.editable.of(!readonly && !busy)]),
      EditorView.contentAttributes.of(editor => ({ 'aria-label': 'Markdown本文', 'aria-readonly': String(editor.state.readOnly), tabindex: '0', spellcheck: 'false', class: composition ? 'nagori-composing' : '' })),
      Prec.highest(keymap.of([
        { key: 'Mod-s', run: () => { if (!composition && !view?.composing) onSave(); return true; } },
        { key: 'Mod-b', run: () => { if (plain) return false; apply('bold'); return true; } },
        { key: 'Mod-i', run: () => { if (plain) return false; apply('italic'); return true; } },
        { key: 'Mod-k', run: () => { if (plain) return false; apply('link'); return true; } },
        { key: 'Mod-f', run: editor => !composition && !editor.composing && openSearchPanel(editor) },
        { key: 'Escape', run: editor => { if (closeSearchPanel(editor)) { editor.focus(); return true; } return false; } },
      ])), keymap.of([...historyKeymap, ...defaultKeymap]),
      EditorView.domEventHandlers({ paste: pasteImage, compositionstart: () => { setComposition(true); return false; }, compositionend: () => { setComposition(false); return false; }, blur: () => { queueMicrotask(updateToolbar); return false; }, scroll: () => { queueMicrotask(updateToolbar); updateOutlinePosition(); return false; } }),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) menuRevision++;
        if (update.docChanged) {
          headings = headings.map(heading => ({ ...heading, from: update.changes.mapPos(heading.from, 1), lineEnd: update.changes.mapPos(heading.lineEnd, 1) }));
          scheduleOutline();
          revision++;
          if (parsed) parsed.pending = parsed.pending ? parsed.pending.compose(update.changes) : update.changes;
          if (linkDialog) { linkDialog = false; pendingLink = undefined; }
        }
        if (update.geometryChanged || update.viewportChanged) updateOutlinePosition();
        if (update.docChanged && !update.transactions.some(tr => tr.annotation(Transaction.addToHistory) === false)) onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet || update.focusChanged) queueMicrotask(() => {
          if (view && !composition && !view.composing && (update.docChanged || update.selectionSet)) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) });
          updateToolbar();
        });
      }),
    ] });
  }
  onMount(() => {
    view = new EditorView({ state: createState(initialText), parent: host });
    const editor = view;
    const scrollbar = activityScrollbar(editor.scrollDOM);
    // WidgetがCodeMirrorのイベントを無視していても、本文のメニューを開く
    const contextmenu = (event: MouseEvent) => { showContextMenu(event, editor); };
    const contextKeys = (event: KeyboardEvent) => { if (event.key === 'F10' && event.shiftKey) showContextMenu(event, editor); };
    editor.scrollDOM.addEventListener('contextmenu', contextmenu, true);
    editor.scrollDOM.addEventListener('keydown', contextKeys, true);
    view.dispatch({ effects: previewOnlyMode.of(previewOnly) });
    scheduleOutline();
    // CodeMirrorが測定する本文のpaddingに付け、スクロール高と余白を一致させる。
    const resize = new ResizeObserver(() => {
      if (view !== editor) return;
      editor.dom.style.setProperty('--editor-bottom-space', `${editor.scrollDOM.clientHeight / 2}px`);
      editor.requestMeasure(); updateOutlinePosition();
    });
    resize.observe(editor.scrollDOM);
    onReady({
      replaceText: text => {
        if (!view || composition || view.composing) return;
        linkDialog = false; pendingLink = undefined; linkError = ''; revision++; menuRevision++; parsed = null;
        const old = view, selection = old.state.selection.main, scroll = old.scrollDOM.scrollTop;
        old.setState(createState(text));
        old.dispatch({ selection: { anchor: Math.min(selection.anchor, text.length), head: Math.min(selection.head, text.length) }, effects: previewOnlyMode.of(previewOnly) });
        old.scrollDOM.scrollTop = scroll; toolbar = null;
        headings = []; outlinePosition = -1; onOutlinePosition?.(-1); scheduleOutline();
      },
      insertText: text => {
        if (!view || readonly || previewOnly || composition || view.composing) return;
        view.dispatch(view.state.replaceSelection(text), { userEvent: 'input' }); view.focus();
      },
      focus: () => view?.focus(), isComposing: () => composition || !!view?.composing,
      block: applyBlock, contextState,
      format: apply, find: () => { if (view && !composition && !view.composing) openSearchPanel(view); },
      refreshImages: () => view?.dispatch({ effects: refreshImagesEffect.of(undefined) }),
      goToHeading,
    });
    return () => { editor.scrollDOM.removeEventListener('contextmenu', contextmenu, true); editor.scrollDOM.removeEventListener('keydown', contextKeys, true); clearTimeout(outlineTimer); resize.disconnect(); scrollbar.destroy(); view?.destroy(); view = undefined; };
  });
  $effect(() => {
    const enabled = previewOnly;
    if (enabled) { toolbar = null; linkDialog = false; pendingLink = undefined; }
    if (view) {
      const editor = view, dom = editor.scrollDOM, before = { scrollTop: dom.scrollTop, clientHeight: dom.clientHeight, scrollHeight: dom.scrollHeight };
      const restore = () => { if (view === editor) dom.scrollTop = restoredScrollTop(before, dom); };
      editor.dispatch({ effects: previewOnlyMode.of(enabled) });
      restore();
      editor.requestMeasure({ read: () => 0, write: restore });
    }
  });
  $effect(() => { const blocked = readonly || busy || saving || previewOnly; if (view) view.dispatch({ effects: findReplaceBlocked.of(blocked) }); });
  $effect(() => { const extension = focusMode(focus, typewriter, plain); if (view) view.dispatch({ effects: focusConfig.reconfigure(extension) }); });
  $effect(() => { const disabled = readonly || busy; if (view) view.dispatch({ effects: readOnlyConfig.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); if (disabled) toolbar = null; });
</script>

<div class="editor-root" class:preview-only={previewOnly} class:plain onfocusout={() => queueMicrotask(updateToolbar)} bind:this={root} style={`--editor-font-size:${fontSize}px`} data-document={documentKey}>
  <div class="editor-host" bind:this={host}></div>
  {#if toolbar}
    <div class="floating-toolbar" role="toolbar" tabindex="-1" aria-label="選択テキストの装飾" style={`top:${toolbar.top}px;left:${toolbar.left}px`} onmousedown={event => event.preventDefault()}>
      {#each kinds as kind}
        <button type="button" disabled={!!toolbar.plans[kind].reason} title={toolbar.plans[kind].reason ?? labels[kind]} aria-label={labels[kind]} onclick={() => apply(kind)} class:strong={kind === 'bold'} class:italic={kind === 'italic'} class:strike={kind === 'strike'}>{#if kind === 'link' || kind === 'code'}<Icon name={kind} size={17}/>{:else}{kind === 'bold' ? 'B' : kind === 'italic' ? 'I' : 'S'}{/if}</button>
      {/each}
    </div>
  {/if}
  {#if linkDialog}
    <div class="link-overlay" onkeydown={linkKeys} role="dialog" aria-modal="true" aria-label="リンクを編集" tabindex="-1">
      <form class="link-form" onsubmit={finishLink}>
        <label>表示テキスト<input bind:value={linkText} aria-label="リンクの表示テキスト" /></label>
        <label>URL / 相対パス<input bind:value={linkUrl} aria-label="リンクの参照先" use:focusInput /></label>
        {#if linkError}<p role="alert">{linkError}</p>{/if}
        <div><button type="button" onclick={dismissLink}>キャンセル</button><button type="submit">適用</button></div>
      </form>
    </div>
  {/if}
</div>

<style>
  .editor-root { position: relative; height: 100%; min-height: 0; color: var(--text); }
  .editor-host { height: 100%; }
  .editor-host :global(.cm-editor) { height: 100%; background: transparent; font-size: var(--editor-font-size); }
  .editor-host :global(.cm-scroller) { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif; line-height: 1.9; overflow: auto; overflow-y: scroll; scrollbar-gutter: stable; }
  /* WebKitで短い本文の予約幅が標準の幅へ戻らないよう、透明なスクロールバーの8pxを常に確保する。 */
  .editor-host :global(.cm-content) { max-width: 900px; min-height: 100%; margin: 0 auto; padding: 32px 64px var(--editor-bottom-space, 50vh); color: var(--text); caret-color: transparent; }
  .editor-host :global(.cm-cursor) { border-left-color: var(--accent); }
  /* 変換中は標準のキャレットを使い、変換範囲の表示を妨げない。 */
  .editor-host :global(.cm-content.nagori-composing) { caret-color: var(--accent); }
  .editor-host :global(.cm-line) { padding: 0; }
  /* テキストファイルは等幅で、行間を詰めて表示する */
  .plain .editor-host :global(.cm-scroller) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }
  .plain .editor-host :global(.cm-editor) { font-size: .8em; }
  .plain .editor-host :global(.cm-content) { max-width: 1100px; tab-size: 4; }
  .editor-host :global(.cm-focused) { outline: none; }
  .editor-host :global(.cm-activeLine) { background: transparent; }
  /* 標準の選択表示を使い、複数行を選んだ時も本文の左右の余白を塗らない。 */
  .editor-host :global(.cm-content::selection), .editor-host :global(.cm-content ::selection) { background: var(--selection); }
  .preview-only .editor-host :global(.cm-content) { caret-color: transparent; }
  .editor-host :global(.nagori-bold) { font-weight: 700; color: var(--heading); }
  .editor-host :global(.nagori-italic) { font-style: italic; }
  .editor-host :global(.nagori-strike) { text-decoration: line-through; color: var(--muted); }
  .editor-host :global(.nagori-code), .editor-host :global(.nagori-code-line) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code-bg); border-radius: 5px; }
  .editor-host :global(.nagori-code) { padding: 2px 4px; font-size: .9em; }
  .editor-host :global(.nagori-code-line) { padding: 0 12px; }
  .editor-host :global(.nagori-link) { color: var(--link); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px; }
  .editor-host :global(.nagori-heading) { font-weight: 750; line-height: 1.4; color: var(--heading); padding: .7em 0 .15em; letter-spacing: -.02em; }
  .editor-host :global(.nagori-h1) { font-size: 2.1em; line-height: 1.25; letter-spacing: -.035em; padding: .2em 0 .1em; }
  .editor-host :global(.nagori-h2) { font-size: 1.48em; }
  .editor-host :global(.nagori-h3) { font-size: 1.25em; }
  .editor-host :global(.nagori-h4), .editor-host :global(.nagori-h5), .editor-host :global(.nagori-h6) { font-size: 1.1em; }
  .editor-host :global(.nagori-quote) { border-left: 4px solid var(--border); border-radius: 2px; padding-left: 15px; color: var(--muted); }
  .editor-host :global(.nagori-list-marker) { display: inline; }
  .editor-host :global(input[type='checkbox']) { accent-color: var(--accent-bright); vertical-align: middle; margin-right: 7px; width: 16px; height: 16px; cursor: pointer; }
  .editor-host :global(input[type='checkbox']:focus-visible) { outline: 2px solid var(--accent); outline-offset: 3px; }
  .editor-host :global(.nagori-rule) { border: none; border-top: 1px solid var(--border); margin: 20px 0; cursor: text; }
  .editor-host :global(.nagori-table-wrap) { overflow-x: auto; padding: 10px 0; cursor: text; }
  .editor-host :global(.nagori-table-wrap table) { border-collapse: collapse; width: 100%; font-size: .94em; }
  .editor-host :global(.nagori-table-wrap td), .editor-host :global(.nagori-table-wrap th) { border: 1px solid var(--border); padding: 9px 12px; }
  .editor-host :global(.nagori-table-wrap th) { background: var(--code-bg); color: var(--heading); text-align: left; }
  .editor-host :global(.nagori-image) { display: inline-block; max-width: 100%; color: var(--muted); font-size: .9em; cursor: text; }
  .editor-host :global(.nagori-image img) { max-width: 100%; max-height: 480px; display: block; border-radius: 12px; }
  .editor-host :global(.nagori-find) { display: grid; gap: 6px; padding: 9px 18px; background: var(--bar); border-bottom: 1px solid var(--border); font-size: 13px; }
  .editor-host :global(.nagori-find-row) { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .editor-host :global(.nagori-find-row[hidden]) { display: none; }
  .editor-host :global(.nagori-find-count) { white-space: nowrap; font-size: 12px; }
  .editor-host :global(.nagori-find input) { flex: 1; min-width: 120px; font: inherit; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; color: inherit; background: var(--surface); }
  .editor-host :global(.nagori-find button), button { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; cursor: pointer; }
  .editor-host :global(.nagori-find button[aria-pressed='true']) { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
  .editor-host :global(.nagori-find input[aria-invalid='true']) { border-color: var(--danger); }
  .editor-host :global(.nagori-find button:disabled) { opacity: .35; cursor: default; }
  .editor-host :global(.nagori-find button:focus-visible), .editor-host :global(.nagori-find input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .editor-host :global(.cm-panels) { background: var(--bar); color: var(--text); border-color: var(--border); }
  .editor-host :global(.cm-tooltip) { background: var(--panel); border-color: var(--border); color: var(--text); }
  .editor-host :global(.cm-searchMatch) { background: var(--accent-soft); }
  .editor-host :global(.cm-searchMatch-selected) { background: var(--selection); }
  .floating-toolbar { position: absolute; z-index: 10; display: flex; align-items: center; gap: 2px; padding: 5px 7px; border-radius: 13px; background: var(--panel); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .floating-toolbar button { min-width: 33px; height: 32px; padding: 5px 8px; display: grid; place-items: center; border: none; border-radius: 7px; font-size: 16px; color: var(--text); }
  .floating-toolbar button:hover { color: var(--accent); background: var(--accent-soft); }
  button:disabled { opacity: .35; cursor: default; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .strong { font-weight: 750; } .italic { font-style: italic; font-family: Georgia, serif; } .strike { text-decoration: line-through; }
  .link-overlay { position: absolute; inset: 0; display: grid; place-items: center; z-index: 20; background: #14233e24; }
  .link-form { display: grid; gap: 14px; width: min(380px, 90%); padding: 24px; border-radius: 14px; background: var(--panel); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .link-form label { display: grid; gap: 6px; font-size: 13px; }
  .link-form input { font: inherit; color: inherit; background: var(--surface); padding: 9px; border: 1px solid var(--border); border-radius: 8px; }
  .link-form > div { display: flex; justify-content: flex-end; gap: 8px; } .link-form p { color: var(--danger); font-size: 13px; }
  @media (max-width: 760px) { .editor-host :global(.cm-content) { padding: 25px 28px 80px; } }
</style>
