// modifiedはファイルの更新日時（Unixのミリ秒）。取れない時は持たない
export type Entry={path:string;name:string;kind:'directory'|'markdown'|'image'|'other'|'symlink';modified?:number};
export function fuzzyScore(path:string, query:string):number|null {
  const target=path.toLocaleLowerCase(), needle=query.toLocaleLowerCase().trim();
  let at=0, score=0, previous=-2;
  for(const char of needle) {const found=target.indexOf(char,at);if(found<0)return null;score+=found===previous+1?8:0;score+=found===0||'/ _-'.includes(target[found-1])?5:0;score-=found-at;previous=found;at=found+1;}
  return score-target.length/100;
}
export function candidates(entries:Entry[], query:string, recent:string[]):Entry[] {
  const files=entries.filter(e=>e.kind==='markdown'||e.kind==='image'||e.kind==='other');
  if(!query.trim()) return recent.flatMap(path=>{const found=files.find(e=>e.path===path);return found?[found]:[];}).slice(0,50);
  // ponytail: linear fuzzy scan; index only if measured search latency exceeds 100ms.
  return files.map(entry=>({entry,score:fuzzyScore(entry.path,query)})).filter(item=>item.score!==null).sort((a,b)=>b.score!-a.score!||a.entry.path.localeCompare(b.entry.path)).slice(0,50).map(item=>item.entry);
}
export function parentPath(path:string) {const slash=path.lastIndexOf('/');return slash<0?'':path.slice(0,slash);}
export function containsPath(folder:string,path:string) {return folder===path||path.startsWith(folder+'/');}
export function renamedPath(path:string, old:string, next:string) {return containsPath(old,path)?next+path.slice(old.length):path;}
export function localLink(documentPath:string,href:string):string {
  if(href.startsWith('#')) throw new Error('同一文書内のアンカー移動はMVP対象外です。');
  if(href.startsWith('/')||/^[a-z][a-z\d+.-]*:/i.test(href)) throw new Error('このリンクは開けません。プロジェクト内のMarkdownに対応しています。');
  const parts=parentPath(documentPath).split('/').filter(Boolean);
  for(const part of decodeURIComponent(href.split(/[?#]/)[0]).split('/')) {if(!part||part==='.')continue;if(part==='..'){if(!parts.length)throw new Error('プロジェクト外のリンクは開けません。');parts.pop();}else parts.push(part);}
  const path=parts.join('/');if(!/\.(md|markdown)$/i.test(path))throw new Error('Markdown以外のローカルリンクは開けません。');return path;
}
export type Naming={kind:'rename'|'markdown'|'directory';parent:string;entry?:Entry;value:string;error:string};
