import { WidgetType, type EditorView } from '@codemirror/view';
import { selectSource } from './previewState.ts';

export class TextWidget extends WidgetType {
  readonly value: string;
  readonly className: string;
  constructor(value: string, className = 'nagori-list-marker') {
    super();
    this.value = value;
    this.className = className;
  }
  eq(other: TextWidget) {
    return this.value === other.value && this.className === other.className;
  }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = this.value;
    span.className = this.className;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}
export class RuleWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  constructor(position: number, previewOnly = false) {
    super();
    this.previewOnly = previewOnly;
    this.position = position;
  }
  eq(other: RuleWidget) {
    return this.position === other.position && this.previewOnly === other.previewOnly;
  }
  toDOM(view: EditorView) {
    const hr = document.createElement('hr');
    hr.className = 'nagori-rule';
    hr.addEventListener('click', () => selectSource(view, this.position));
    return hr;
  }
  ignoreEvent() {
    return true;
  }
}
