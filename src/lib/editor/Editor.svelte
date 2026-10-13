<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { blogThemeCss, type BlogTheme } from './blogTheme.ts';
  import { createToolbar } from './toolbar.svelte.ts';
  import { editorKeymap } from './keymap.ts';
  import Icon from '../components/Icon.svelte';
  import { Compartment, EditorState, Transaction, EditorSelection } from '@codemirror/state';
  import { EditorView, highlightActiveLine, layer, RectangleMarker } from '@codemirror/view';
  import { history, isolateHistory } from '@codemirror/commands';
  import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
  import { syntaxTree, syntaxTreeAvailable, forceParsing } from '@codemirror/language';
  import { extractHeadings, currentHeading, type OutlineHeading } from '../workspace/outline.ts';
  import { openSearchPanel } from '@codemirror/search';
  import { findExtension, findReplaceBlocked } from './findPanel.ts';
  import { restoredScrollTop } from './scrollRestore.ts';
  import { focusMode } from './focusMode.ts';
  import { activityScrollbar } from './activityScrollbar.ts';
  import { smoothWheel } from './smoothWheel.ts';
  import { livePreview } from './livePreview.ts';
import { previewOnlyMode, compositionMode, refreshImagesEffect } from './previewState.ts';
  import { inputEndsComposition, keyEndsComposition, createBlurFailsafe } from './composition.ts';
  import { selectionTextLayer } from './selectionLayer.ts';
  import { markdownExtensions } from './markdown.ts';
  import type { EditorApi, EditorContextState, EditorContextMenu } from './editor.ts';
  import { blockAvailability, blockEdit, type BlockKind } from './blockEdit.ts';
  import { imageDrop } from '../workspace/imageDrop.ts';
  import { codeLanguage, codeHighlighting } from './codeLanguages.ts';
  import { pasteMarkdown } from './linkPaste.ts';
  import { typingFormat, typingCleanup } from './typingFormat.ts';
  import { matchSpan } from '../workspace/workspaceSearch.ts';

  let { initialText, documentKey, hidden = false, readonly = false, busy = false, saving = false, plain = false, properties = true, blogMode = false, blogArticleHeader = true, blogLinkCardsEnabled = true, blogCharactersEnabled = true, blogBodyTheme = true, blogIndentOnEnter = true, blogTheme = null, blogCategories = null, blogCharacters = null, blogLinkCards = null, fetchLinkCard, previewOnly = false, focus = false, typewriter = false, fontSize = 19, editorStyle = '', headingRule = true, onChange, onComposition, onSave, onLink, onPasteImage, onDropImages, onImageError, onContextMenu, resolveImage, onReady, onOutline, onOutlinePosition }: {
    onContextMenu?: (context: EditorContextMenu) => void;
    initialText: string; documentKey: string | number; hidden?: boolean; readonly?: boolean; busy?: boolean; saving?: boolean; plain?: boolean; properties?: boolean; blogMode?: boolean; blogArticleHeader?: boolean; blogLinkCardsEnabled?: boolean; blogCharactersEnabled?: boolean; blogBodyTheme?: boolean; blogIndentOnEnter?: boolean; blogTheme?: BlogTheme | null; blogCharacters?: import('./blogCharacters.ts').BlogCharacters | null; blogLinkCards?: import('./blogLinkCards.ts').LinkPreviews | null; fetchLinkCard?: import('./previewState.ts').Options['fetchLinkCard']; blogCategories?: import('./blogCategories.ts').BlogCategory[] | null; previewOnly?: boolean; focus?: boolean; typewriter?: boolean; fontSize?: number; editorStyle?: string; headingRule?: boolean;
    onChange: (text: string) => void; onComposition: (active: boolean) => void; onSave: () => void;
    onLink: (href: string) => void; onPasteImage?: (image: File) => void; resolveImage: (reference: string) => Promise<string>; onReady: (api: EditorApi) => void;
    onOutline?: (headings: OutlineHeading[]) => void; onOutlinePosition?: (index: number) => void;
    onDropImages?: (images: File[]) => Promise<string | null>; onImageError?: (reason: string) => void;
  } = $props();
  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let view: EditorView | undefined;
  const formatting = createToolbar({
    get plain() { return plain; },
    get readonly() { return readonly; },
    get busy() { return busy; },
    get previewOnly() { return previewOnly; },
    get composition() { return composition; },
    get view() { return view; },
    get root() { return root; },
  });
  let menuRevision = 0;
  let composition = false;
  // blur のあとに compositionend が届かなかった時の安全策（setComposition(false) を呼ぶ）
  const blurFailsafe = createBlurFailsafe(() => { if (composition) setComposition(false); });
  let pendingFindBlocked: boolean | undefined;
  const readOnlyConfig = new Compartment();
  const focusConfig = new Compartment();
  const previewConfig = new Compartment();
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

  function setComposition(active: boolean) {
    composition = active; formatting.toolbar = null;
    // 変換中は選択の矩形を隠す(composition は非リアクティブのため、クラスはDOMで切り替える)
    root?.classList.toggle('composing', active);
    if (active) onComposition(true);
    const editor = view;
    if (active) return;
    // CodeMirrorが最後のDOM変更を取り込んでから、装飾と保存を再開する。
    queueMicrotask(() => {
      if (!editor || view !== editor || composition !== active) return;
      const effects = [compositionMode.of(active)];
      if (!active && pendingFindBlocked !== undefined) { effects.push(findReplaceBlocked.of(pendingFindBlocked)); pendingFindBlocked = undefined; }
      editor.dispatch({ effects });
      if (!active) { onComposition(false); formatting.updateToolbar(); }
    });
  }
  function contextState(position = view?.state.selection.main.head ?? 0): EditorContextState {
    const editable = !!view && !readonly && !busy && !previewOnly && !composition && !view.composing && !formatting.linkDialog;
    const availability = view && !plain && editable ? blockAvailability(view.state.doc.toString(), position) : { block: false, heading: false };
    return { plain, editable, ...availability, revision: menuRevision };
  }
  function applyBlock(kind: BlockKind, expectedRevision: number, position: number) {
    // 本文の変更で位置が範囲外になった時は、挿入せずに止める
    if (!view || plain || position < 0 || position > view.state.doc.length || !contextState(position).editable || expectedRevision !== menuRevision) return;
    const plan = blockEdit(view.state.doc.toString(), position, kind);
    if (!plan) return;
    view.dispatch({ changes: plan.changes, selection: EditorSelection.range(plan.selection.from, plan.selection.to), userEvent: 'input.format', annotations: isolateHistory.of('full') });
    view.focus(); formatting.updateToolbar();
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
    const at = position ?? range.head;
    onContextMenu?.({ ...contextState(at), position: at, x: event instanceof MouseEvent ? event.clientX : coords?.left ?? bounds.left, y: event instanceof MouseEvent ? event.clientY : coords?.bottom ?? bounds.top });
    return true;
  }
  function createState(text: string) {
    let compositionDeletion: { from: number; to: number } | undefined;
    return EditorState.create({ doc: text, extensions: [
      history(), highlightActiveLine(), EditorView.lineWrapping,
      smoothWheel,
      imageDrop({ state: () => ({ plain, readonly, busy, saving, previewOnly, composing: composition, saved: !!onDropImages }), importImages: images => onDropImages?.(images) ?? Promise.resolve(null), notify: reason => onImageError?.(reason) }),
      focusConfig.of(focusMode(focus, typewriter, plain)),
      // 選択の塗りは文字の高さに収めて本文の下へ描く(selectionLayer.ts)。
      selectionTextLayer(),
      // 折り返しの上下はカーソルのassocで決める。
      layer({
        above: true, class: 'cm-cursorLayer',
        markers: editor => {
          const range = editor.state.selection.main;
          if (!editor.hasFocus || (!range.empty && !composition && !editor.composing) || editor.state.readOnly || !editor.state.facet(EditorView.editable)) return [];
          return RectangleMarker.forRange(editor, 'cm-cursor cm-cursor-primary', composition || editor.composing ? EditorSelection.cursor(range.head, range.assoc) : range);
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
        previewConfig.of(livePreview({ resolveImage: ref => resolveImage(ref), onLink: href => onLink(href), properties, blogMode, blogArticleHeader, blogLinkCardsEnabled, blogCharactersEnabled, blogCategories, blogCharacters, blogLinkCards, fetchLinkCard, onPropertyComposition: setComposition })),
        typingFormat(() => composition),
      ]),
      // 変換開始だけのdispatchで未確定文字のDOMを作り直さない。
      EditorState.transactionExtender.of(() => composition ? { effects: compositionMode.of(true) } : null),
      EditorView.domEventObservers({ beforeinput(event, editor) {
        // compositionend が届かないまま変換が終わった時の安全策。変換を使わない入力が来たら、変換は終わっている
        if (composition && inputEndsComposition(event.inputType, event.isComposing)) setComposition(false);
        compositionDeletion = undefined;
        const range = event.inputType === 'deleteCompositionText' ? event.getTargetRanges()[0] : undefined;
        if (range && editor.contentDOM.contains(range.startContainer) && editor.contentDOM.contains(range.endContainer)) {
          compositionDeletion = { from: editor.posAtDOM(range.startContainer, range.startOffset), to: editor.posAtDOM(range.endContainer, range.endOffset) };
        }
      } }),
      EditorView.inputHandler.of((editor, from, to, text, insert) => {
        const range = compositionDeletion; compositionDeletion = undefined;
        // 同じ語が続く太字では、文節の選択だけを削除と誤認するため、WebKitの削除範囲を使う。
        if (!range || text || range.from >= range.to || range.to > editor.state.doc.length || (range.from === from && range.to === to)) return false;
        const tr = insert();
        editor.dispatch({ changes: range, selection: tr.selection, userEvent: tr.annotation(Transaction.userEvent), scrollIntoView: tr.scrollIntoView });
        return true;
      }),
      findExtension(() => composition, readonly || busy || saving || previewOnly),
      readOnlyConfig.of([EditorState.readOnly.of(readonly || busy), EditorView.editable.of(!readonly && !busy)]),
      EditorView.contentAttributes.of(editor => ({ 'aria-label': 'Markdown本文', 'aria-readonly': String(editor.state.readOnly), tabindex: '0', spellcheck: 'false' })),
      editorKeymap({
        get plain() { return plain; }, get indentParagraphs() { return blogMode && blogIndentOnEnter; }, get previewOnly() { return previewOnly; }, get composition() { return composition; },
        get linkDialog() { return formatting.linkDialog; }, get view() { return view; }, onSave: () => onSave(), apply: formatting.apply,
      }),
      EditorView.domEventHandlers({ paste: (event, editor) => pasteMarkdown(event, editor, !plain, onPasteImage, composition || previewOnly || formatting.linkDialog), compositionstart: () => { blurFailsafe.cancel(); setComposition(true); return false; }, compositionend: () => { blurFailsafe.cancel(); setComposition(false); return false; }, keydown: event => { if (composition && keyEndsComposition(event)) setComposition(false); return false; }, blur: () => { blurFailsafe.blur(composition); queueMicrotask(formatting.updateToolbar); return false; }, scroll: () => { queueMicrotask(formatting.updateToolbar); updateOutlinePosition(); return false; } }),
      EditorView.updateListener.of(update => {
        // 選択の変更では進めない。macOSのメニューの開閉でWebKitが選択を戻すと、挿入が取り消されるため。
        if (update.docChanged) menuRevision++;
        if (update.docChanged) {
          headings = headings.map(heading => ({ ...heading, from: update.changes.mapPos(heading.from, 1), lineEnd: update.changes.mapPos(heading.lineEnd, 1) }));
          scheduleOutline();
          formatting.changed(update.changes);
        }
        if (update.geometryChanged || update.viewportChanged) updateOutlinePosition();
        if (update.docChanged && update.transactions.some(tr => tr.annotation(Transaction.addToHistory) !== false || tr.annotation(typingCleanup))) onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet || update.focusChanged) queueMicrotask(() => {
          if (view && !composition && !view.composing && (update.docChanged || update.selectionSet)) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) });
          formatting.updateToolbar();
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
        formatting.reset(); menuRevision++;
        const old = view, selection = old.state.selection.main, scroll = old.scrollDOM.scrollTop;
        old.setState(createState(text));
        old.dispatch({ selection: { anchor: Math.min(selection.anchor, text.length), head: Math.min(selection.head, text.length) }, effects: previewOnlyMode.of(previewOnly) });
        old.scrollDOM.scrollTop = scroll; formatting.toolbar = null;
        headings = []; outlinePosition = -1; onOutlinePosition?.(-1); scheduleOutline();
      },
      insertText: text => {
        if (!view || readonly || previewOnly || composition || view.composing) return;
        view.dispatch(view.state.replaceSelection(text), { userEvent: 'input' }); view.focus();
      },
      focus: () => view?.focus(), isComposing: () => composition || !!view?.composing,
      endComposition: () => { if (composition) setComposition(false); },
      block: applyBlock, contextState,
      format: formatting.apply, listify: formatting.applyList, find: () => { if (view && !composition && !view.composing) openSearchPanel(view); },
      refreshImages: () => view?.dispatch({ effects: refreshImagesEffect.of(undefined) }),
      goToHeading,
      revealRange: (line, column, length) => {
        const span = view && !composition && !view.composing ? matchSpan(view.state.doc, line, column, length) : null;
        if (!view || !span) return;
        view.dispatch({ selection: { anchor: span.from, head: span.to }, effects: EditorView.scrollIntoView(span.from, { y: 'center' }) });
        view.focus();
      },
    });
    return () => { editor.scrollDOM.removeEventListener('contextmenu', contextmenu, true); editor.scrollDOM.removeEventListener('keydown', contextKeys, true); clearTimeout(outlineTimer); resize.disconnect(); scrollbar.destroy(); view?.destroy(); view = undefined; };
  });
  $effect(() => {
    const enabled = previewOnly;
    if (enabled) { formatting.toolbar = null; formatting.clearLink(); }
    if (view) {
      const editor = view, dom = editor.scrollDOM, before = { scrollTop: dom.scrollTop, clientHeight: dom.clientHeight, scrollHeight: dom.scrollHeight };
      const restore = () => { if (view === editor) dom.scrollTop = restoredScrollTop(before, dom); };
      editor.dispatch({ effects: previewOnlyMode.of(enabled) });
      restore();
      editor.requestMeasure({ read: () => 0, write: restore });
    }
  });
  // 本文の幅や行間が変わったら、折り返しを測り直す。サイドバーや目次の開閉で幅が変わった時も同じ
  $effect(() => {
    void editorStyle;
    void blogTheme;
    void blogBodyTheme;
    view?.requestMeasure();
  });
  $effect(() => {
    const blocked = readonly || busy || saving || previewOnly;
    if (!view) return;
    // 保存の完了が変換と重なっても、未確定文字と文節の選択を触らない。
    if (composition || view.compositionStarted) pendingFindBlocked = blocked;
    else view.dispatch({ effects: findReplaceBlocked.of(blocked) });
  });
  $effect(() => {
    const css = blogThemeCss(blogMode && !plain ? blogTheme : null, blogBodyTheme);
    if (!css) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    view?.requestMeasure();
    return () => style.remove();
  });
  // プロパティ表示、ブログの表示設定、カテゴリの候補が変わった時だけ、表示の拡張を入れ替える。
  // 入れ替えると画像を含む装飾をすべて作り直すので、ほかの変化では動かさない
  let previewKey = untrack(() => `${properties}:${blogMode}:${blogArticleHeader}:${blogLinkCardsEnabled}:${blogCharactersEnabled}:${JSON.stringify(blogCategories)}:${JSON.stringify(blogCharacters)}:${JSON.stringify(blogLinkCards)}`);
  $effect(() => {
    const key = `${properties}:${blogMode}:${blogArticleHeader}:${blogLinkCardsEnabled}:${blogCharactersEnabled}:${JSON.stringify(blogCategories)}:${JSON.stringify(blogCharacters)}:${JSON.stringify(blogLinkCards)}`;
    if (key === previewKey) return;
    previewKey = key;
    untrack(() => {
      if (view && !plain) view.dispatch({ effects: previewConfig.reconfigure(livePreview({ resolveImage: ref => resolveImage(ref), onLink: href => onLink(href), properties, blogMode, blogArticleHeader, blogLinkCardsEnabled, blogCharactersEnabled, blogCategories, blogCharacters, blogLinkCards, fetchLinkCard, onPropertyComposition: setComposition })) });
    });
  });
  $effect(() => { const extension = focusMode(focus, typewriter, plain); if (view) view.dispatch({ effects: focusConfig.reconfigure(extension) }); });
  $effect(() => { const disabled = readonly || busy; if (view) view.dispatch({ effects: readOnlyConfig.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); if (disabled) formatting.toolbar = null; });
</script>

<div {hidden} class="editor-root" class:preview-only={previewOnly} class:plain class:no-heading-rule={!headingRule} onfocusout={() => queueMicrotask(formatting.updateToolbar)} bind:this={root} style={`--editor-font-size:${fontSize}px;${editorStyle}`} data-document={documentKey}>
  <div class="editor-host" data-blog-theme={blogMode && blogBodyTheme && !plain && blogTheme ? '' : undefined} bind:this={host}></div>
  {#if formatting.toolbar}
    <div class="floating-toolbar" role="toolbar" tabindex="-1" aria-label="選択テキストの装飾" style={`top:${formatting.toolbar.top}px;left:${formatting.toolbar.left}px`} onmousedown={event => event.preventDefault()}>
      {#each formatting.kinds as kind}
        <button type="button" disabled={!!formatting.toolbar.plans[kind].reason} title={formatting.toolbar.plans[kind].reason ?? formatting.labels[kind]} aria-label={formatting.labels[kind]} onclick={() => formatting.apply(kind)} class:strong={kind === 'bold'} class:italic={kind === 'italic'} class:strike={kind === 'strike'}>{#if kind === 'link' || kind === 'code'}<Icon name={kind} size={17}/>{:else}{kind === 'bold' ? 'B' : kind === 'italic' ? 'I' : 'S'}{/if}</button>
      {/each}
      <span class="floating-toolbar-divider" aria-hidden="true"></span>
      {#each formatting.listKinds as kind}
        <button type="button" disabled={!formatting.toolbar.lists[kind]} title={formatting.listLabels[kind]} aria-label={formatting.listLabels[kind]} onclick={() => formatting.applyList(kind)}><Icon name={kind} size={17}/></button>
      {/each}
    </div>
  {/if}
  {#if formatting.linkDialog}
    <div class="link-overlay" onkeydown={formatting.linkKeys} role="dialog" aria-modal="true" aria-label="リンクを編集" tabindex="-1">
      <form class="link-form" onsubmit={formatting.finishLink}>
        <label>表示テキスト<input bind:value={formatting.linkText} aria-label="リンクの表示テキスト" /></label>
        <label>URL / 相対パス<input bind:value={formatting.linkUrl} aria-label="リンクの参照先" use:formatting.focusInput /></label>
        {#if formatting.linkError}<p role="alert">{formatting.linkError}</p>{/if}
        <div><button type="button" onclick={formatting.dismissLink}>キャンセル</button><button type="submit">適用</button></div>
      </form>
    </div>
  {/if}
</div>

<style>
  @import './editor.css';
</style>
