import { StateField, EditorState, type Extension } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
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
    provide: (field) => EditorView.decorations.from(field),
  });
  return [
    previewOnlyField,
    compositionField,
    field,
    EditorState.changeFilter.of((tr) => !tr.startState.field(previewOnlyField)),
    EditorView.domEventHandlers({
      click(event) {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-href]');
        if (target && event.metaKey) {
          event.preventDefault();
          options.onLink(target.dataset.href!);
          return true;
        }
        return false;
      },
    }),
  ];
}
