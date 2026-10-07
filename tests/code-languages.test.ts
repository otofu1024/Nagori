import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { highlightingFor, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { codeLanguages, codeLanguage, codeHighlighting } from '../src/lib/codeLanguages.ts';

test('指定した言語と別名だけを選び、定義は初期状態では読み込まない', () => {
  assert.ok(codeLanguages.every(language => !language.support));
  for (const name of ['js', 'ts', 'python', 'rust', 'json', 'css', 'html', 'bash', 'sh', 'yaml', 'toml', 'sql', 'swift', 'go', 'java', 'c', 'cpp', 'diff']) assert.ok(codeLanguage(name), name);
  assert.equal(codeLanguage('JS'), codeLanguage('javascript'));
  assert.equal(codeLanguage('ts title'), codeLanguage('typescript'));
  for (const name of ['', 'unknown', 'notjavascript', 'text', 'rubyonrails']) assert.equal(codeLanguage(name), null, name);
});

test('各言語の定義を必要になった時に読み込み、フェンス内を解析する', async () => {
  const samples = ['const answer = 42;', 'const answer: number = 42;', 'def f(): return "x"', 'fn main() { let x = 42; }', '{"x": 42}', 'a { color: red; }', '<p id="x">x</p>', 'echo "hello"', 'key: true', 'key = true', 'SELECT name FROM users;', 'let x = 42', 'package main\nfunc main() {}', 'class Main {}', 'int main() { return 0; }', 'class Main {};', '+added\n-removed'];
  for (const [index, description] of codeLanguages.entries()) {
    const loaded = await description.load();
    assert.equal(await description.load(), loaded);
    const state = EditorState.create({ doc: `\`\`\`${description.name}\n${samples[index]}\n\`\`\``, extensions: [markdown({ base: commonmarkLanguage, codeLanguages: codeLanguage }), codeHighlighting] });
    const tree = syntaxTree(state);
    assert.equal(tree.topNode.firstChild?.name, 'FencedCode');
    assert.ok(tree.resolveInner(state.doc.line(2).from + 1).name !== 'CodeText', description.name);
  }
});

test('未知の言語と言語なしはコード本文をそのまま保つ', () => {
  for (const name of ['', 'unknown']) {
    const state = EditorState.create({ doc: `\`\`\`${name}\nconst x = 1;\n\`\`\``, extensions: [markdown({ base: commonmarkLanguage, codeLanguages: codeLanguage }), codeHighlighting] });
    assert.equal(syntaxTree(state).resolveInner(state.doc.line(2).from + 2).name, 'CodeText');
  }
  const state = EditorState.create({ extensions: [codeHighlighting] });
  for (const tag of [tags.keyword, tags.string, tags.number, tags.comment, tags.function(tags.variableName), tags.typeName, tags.attributeName]) assert.match(highlightingFor(state, [tag]) ?? '', /^nagori-syntax-/);
});
