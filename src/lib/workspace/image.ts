// Rust側で形式を確認済みの画像について、先頭のバイト列からMIMEタイプを決める
export function imageMime(bytes: Uint8Array): string {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return 'application/octet-stream';
}

// 貼り付けで受け付ける画像の形式
const pastable = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
type ClipboardLike = { getData(format: string): string; items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null };
// クリップボードから貼り付ける画像を選ぶ。文字も入っている時は、文字の貼り付けを優先して画像として扱わない
export function clipboardImage(data: ClipboardLike | null | undefined): File | null {
  if (!data || data.getData('text/plain')) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && pastable.has(item.type)) return item.getAsFile();
  }
  return null;
}
