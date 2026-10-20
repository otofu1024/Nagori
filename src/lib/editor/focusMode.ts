import { type EditorState, type Extension, type Transaction, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { compositionMode, previewOnlyField, previewOnlyMode } from './previewState.ts';
import { frontMatter } from './markdown.ts';

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

// Previewでは黒い段落を1つだけにする。選択が複数の段落にまたがっても、選択の先頭(head)の段落を使う。
function activeSpans(state: EditorState): Span[] {
  if (!previewing(state)) return focusSpans(state);
  const span = previewTarget(state, state.selection.main.head);
  return span ? [span] : [];
}

const previewing = (state: EditorState) => !!state.field(previewOnlyField, false);
// スクロールのたびに本文全体を文字列にしないよう、先頭が --- の時だけ Front Matter を調べる
const frontEnd = (state: EditorState) => (/^(?:\uFEFF)?---/.test(state.sliceDoc(0, 4)) ? frontMatter(state.doc.toString())?.to ?? 0 : 0);

// 指定の行から向きへ進み、Front Matterと空行を飛ばして最初の段落を返す。
function scanTarget(state: EditorState, number: number, step: 1 | -1, front: number): Span | null {
  for (let n = number; n >= 1 && n <= state.doc.lines; n += step) {
    const line = state.doc.line(n);
    if (line.from < front || !line.text.trim()) continue;
    return focusBlock(state, line.from);
  }
  return null;
}

// Previewで黒くする段落。Front Matterや空行の位置なら、近い段落へ寄せる。段落がなければnull。
export function previewTarget(state: EditorState, position: number): Span | null {
  const front = frontEnd(state), line = state.doc.lineAt(position);
  if (line.from >= front && line.text.trim()) return focusBlock(state, position);
  return scanTarget(state, line.number, 1, front) ?? scanTarget(state, line.number - 1, -1, front);
}

// 黒い段落の前後の段落。先頭と末尾では null を返す。
export function previewNeighbor(state: EditorState, span: Span, forward: boolean): Span | null {
  const front = frontEnd(state);
  return forward ? scanTarget(state, state.doc.lineAt(span.to).number + 1, 1, front) : scanTarget(state, state.doc.lineAt(span.from).number - 1, -1, front);
}

// Previewの↑↓キーを集中モードの段落移動へ渡す。集中モードがオフなら対象がなくfalseを返す。
const previewControllers = new WeakMap<EditorView, { step(forward: boolean): boolean }>();
export function previewFocusStep(view: EditorView, forward: boolean): boolean {
  return previewControllers.get(view)?.step(forward) ?? false;
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
    // 高さが決まった後に描き直す必要がある時だけ立てる
    stale = false;
    destroyed = false;
    view: EditorView;
    animation = 0;
    animating = false;
    quietUntil = 0;
    scrollTimer = 0;
    cancelFollow = () => { this.follow = this.scrolling = false; };
    // Previewの集中モード。段落を動かした時と、手でスクロールした時の処理
    wheeled = () => { if (!this.animating) return; cancelAnimationFrame(this.animation); this.animating = false; };
    scrolled = () => {
      if (this.animating || performance.now() < this.quietUntil || !previewing(this.view.state)) return;
      clearTimeout(this.scrollTimer);
      // 位置は計測のreadで求め、選択の変更は計測を抜けた後に行う。計測の中でdispatchすると、EditorViewの更新と衝突するため
      this.scrollTimer = window.setTimeout(() => this.view.requestMeasure({ read: () => this.centerPosition(), write: position => queueMicrotask(() => { if (!this.destroyed && !this.animating && previewing(this.view.state)) this.placeFocus(position); }) }), 150);
    };
    pointed = (event: PointerEvent) => {
      if (!previewing(this.view.state)) return;
      const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      const span = position === null ? null : previewTarget(this.view.state, position);
      if (span) this.select(span.from);
    };
    constructor(view: EditorView) {
      this.view = view;
      this.spans = focus ? activeSpans(view.state) : [];
      if (typewriter) {
        view.scrollDOM.addEventListener('wheel', this.cancelFollow, { passive: true });
        view.scrollDOM.addEventListener('pointerdown', this.cancelFollow, true);
      }
      if (focus) {
        view.scrollDOM.addEventListener('wheel', this.wheeled, { passive: true });
        view.scrollDOM.addEventListener('scroll', this.scrolled, { passive: true });
        view.scrollDOM.addEventListener('pointerdown', this.pointed, true);
        previewControllers.set(view, this);
        // 開いた時や集中モードをオンにした時は、Previewなら画面の中央の段落を黒くする。
        // 構築時は本文の高さが決まっていないため、Previewでは描かずに次のframeで描き直す
        if (previewing(view.state)) this.centerLater();
        else { this.decorate(); this.refresh(); }
      }
    }
    update(update: ViewUpdate) {
      const wasComposing = this.composing;
      for (const tr of update.transactions) for (const effect of tr.effects) if (effect.is(compositionMode)) this.composing = effect.value;
      if (this.composing || update.view.composing) { this.cancelFollow(); this.decorations = this.decorations.map(update.changes); return; }
      // 集中モードのPreviewでは、タイプライター表示の追従をしない
      if (typewriter && !(focus && previewing(update.state)) && (update.docChanged || update.selectionSet)) {
        this.follow = update.transactions.some(followsTyping);
        if (!this.follow) this.scrolling = false;
      }
      if (focus && update.transactions.some(tr => tr.effects.some(effect => effect.is(previewOnlyMode) && effect.value))) this.centerLater();
      if (!focus) return;
      const next = activeSpans(update.state);
      const changed = next.length !== this.spans.length || next.some((span, i) => span.from !== this.spans[i].from || span.to !== this.spans[i].to);
      this.spans = next;
      if (changed || wasComposing || update.docChanged || update.viewportChanged || update.geometryChanged || this.stale) { this.stale = false; this.decorate(); }
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
    centerLater() {
      // 先頭の段落が選ばれたままだと選択は変わらないため、描き直しを予約してから空の取引を送り、中央を選ぶ
      requestAnimationFrame(() => { if (!this.destroyed && previewing(this.view.state)) { this.stale = true; this.view.dispatch({}); this.centerFocus(); } });
    }
    // 一番上なら最初の段落、それ以外は画面の中央の段落を黒くする
    centerFocus() { this.placeFocus(this.centerPosition()); }
    // 画面の中央の高さにある位置。高さを読むため、計測のread段階で呼ぶ。座標からの判定は手で動かした直後に誤ることがあるため使わない
    centerPosition(): number {
      const scroll = this.view.scrollDOM;
      if (scroll.scrollTop <= 0) return 0;
      const middle = scroll.getBoundingClientRect().top + scroll.clientHeight / 2 - this.view.documentTop;
      return this.view.lineBlockAtHeight(Math.max(0, middle)).from;
    }
    placeFocus(position: number) {
      const span = previewTarget(this.view.state, position);
      if (span) this.select(span.from);
    }
    select(position: number) {
      const main = this.view.state.selection.main;
      if (main.empty && main.head === position) return;
      this.view.dispatch({ selection: { anchor: position } });
    }
    // 前後の段落へ移し、その中央が画面の中央に来るまでなめらかに動かす。押し続けた時は途中でも次へ進む。
    // 黒い段落がないか画面の外にある時は移さず、画面の中央の段落を黒くする。ただし動いている途中は、
    // 向かう先の段落がまだ画面の外にあるため、次へ進む
    step(forward: boolean) {
      if (this.destroyed || !previewing(this.view.state)) return false;
      const state = this.view.state;
      const current = previewTarget(state, state.selection.main.head);
      if (!current || (!this.animating && !this.onScreen(current))) { this.centerFocus(); return true; }
      const next = previewNeighbor(state, current, forward);
      if (next) { this.select(next.from); this.animateTo(next); }
      return true;
    }
    // 段落の一部でも今の画面に見えているか。座標は centerTop と同じ、画面上の位置で求める
    onScreen(span: Span): boolean {
      const rect = this.view.scrollDOM.getBoundingClientRect();
      const top = this.view.documentTop + this.view.lineBlockAt(span.from).top, bottom = this.view.documentTop + this.view.lineBlockAt(span.to).bottom;
      return bottom > rect.top && top < rect.bottom;
    }
    // 段落の中央が画面の中央に来る scrollTop。未描画の行の高さは動いている間に確定するため、毎回求め直す
    centerTop(span: Span): number {
      const scroll = this.view.scrollDOM, rect = scroll.getBoundingClientRect();
      const middle = this.view.documentTop + (this.view.lineBlockAt(span.from).top + this.view.lineBlockAt(span.to).bottom) / 2;
      return Math.min(Math.max(0, scroll.scrollTop + middle - (rect.top + scroll.clientHeight / 2)), scroll.scrollHeight - scroll.clientHeight);
    }
    animateTo(span: Span) {
      const scroll = this.view.scrollDOM;
      const from = scroll.scrollTop;
      let started: number | undefined;
      cancelAnimationFrame(this.animation);
      this.animating = true;
      const frame = (now: number) => {
        started ??= now;
        const progress = Math.min(1, (now - started) / 200), eased = 1 - (1 - progress) ** 3;
        const to = this.centerTop(span);
        scroll.scrollTop = from + (to - from) * eased;
        // 動かした後の scroll イベントを、手のスクロールとして扱わない
        this.quietUntil = now + 100;
        if (progress < 1) this.animation = requestAnimationFrame(frame);
        else this.animating = false;
      };
      this.animation = requestAnimationFrame(frame);
    }
    destroy() {
      this.destroyed = true;
      this.cancelFollow();
      if (this.animation) cancelAnimationFrame(this.animation);
      clearTimeout(this.scrollTimer);
      this.animating = false;
      if (previewControllers.get(this.view) === this) previewControllers.delete(this.view);
      this.view.scrollDOM.removeEventListener('wheel', this.cancelFollow);
      this.view.scrollDOM.removeEventListener('pointerdown', this.cancelFollow, true);
      this.view.scrollDOM.removeEventListener('wheel', this.wheeled);
      this.view.scrollDOM.removeEventListener('scroll', this.scrolled);
      this.view.scrollDOM.removeEventListener('pointerdown', this.pointed, true);
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
