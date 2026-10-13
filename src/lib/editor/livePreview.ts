import { StateField, EditorState, Transaction, Prec, type Extension } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { propertiesSourceField, PropertiesWidget } from './previewProperties.ts';
import { buildPreview } from './previewDecorations.ts';
import { previewContext, type PreviewContext } from './previewContext.ts';
import { refreshImagesEffect, previewOnlyField, compositionField, type Options } from './previewState.ts';

export function livePreview(options: Options): Extension {
  const resolver = options.resolveImage;
  let currentOptions = options;
  let cached: PreviewContext | undefined;
  const field = StateField.define<DecorationSet>({
    create: (state) => {
      cached = previewContext(state);
      return buildPreview(state, currentOptions, cached);
    },
    update: (value, tr) => {
      if (tr.effects.some((e) => e.is(refreshImagesEffect))) currentOptions = { ...options, resolveImage: (ref) => resolver(ref) };
      // The cursor's source is already exposed. Keep every other widget and the composing DOM stable until IME commits.
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
  return [
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
