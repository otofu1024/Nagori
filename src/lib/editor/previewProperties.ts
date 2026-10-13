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
export const templateProperties = [
  'title',
  'description',
  'publishedAt',
  'updatedAt',
  'category',
  'tags',
  'draft',
  'cover',
  'coverAlt',
  'coverTitleLines',
] as const;
export function propertyCandidates(properties: Property[]): string[] {
  return templateProperties.filter((key) => !properties.some((property) => property.key === key));
}
export function propertyKind(property: Property, blogMode = false) {
  if (!property.editable || (typeof property.value === 'string' && /[\r\n]/.test(property.value))) return 'other';
  if (Array.isArray(property.value)) return 'list';
  if (typeof property.value === 'boolean') return 'boolean';
  if (blogMode) {
    if (property.key === 'publishedAt' || property.key === 'updatedAt')
      return !property.value || /^\d{4}-\d{2}-\d{2}$/.test(String(property.value)) ? 'date' : 'other';
    return typeof property.value === 'string' || property.value === null ? 'text' : 'other';
  }
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

function propertyEditing(dom: HTMLElement, view: EditorView, options: Options, error: HTMLElement) {
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
  const inputEvents = (input: HTMLElement, write: () => void) => {
    input.addEventListener('compositionstart', () => {
      composing = true;
      options.onPropertyComposition?.(true);
    });
    input.addEventListener('compositionend', () => {
      composing = false;
      options.onPropertyComposition?.(false);
      queueMicrotask(write);
    });
    input.addEventListener('input', (event) => {
      if (!(event as InputEvent).isComposing && !composing) write();
    });
    input.addEventListener('focus', () => view.dispatch({ annotations: isolateHistory.of('before') }));
  };
  dom.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || composing || view.composing || view.state.field(compositionField, false)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.isComposing && !composing) {
      event.preventDefault();
      event.stopPropagation();
      event.shiftKey ? redo(view) : undo(view);
    }
    if (event.key === 'Escape' && !composing) {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: readProperties(view.state.doc.toString())?.bodyFrom ?? 0 } });
      view.focus();
    }
  });
  return { commit, inputEvents, isComposing: () => composing || view.composing || !!view.state.field(compositionField, false) };
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
    return this.source === other.source && this.readonly === other.readonly && this.options.blogMode === other.options.blogMode;
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
    const { commit, inputEvents, isComposing } = propertyEditing(dom, view, this.options, error);
    const values = (key: string) => {
      const value = readProperties(view.state.doc.toString())?.properties.find((property) => property.key === key)?.value;
      return Array.isArray(value) ? (value as string[]) : [];
    };
    for (const property of this.properties) {
      const kind = propertyKind(property, this.options.blogMode);
      const row = document.createElement('div');
      row.className = 'nagori-property-row';
      row.dataset.key = property.key;
      row.dataset.kind = kind;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(icon.namespaceURI, 'path');
      path.setAttribute('d', icons[kind === 'list' && ['tags', 'tag', 'aliases'].includes(property.key) ? 'tags' : kind]);
      icon.append(path);
      const name = document.createElement('span');
      name.className = 'nagori-property-name';
      name.textContent = property.key;
      const value = document.createElement('div');
      value.className = 'nagori-property-value';
      row.append(icon, name, value);
      dom.append(row);
      if (kind === 'other' || (this.readonly && kind !== 'list' && kind !== 'boolean')) {
        const text = document.createElement('span');
        text.className = 'nagori-property-text';
        text.textContent = valueText(property);
        value.append(text);
        continue;
      }
      if (kind === 'list') {
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
            if (isComposing() || !input.value.trim()) return;
            const before = view.state.doc;
            commit(property.key, [...values(property.key), input.value.trim()]);
            if (before !== view.state.doc) input.value = '';
          };
          // 一覧はEnterか欄から離れた時に追加し、変換の確定では追加しない。
          inputEvents(input, () => {});
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.isComposing && !isComposing() && event.keyCode !== 229) {
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
        input.type = kind === 'boolean' ? 'checkbox' : kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text';
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
      if (this.options.blogMode) {
        const select = document.createElement('select');
        select.hidden = true;
        select.setAttribute('aria-label', '追加するプロパティ');
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = '項目を選択';
        select.append(prompt);
        for (const key of propertyCandidates(readProperties(this.source)?.properties ?? this.properties)) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = key;
          select.append(option);
        }
        add.disabled = select.options.length === 1;
        add.addEventListener('click', () => {
          select.hidden = false;
          select.focus();
        });
        select.addEventListener('change', () => {
          if (!select.value) return;
          commit(select.value, select.value === 'draft' ? false : select.value === 'tags' || select.value === 'coverTitleLines' ? [] : '');
        });
        dom.append(add, select);
      } else {
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
          if (isComposing() || !input.value.trim()) return;
          const key = input.value.trim();
          if (readProperties(view.state.doc.toString())?.properties.some((property) => property.key === key)) return;
          commit(key, '');
        };
        inputEvents(input, () => {});
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing && !isComposing() && event.keyCode !== 229) {
            event.preventDefault();
            addProperty();
          }
        });
        input.addEventListener('blur', addProperty);
        dom.append(add, input);
      }
    }
    dom.append(error);
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
      rows.some(
        (row, i) =>
          row.dataset.key !== this.properties[i].key || row.dataset.kind !== propertyKind(this.properties[i], this.options.blogMode),
      ) ||
      !!dom.querySelector('.nagori-property-add') === this.readonly ||
      (!this.readonly && !!dom.querySelector('select') !== !!this.options.blogMode)
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
    widget: options.blogMode
      ? new BlogHeaderWidget(text, read.properties, viewState.readOnly, options)
      : new PropertiesWidget(text.slice(0, read.bodyFrom), read.properties, viewState.readOnly, options),
    block: true,
    // 次の行の先頭にある見出しなどの行装飾を置き換えに巻き込まない。
    inclusiveEnd: false,
  }).range(0, to);
}

