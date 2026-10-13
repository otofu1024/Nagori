import { StateField, EditorState, Transaction, Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, BlockType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { propertiesSourceField, PropertiesWidget } from './previewProperties.ts';
import { buildPreview } from './previewDecorations.ts';
import { LinkCardWidget, TalkWidget } from './previewBlog.ts';
import { previewContext, type PreviewContext } from './previewContext.ts';
import { refreshImagesEffect, previewOnlyField, compositionField, type Options } from './previewState.ts';

export function livePreview(options: Options): Extension {
  const resolver = options.resolveImage;
  let view: EditorView | undefined;
  const previews = new Map<string, { value: import('./blogLinkCards.ts').LinkPreview | null; until: number }>();
  const linkPreview = (url: string) => {
    if (!options.blogMode || options.blogLinkCardsEnabled === false) return null;
    const cached = options.blogLinkCards?.[url];
    if (cached) return cached;
    const request = previews.get(url);
    if (request && request.until > Date.now()) return request.value;
    // キャッシュを読み終える前は取りに行かない。読み終えると表示を作り直すので、そこで足りない分だけ取る
    if (!options.blogLinkCards || !options.fetchLinkCard) return null;
    const pending = { value: null as import('./blogLinkCards.ts').LinkPreview | null, until: Infinity };
    previews.set(url, pending);
    options
      .fetchLinkCard(url)
      .catch(() => null)
      .then((value) => {
        pending.value = value;
        pending.until = value ? Infinity : Date.now() + 60_000;
        if (view) view.dispatch({ effects: refreshImagesEffect.of() });
      });
    return null;
  };
  let currentOptions = { ...options, linkPreview };
  let cached: PreviewContext | undefined;
  const field = StateField.define<DecorationSet>({
    create: (state) => {
      cached = previewContext(state);
      return buildPreview(state, currentOptions, cached);
    },
    update: (value, tr) => {
      if (tr.effects.some((e) => e.is(refreshImagesEffect)))
        currentOptions = { ...options, linkPreview, resolveImage: (ref) => resolver(ref) };
      // カーソルのある所は記法を出している。日本語の確定まで、ほかの部品と変換中のDOMを動かさない。
      if (tr.state.field(compositionField)) return value.map(tr.changes);
      const parsedChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (tr.docChanged || parsedChanged || tr.startState.field(compositionField)) cached = previewContext(tr.state, cached);
      return tr.docChanged || tr.selection || tr.effects.length || parsedChanged ? buildPreview(tr.state, currentOptions, cached) : value;
    },
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) =>
        view.state.field(field).update({ filter: (_from, _to, decoration) => decoration.spec.widget instanceof PropertiesWidget }),
      ),
    ],
  });
  // カードと吹き出しは1つの部品に置き換えて描くので、上下の矢印キーで飛び越えずに、部品へカーソルを入れて記法へ戻す
  const enterBlogComponent = (view: EditorView, forward: boolean) => {
    const main = view.state.selection.main;
    if (!main.empty) return false;
    const line = view.state.doc.lineAt(main.head),
      next = view.moveVertically(main, forward).head;
    let target: number | undefined;
    view.state.field(field).between(forward ? line.to : next, forward ? next : line.from, (from, to, decoration) => {
      const widget = decoration.spec.widget;
      if (!(widget instanceof LinkCardWidget || widget instanceof TalkWidget)) return;
      if (forward && from > line.to && from <= next && (target === undefined || from < target)) target = from;
      if (!forward && to < line.from && to >= next) {
        const last = view.state.doc.lineAt(to).from;
        if (target === undefined || last > target) target = last;
      }
    });
    if (target === undefined) return false;
    // 引用の記号の後ろへ置き、段落の中に入れる。記号の前だと段落の改行がつながったままになる
    const marker = /^ {0,3}>[ \t]?/.exec(view.state.doc.lineAt(target).text)?.[0].length ?? 0;
    view.dispatch({ selection: { anchor: target + marker }, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
  // 行の先頭に隠した記号が続くと(引用の太字など)、上下の移動先が見えている隣の行を飛ばすことがある。
  // 間に見えている自分の行があれば、その行の同じ桁へ止める。隠した行と部品に置き換えた行は今までどおり通り越す
  const stayOnNextLine = (view: EditorView, forward: boolean) => {
    const main = view.state.selection.main;
    if (!main.empty) return false;
    const doc = view.state.doc,
      line = doc.lineAt(main.head),
      next = doc.lineAt(view.moveVertically(main, forward).head);
    if (Math.abs(next.number - line.number) < 2) return false;
    const step = forward ? 1 : -1;
    for (let number = line.number + step; number !== next.number; number += step) {
      const between = doc.line(number),
        block = view.lineBlockAt(between.from);
      if (block.type !== BlockType.Text || block.from !== between.from || block.to !== between.to || block.height < 2) continue;
      if (view.lineBlockAt(line.from).from !== line.from) return false;
      const column = Math.min(main.head - line.from, between.length);
      view.dispatch({ selection: { anchor: between.from + column }, scrollIntoView: true, userEvent: 'select' });
      return true;
    }
    return false;
  };
  return [
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (!options.blogMode || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return false;
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing || view.composing) return false;
          if (!enterBlogComponent(view, event.key === 'ArrowDown') && !stayOnNextLine(view, event.key === 'ArrowDown')) return false;
          event.preventDefault();
          return true;
        },
      }),
    ),
    ViewPlugin.define((editor) => {
      view = editor;
      return {
        destroy() {
          view = undefined;
        },
      };
    }),
    previewOnlyField,
    compositionField,
    propertiesSourceField,
    field,
    EditorState.transactionFilter.of((tr) => {
      if (!options.properties || tr.state.field(propertiesSourceField) || tr.state.field(compositionField) || !tr.newSelection.main.empty)
        return tr;
      let end = 0;
      tr.state.field(field, false)?.between(0, tr.newDoc.length, (_from, to, decoration) => {
        if (decoration.spec.widget instanceof PropertiesWidget) end = to;
      });
      return end && tr.newSelection.main.head < end ? [tr, { selection: { anchor: end }, sequential: true }] : tr;
    }),
    EditorState.changeFilter.of((tr) => {
      if (tr.startState.field(previewOnlyField)) return false;
      if (!options.properties || !tr.startState.selection.main.empty || tr.annotation(Transaction.userEvent) === 'input.properties')
        return true;
      let end = 0;
      tr.startState.field(field, false)?.between(0, tr.startState.doc.length, (_from, to, decoration) => {
        if (decoration.spec.widget instanceof PropertiesWidget) end = to;
      });
      // 本文の先頭でBackspaceを押しても、隠れているFront Matterは消さない。
      return end && tr.isUserEvent('delete') ? [0, end] : true;
    }),
    // 標準の上矢印の処理より先に、本文の先頭から見出しへ移す
    Prec.highest(EditorView.domEventHandlers({
      keydown(event, view) {
        if (
          !options.blogMode ||
          options.blogArticleHeader === false ||
          !options.properties ||
          view.state.readOnly ||
          event.key !== 'ArrowUp' ||
          event.isComposing ||
          view.composing ||
          view.state.field(compositionField) ||
          view.state.field(propertiesSourceField)
        )
          return false;
        let end = 0;
        view.state.field(field).between(0, view.state.doc.length, (_from, to, decoration) => {
          if (decoration.spec.widget instanceof PropertiesWidget) end = to;
        });
        // 見出しと本文の間の空行は飛ばすので、本文の最初の行の一番上から上へ動く時に見出しへ移る
        const main = view.state.selection.main;
        const bodyStart = end + (/^(?:[ \t]*\r?\n)+/.exec(view.state.doc.sliceString(end))?.[0].length ?? 0);
        if (end && main.empty && main.head >= end && main.head <= view.state.doc.lineAt(bodyStart).to && view.moveVertically(main, false).head < bodyStart) {
          const target = view.dom.querySelector<HTMLElement>('.article-description [contenteditable]');
          if (target) {
            target.focus();
            const range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(false);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            return true;
          }
        }
        return false;
      },
      click(event) {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-href]');
        if (target && event.metaKey) {
          event.preventDefault();
          options.onLink(target.dataset.href!);
          return true;
        }
        return false;
      },
    })),
  ];
}
