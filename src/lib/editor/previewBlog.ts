import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { children, markdownParser } from './markdown.ts';
import { standaloneUrl, type LinkPreview } from './blogLinkCards.ts';
import { talkMarker } from './blogCharacters.ts';
import { renderInline } from './previewTable.ts';
import { mathExpressions } from './markdownMath.ts';
import { releaseMath } from './previewMath.ts';
import { references } from './markdownInline.ts';
import { selectSource, type Options, type DecorationContext } from './previewState.ts';

function publicImage(image: HTMLImageElement, ref: string, options: Options, view: EditorView, container: HTMLElement) {
  // publicの画像も検証済みのローカル画像ローダーを通し、リモートのURLはimgへ入れない。
  if (!ref || ref.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(ref)) return;
  const path = ref.startsWith('/') ? ref : '/' + ref;
  options
    .resolveImage(path)
    .then((url) => {
      if (!container.isConnected || !url.startsWith('blob:')) return;
      image.addEventListener('load', () => view.requestMeasure(), { once: true });
      image.src = url;
    })
    .catch(() => {});
}
function container() {
  const element = document.createElement('div');
  element.className = 'nagori-blog-component';
  return element;
}
export class LinkCardWidget extends WidgetType {
  readonly preview: LinkPreview;
  readonly options: Options;
  constructor(preview: LinkPreview, options: Options) {
    super();
    this.preview = preview;
    this.options = options;
  }
  eq(other: LinkCardWidget) {
    return this.preview === other.preview && this.options === other.options;
  }
  toDOM(view: EditorView) {
    const root = container(),
      card = document.createElement('a');
    card.className = 'link-card' + (this.preview.image ? ' link-card--with-image' : '');
    card.href = this.preview.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('aria-label', `${this.preview.title}（${this.preview.hostname}）`);
    card.setAttribute('data-pagefind-ignore', '');
    const body = document.createElement('span');
    body.className = 'link-card__body';
    const title = document.createElement('strong');
    title.className = 'link-card__title';
    title.textContent = this.preview.title;
    body.append(title);
    if (this.preview.description) {
      const description = document.createElement('span');
      description.className = 'link-card__description';
      description.textContent = this.preview.description;
      body.append(description);
    }
    const site = document.createElement('span');
    site.className = 'link-card__site';
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    site.append(arrow, this.preview.hostname);
    body.append(site);
    card.append(body);
    if (this.preview.image) {
      const wrap = document.createElement('span');
      wrap.className = 'link-card__image';
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      wrap.append(image);
      card.append(wrap);
      publicImage(image, this.preview.image, this.options, view, root);
    }
    card.addEventListener('click', (event) => {
      event.preventDefault();
      this.options.onLink(this.preview.url);
    });
    root.append(card);
    return root;
  }
  ignoreEvent() {
    return true;
  }
}

