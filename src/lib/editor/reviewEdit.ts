import { StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory, invertedEffects } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { TextChange } from '../workspace/frontMatter.ts';

export const dismissReview = StateEffect.define<{ id: string; hidden: boolean }>();
export const reviewDismissed = StateField.define<readonly string[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(dismissReview)) value = effect.value.hidden ? [...value.filter(id => id !== effect.value.id), effect.value.id] : value.filter(id => id !== effect.value.id);
    return value;
  },
});
export const reviewHistory = [reviewDismissed, invertedEffects.of(tr => tr.effects.filter(effect => effect.is(dismissReview)).map(effect => dismissReview.of({ id: effect.value.id, hidden: tr.startState.field(reviewDismissed).includes(effect.value.id) })))];

export function applyReviewEdit(view: Pick<EditorView, 'state' | 'dispatch'>, expected: string, changes: TextChange[], dismiss?: string): boolean {
  if (view.state.readOnly || view.state.doc.toString() !== expected || (!changes.length && !dismiss)) return false;
  view.dispatch({ changes, effects: dismiss ? dismissReview.of({ id: dismiss, hidden: true }) : [], annotations: [Transaction.userEvent.of('input.review'), isolateHistory.of('full')] });
  return true;
}
