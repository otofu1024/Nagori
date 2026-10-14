import { Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { TextChange } from '../workspace/frontMatter.ts';

export function applyReviewEdit(view: Pick<EditorView, 'state' | 'dispatch'>, expected: string, changes: TextChange[]): boolean {
  if (view.state.readOnly || view.state.doc.toString() !== expected || !changes.length) return false;
  view.dispatch({ changes, annotations: [Transaction.userEvent.of('input.review'), isolateHistory.of('full')] });
  return true;
}
