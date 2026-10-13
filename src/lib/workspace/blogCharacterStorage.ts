import { invoke } from '@tauri-apps/api/core';
import type { CharacterStorage, CharacterSave, CharacterSnapshot } from './blogCharacterManager.ts';

export const characterStorage: CharacterStorage = {
  read: () => invoke<CharacterSnapshot>('document_open', { path: 'src/config.ts' }),
  async documents() {
    const entries = await invoke<{ path: string; kind: string }[]>('workspace_index');
    const documents = [];
    for (const entry of entries) {
      if (entry.kind === 'markdown' && entry.path.startsWith('src/content/blog/'))
        documents.push(await invoke<{ text: string }>('document_open', { path: entry.path }));
    }
    return documents;
  },
  imageBaseline: (path) => invoke<string | null>('blog_characters_image_baseline', { path }),
  save: (request) => invoke<CharacterSave>('blog_characters_save', { request }),
};
