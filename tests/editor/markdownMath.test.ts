import test from 'node:test';
import { renderMath } from '../../src/lib/editor/mathjax.ts';
import { readMathStats, resetMathStats } from '../../src/lib/editor/mathStats.ts';
import { MAX_MATH_LENGTH, mathExpressions, type MathExpression } from '../../src/lib/editor/markdownMath.ts';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorView, type WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { frontMatter, markdownParser, markdownExtensions, walk, references, linkTarget, formatPlan, linkMarkdown, touches, codeDisplay } from '../../src/lib/editor/markdown.ts';
import { livePreview, previewOnlyMode, compositionMode, buildPreview } from '../../src/lib/editor/livePreview.ts';

