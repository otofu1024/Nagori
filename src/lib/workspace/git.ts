import type { Entry } from './navigation.ts';

export type GitChange = { path: string; originalPath: string | null; index: string; worktree: string };
export type GitCommit = { oid: string; message: string; undo: 'reset' | 'revert' | null; reason: string | null };
export type GitStatus = { branch: string; upstream: string | null; ahead: number; changes: GitChange[]; lastCommit: GitCommit | null };
export type GitAction =
  | { kind: 'stage' | 'unstage'; paths: string[] }
  | { kind: 'commit'; message: string }
  | { kind: 'push' | 'pull' }
  | { kind: 'undo'; oid: string; mode: 'reset' | 'revert' };

export function gitFile(path: string) {
  const slash = path.lastIndexOf('/');
  const directory = path.slice(0, slash < 0 ? 0 : slash);
  return {
    name: path.slice(slash + 1),
    directory,
    // 末尾も見えるように、長い場所は途中を省く。
    shortDirectory: directory.length > 28 ? directory.slice(0, 12) + '…' + directory.slice(-14) : directory,
  };
}

export function gitEntry(path: string): Entry {
  return { path, name: gitFile(path).name, kind: /\.(md|markdown)$/i.test(path) ? 'markdown' : /\.(png|jpe?g|gif|webp)$/i.test(path) ? 'image' : 'other' };
}
