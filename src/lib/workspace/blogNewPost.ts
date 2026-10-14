import { readBlogCategories, type BlogCategory } from '../editor/blogCategories.ts';
import type { Entry } from './navigation.ts';

export type NewPostInput = { title: string; description: string; category: string; tags: string[] };
export type NewPostStorage = {
  config(): Promise<string | null>;
  create(date: string, text: string): Promise<Entry>;
};

export function newPostErrors(input: NewPostInput, categories: BlogCategory[] | null) {
  return {
    title: input.title.trim() ? '' : 'タイトルは必須です。',
    description: input.description.trim() ? '' : '説明は必須です。',
    category: categories?.some((item) => item.key === input.category) ? '' : 'カテゴリを選んでください。',
  };
}

export function japanDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

// テンプレートのscripts/new-post.mjsと同じ文字列を作る。
export function newPostMarkdown(input: NewPostInput, date: string): string {
  const tags = input.tags.map((tag) => tag.trim()).filter(Boolean);
  const tagLines = tags.length ? `\ntags:\n${tags.map((tag) => `  - ${JSON.stringify(tag)}`).join('\n')}` : '\ntags: []';
  return `---\ntitle: ${JSON.stringify(input.title.trim())}\n# 表紙タイトルを手動で改行したい場合だけ使用\n# coverTitleLines:\n#   - "1行目"\n#   - "2行目"\ndescription: ${JSON.stringify(input.description.trim())}\npublishedAt: ${date}\ncategory: ${input.category}${tagLines}\ndraft: false\n---\n\nここから本文を書きます。\n`;
}

// 作成直前に設定を読み直す。画面とMCPで同じ検証と入出力を使える。
export async function createBlogPost(storage: NewPostStorage, input: NewPostInput, now = new Date()): Promise<Entry> {
  const categories = readBlogCategories(await storage.config());
  if (!categories) throw new Error('src/config.tsのカテゴリを読めません。');
  const error = Object.values(newPostErrors(input, categories)).find(Boolean);
  if (error) throw new Error(error);
  const date = japanDate(now);
  return storage.create(date, newPostMarkdown(input, date));
}

export function blogTagCandidates(documents: { tags: string[] }[]): string[] {
  const tags = new Set<string>();
  for (const document of documents) {
    for (const tag of document.tags) {
      if (typeof tag === 'string' && tag.trim()) tags.add(tag.trim());
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b, 'ja'));
}
