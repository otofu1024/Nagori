import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { mathExpressions } from './markdownMath.ts';
import { markdownParser, frontMatter, type Span } from './markdown.ts';
import { references } from './markdownInline.ts';
import type { MathContext } from './previewMath.ts';

export type PreviewContext = { tree: Tree; text: string; front: Span | null; refs: Map<string, string>; math: MathContext };
export function previewContext(state: EditorState, previous?: PreviewContext): PreviewContext {
  const tree = syntaxTree(state),
    text = state.doc.toString();
  // ponytail: full math scan once per text revision up to the 2MiB document limit; index only if measured latency requires it.
  const hasMath = text.includes('$') || text.includes('\\(') || text.includes('\\[');
  const math =
    previous?.text === text
      ? previous.math
      : { expressions: hasMath ? mathExpressions(markdownParser.parse(text), text) : [], mounts: new Set<HTMLElement>(), epoch: 0 };
  return { tree, text, front: frontMatter(text), refs: references(tree, text), math };
}
