<script lang="ts">
  import { onMount } from 'svelte';
  import { Compartment, EditorState, Prec, Transaction, EditorSelection } from '@codemirror/state';
  import { EditorView, keymap, drawSelection, highlightActiveLine, type Panel } from '@codemirror/view';
  import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
  import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
  import { syntaxTree } from '@codemirror/language';
  import { search, SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, openSearchPanel, closeSearchPanel } from '@codemirror/search';
  import { livePreview, previewMode, compositionMode, refreshImagesEffect } from './livePreview.ts';
  import { formatPlan, linkMarkdown, markdownExtensions, markdownParser, type FormatPlan } from './markdown.ts';
  import type { EditorApi, FormatKind } from './editor.ts';

  let { initialText, documentKey, readonly = false, sourceMode = false, fontSize = 16, onChange, onComposition, onSave, onLink, resolveImage, onReady }: {
    initialText: string; documentKey: string | number; readonly?: boolean; sourceMode?: boolean; fontSize?: number;
    onChange: (text: string) => void; onComposition: (active: boolean) => void; onSave: () => void;
    onLink: (href: string) => void; resolveImage: (reference: string) => Promise<string>; onReady: (api: EditorApi) => void;
  } = $props();
  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let view: EditorView | undefined;
  let toolbar = $state<{ top: number; left: number; plans: Record<FormatKind, FormatPlan> } | null>(null);
  let linkDialog = $state(false), linkText = $state(''), linkUrl = $state(''), linkError = $state('');
  let pendingLink: FormatPlan | undefined;
  let composition = false, revision = 0, pendingRevision = -1;
  const readOnlyConfig = new Compartment();
  const kinds: FormatKind[] = ['bold', 'italic', 'strike', 'link', 'code'];
  const labels = { bold: '太字', italic: '斜体', strike: '取り消し線', link: 'リンク', code: 'Inline Code' };

  function plans() {
    if (!view) return null;
    const range = view.state.selection.main, text = view.state.doc.toString();
    const parsed = syntaxTree(view.state), tree = parsed.length === text.length ? parsed : markdownParser.parse(text);
    return Object.fromEntries(kinds.map(kind => [kind, formatPlan(text, range, kind, tree)])) as Record<FormatKind, FormatPlan>;
  }
  function updateToolbar() {
    const toolbarFocused = !!root?.querySelector('.floating-toolbar')?.contains(document.activeElement);
    if (!view || readonly || composition || view.composing || linkDialog || view.state.selection.main.empty || (!view.hasFocus && !toolbarFocused)) { toolbar = null; return; }
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (!coords) { toolbar = null; return; }
    const bounds = root.getBoundingClientRect();
    toolbar = { top: Math.max(4, coords.top - bounds.top - 44), left: Math.max(8, Math.min(coords.left - bounds.left, bounds.width - 245)), plans: plans()! };
  }
  function apply(kind: FormatKind) {
    if (!view || readonly || composition || view.composing || linkDialog) return;
    const plan = plans()?.[kind];
    if (!plan || plan.reason) return;
    if (kind === 'link') { pendingLink = plan; pendingRevision = revision; linkText = plan.linkText ?? ''; linkUrl = plan.existingLink ?? ''; linkError = ''; linkDialog = true; toolbar = null; return; }
    view.dispatch({ changes: { from: plan.from, to: plan.to, insert: plan.text }, selection: EditorSelection.range(plan.selection.from, plan.selection.to), userEvent: 'input.format' });
    view.focus(); updateToolbar();
  }
  function finishLink(event: SubmitEvent) {
    event.preventDefault();
    if (!view || !pendingLink || readonly || composition) return;
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
    composition = active; toolbar = null; onComposition(active);
    // Run outside CodeMirror's DOM composition handler, so the view has settled its own composition state.
    queueMicrotask(() => { view?.dispatch({ effects: compositionMode.of(active) }); if (!active) updateToolbar(); });
  }
  function searchPanel(editor: EditorView): Panel {
    const dom = document.createElement('div'); dom.className = 'nagori-find';
    const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'このファイルを検索'; input.setAttribute('aria-label', '検索する文字列'); input.setAttribute('main-field', 'true'); input.value = getSearchQuery(editor.state).search;
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
    const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', label); b.onclick = action; return b; };
    const update = () => {
      const query = getSearchQuery(editor.state); let total = 0, current = 0;
      if (query.valid) { const cursor = query.getCursor(editor.state.doc); for (let match = cursor.next(); !match.done; match = cursor.next()) { total++; if (match.value.from === editor.state.selection.main.from && match.value.to === editor.state.selection.main.to) current = total; } }
      count.textContent = `${current} / ${total}`;
    };
    input.oninput = () => { editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value, literal: true, regexp: false, caseSensitive: true })) }); if (input.value) findNext(editor); update(); };
    input.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); closeSearchPanel(editor); editor.focus(); } else if (event.key === 'Enter') { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(editor); } };
    dom.append(input, count, button('前へ', () => findPrevious(editor)), button('次へ', () => findNext(editor)), button('閉じる', () => { closeSearchPanel(editor); editor.focus(); }));
    return { dom, top: true, mount: () => { input.focus(); input.select(); update(); }, update };
  }
  function createState(text: string) {
    return EditorState.create({ doc: text, extensions: [
      history(), drawSelection(), highlightActiveLine(), EditorView.lineWrapping,
      markdown({ base: commonmarkLanguage, extensions: markdownExtensions, completeHTMLTags: false, pasteURLAsLink: false }),
      livePreview({ resolveImage: ref => resolveImage(ref), onLink: href => onLink(href) }),
      search({ literal: true, regexp: false, caseSensitive: true, createPanel: searchPanel }),
      readOnlyConfig.of([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]),
      EditorView.contentAttributes.of(editor => ({ 'aria-label': 'Markdown本文', 'aria-readonly': String(editor.state.readOnly), tabindex: '0', spellcheck: 'false' })),
      Prec.highest(keymap.of([
        { key: 'Mod-s', run: () => { if (!composition && !view?.composing) onSave(); return true; } },
        { key: 'Mod-b', run: () => { apply('bold'); return true; } },
        { key: 'Mod-i', run: () => { apply('italic'); return true; } },
        { key: 'Mod-k', run: () => { apply('link'); return true; } },
        { key: 'Mod-f', run: openSearchPanel },
        { key: 'Escape', run: editor => { if (closeSearchPanel(editor)) { editor.focus(); return true; } return false; } },
      ])), keymap.of([...historyKeymap, ...defaultKeymap]),
      EditorView.domEventHandlers({ compositionstart: () => { setComposition(true); return false; }, compositionend: () => { setComposition(false); return false; }, blur: () => { queueMicrotask(updateToolbar); return false; }, scroll: () => { toolbar = null; return false; } }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          revision++;
          if (linkDialog) { linkDialog = false; pendingLink = undefined; }
        }
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
    view.dispatch({ effects: previewMode.of(sourceMode) });
    onReady({
      getText: () => view!.state.doc.toString(),
      replaceText: text => {
        if (!view || composition || view.composing) return;
        linkDialog = false; pendingLink = undefined; linkError = ''; revision++;
        const old = view, selection = old.state.selection.main, scroll = old.scrollDOM.scrollTop;
        old.setState(createState(text));
        old.dispatch({ selection: { anchor: Math.min(selection.anchor, text.length), head: Math.min(selection.head, text.length) }, effects: previewMode.of(sourceMode) });
        old.scrollDOM.scrollTop = scroll; toolbar = null;
      },
      insertText: text => {
        if (!view || composition || view.composing) return;
        view.dispatch(view.state.replaceSelection(text), { userEvent: 'input' }); view.focus();
      },
      focus: () => view?.focus(), isComposing: () => composition || !!view?.composing,
      format: apply, find: () => { if (view) openSearchPanel(view); },
      refreshImages: () => view?.dispatch({ effects: refreshImagesEffect.of(undefined) }),
    });
    return () => { view?.destroy(); view = undefined; };
  });
  $effect(() => { const enabled = sourceMode; if (view) { view.dispatch({ effects: previewMode.of(enabled) }); view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) }); } });
  $effect(() => { const disabled = readonly; if (view) view.dispatch({ effects: readOnlyConfig.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); if (disabled) toolbar = null; });
</script>

<div class="editor-root" onfocusout={() => queueMicrotask(updateToolbar)} bind:this={root} style={`--editor-font-size:${fontSize}px`} data-document={documentKey}>
  <div class="editor-host" bind:this={host}></div>
  {#if toolbar}
    <div class="floating-toolbar" role="toolbar" tabindex="-1" aria-label="選択テキストの装飾" style={`top:${toolbar.top}px;left:${toolbar.left}px`} onmousedown={event => event.preventDefault()}>
      {#each kinds as kind}
        <button type="button" disabled={!!toolbar.plans[kind].reason} title={toolbar.plans[kind].reason ?? labels[kind]} aria-label={labels[kind]} onclick={() => apply(kind)} class:strong={kind === 'bold'} class:italic={kind === 'italic'} class:strike={kind === 'strike'}>{kind === 'bold' ? 'B' : kind === 'italic' ? 'I' : kind === 'strike' ? 'S' : kind === 'link' ? '↗' : '</>'}</button>
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
  .editor-root { position: relative; height: 100%; min-height: 0; color: var(--text, #242936); }
  .editor-host { height: 100%; }
  .editor-host :global(.cm-editor) { height: 100%; background: transparent; font-size: var(--editor-font-size); }
  .editor-host :global(.cm-scroller) { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif; line-height: 1.9; overflow: auto; }
  .editor-host :global(.cm-content) { padding: 36px max(30px, calc((100% - 780px) / 2)) 160px; caret-color: var(--accent, #7254d5); }
  .editor-host :global(.cm-line) { padding: 0; }
  .editor-host :global(.cm-focused) { outline: none; }
  .editor-host :global(.cm-activeLine) { background: transparent; }
  .editor-host :global(.cm-selectionBackground), .editor-host :global(.cm-focused .cm-selectionBackground) { background: var(--selection, #a58bf54a); }
  .editor-host :global(.nagori-bold) { font-weight: 700; }
  .editor-host :global(.nagori-italic) { font-style: italic; }
  .editor-host :global(.nagori-strike) { text-decoration: line-through; }
  .editor-host :global(.nagori-code), .editor-host :global(.nagori-code-line) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--surface-soft, #f1eff7); border-radius: 4px; }
  .editor-host :global(.nagori-code) { padding: 2px 4px; font-size: .9em; }
  .editor-host :global(.nagori-code-line) { padding: 0 12px; }
  .editor-host :global(.nagori-link) { color: var(--accent, #7254d5); text-decoration: underline; text-decoration-color: var(--border, #dcd6ec); }
  .editor-host :global(.nagori-heading) { font-weight: 700; line-height: 1.5; padding: .35em 0 .2em; }
  .editor-host :global(.nagori-h1) { font-size: 1.9em; }
  .editor-host :global(.nagori-h2) { font-size: 1.55em; }
  .editor-host :global(.nagori-h3) { font-size: 1.28em; }
  .editor-host :global(.nagori-h4), .editor-host :global(.nagori-h5), .editor-host :global(.nagori-h6) { font-size: 1.1em; }
  .editor-host :global(.nagori-quote) { border-left: 3px solid var(--border, #dcd6ec); padding-left: 14px; color: var(--muted, #797382); }
  .editor-host :global(.nagori-list-marker) { display: inline; }
  .editor-host :global(input[type='checkbox']) { accent-color: var(--accent, #7254d5); vertical-align: middle; margin-right: 5px; }
  .editor-host :global(.nagori-rule) { border: none; border-top: 1px solid var(--border, #dcd6ec); margin: 18px 0; cursor: text; }
  .editor-host :global(.nagori-table-wrap) { overflow-x: auto; padding: 10px 0; cursor: text; }
  .editor-host :global(.nagori-table-wrap table) { border-collapse: collapse; width: 100%; font-size: .94em; }
  .editor-host :global(.nagori-table-wrap td), .editor-host :global(.nagori-table-wrap th) { border: 1px solid var(--border, #dcd6ec); padding: 8px 12px; }
  .editor-host :global(.nagori-table-wrap th) { background: var(--surface-soft, #f1eff7); text-align: left; }
  .editor-host :global(.nagori-image) { display: inline-block; max-width: 100%; color: var(--muted, #797382); font-size: .9em; cursor: text; }
  .editor-host :global(.nagori-image img) { max-width: 100%; max-height: 480px; display: block; border-radius: 9px; }
  .editor-host :global(.nagori-find) { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--surface, #fff); border-bottom: 1px solid var(--border, #dcd6ec); font-size: 13px; }
  .editor-host :global(.nagori-find input) { flex: 1; min-width: 100px; padding: 6px 10px; border: 1px solid var(--border, #dcd6ec); border-radius: 6px; color: inherit; background: transparent; }
  .editor-host :global(.nagori-find button), button { font: inherit; color: inherit; background: var(--surface, #fff); border: 1px solid var(--border, #dcd6ec); border-radius: 6px; padding: 5px 9px; cursor: pointer; }
  .floating-toolbar { position: absolute; z-index: 10; display: flex; gap: 2px; padding: 5px; border-radius: 10px; background: var(--surface, #fff); border: 1px solid var(--border, #dcd6ec); box-shadow: 0 4px 20px #0002; }
  .floating-toolbar button { min-width: 35px; border: none; }
  button:disabled { opacity: .35; cursor: default; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent, #7254d5); outline-offset: 2px; }
  .strong { font-weight: bold; } .italic { font-style: italic; } .strike { text-decoration: line-through; }
  .link-overlay { position: absolute; inset: 0; display: grid; place-items: center; z-index: 20; background: #0002; }
  .link-form { display: grid; gap: 14px; width: min(380px, 90%); padding: 24px; border-radius: 14px; background: var(--surface, #fff); box-shadow: 0 12px 40px #0002; }
  .link-form label { display: grid; gap: 6px; font-size: 13px; }
  .link-form input { font: inherit; color: inherit; background: transparent; padding: 8px; border: 1px solid var(--border, #dcd6ec); border-radius: 6px; }
  .link-form > div { display: flex; justify-content: flex-end; gap: 8px; } .link-form p { color: #c53e51; font-size: 13px; }
</style>
