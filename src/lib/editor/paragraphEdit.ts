import { EditorSelection, type StateCommand } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { markdownParser } from './markdown.ts';

// 段落では前の行の空白を引き継がず、ブログの設定がオンなら全角スペースを1つ入れる。
// 空行は字下げしない。途中で分けた右側が全角スペースで始まる時は重ねない。
// 見出し、区切り線、リンクの定義の行は、字下げせずにそのまま改行する(標準の改行は空白を足してしまう)。
export function paragraphNewline({ state, dispatch }: Parameters<StateCommand>[0], indent = false, plain = false): boolean {
  if (state.readOnly) return false;
  const doc = state.doc;
  let bare = false;
  if (!plain) {
    const end = Math.max(...state.selection.ranges.map((range) => doc.lineAt(range.to).to));
    const tree = ensureSyntaxTree(state, end, 20) ?? markdownParser.parse(doc.toString());
    for (const range of state.selection.ranges)
      for (const position of [range.from, range.to]) {
        const line = doc.lineAt(position);
        let paragraph = false;
        for (let node = tree.resolve(line.to, -1); node.parent; node = node.parent) {
          if (
            /^(?:ATXHeading\d|SetextHeading\d|HorizontalRule|LinkReference)$/.test(node.name)
          ) {
            bare = true;
            break;
          }
          if (
            /^(?:ListItem|Blockquote|FencedCode|CodeBlock|Table|FrontMatter|HTMLBlock|MathBlock|MathUnclosed)$/.test(
              node.name,
            )
          )
            return false;
          if (node.name === 'Paragraph') paragraph = true;
        }
        if (!bare && !paragraph && line.text.trim()) return false;
      }
  }
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = doc.lineAt(range.from);
        const prefix = indent && !plain && !bare && line.text.trim() && doc.sliceString(range.to, range.to + 1) !== '\u3000' ? '\u3000' : '';
        return {
          changes: { from: range.from, to: range.to, insert: state.lineBreak + prefix },
          range: EditorSelection.cursor(range.from + 1 + prefix.length),
        };
      }),
      { userEvent: 'input', annotations: isolateHistory.of('full'), scrollIntoView: true },
    ),
  );
  return true;
}
