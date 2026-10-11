import { EditorState } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { history } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownExtensions } from '../../src/lib/editor/markdown.ts';

import { livePreview } from '../../src/lib/editor/livePreview.ts';

import { buildPreview } from '../../src/lib/editor/previewDecorations.ts';
export const options = { resolveImage: async () => 'blob:approved', onLink: () => {} };
export function editor(text: string, anchor = text.length) {
  let state = EditorState.create({
    doc: text,
    selection: { anchor },
    extensions: [
      history(),
      markdown({ base: commonmarkLanguage, extensions: markdownExtensions, completeHTMLTags: false, pasteURLAsLink: false }),
      livePreview(options),
    ],
  });
  ensureSyntaxTree(state, text.length, 1000);
  state = state.update({ selection: { anchor } }).state;
  return state;
}
export function decorationRanges(state: EditorState, rendered = false) {
  const result: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  const sets = rendered ? state.facet(EditorView.decorations) : [buildPreview(state, options)];
  for (const set of sets)
    if (typeof set !== 'function')
      set.between(0, state.doc.length, (from, to, value) => {
        result.push({ from, to, spec: value.spec });
      });
  return result;
}
