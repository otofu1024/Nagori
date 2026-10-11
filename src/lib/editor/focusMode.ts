import { type EditorState, type Extension, type Transaction, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { compositionMode } from './livePreview.ts';

type Span = { from: number; to: number };

export function focusBlock(state: EditorState, position: number): Span {
  const line = state.doc.lineAt(position);
  let block: Span = line, item = false;
  // インデント付きコードでは、先頭の空白が構文ノードの範囲外になる。
  const at = Math.max(position, line.from + /^[ \t]*/.exec(line.text)![0].length);
  for (let node = syntaxTree(state).resolveInner(at, at === line.to ? -1 : 1); node.parent; node = node.parent) {
    if (node.name === 'ListItem') {
      if (!item) block = node;
      item = true;
    } else if (node.name === 'Blockquote' && !item) block = node;
    else if (!item && /^(?:Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|Table|HTMLBlock|HorizontalRule|MathBlock|MathUnclosed|LinkReference)$/.test(node.name)) block = node;
  }
  return { from: state.doc.lineAt(block.from).from, to: state.doc.lineAt(block.to).to };
}

export function focusSpans(state: EditorState): Span[] {
  // 選択の両端だけを構文木で調べる。間にあるブロックは選択区間に含まれる。
  return state.selection.ranges.map(range => ({ from: focusBlock(state, range.from).from, to: focusBlock(state, range.to).to }));
}

export function followsTyping(transaction: Transaction): boolean {
  return !transaction.isUserEvent('select.pointer') && !transaction.isUserEvent('select.search') && !transaction.isUserEvent('input.drop') &&
    ['input', 'delete', 'select', 'undo', 'redo'].some(event => transaction.isUserEvent(event));
}

export function centeredScrollTop(scrollTop: number, cursorMiddle: number, viewportTop: number, viewportHeight: number): number {
  return Math.max(0, scrollTop + cursorMiddle - viewportTop - viewportHeight / 2);
}

export function focusMode(focus: boolean, typewriter: boolean, plain = false): Extension {
  focus &&= !plain;
  if (!focus && !typewriter) return [];
  const plugin = ViewPlugin.fromClass(class {
    spans: Span[];
    decorations = Decoration.none;
    composing = false;
    follow = false;
    scrolling = false;
    scrollKey = {};
    destroyed = false;
    view: EditorView;
    cancelFollow = () => { this.follow = this.scrolling = false; };
    constructor(view: EditorView) {
      this.view = view;
      this.spans = focus ? focusSpans(view.state) : [];
      if (typewriter) {
        view.scrollDOM.addEventListener('wheel', this.cancelFollow, { passive: true });
        view.scrollDOM.addEventListener('pointerdown', this.cancelFollow, true);
      }
      if (focus) { this.decorate(); this.refresh(); }
    }
    update(update: ViewUpdate) {
      const wasComposing = this.composing;
      for (const tr of update.transactions) for (const effect of tr.effects) if (effect.is(compositionMode)) this.composing = effect.value;
      if (this.composing || update.view.composing) { this.cancelFollow(); this.decorations = this.decorations.map(update.changes); return; }
      if (typewriter && (update.docChanged || update.selectionSet)) {
        this.follow = update.transactions.some(followsTyping);
        if (!this.follow) this.scrolling = false;
      }
      if (!focus) return;
      const next = focusSpans(update.state);
      const changed = next.length !== this.spans.length || next.some((span, i) => span.from !== this.spans[i].from || span.to !== this.spans[i].to);
      this.spans = next;
      if (changed || wasComposing || update.docChanged || update.viewportChanged || update.geometryChanged) this.decorate();
      if (update.transactions.length || update.viewportChanged || update.geometryChanged) this.refresh();
    }
    decorate() {
      const ranges: Range<Decoration>[] = [];
      const active = Decoration.line({ class: 'nagori-focus-active' });
      const seen = new Set<number>();
      for (const visible of this.view.visibleRanges) for (const span of this.spans) {
        const from = Math.max(visible.from, span.from), to = Math.min(visible.to, span.to);
        if (from > to) continue;
        for (let line = this.view.state.doc.lineAt(from); line.from <= to;) {
          if (!seen.has(line.from)) { ranges.push(active.range(line.from)); seen.add(line.from); }
          if (line.number === this.view.state.doc.lines) break;
          line = this.view.state.doc.line(line.number + 1);
        }
      }
      this.decorations = Decoration.set(ranges, true);
    }
    refresh() {
      this.view.requestMeasure({ key: this,
        read: view => [...view.contentDOM.children].filter(child => !child.classList.contains('cm-line')).map(child => {
          const from = view.posAtDOM(child, 0), to = view.posAtDOM(child, child.childNodes.length);
          return { child, active: this.spans.some(span => from <= span.to && to >= span.from) };
        }),
        // ブロックWidgetにも行と同じクラスを付け、数式・表も一緒に薄くする。
        write: blocks => { if (!this.destroyed) for (const { child, active } of blocks) child.classList.toggle('nagori-focus-active', active); },
      });
    }
    destroy() {
      this.destroyed = true;
      this.cancelFollow();
      this.view.scrollDOM.removeEventListener('wheel', this.cancelFollow);
      this.view.scrollDOM.removeEventListener('pointerdown', this.cancelFollow, true);
      for (const child of this.view.contentDOM.children) child.classList.remove('nagori-focus-active');
    }
  }, { decorations: mode => mode.decorations });
  return [plugin, ...(focus ? [
    EditorView.editorAttributes.of({ class: 'nagori-focus-mode' }),
    EditorView.theme({
      '&.nagori-focus-mode .cm-content > *': { opacity: '0.5' },
      '&.nagori-focus-mode .cm-content > .nagori-focus-active': { opacity: '1' },
    }),
  ] : []), ...(typewriter ? [EditorView.scrollHandler.of((view, range, options) => {
    const mode = view.plugin(plugin);
    if (!mode?.follow || mode.composing || view.composing || options.y !== 'nearest' || range.head !== view.state.selection.main.head) return false;
    mode.follow = false;
    mode.scrolling = true;
    // スクロール処理中はレイアウトを読めないため、次の計測で位置を求める。
    view.requestMeasure({ key: mode.scrollKey,
      read: () => {
        const cursor = view.coordsAtPos(range.head, range.assoc || 1);
        if (!cursor) return null;
        const viewport = view.scrollDOM.getBoundingClientRect();
        return centeredScrollTop(view.scrollDOM.scrollTop, (cursor.top + cursor.bottom) / 2, viewport.top, view.scrollDOM.clientHeight);
      },
      write: top => {
        if (top !== null && mode.scrolling && !mode.destroyed && !mode.composing && !view.composing && range.head === view.state.selection.main.head) view.scrollDOM.scrollTop = top;
        mode.scrolling = false;
      },
    });
    return true;
  })] : [])];
}