export const blogHeaderKeys = ['title', 'description', 'publishedAt', 'updatedAt', 'category', 'tags'];
const dateFormatter = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
function validDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[Tt ].*)?$/.test(value) || Number.isNaN(Date.parse(value))) return false;
  return new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10);
}
let extraPropertiesOpen = false;
try {
  extraPropertiesOpen = localStorage.getItem('nagori-blog-properties-open') === 'true';
} catch {}
const extras = new WeakMap<HTMLElement, { widget: PropertiesWidget; dom: HTMLElement }>();

export class BlogHeaderWidget extends PropertiesWidget {
  eq(other: PropertiesWidget) {
    return (
      other instanceof BlogHeaderWidget &&
      super.eq(other) &&
      JSON.stringify(this.options.blogCategories) === JSON.stringify(other.options.blogCategories)
    );
  }
  private extraWidget() {
    return new PropertiesWidget(
      this.source,
      this.properties.filter((property) => !blogHeaderKeys.includes(property.key)),
      this.readonly,
      this.options,
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('section');
    dom.className = 'nagori-blog-header';
    dom.contentEditable = 'false';
    const header = document.createElement('header');
    header.className = 'article-header';
    const error = document.createElement('div');
    error.className = 'nagori-property-error';
    error.setAttribute('role', 'status');
    error.hidden = true;
    const editing = propertyEditing(dom, view, this.options, error);
    const current = (key: string) => readProperties(view.state.doc.toString())?.properties.find((property) => property.key === key);
    const editable = (key: string) => !this.readonly && current(key)?.editable !== false;
    const category = document.createElement('a');
    category.dataset.key = 'category';
    category.setAttribute('aria-label', 'category');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'category');
    select.hidden = true;
    select.disabled = !editable('category');
    const presentCategory = current('category')?.value;
    const categories =
      this.options.blogCategories ??
      (typeof presentCategory === 'string' && presentCategory ? [{ key: presentCategory, label: presentCategory }] : []);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'category';
    select.append(placeholder);
    for (const candidate of categories) {
      const option = document.createElement('option');
      option.value = candidate.key;
      option.textContent = candidate.label;
      select.append(option);
    }
    const chooseCategory = () => {
      if (select.disabled) return;
      select.hidden = false;
      select.focus();
    };
    if (!select.disabled) category.tabIndex = 0;
    category.addEventListener('click', chooseCategory);
    category.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseCategory();
      }
    });
    editing.inputEvents(select, () => {});
    select.addEventListener('change', () => {
      editing.commit('category', select.value);
      select.hidden = true;
    });
    select.addEventListener('blur', () => {
      select.hidden = true;
    });
    header.append(category, select);
    for (const key of ['title', 'description']) {
      const container = document.createElement(key === 'title' ? 'h1' : 'p');
      if (key === 'description') container.className = 'article-description';
      const text = document.createElement('span');
      text.dataset.key = key;
      text.dataset.placeholder = key;
      text.setAttribute('aria-label', key);
      if (editable(key)) {
        text.contentEditable = 'plaintext-only';
        text.tabIndex = 0;
        text.setAttribute('role', 'textbox');
        text.setAttribute('aria-multiline', 'false');
        const write = () => editing.commit(key, (text.textContent ?? '').replace(/[\r\n]+/g, ' '));
        editing.inputEvents(text, write);
        text.addEventListener('focus', () => {
          const value = String(current(key)?.value ?? '');
          if (text.textContent !== value) text.textContent = value;
        });
        text.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !editing.isComposing()) {
            event.preventDefault();
            write();
            text.blur();
          }
        });
        text.addEventListener('beforeinput', (event) => {
          if (!editing.isComposing() && ['insertParagraph', 'insertLineBreak'].includes((event as InputEvent).inputType))
            event.preventDefault();
        });
        text.addEventListener('paste', (event) => {
          event.preventDefault();
          if (editing.isComposing()) return;
          const value = event.clipboardData?.getData('text/plain').replace(/[\r\n]+/g, ' ') ?? '';
          const selection = window.getSelection();
          if (selection?.rangeCount && text.contains(selection.anchorNode)) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(value);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
          }
          write();
        });
        text.addEventListener('blur', () => {
          if (!editing.isComposing()) {
            write();
            this.syncHeader(dom, view);
          }
        });
      }
      container.append(text);
      header.append(container);
    }
    const dates = document.createElement('div');
    dates.className = 'article-dates';
    for (const key of ['publishedAt', 'updatedAt']) {
      if (key === 'updatedAt' && !current(key)) continue;
      const time = document.createElement('time');
      time.dataset.key = key;
      time.setAttribute('aria-label', key);
      const input = document.createElement('input');
      input.type = 'date';
      input.hidden = true;
      input.disabled = !editable(key);
      input.setAttribute('aria-label', key);
      if (!input.disabled) time.tabIndex = 0;
      const chooseDate = () => {
        if (input.disabled) return;
        input.hidden = false;
        input.focus();
        // WebViewによっては日付ピッカーを持たないため、日付欄自体でも選べるようにする。
        try {
          input.showPicker?.();
        } catch {}
      };
      time.addEventListener('click', chooseDate);
      time.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          chooseDate();
        }
      });
      const write = () => {
        if (!input.validity.valid) return;
        const value = current(key)?.value;
        editing.commit(key, input.value ? input.value + (validDate(value) ? String(value).slice(10) : '') : '');
      };
      editing.inputEvents(input, write);
      input.addEventListener('change', write);
      input.addEventListener('blur', () => {
        input.hidden = true;
      });
      dates.append(time, input);
    }
    const reading = document.createElement('span');
    reading.className = 'nagori-reading-time';
    dates.append(reading);
    header.append(dates);
    const tags = document.createElement('div');
    tags.className = 'tag-list';
    tags.setAttribute('aria-label', 'タグ');
    const chips = document.createElement('span');
    chips.className = 'nagori-header-tags';
    tags.append(chips);
    if (editable('tags')) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'nagori-header-tag-input';
      input.setAttribute('aria-label', 'tagsに追加');
      input.placeholder = '+';
      const add = () => {
        if (editing.isComposing() || !input.value.trim()) return;
        const value = current('tags')?.value;
        const before = view.state.doc;
        editing.commit('tags', [...(Array.isArray(value) ? value : []), input.value.trim()]);
        if (before !== view.state.doc) input.value = '';
      };
      editing.inputEvents(input, () => {});
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !editing.isComposing()) {
          event.preventDefault();
          add();
        }
      });
      input.addEventListener('blur', add);
      tags.append(input);
    }
    header.append(tags);
    const details = document.createElement('details');
    details.className = 'nagori-blog-properties';
    details.open = extraPropertiesOpen;
    const summary = document.createElement('summary');
    summary.textContent = 'プロパティ';
    const widget = this.extraWidget(),
      list = widget.toDOM(view);
    extras.set(dom, { widget, dom: list });
    details.append(summary, list);
    details.addEventListener('toggle', () => {
      extraPropertiesOpen = details.open;
      try {
        localStorage.setItem('nagori-blog-properties-open', String(details.open));
      } catch {}
      view.requestMeasure();
    });
    dom.append(header, details, error);
    dom.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && !event.isComposing && !editing.isComposing()) {
        const target = event.target as HTMLElement;
        if (target.isContentEditable) {
          const selection = window.getSelection();
          // カーソルの後ろに文字が残っていない時だけ、本文へ移る
          if (!selection?.isCollapsed || !selection.rangeCount) return;
          const rest = document.createRange();
          rest.selectNodeContents(target);
          rest.setStart(selection.focusNode!, selection.focusOffset);
          if (rest.toString() !== '') return;
        }
        if (target.closest('.article-header') && !(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) {
          event.preventDefault();
          const read = readProperties(view.state.doc.toString());
          const from = read?.bodyFrom ?? 0;
          const to = from + (/^(?:[ \t]*\r?\n)+/.exec(view.state.doc.sliceString(from))?.[0].length ?? 0);
          view.dispatch({ selection: { anchor: to } });
          view.focus();
        }
      }
    });
    this.syncHeader(dom, view);
    return dom;
  }
  private syncHeader(dom: HTMLElement, view: EditorView) {
    const read = readProperties(view.state.doc.toString());
    const property = (key: string) => read?.properties.find((property) => property.key === key);
    const value = (key: string) => property(key)?.value;
    for (const key of ['title', 'description']) {
      const text = dom.querySelector<HTMLElement>(`.article-header [data-key="${key}"]`)!;
      const current = value(key);
      const titleLines = value('coverTitleLines');
      if (key === 'title' && document.activeElement !== text) {
        const lines =
          Array.isArray(titleLines) && titleLines.length && titleLines.every((line) => typeof line === 'string')
            ? titleLines
            : [String(current ?? '')];
        text.replaceChildren(
          ...lines.map((line, index) => {
            const span = document.createElement('span');
            span.className = 'article-title-line';
            span.textContent = line + (index < lines.length - 1 ? ' ' : '');
            return span;
          }),
        );
        text.parentElement!.setAttribute('aria-label', String(current ?? ''));
      } else if (text.textContent !== String(current ?? '')) text.textContent = String(current ?? '');
      text.setAttribute('aria-invalid', String(typeof current !== 'string' || !current.trim()));
    }
    const category = dom.querySelector<HTMLElement>('[data-key="category"]')!;
    const categoryValue = value('category');
    const match = this.options.blogCategories?.find((category) => category.key === categoryValue);
    category.className = 'category-label';
    if (typeof categoryValue === 'string' && categoryValue && !/\s/.test(categoryValue)) category.classList.add(categoryValue);
    category.textContent = match?.label ?? String(categoryValue || 'category');
    category.setAttribute(
      'aria-invalid',
      String(typeof categoryValue !== 'string' || !categoryValue.trim() || (!!this.options.blogCategories && !match)),
    );
    dom.querySelector<HTMLSelectElement>('.article-header select')!.value = String(categoryValue ?? '');
    for (const key of ['publishedAt', 'updatedAt']) {
      const time = dom.querySelector<HTMLTimeElement>(`time[data-key="${key}"]`)!;
      if (!time) continue;
      const input = time.nextElementSibling as HTMLInputElement;
      const current = value(key),
        valid = validDate(current);
      time.dateTime = valid ? String(current) : '';
      time.textContent = valid
        ? `${dateFormatter.format(new Date(String(current)))} ${key === 'publishedAt' ? '公開' : '更新'}`
        : `${key}: ${current ?? ''}`;
      time.setAttribute('aria-invalid', String(!valid));
      const date = valid ? String(current).slice(0, 10) : '';
      if (input.value !== date) input.value = date;
    }
    dom.querySelector('.nagori-reading-time')!.textContent =
      `約 ${Math.max(1, Math.ceil(view.state.doc.sliceString(read?.bodyFrom ?? 0).replace(/\s/g, '').length / 500))} 分で読めます`;
    const chips = dom.querySelector('.nagori-header-tags')!;
    chips.replaceChildren();
    const tags = value('tags');
    if (Array.isArray(tags))
      tags.forEach((tag, index) => {
        const chip = document.createElement('a');
        chip.textContent = '#' + tag;
        if (!this.readonly && property('tags')?.editable) {
          const remove = document.createElement('button');
          remove.textContent = '×';
          remove.setAttribute('aria-label', tag + 'を削除');
          remove.addEventListener('click', () => {
            const current = readProperties(view.state.doc.toString())?.properties.find((property) => property.key === 'tags')?.value;
            if (Array.isArray(current))
              commits.get(dom)?.(
                'tags',
                current.filter((_, i) => i !== index),
              );
          });
          chip.append(remove);
        }
        chips.append(chip);
      });
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const previous = extras.get(dom);
    if (
      !previous ||
      previous.widget.readonly !== this.readonly ||
      JSON.stringify(previous.widget.options.blogCategories) !== JSON.stringify(this.options.blogCategories)
    )
      return false;
    // 安全に編集できる型が変わった場合は、入力欄も作り直す。
    const old = readProperties(previous.widget.source)?.properties ?? [];
    if (
      blogHeaderKeys.some(
        (key) =>
          (old.find((property) => property.key === key)?.editable === false) !==
            (this.properties.find((property) => property.key === key)?.editable === false) ||
          (key === 'updatedAt' &&
            old.some((property) => property.key === key) !== this.properties.some((property) => property.key === key)),
      )
    )
      return false;
    const widget = this.extraWidget();
    if (propertyCandidates(old).join() !== propertyCandidates(this.properties).join() || !widget.updateDOM(previous.dom, view)) {
      const list = widget.toDOM(view);
      previous.dom.replaceWith(list);
      previous.dom = list;
    }
    previous.widget = widget;
    this.syncHeader(dom, view);
    return true;
  }
}
