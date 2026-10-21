import { invoke } from '@tauri-apps/api/core';
import { imageMime } from './image.ts';

export function createImageLoader(currentPath: () => string | undefined) {
  const imageUrls = new Set<string>();
  const imageCache = new Map<string, Promise<string>>();
  let imageEpoch = 0;
  function releaseImages() {
    imageEpoch++;
    imageCache.clear();
    for (const url of imageUrls) URL.revokeObjectURL(url);
    imageUrls.clear();
  }

  // 記事中の表示(preview)は縮小版を、画像そのものを開く時は元のバイト列を使う
  async function blobImage(path: string, documentPath?: string, preview = false) {
    const bytes = new Uint8Array(await invoke<ArrayBuffer>('image_read', { path, documentPath, preview }));
    const url = URL.createObjectURL(new Blob([bytes], { type: imageMime(bytes) }));
    imageUrls.add(url);
    return url;
  }
  async function resolveImage(ref: string) {
    const epoch = imageEpoch,
      path = currentPath();
    if (!path) throw new Error('記事を開いてください。');
    const key = path + '\0' + ref,
      cached = imageCache.get(key);
    if (cached) return cached;
    const promise = blobImage(ref, path, true).then((url) => {
      if (epoch !== imageEpoch || path !== currentPath()) {
        URL.revokeObjectURL(url);
        imageUrls.delete(url);
        throw new Error('記事が切り替わりました。');
      }
      return url;
    });
    imageCache.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      if (imageCache.get(key) === promise) imageCache.delete(key);
      throw error;
    }
  }

  // 画像の元のファイルをクリップボードへ入れる。解決と同じ規則で、ワークスペースの外や外部のURLは扱わない
  async function copyImage(ref: string) {
    const path = currentPath();
    if (!path) throw new Error('記事を開いてください。');
    await invoke('image_copy', { path: ref, documentPath: path });
  }

  return {
    releaseImages,
    blobImage,
    resolveImage,
    copyImage,
    discard: (url: string) => {
      URL.revokeObjectURL(url);
      imageUrls.delete(url);
    },
  };
}
