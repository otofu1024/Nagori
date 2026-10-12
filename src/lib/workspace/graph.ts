import { localLink } from './navigation.ts';

export type GraphArticle = { path: string; title: string; tags: string[]; links: string[] };
export type GraphNode = { id: string; label: string; kind: 'article' | 'tag'; path?: string; degree: number };
export type GraphEdge = { source: string; target: string; kind: 'link' | 'tag' };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export function buildGraph(articles: GraphArticle[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const names = new Map<string, string | null>();
  for (const { path, title } of articles) {
    const id = `article:${path}`,
      name = path.split('/').at(-1)!.replace(/\.md$/i, '');
    nodes.set(id, { id, path, label: title || name, kind: 'article', degree: 0 });
    names.set(name, names.has(name) ? null : id);
  }
  const connect = (source: string, target: string, kind: GraphEdge['kind']) => {
    if (source === target) return;
    const key = JSON.stringify([kind, ...[source, target].sort()]);
    if (edges.has(key)) return;
    edges.set(key, { source, target, kind });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  };
  for (const article of articles) {
    const source = `article:${article.path}`;
    for (const value of article.tags) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const tag = value.trim(),
        id = `tag:${tag}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: '#' + tag, kind: 'tag', degree: 0 });
      connect(source, id, 'tag');
    }
    for (const link of article.links) {
      const wiki = link.startsWith('[[') && link.endsWith(']]');
      const href = wiki ? link.slice(2, -2) : link;
      if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      try {
        let target: string | null | undefined;
        if (wiki) {
          const name = href.split(/[?#]/)[0],
            path = /\.md$/i.test(name) ? name : name + '.md';
          target = `article:${localLink(article.path, path)}`;
          if (!nodes.has(target)) target = `article:${localLink('', path)}`;
          if (!nodes.has(target) && !name.includes('/')) target = names.get(decodeURIComponent(name).replace(/\.md$/i, ''));
        } else target = `article:${localLink(article.path, href)}`;
        if (target && nodes.has(target)) connect(source, target, 'link');
      } catch {
        /* Broken and outside-workspace links have no edge. */
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
