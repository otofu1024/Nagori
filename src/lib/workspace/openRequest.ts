// 開く依頼を、今この窓で開いているフォルダと照らして、どう処理するかを決める

export type OpenRequestInput = { workspace: string; path: string | null; restore: boolean };

export type OpenRequestPlan = { kind: 'project' } | { kind: 'file'; path: string } | { kind: 'none' };

// 同じフォルダの依頼では、フォルダを開き直さない。ファイルの指定があればそのファイルだけを開き、なければ何もしない
export function planOpenRequest(request: OpenRequestInput, project: string): OpenRequestPlan {
  if (project && request.workspace === project) {
    return request.path ? { kind: 'file', path: request.path } : { kind: 'none' };
  }
  return { kind: 'project' };
}
