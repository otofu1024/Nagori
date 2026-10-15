import common from './skills/共通.md?raw';
import review from './skills/添削/SKILL.md?raw';
import reviewSchema from './skills/添削/schema.json';
import suggest from './skills/提案/SKILL.md?raw';
import suggestSchema from './skills/提案/schema.json';
import type { ReviewSkills } from '../workspace/blogReview.ts';

export const reviewSkills: ReviewSkills = { common, review: { instruction: review, schema: reviewSchema }, suggest: { instruction: suggest, schema: suggestSchema } };
