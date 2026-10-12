import { StateEffect, StateField, EditorState, type Range } from '@codemirror/state';
import { EditorView, type Decoration } from '@codemirror/view';
import type { Span } from './markdown.ts';

export const refreshImagesEffect = StateEffect.define<void>();
export const previewOnlyMode = StateEffect.define<boolean>();
export const compositionMode = StateEffect.define<boolean>();
export const previewOnlyField = StateField.define({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(previewOnlyMode) ? e.value : v), value),
  provide: (field) => [
    EditorState.readOnly.computeN([field], (state) => (state.field(field) ? [true] : [])),
    EditorView.editable.computeN([field], (state) => (state.field(field) ? [false] : [])),
  ],
});
export const compositionField = StateField.define({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(compositionMode) ? e.value : v), value),
});
export type Options = {
  resolveImage(reference: string): Promise<string>;
  onLink(href: string): void;
  properties?: boolean;
  blogMode?: boolean;
  onPropertyComposition?(active: boolean): void;
};
export const inlineClasses: Record<string, string> = {
  StrongEmphasis: 'nagori-bold',
  Emphasis: 'nagori-italic',
  Strikethrough: 'nagori-strike',
  InlineCode: 'nagori-code',
  Link: 'nagori-link',
  Autolink: 'nagori-link',
};
export function selectSource(view: EditorView, position: number) {
  if (view.state.field(previewOnlyField)) return;
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'nearest' }) });
  view.focus();
}

export type DecorationContext = {
  state: EditorState;
  text: string;
  ranges: Range<Decoration>[];
  active(span: Span): boolean;
  mark(from: number, to: number, className: string, attributes?: Record<string, string>): void;
  hide(from: number, to: number): void;
  line(position: number, className: string): void;
  listLine(number: number, className: string, style: string): void;
};