export class TalkWidget extends WidgetType {
  readonly position: number;
  readonly talk: NonNullable<ReturnType<typeof talkMarker>>;
  readonly options: Options;
  constructor(position: number, talk: NonNullable<ReturnType<typeof talkMarker>>, options: Options) {
    super();
    this.position = position;
    this.talk = talk;
    this.options = options;
  }
  eq(other: TalkWidget) {
    return this.position === other.position && JSON.stringify(this.talk) === JSON.stringify(other.talk) && this.options === other.options;
  }
  toDOM(view: EditorView) {
    const root = container(),
      aside = document.createElement('aside');
    aside.className = 'talk';
    aside.dataset.character = this.talk.key;
    aside.dataset.expression = this.talk.expression.expression;
    aside.setAttribute('aria-label', `${this.talk.character.name}（${this.talk.expression.label}）のひとこと`);
    const image = document.createElement('img');
    image.className = 'talk__character';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    const bubble = document.createElement('div');
    bubble.className = 'talk__bubble';
    const text = this.talk.body,
      tree = markdownParser.parse(text),
      refs = references(tree, text);
    const math = { expressions: mathExpressions(tree, text), mounts: new Set<HTMLElement>(), epoch: 0 };
    const render = (parent: HTMLElement, node: SyntaxNode) => {
      if (node.name === 'Paragraph' || /^(?:ATXHeading|SetextHeading)/.test(node.name)) {
        const element = document.createElement(node.name === 'Paragraph' ? 'p' : `h${node.name.at(-1)}`);
        renderInline(element, node, text, refs, this.options, view, math);
        parent.append(element);
      } else if (['FencedCode', 'CodeBlock'].includes(node.name)) {
        const pre = document.createElement('pre'),
          code = document.createElement('code');
        code.textContent =
          node.name === 'FencedCode'
            ? children(node)
                .filter((part) => part.name === 'CodeText')
                .map((part) => text.slice(part.from, part.to))
                .join('\n')
            : text.slice(node.from, node.to);
        pre.append(code);
        parent.append(pre);
      } else if (node.name === 'HorizontalRule') parent.append(document.createElement('hr'));
      else {
        const tag = (
          {
            Blockquote: 'blockquote',
            BulletList: 'ul',
            OrderedList: 'ol',
            ListItem: 'li',
            Table: 'table',
            TableHeader: 'tr',
            TableRow: 'tr',
            TableCell: node.parent?.name === 'TableHeader' ? 'th' : 'td',
          } as Record<string, string>
        )[node.name];
        const element = tag ? document.createElement(tag) : parent;
        if (node.name === 'TableCell') renderInline(element, node, text, refs, this.options, view, math);
        else for (const child of children(node)) render(element, child);
        if (tag) parent.append(element);
      }
    };
    render(bubble, tree.topNode);
    aside.append(image, bubble);
    root.append(aside);
    publicImage(image, this.talk.expression.src, this.options, view, root);
    // 数式と画像は吹き出し内で解析した位置を持つので、編集は元の引用の先頭へ戻す。
    root.addEventListener(
      'click',
      (event) => {
        if ((event.target as HTMLElement).closest('.nagori-math, .nagori-image')) {
          event.preventDefault();
          event.stopPropagation();
          selectSource(view, this.position);
        }
      },
      true,
    );
    root.addEventListener('click', () => selectSource(view, this.position));
    root.addEventListener(
      'keydown',
      (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).closest('.nagori-math, .nagori-image')) {
          event.preventDefault();
          event.stopPropagation();
          selectSource(view, this.position);
        }
      },
      true,
    );
    return root;
  }
  destroy(element: HTMLElement) {
    element.querySelectorAll<HTMLElement>('.nagori-math').forEach(releaseMath);
  }
  ignoreEvent() {
    return true;
  }
}
export function decorateBlog(node: SyntaxNode, context: DecorationContext, options: Options, refs: Map<string, string>) {
  if (!options.blogMode || context.active(node)) return false;
  if (node.name === 'Paragraph') {
    const url = standaloneUrl(node, context.text, refs),
      preview = url && options.blogLinkCardsEnabled !== false && options.linkPreview?.(url);
    if (url && !preview) context.mark(node.from, node.to, 'nagori-link', { 'data-href': url, title: `${url}（Cmd＋クリックで開く）` });
    if (preview) {
      context.ranges.push(Decoration.replace({ widget: new LinkCardWidget(preview, options), block: true }).range(node.from, node.to));
      return true;
    }
  }
  if (node.name === 'Blockquote' && options.blogCharactersEnabled !== false) {
    const first = children(node).find((part) => part.name !== 'QuoteMark');
    if (first?.name !== 'Paragraph') return false;
    const text = context.text.slice(node.from, node.to).replace(/^ {0,3}>[ \t]?/gm, '');
    const talk = talkMarker(text, options.blogCharacters);
    if (talk) {
      context.ranges.push(Decoration.replace({ widget: new TalkWidget(node.from, talk, options), block: true }).range(node.from, node.to));
      return true;
    }
  }
  return false;
}
