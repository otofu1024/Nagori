// This module is imported only when an inactive math widget needs rendering.
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { length2em } from '@mathjax/src/js/util/lengths.js';
import type TexError from '@mathjax/src/js/input/tex/TexError.js';
import type { LiteElement } from '@mathjax/src/js/adaptors/lite/Element.js';
import type { LiteText } from '@mathjax/src/js/adaptors/lite/Text.js';
import type { LiteDocument } from '@mathjax/src/js/adaptors/lite/Document.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { CHTML } from '@mathjax/src/js/output/chtml.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { AssistiveMmlHandler } from '@mathjax/src/js/a11y/assistive-mml.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import { MAX_MATH_LENGTH, type MathExpression } from './markdownMath.ts';

const adaptor = liteAdaptor({ fontSize: 16 });
AssistiveMmlHandler(RegisterHTMLHandler(adaptor));
const output = new CHTML<LiteElement, LiteText, LiteDocument>({ fontURL: 'nagori-mathjax-font', dynamicPrefix: '@mathjax/mathjax-newcm-font/js/chtml/dynamic', adaptiveCSS: true });
// Vite emits local hashed font/data assets. No CDN, autoload, require, menu or speech workers.
const fontData = typeof window !== 'undefined' ? import.meta.glob('../../node_modules/@mathjax/mathjax-newcm-font/mjs/chtml/dynamic/*.js') : {};
const fontURLs = typeof window !== 'undefined' ? import.meta.glob<string>('../../node_modules/@mathjax/mathjax-newcm-font/chtml/woff2/*.woff2', { query: '?url&no-inline', import: 'default', eager: true }) : {};
mathjax.asyncLoad = (path: string) => {
  const name = path.split('/').at(-1)!;
  const load = fontData[`../../node_modules/@mathjax/mathjax-newcm-font/mjs/chtml/dynamic/${name}`];
  if (load) return load();
  // The same renderer's Node tests use the installed official font package.
  if (typeof window === 'undefined' && /^@mathjax\/mathjax-newcm-font\/js\/chtml\/dynamic\/[a-z0-9-]+\.js$/.test(path)) return import(/* @vite-ignore */ path);
  return Promise.reject(new Error('未許可の数式フォントデータです'));
};
export type MathResult = { html?: string; error?: string };
export type MathRender = { expressions: Map<number, MathResult>; css: string };
let queue: Promise<void> = Promise.resolve();

export function renderMath(expressions: MathExpression[], active: () => boolean = () => true): Promise<MathRender | null> {
  const job = queue.then(async () => {
    if (!active()) return null;
    if (expressions.length > 512 || expressions.reduce((size, item) => size + item.expression.length, 0) > 262144) throw new Error('この文書の数式表示上限を超えました');
    const errors = new WeakMap<object, string>();
    // A fresh TeX instance gives each revision its own macros, equation numbers and labels.
    const input = new TeX<LiteElement, LiteText, LiteDocument>({ packages: ['base', 'ams', 'newcommand', 'mathtools'], tags: 'ams', maxBuffer: MAX_MATH_LENGTH, maxMacros: 1000, maxTemplateSubtitutions: 1000,
      inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']], processEnvironments: false, processRefs: false,
      formatError(jax: TeX<LiteElement, LiteText, LiteDocument>, error: TexError) { errors.set(jax.parseOptions.mathItem, error.message); return jax.formatError(error); }
    });
    input.preFilters.add((data: unknown) => { errors.delete((data as { math: object }).math); });
    const doc = mathjax.document('', { InputJax: input, OutputJax: output });
    doc.addRenderAction('nagori-attributes', STATE.COMPILED + 1, () => {
      for (const math of doc.math) {
        let invalidAttributes = false, oversized = false;
        math.root.walkTree(node => {
          // Preserve base mod spacing and delimiter flags; raw token CSS/links aren't Markdown math.
          const kept = node.getProperty('keep-attrs');
          if (typeof kept === 'string' && kept.split(/\s+/).some(name => name !== 'lspace' && name !== 'rspace' && !(name === 'stretchy' && typeof node.attributes.getExplicit(name) === 'boolean'))) invalidAttributes = true;
          for (const name of ['width', 'height', 'depth', 'voffset', 'lspace', 'rspace', 'minsize', 'maxsize', 'mathsize', 'fontsize', 'rowspacing', 'columnspacing']) {
            const value = node.attributes?.getExplicit(name);
            if (typeof value === 'string') for (const size of value.split(/\s+/)) if (!(name === 'maxsize' && size === 'infinity') && Math.abs(length2em(size, 1)) > 20) oversized = true;
          }
        });
        if (invalidAttributes || oversized) { const error = new Error(invalidAttributes ? '数式トークンの表示属性には対応していません' : '数式の指定寸法は20em以内で表示できます'); errors.set(math, error.message); doc.options.compileError(doc, math, error); }
      }
    }, () => {});
    const body = adaptor.body(doc.document);
    const holders = expressions.map(item => {
      const holder = adaptor.node('div', {}, [adaptor.text((item.display ? '\\[' : '\\(') + item.expression + (item.display ? '\\]' : '\\)'))]);
      adaptor.append(body, holder); return holder;
    });
    try {
      output.clearCache();
      // The complete source-order list includes offscreen/actively edited equations.
      // MathDocument.compile performs the AMS forward-reference recompile pass.
      await doc.renderPromise();
      if (!active()) return null;
      const holderErrors = new Map<LiteElement, string>();
      for (const math of doc.math) { const error = errors.get(math); if (error) holderErrors.set(adaptor.parent(math.start.node), error); }
      const result = new Map<number, MathResult>();
      expressions.forEach((item, index) => {
        const html = adaptor.innerHTML(holders[index]);
        const error = item.expression.length > MAX_MATH_LENGTH ? '数式が長すぎます' : holderErrors.get(holders[index]) ?? (!adaptor.tags(holders[index], 'mjx-container').length || adaptor.tags(holders[index], 'mjx-merror').length ? '数式の構文を確認してください' : undefined);
        result.set(item.from, error ? { error } : { html });
      });
      const css = adaptor.cssText(output.styleSheet(doc)).replace(/nagori-mathjax-font\/([a-z0-9-]+\.woff2)/g, (_match, name: string) => {
        const url = fontURLs[`../../node_modules/@mathjax/mathjax-newcm-font/chtml/woff2/${name}`];
        if (typeof window !== 'undefined' && !url) throw new Error('数式フォントが見つかりません');
        return url ?? `nagori-mathjax-font/${name}`;
      });
      return { expressions: result, css };
    } finally {
      doc.clear();
      output.clearCache();
      // clearCache doesn't release MathJax's current document/item/table references.
      for (const key of ['document', 'math', 'container', 'table', 'nodeMap']) Reflect.deleteProperty(output, key);
      adaptor.document = adaptor.createDocument();
      // Newcommand's global named maps otherwise keep the last document's macro strings.
      new TeX({ packages: ['base', 'newcommand'] });
    }
  });
  queue = job.then(() => {}, () => {});
  return job;
}
