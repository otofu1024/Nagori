import { StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { patchFrontMatter, readProperties, type Property } from '../workspace/frontMatter.ts';
import { frontMatter } from './markdown.ts';
import { compositionField, previewOnlyField, type Options } from './previewState.ts';

export const propertiesSource = StateEffect.define<boolean>();
export const propertiesSourceField = StateField.define({
  create: () => false,
  update(value, tr) {
    value = tr.effects.reduce((value, effect) => (effect.is(propertiesSource) ? effect.value : value), value);
    return value && tr.newSelection.main.from < (frontMatter(tr.newDoc.toString())?.to ?? 0);
  },
});
export function propertyKind(property: Property) {
  if (!property.editable || (typeof property.value === 'string' && /[\r\n]/.test(property.value))) return 'other';
  if (Array.isArray(property.value)) return 'list';
  if (typeof property.value === 'boolean') return 'boolean';
  if (typeof property.value === 'number') return 'number';
  if (
    typeof property.value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/.test(property.value) &&
    !Number.isNaN(Date.parse(property.value)) &&
    new Date(property.value.slice(0, 10)).toISOString().slice(0, 10) === property.value.slice(0, 10)
  )
    return 'date';
  return typeof property.value === 'string' ? 'text' : 'other';
}
const commits = new WeakMap<HTMLElement, (key: string, value: string | string[] | boolean | number) => void>();
const icons = {
  text: 'M4 5h16M4 10h12M4 15h8',
  number: 'M9 3L7 21M17 3l-2 18M3 9h18M2 15h18',
  date: 'M5 5h14v15H5zM8 3v4M16 3v4M5 10h14',
  tags: 'M3 4h9l9 9-8 8-10-10zM7 8h.01',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  boolean: 'M20 12v8H4V4h10M9 10l4 4 8-10',
  other: 'M8 5L3 12l5 7M16 5l5 7-5 7',
};
function valueText(property: Property) {
  if (typeof property.value === 'string') return property.value;
  try {
    return JSON.stringify(property.value) ?? '';
  } catch {
    return property.source;
  }
}

export class PropertiesWidget extends WidgetType {
  readonly source: string;
  readonly properties: Property[];
  readonly readonly: boolean;
  readonly options: Options;
  constructor(source: string, properties: Property[], readonly: boolean, options: Options) {
    super();
    this.source = source;
    this.properties = properties;
    this.readonly = readonly;
    this.options = options;
  }
  eq(other: PropertiesWidget) {
    return this.source === other.source && this.readonly === other.readonly;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('section');
    dom.className = 'nagori-properties';
    dom.contentEditable = 'false';
    dom.setAttribute('aria-label', 'プロパティ');
    const header = document.createElement(this.readonly ? 'div' : 'button');
    header.className = 'nagori-properties-heading';
    header.textContent = 'プロパティ';
    if (!this.readonly) {
      header.title = 'Front Matterのソースを表示';
      header.addEventListener('click', () => {
        view.dispatch({ effects: propertiesSource.of(true), selection: { anchor: 0 } });
        view.focus();
      });
    }
    dom.append(header);
    const error = document.createElement('div');
    error.className = 'nagori-property-error';
    error.setAttribute('role', 'status');
    error.hidden = true;
    let composing = false;
    const commit = (key: string, value: string | string[] | boolean | number) => {
      if (composing || view.composing || view.state.readOnly || view.state.field(compositionField, false)) return;
      try {
        const changes = patchFrontMatter(view.state.doc.toString(), key, value);
        if (changes.length) view.dispatch({ changes, annotations: Transaction.userEvent.of('input.properties') });
        error.textContent = '';
        error.hidden = true;
      } catch (reason) {
        error.textContent = String(reason instanceof Error ? reason.message : reason);
        error.hidden = false;
      }
    };
    commits.set(dom, commit);
    const values = (key: string) => {
      const value = readProperties(view.state.doc.toString())?.properties.find((property) => property.key === key)?.value;
      return Array.isArray(value) ? (value as string[]) : [];
    };
    const inputEvents = (input: HTMLInputElement, write: () => void) => {
      input.addEventListener('compositionstart', () => {
        composing = true;
        this.options.onPropertyComposition?.(true);
      });
      input.addEventListener('compositionend', () => {
        composing = false;
        this.options.onPropertyComposition?.(false);
        queueMicrotask(write);
      });
      input.addEventListener('input', (event) => {
        if (!(event as InputEvent).isComposing && !composing) write();
      });
      input.addEventListener('focus', () => view.dispatch({ annotations: isolateHistory.of('before') }));
    };
    for (const property of this.properties) {
      const row = document.createElement('div');
      row.className = 'nagori-property-row';
      row.dataset.key = property.key;
      row.dataset.kind = propertyKind(property);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(icon.namespaceURI, 'path');
      path.setAttribute(
        'd',
        icons[propertyKind(property) === 'list' && ['tags', 'tag', 'aliases'].includes(property.key) ? 'tags' : propertyKind(property)],
      );
      icon.append(path);
      const name = document.createElement('span');
      name.className = 'nagori-property-name';
      name.textContent = property.key;
      const value = document.createElement('div');
      value.className = 'nagori-property-value';
      row.append(icon, name, value);
      dom.append(row);
      if (
        propertyKind(property) === 'other' ||
        (this.readonly && propertyKind(property) !== 'list' && propertyKind(property) !== 'boolean')
      ) {
        const text = document.createElement('span');
        text.className = 'nagori-property-text';
        text.textContent = valueText(property);
        value.append(text);
        continue;
      }
      if (propertyKind(property) === 'list') {
        const chips = document.createElement('span');
        chips.className = 'nagori-property-chips';
        value.append(chips);
        if (!this.readonly) {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'nagori-property-list-input';
          input.setAttribute('aria-label', property.key + 'に追加');
          input.placeholder = '追加';
          value.append(input);
          const add = () => {
            if (composing || view.state.field(compositionField, false) || !input.value.trim()) return;
            const before = view.state.doc;
            commit(property.key, [...values(property.key), input.value.trim()]);
            if (before !== view.state.doc) input.value = '';
          };
          // 一覧はEnterか欄から離れた時に追加し、変換の確定では追加しない。
          inputEvents(input, () => {});
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) {
              event.preventDefault();
              add();
            }
          });
          input.addEventListener('blur', add);
          value.addEventListener('click', (event) => {
            if (event.target === value || event.target === chips) input.focus();
          });
        }
      } else {
        const input = document.createElement('input');
        input.type =
          propertyKind(property) === 'boolean'
            ? 'checkbox'
            : propertyKind(property) === 'date'
              ? 'date'
              : propertyKind(property) === 'number'
                ? 'number'
                : 'text';
        if (input.type === 'number') input.step = 'any';
        input.setAttribute('aria-label', property.key);
        input.disabled = this.readonly;
        value.append(input);
        const write = () => {
          if (!input.validity.valid || (input.type === 'number' && !input.value)) return;
          const current = readProperties(view.state.doc.toString())?.properties.find((p) => p.key === property.key)?.value;
          commit(
            property.key,
            input.type === 'checkbox'
              ? input.checked
              : input.type === 'number'
                ? input.valueAsNumber
                : input.type === 'date'
                  ? input.value
                    ? input.value + String(current).slice(10)
                    : ''
                  : input.value,
          );
        };
        inputEvents(input, write);
        input.addEventListener('change', write);
      }
    }
    if (!this.readonly) {
      const add = document.createElement('button');
      add.className = 'nagori-property-add';
      add.textContent = '+ プロパティを追加';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'nagori-property-key-input';
      input.hidden = true;
      input.setAttribute('aria-label', '追加するプロパティ');
      add.addEventListener('click', () => {
        input.hidden = false;
        input.focus();
      });
      const addProperty = () => {
        if (composing || view.state.field(compositionField, false) || !input.value.trim()) return;
        const key = input.value.trim();
        if (readProperties(view.state.doc.toString())?.properties.some((property) => property.key === key)) return;
        commit(key, '');
      };
      inputEvents(input, () => {});
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) {
          event.preventDefault();
          addProperty();
        }
      });
      input.addEventListener('blur', addProperty);
      dom.append(add, input);
    }
    dom.append(error);
    dom.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.isComposing && !composing) {
        event.preventDefault();
        event.shiftKey ? redo(view) : undo(view);
      }
      if (event.key === 'Escape' && !composing) {
        view.dispatch({ selection: { anchor: readProperties(view.state.doc.toString())?.bodyFrom ?? 0 } });
        view.focus();
      }
    });
    this.sync(dom, view);
    return dom;
  }
  private sync(dom: HTMLElement, view: EditorView) {
    for (const row of dom.querySelectorAll<HTMLElement>('.nagori-property-row')) {
      const property = this.properties.find((property) => property.key === row.dataset.key)!;
      const input = row.querySelector<HTMLInputElement>('input:not(.nagori-property-list-input)');
      if (input) {
        if (input.type === 'checkbox') input.checked = !!property.value;
        else {
          const value = input.type === 'date' ? String(property.value).slice(0, 10) : String(property.value ?? '');
          if (input.value !== value) input.value = value;
        }
      }
      const chips = row.querySelector<HTMLElement>('.nagori-property-chips');
      if (chips) {
        // 値をDOMに保持せず、削除時は現在の文書から読む。Undo後にも古い一覧を書き戻さない。
        chips.replaceChildren();
        (property.value as string[]).forEach((text, index) => {
          const chip = document.createElement('span');
          chip.className = 'nagori-property-chip';
          chip.textContent = text;
          if (!this.readonly) {
            const remove = document.createElement('button');
            remove.textContent = '×';
            remove.setAttribute('aria-label', text + 'を削除');
            remove.addEventListener('click', () => {
              const current = readProperties(view.state.doc.toString());
              const next = current?.properties.find((p) => p.key === property.key)?.value;
              if (Array.isArray(next))
                commits.get(dom)?.(
                  property.key,
                  next.filter((_, i) => i !== index),
                );
            });
            chip.append(remove);
          }
          chips.append(chip);
        });
      } else if (!input) row.querySelector('.nagori-property-text')!.textContent = valueText(property);
    }
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const rows = [...dom.querySelectorAll<HTMLElement>('.nagori-property-row')];
    if (
      rows.length !== this.properties.length ||
      rows.some((row, i) => row.dataset.key !== this.properties[i].key || row.dataset.kind !== propertyKind(this.properties[i])) ||
      !!dom.querySelector('.nagori-property-add') === this.readonly
    )
      return false;
    this.sync(dom, view);
    return true;
  }
  ignoreEvent() {
    return true;
  }
}

export function propertiesDecoration(viewState: import('@codemirror/state').EditorState, options: Options) {
  if (!options.properties || (!viewState.field(previewOnlyField, false) && viewState.field(propertiesSourceField, false))) return null;
  const text = viewState.doc.toString(),
    read = readProperties(text);
  if (!read) return null;
  const to = read.bodyFrom + (/^(?:[ \t]*\r?\n)+/.exec(text.slice(read.bodyFrom))?.[0].length ?? 0);
  return Decoration.replace({
    widget: new PropertiesWidget(text.slice(0, read.bodyFrom), read.properties, viewState.readOnly, options),
    block: true,
    // 次の行の先頭にある見出しなどの行装飾を置き換えに巻き込まない。
    inclusiveEnd: false,
  }).range(0, to);
}
