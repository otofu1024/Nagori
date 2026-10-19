// 数式Widgetが初めて表示される時に読み込む。
import katex, { type KatexOptions } from 'katex';
import { MAX_MATH_LENGTH, type MathExpression } from './markdownMath.ts';
import { countRenderStart } from './mathStats.ts';

type MathResult = { html?: string; error?: string };
export type MathRender = { expressions: Map<number, MathResult> };

// 文書全体の数式の数と合計文字数の上限。超えた分の数式だけを数式エラーにし、文書全体は止めない。
export const MAX_MATH_COUNT = 4096;
export const MAX_MATH_TOTAL_LENGTH = 262144;

export async function renderMath(expressions: MathExpression[], active: () => boolean = () => true): Promise<MathRender | null> {
  if (!active()) return null;
  countRenderStart();
  // 文書の先頭から数える。上限を超えた数式以降も超え続けるため、その後の数式はすべてエラーになる。
  let count = 0;
  let total = 0;
  // 文書の更新ごとに作り直し、マクロを別の文書へ持ち越さない。
  const macros: KatexOptions['macros'] = {};
  const result = new Map<number, MathResult>();
  let equationNumber = 0;
  for (const item of expressions) {
    try {
      count++;
      total += item.expression.length;
      if (count > MAX_MATH_COUNT || total > MAX_MATH_TOTAL_LENGTH) throw new Error('この文書の数式表示上限を超えました');
      if (item.expression.length > MAX_MATH_LENGTH) throw new Error('数式が長すぎます');
      // 例外は数式ごとに受け止め、既存の数式エラー表示へ渡す。
      let html = katex.renderToString(item.expression, {
        displayMode: item.display,
        output: 'htmlAndMathml',
        trust: false,
        throwOnError: true,
        strict: 'warn',
        maxSize: 20,
        maxExpand: 1000,
        macros,
        globalGroup: true,
      });
      // CSSカウンターでは画面外の式が数えられないため、全文の順序で番号を固定する。
      let mathmlNumber = equationNumber;
      html = html.replace(/<span class="eqn-num"><\/span>/g, () => `<span>(${++equationNumber})</span>`);
      // KaTeXの環境内の手動tagはMathMLに出ないため、誤った自動番号を付けない。
      const mathmlTags = /<mtd class ="mml-eqn-num"><\/mtd>/g;
      const automaticOnly = (html.match(mathmlTags)?.length ?? 0) === equationNumber - mathmlNumber;
      html = html.replace(mathmlTags, () => (automaticOnly ? `<mtd><mtext>(${++mathmlNumber})</mtext></mtd>` : '<mtd></mtd>'));
      result.set(item.from, { html });
    } catch (error) {
      result.set(item.from, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return active() ? { expressions: result } : null;
}
