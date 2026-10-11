import { LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags, tagHighlighter } from '@lezer/highlight';

// フェンスで指定された言語だけを読み込む。別名は同じ定義を使う
export const codeLanguages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'jsx'], load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })) }),
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts', 'tsx'], load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true, jsx: true })) }),
  LanguageDescription.of({ name: 'Python', alias: ['py'], load: () => import('@codemirror/lang-python').then(m => m.python()) }),
  LanguageDescription.of({ name: 'Rust', alias: ['rs'], load: () => import('@codemirror/lang-rust').then(m => m.rust()) }),
  LanguageDescription.of({ name: 'JSON', load: () => import('@codemirror/lang-json').then(m => m.json()) }),
  LanguageDescription.of({ name: 'CSS', load: () => import('@codemirror/lang-css').then(m => m.css()) }),
  LanguageDescription.of({ name: 'HTML', load: () => import('@codemirror/lang-html').then(m => m.html()) }),
  LanguageDescription.of({ name: 'Shell', alias: ['bash', 'sh', 'zsh'], load: () => import('@codemirror/legacy-modes/mode/shell').then(m => new LanguageSupport(StreamLanguage.define(m.shell))) }),
  LanguageDescription.of({ name: 'YAML', alias: ['yml'], load: () => import('@codemirror/lang-yaml').then(m => m.yaml()) }),
  LanguageDescription.of({ name: 'TOML', load: () => import('@codemirror/legacy-modes/mode/toml').then(m => new LanguageSupport(StreamLanguage.define(m.toml))) }),
  LanguageDescription.of({ name: 'SQL', load: () => import('@codemirror/lang-sql').then(m => m.sql()) }),
  LanguageDescription.of({ name: 'Swift', load: () => import('@codemirror/legacy-modes/mode/swift').then(m => new LanguageSupport(StreamLanguage.define(m.swift))) }),
  LanguageDescription.of({ name: 'Go', alias: ['golang'], load: () => import('@codemirror/legacy-modes/mode/go').then(m => new LanguageSupport(StreamLanguage.define(m.go))) }),
  LanguageDescription.of({ name: 'Java', load: () => import('@codemirror/legacy-modes/mode/clike').then(m => new LanguageSupport(StreamLanguage.define(m.java))) }),
  LanguageDescription.of({ name: 'C', load: () => import('@codemirror/legacy-modes/mode/clike').then(m => new LanguageSupport(StreamLanguage.define(m.c))) }),
  LanguageDescription.of({ name: 'C++', alias: ['cpp', 'c++'], load: () => import('@codemirror/legacy-modes/mode/clike').then(m => new LanguageSupport(StreamLanguage.define(m.cpp))) }),
  LanguageDescription.of({ name: 'Diff', alias: ['patch'], load: () => import('@codemirror/legacy-modes/mode/diff').then(m => new LanguageSupport(StreamLanguage.define(m.diff))) }),
];

export function codeLanguage(info: string) {
  const name = info.trim().split(/\s+/)[0];
  return name ? LanguageDescription.matchLanguageName(codeLanguages, name, false) : null;
}

// 色はコード行だけにCSSで付けるため、Inline Codeや本文の装飾は変えない
export const codeHighlighting = syntaxHighlighting(tagHighlighter([
  { tag: tags.keyword, class: 'nagori-syntax-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'nagori-syntax-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'nagori-syntax-number' },
  { tag: tags.comment, class: 'nagori-syntax-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'nagori-syntax-function' },
  { tag: [tags.typeName, tags.className], class: 'nagori-syntax-type' },
  { tag: [tags.propertyName, tags.attributeName, tags.tagName], class: 'nagori-syntax-property' },
  { tag: tags.inserted, class: 'nagori-syntax-string' },
  { tag: tags.deleted, class: 'nagori-syntax-keyword' },
]));
