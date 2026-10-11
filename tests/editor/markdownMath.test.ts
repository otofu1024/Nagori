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
import { frontMatter, markdownParser, markdownExtensions, walk, touches } from '../../src/lib/editor/markdown.ts';
import { references, linkTarget, linkMarkdown, codeDisplay } from '../../src/lib/editor/markdownInline.ts';
import { formatPlan } from '../../src/lib/editor/markdownFormat.ts';
import { livePreview } from '../../src/lib/editor/livePreview.ts';
import { previewOnlyMode, compositionMode } from '../../src/lib/editor/previewState.ts';
import { buildPreview } from '../../src/lib/editor/previewDecorations.ts';

