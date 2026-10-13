import { Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { historyKeymap, defaultKeymap } from '@codemirror/commands';
import { openSearchPanel, closeSearchPanel } from '@codemirror/search';
import { moveList, continueList } from './listEdit.ts';
import { moveTable } from './tableEdit.ts';
import { paragraphNewline } from './paragraphEdit.ts';
import type { FormatKind } from './editor.ts';

type KeymapDeps = {
  readonly plain: boolean;
  readonly indentParagraphs?: boolean;
  readonly previewOnly: boolean;
  readonly composition: boolean;
  readonly linkDialog: boolean;
  readonly view: EditorView | undefined;
  onSave(): void;
  apply(kind: FormatKind): void;
};

export function editorKeymap(deps: KeymapDeps): Extension {
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'Tab',
          run: (editor) =>
            !deps.plain &&
            !deps.previewOnly &&
            !deps.composition &&
            !editor.composing &&
            !editor.compositionStarted &&
            !deps.linkDialog &&
            (moveTable(editor, 'next') || moveList(editor)),
        },
        {
          key: 'Shift-Tab',
          run: (editor) =>
            !deps.plain &&
            !deps.previewOnly &&
            !deps.composition &&
            !editor.composing &&
            !editor.compositionStarted &&
            !deps.linkDialog &&
            (moveTable(editor, 'previous') || moveList(editor, true)),
        },
        {
          key: 'Enter',
          run: (editor) =>
            !deps.previewOnly &&
            !deps.composition &&
            !editor.composing &&
            !editor.compositionStarted &&
            !deps.linkDialog &&
            ((!deps.plain && (moveTable(editor, 'down') || continueList(editor))) || paragraphNewline(editor, !!deps.indentParagraphs, deps.plain)),
        },
        {
          key: 'Mod-s',
          run: () => {
            if (!deps.composition && !deps.view?.composing) deps.onSave();
            return true;
          },
        },
        {
          key: 'Mod-b',
          run: () => {
            if (deps.plain) return false;
            deps.apply('bold');
            return true;
          },
        },
        {
          key: 'Mod-i',
          run: () => {
            if (deps.plain) return false;
            deps.apply('italic');
            return true;
          },
        },
        {
          key: 'Mod-k',
          run: () => {
            if (deps.plain) return false;
            deps.apply('link');
            return true;
          },
        },
        { key: 'Mod-f', run: (editor) => !deps.composition && !editor.composing && openSearchPanel(editor) },
        {
          key: 'Escape',
          run: (editor) => {
            if (closeSearchPanel(editor)) {
              editor.focus();
              return true;
            }
            return false;
          },
        },
      ]),
    ),
    keymap.of([...historyKeymap, ...defaultKeymap]),
  ];
}
