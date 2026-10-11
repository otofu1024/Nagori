import { WidgetType, type EditorView } from '@codemirror/view';
import { selectSource, type Options } from './previewState.ts';

export class ImageWidget extends WidgetType {
  readonly previewOnly: boolean;
  readonly position: number;
  readonly ref: string;
  readonly alt: string;
  readonly resolveImage: Options['resolveImage'];
  constructor(position: number, ref: string, alt: string, resolveImage: Options['resolveImage'], previewOnly = false) {
    super();
    this.previewOnly = previewOnly;
    this.position = position;
    this.ref = ref;
    this.alt = alt;
    this.resolveImage = resolveImage;
  }
  eq(other: ImageWidget) {
    return (
      this.position === other.position &&
      this.ref === other.ref &&
      this.alt === other.alt &&
      this.resolveImage === other.resolveImage &&
      this.previewOnly === other.previewOnly
    );
  }
  toDOM(view: EditorView) {
    const container = document.createElement('span');
    container.className = 'nagori-image';
    container.tabIndex = this.previewOnly ? -1 : 0;
    container.setAttribute('role', this.previewOnly ? 'group' : 'button');
    container.setAttribute('aria-label', this.previewOnly ? `画像: ${this.alt || this.ref}` : `画像の記法を編集: ${this.alt || this.ref}`);
    container.textContent = `画像: ${this.ref}`;
    container.addEventListener('click', () => selectSource(view, this.position));
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') selectSource(view, this.position);
    });
    // Only URLs created by the parent's validated local-image resolver enter an img element.
    let reference = this.ref;
    try {
      reference = decodeURIComponent(reference);
    } catch {
      /* Invalid percent escape stays literal and resolver reports the path error. */
    }
    this.resolveImage(reference)
      .then((url) => {
        if (!container.isConnected || !/^blob:/.test(url)) return;
        const image = document.createElement('img');
        image.src = url;
        image.alt = this.alt;
        image.addEventListener('load', () => view.requestMeasure());
        image.addEventListener('error', () => {
          container.textContent = `画像を表示できません: ${this.ref}`;
        });
        container.replaceChildren(image);
      })
      .catch((error) => {
        if (container.isConnected) container.textContent = `画像: ${this.ref} — ${String(error)}`;
      });
    return container;
  }
  ignoreEvent() {
    return true;
  }
}
