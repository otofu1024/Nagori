<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { Menu } from '@tauri-apps/api/menu';
  import { open, confirm } from '@tauri-apps/plugin-dialog';
  import Editor from './lib/Editor.svelte';
  import Icon from './lib/Icon.svelte';
  import nagoriIcon from './lib/assets/nagori-icon.png';
  import nagoriWordmark from './lib/assets/nagori-wordmark.png';
  import nagoriWordmarkDark from './lib/assets/nagori-wordmark-dark.png';
  import type { EditorApi } from './lib/editor';
  import { EditSession, failure, type OpenedDocument } from './lib/session';
  import { candidates, containsPath, renamedPath, parentPath, localLink, type Entry } from './lib/navigation';

  import { defaults, startupSettings, nextTheme, type Settings } from './lib/settings';
  type ImageData={mime:string;data:number[];width:number;height:number};
  let settings=$state<Settings>({...defaults,theme:'light'});
  let settingsLoaded=$state(false);
  let project=$state(''), current=$state<Entry|null>(null), initialText=$state(''), documentKey=$state(0);
  let session=$state.raw<EditSession|null>(null);
  let editor:EditorApi|null=null;
  let status=$state('saved'), chars=$state(0), readonly=$state(false), issue=$state<ReturnType<typeof failure>|null>(null);
  let tree=$state<Record<string,Entry[]>>({}), expanded=$state<string[]>(['']), selected=$state('');
  let index=$state<Entry[]>([]), busy=$state(false), starting=$state(true), notice=$state(''), contentError=$state('');
  let sidebarVisible=$state(true);
  let sourceMode=$state(false), imageUrl=$state(''), imageDimensions=$state('');
  let composing=false, compositionWaiters:Array<()=>void>=[], autosave:ReturnType<typeof setTimeout>|undefined;
  let fsTimer:ReturnType<typeof setTimeout>|undefined, noticeTimer:ReturnType<typeof setTimeout>|undefined;
  let externalQueued=false, externalChecking=false;
  const imageUrls=new Set<string>();
  const imageCache=new Map<string,Promise<string>>();
  let imageEpoch=0, treeQueued=false, imagesQueued=false;
  let quick=$state(false), query=$state(''), quickIndex=$state(0), quickInput=$state<HTMLInputElement>();
  let quickFocus:HTMLElement|null=null;
  let errorDialog:HTMLDialogElement, saveAsInput:HTMLInputElement, quickDialog:HTMLDialogElement;
  let renameInput=$state<HTMLInputElement>();
  let disk=$state.raw<OpenedDocument|null>(null), diskLabel=$state('');
  let naming=$state<{kind:'rename'|'markdown'|'directory';parent:string;entry?:Entry;value:string;error:string}|null>(null);
  let saveAs=$state(false), saveAsPath=$state(''), saveAsError=$state('');
  let saveAsDialog:HTMLDialogElement;
  const results=$derived(candidates(index,query,settings.recentFiles));
  const rows=$derived.by(()=>{const out:Array<Entry&{depth:number}>=[];const walk=(path:string,depth:number)=>{for(const entry of tree[path]??[]){out.push({...entry,depth});if(entry.kind==='directory'&&expanded.includes(entry.path))walk(entry.path,depth+1);}};walk('',0);return out;});
  const labels:Record<string,string>={saved:'保存済み',dirty:'未保存',saving:'保存中…',error:'保存失敗',conflict:'競合',missing:'ファイルが見つかりません'};
  const projectName=$derived(project.split('/').filter(Boolean).at(-1)??'Workspace');
  $effect(()=>{document.documentElement.dataset.theme=settings.theme;});

  function notify(message:string) {notice=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice='',5000);}
  function syncSession() {if(!session)return;status=session.status;issue=session.issue;readonly=session.readonly;chars=session.text.length;}
  function cancelSave() {clearTimeout(autosave);autosave=undefined;}
  function scheduleSave() {cancelSave();if(!session||session.issue||composing)return;autosave=setTimeout(()=>{void session?.flush().then(ok=>{if(!ok&&session?.issue)void showProblem();if(externalQueued&&!busy&&!composing){externalQueued=false;void checkExternal();}});},500);}
  function changed(text:string) {session?.edit(text);scheduleSave();}
  function composition(active:boolean) {composing=active;if(session)session.composing=active;if(active)cancelSave();else{for(const resolve of compositionWaiters.splice(0))resolve();scheduleSave();if(treeQueued&&!busy)void processChanges();if(externalQueued&&!busy){externalQueued=false;void checkExternal();}}}
  async function settleComposition() {if(composing)await new Promise<void>(resolve=>compositionWaiters.push(resolve));}
  async function flush() {cancelSave();await settleComposition();if(!session)return true;const ok=await session.flush();if(!ok&&session.issue)await showProblem();return ok;}
  async function operation(action:()=>Promise<void>, needsSave=true) {
    if(busy)return;
    await settleComposition();
    if(busy)return;
    busy=true;
    try {if(needsSave&&!await flush())return;await action();} catch(error) {notify(failure(error).message);} finally {busy=false;if(treeQueued)void processChanges();if(externalQueued){externalQueued=false;void checkExternal();}}
  }
  async function processChanges() {if(busy||composing)return;const root=project,refreshImages=imagesQueued;treeQueued=false;imagesQueued=false;try{await refreshTree();if(root!==project||busy||composing){treeQueued=true;imagesQueued ||= refreshImages;return;}if(refreshImages&&session){releaseImages();editor?.refreshImages();}if(refreshImages&&current?.kind==='image'){const target=current,key=documentKey;const result=await blobImage(target.path);if(current!==target||documentKey!==key){URL.revokeObjectURL(result.url);imageUrls.delete(result.url);}else{if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=result.url;imageDimensions=`${result.data.width} × ${result.data.height}`;}}await checkExternal();}catch(error){notify(failure(error).message);}}
  let settingsQueue=Promise.resolve();
  function persist() {if(!settingsLoaded)return settingsQueue;const snapshot=JSON.parse(JSON.stringify(settings));settingsQueue=settingsQueue.then(()=>invoke<void>('settings_save',{settings:snapshot})).catch(error=>notify('設定を保存できません: '+failure(error).message));return settingsQueue;}
  async function list(path:string) {const root=project;const entries=await invoke<Entry[]>('workspace_list',{path});if(root===project)tree={...tree,[path]:entries};}
  async function refreshTree() {const root=project;for(const path of expanded){try{await list(path);}catch{if(path==='')throw new Error('プロジェクトフォルダを読み込めません。');tree={...tree,[path]:[]};}}const entries=await invoke<Entry[]>('workspace_index');if(root===project)index=entries;}
  async function toggle(entry:Entry) {if(expanded.includes(entry.path))expanded=expanded.filter(path=>path!==entry.path);else{try{await list(entry.path);expanded=[...expanded,entry.path];}catch(error){notify(failure(error).message);}}}
  function releaseImages() {imageEpoch++;imageCache.clear();for(const url of imageUrls)URL.revokeObjectURL(url);imageUrls.clear();imageUrl='';}
  function clearDocument() {cancelSave();quickFocus=null;session=null;editor=null;current=null;initialText='';issue=null;status='saved';readonly=false;chars=0;contentError='';documentKey++;releaseImages();}
  async function blobImage(path:string,documentPath?:string) {const data=await invoke<ImageData>('image_read',{path,documentPath});const url=URL.createObjectURL(new Blob([new Uint8Array(data.data)],{type:data.mime}));imageUrls.add(url);return {url,data};}
  async function resolveImage(ref:string) {
    const epoch=imageEpoch, path=current?.path;if(!path)throw new Error('記事を開いてください。');
    const key=path+'\0'+ref, cached=imageCache.get(key);if(cached)return cached;
    const promise=blobImage(ref,path).then(result=>{if(epoch!==imageEpoch||path!==current?.path){URL.revokeObjectURL(result.url);imageUrls.delete(result.url);throw new Error('記事が切り替わりました。');}return result.url;});
    imageCache.set(key,promise);try{return await promise;}catch(error){if(imageCache.get(key)===promise)imageCache.delete(key);throw error;}
  }
  async function loadEntry(entry:Entry) {
    clearDocument();current=entry;selected=entry.path;
    try {
      if(entry.kind==='markdown') {
        const opened=await invoke<OpenedDocument>('document_open',{path:entry.path});
        initialText=opened.text;
        session=new EditSession(opened,(path,text,baseline)=>invoke('document_save',{path,text,baseline}),syncSession);syncSession();
      } else if(entry.kind==='image') {const result=await blobImage(entry.path);imageUrl=result.url;imageDimensions=`${result.data.width} × ${result.data.height}`;}
      else contentError=entry.kind==='symlink'?'シンボリックリンクは表示のみです。':'このファイル形式は編集対象外です。Markdown（2MiB以下）とPNG・JPEG・GIF・WebP画像（20MiB・1,600万画素以下）に対応しています。';
    } catch(error) {contentError=failure(error).message;}
    settings.lastFile=entry.path;settings.recentFiles=[entry.path,...settings.recentFiles.filter(path=>path!==entry.path)].slice(0,30);void persist();
    await tick();editor?.focus();
  }
  async function selectEntry(entry:Entry) {if(entry.kind==='directory'){selected=entry.path;await toggle(entry);return;}if(entry.path===current?.path)return;await operation(()=>loadEntry(entry));}
  async function chooseProject() {
    await operation(async()=>{const picked=await open({directory:true,multiple:false,title:'プロジェクトフォルダを開く'});if(typeof picked!=='string')return;await openProject(picked);});
  }
  async function openProject(path:string,restoreFile?:string|null) {
    const root=await invoke<string>('workspace_open',{path});clearDocument();project=root;tree={};expanded=[''];selected='';index=[];settings.lastProject=root;settings.lastFile=null;settings.recentFiles=[];
    await refreshTree();void persist();
    if(restoreFile){const entry=index.find(item=>item.path===restoreFile);if(entry){const parent=parentPath(entry.path);const folders=parent.split('/').filter(Boolean);let built='';for(const name of folders){built=built?built+'/'+name:name;await list(built);expanded=[...expanded,built];}await loadEntry(entry);}}
  }
  async function quickOpen() {
    if(!project||busy||errorDialog?.open||saveAsDialog?.open)return;
    const focus=document.activeElement as HTMLElement|null;
    try {
      const root=project,entries=await invoke<Entry[]>('workspace_index');
      if(root!==project||busy)return;
      index=entries;query='';quickIndex=0;quick=true;
      await tick();quickDialog.showModal();
      quickFocus=focus?.isConnected?focus:null;
      quickInput?.focus();
    } catch(error) {quickFocus=null;notify(failure(error).message);}
  }
  function closeQuick(restore=true) {const focus=quickFocus;quickFocus=null;quick=false;quickDialog.close();if(restore&&focus?.isConnected)focus.focus();}
  async function quickKey(event:KeyboardEvent) {if(event.key==='Escape'){event.preventDefault();closeQuick();}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();quickIndex=Math.max(0,Math.min(results.length-1,quickIndex+(event.key==='ArrowDown'?1:-1)));document.getElementById('quick-'+quickIndex)?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'&&results[quickIndex]){event.preventDefault();const entry=results[quickIndex];closeQuick(false);await selectEntry(entry);}}
  function selectedFolder() {const entry=rows.find(item=>item.path===selected);return entry?.kind==='directory'?entry.path:parentPath(selected);}
  async function startName(kind:'markdown'|'directory'|'rename',entry?:Entry) {if(busy)return;const parent=kind==='rename'?parentPath(entry!.path):selectedFolder();if(parent&&!expanded.includes(parent)){await list(parent);expanded=[...expanded,parent];}naming={kind,parent,entry,value:kind==='rename'?entry!.name:kind==='markdown'?'untitled.md':'新しいフォルダ',error:''};await tick();renameInput?.focus();renameInput?.select();}
  async function commitName() {
    if(!naming||busy)return;const request=naming;
    if(!request.value.trim()||/[\/\0]/.test(request.value)||['.','..'].includes(request.value)){naming={...request,error:'有効な名前を入力してください。'};return;}
    await operation(async()=>{
      try {
        if(request.kind==='rename') {
          const old=request.entry!.path;const entry=await invoke<Entry>('file_rename',{path:old,newName:request.value});
          if(current?.path===old&&entry.kind!==current.kind)await loadEntry(entry);else if(current&&containsPath(old,current.path)){current={...current,path:renamedPath(current.path,old,entry.path),name:request.entry!.kind==='directory'?current.name:entry.name};if(session)session.path=current.path;settings.lastFile=current.path;releaseImages();if(session)editor?.refreshImages();else if(current.kind==='image'){const preview=await blobImage(current.path);imageUrl=preview.url;imageDimensions=`${preview.data.width} × ${preview.data.height}`;}}
          settings.recentFiles=settings.recentFiles.map(path=>renamedPath(path,old,entry.path));expanded=expanded.map(path=>renamedPath(path,old,entry.path));selected=entry.path;notify('名前を変更しました。リンク・画像の参照は自動更新されません。');
        } else {
          let name=request.value;if(request.kind==='markdown'&&!/\.(md|markdown)$/i.test(name))name+='.md';const path=request.parent?request.parent+'/'+name:name;
          const entry=await invoke<Entry>('file_create',{path,kind:request.kind});selected=entry.path;if(entry.kind==='markdown')await loadEntry(entry);
        }
        naming=null;await refreshTree();void persist();
      } catch(error) {naming={...request,error:failure(error).message};}
    });
  }
  async function trash(entry:Entry) {await operation(async()=>{await invoke('file_trash',{path:entry.path});if(current&&containsPath(entry.path,current.path)){clearDocument();settings.lastFile=null;}settings.recentFiles=settings.recentFiles.filter(path=>!containsPath(entry.path,path));expanded=expanded.filter(path=>!containsPath(entry.path,path));selected='';await refreshTree();void persist();notify(`「${entry.name}」をゴミ箱へ移動しました。復元はFinderのゴミ箱から行えます。`);});}
  async function reveal(entry?:Entry) {try{await invoke('workspace_reveal',{path:entry?.path??''});}catch(error){notify(failure(error).message);}}
  async function contextMenu(event:MouseEvent,entry:Entry) {
    event.preventDefault();selected=entry.path;
    const menu=await Menu.new({items:[{id:'reveal',text:'Finderで表示',action:()=>void reveal(entry)},{id:'rename',text:'名前を変更（参照は更新しません）',enabled:entry.kind!=='symlink',action:()=>void startName('rename',entry)},{id:'trash',text:entry.kind==='directory'?'フォルダと配下をゴミ箱へ移動':'ゴミ箱へ移動',enabled:entry.kind!=='symlink',action:()=>void trash(entry)}]});
    try{await menu.popup();}finally{await menu.close();}
  }
  async function insertImage() {if(!session||session.readonly)return;await operation(async()=>{const picked=await open({multiple:false,title:'画像を挿入',filters:[{name:'画像',extensions:['png','jpg','jpeg','gif','webp']}]});if(typeof picked!=='string')return;const result=await invoke<{path:string;markdown:string}>('image_insert',{sourcePath:picked,documentPath:session!.path});editor?.insertText(result.markdown);await refreshTree();},false);}
  async function link(href:string) {try{if(/^https?:\/\//i.test(href)){await invoke('external_open',{url:href});return;}if(!current)return;const path=localLink(current.path,href);await selectEntry({path,name:path.split('/').at(-1)!,kind:'markdown'});}catch(error){notify(failure(error).message);}}
  async function showProblem() {
    const target=session;if(!target?.issue)return;issue=target.issue;disk=null;diskLabel='';
    if(issue.code==='CONFLICT'){try{const fresh=await invoke<OpenedDocument>('document_open',{path:target.path});if(session!==target||!target.issue)return;disk=fresh;diskLabel=fresh.text.slice(0,500);}catch{}}
    await tick();if(session!==target||!target.issue)return;if(!errorDialog.open)errorDialog.showModal();
  }
  async function reloadDisk() {
    const target=session;if(!target)return;
    try{if(!await confirm('編集中の内容を破棄して、最新のディスク内容を採用します。Undo履歴もリセットされます。',{title:'ディスク内容を採用',kind:'warning',okLabel:'採用する',cancelLabel:'キャンセル'}))return;const fresh=await invoke<OpenedDocument>('document_open',{path:target.path});if(session!==target)return;target.reload(fresh);editor?.replaceText(fresh.text);errorDialog.close();}
    catch(error){if(session===target)target.block(error);}
  }
  async function overwriteDisk() {
    const target=session, expected=disk?.baseline;if(!target||!expected)return;
    if(!await confirm('ディスク側の変更を失います。編集中の内容で上書きしますか？',{title:'編集内容で上書き',kind:'warning',okLabel:'上書きする',cancelLabel:'キャンセル'}))return;
    try{const fresh=await invoke<OpenedDocument>('document_open',{path:target.path});if(session!==target)return;if(fresh.baseline!==expected){disk=fresh;diskLabel=fresh.text.slice(0,500);notify('ディスクが再変更されました。最新内容を確認し、もう一度選択してください。');return;}session.baseline=fresh.baseline;session.retry();errorDialog.close();if(!await flush())await showProblem();}catch(error){if(session===target)target.block(error);}
  }
  async function retrySave() {if(!session)return;session.retry();errorDialog.close();await flush();}
  async function beginSaveAs() {if(!session)return;saveAsPath=session.path.replace(/\.(md|markdown)$/i,'-copy.md');saveAsError='';saveAs=true;await tick();saveAsDialog.showModal();saveAsInput.focus();saveAsInput.select();}
  async function commitSaveAs() {
    if(!session||busy)return;await settleComposition();if(!session||busy)return;busy=true;
    try {const text=session.text,gen=session.generation;const opened=await invoke<OpenedDocument>('document_save_as',{sourcePath:session.path,path:saveAsPath,text});session.path=opened.path;session.baseline=opened.baseline;session.savedGeneration=gen;session.issue=null;session.readonly=opened.readonly;current={path:opened.path,name:opened.path.split('/').at(-1)!,kind:'markdown'};selected=opened.path;releaseImages();editor?.refreshImages();settings.lastFile=opened.path;settings.recentFiles=[opened.path,...settings.recentFiles.filter(path=>path!==opened.path)].slice(0,30);syncSession();saveAsDialog.close();saveAs=false;errorDialog.close();await refreshTree();void persist();if(session.dirty)scheduleSave();notify('別名で保存しました。');}
    catch(error) {saveAsError=failure(error).message;}finally{busy=false;}
  }
  async function discardAndClose() {const target=session;if(!target)return;if(target.dirty&&!await confirm('未保存の編集内容を破棄して閉じます。',{title:'未保存内容を破棄',kind:'warning',okLabel:'破棄して閉じる',cancelLabel:'キャンセル'}))return;if(session!==target)return;clearDocument();settings.lastFile=null;errorDialog.close();void persist();}
  async function checkExternal() {
    if(busy||externalChecking||composing){externalQueued=true;return;}
    const target=session;if(!target)return;const baseline=target.baseline,generation=target.generation;externalChecking=true;
    try {if(target.isSaving){externalQueued=true;return;};const fresh=await invoke<OpenedDocument>('document_open',{path:target.path});if(session!==target||busy)return;if(composing){externalQueued=true;return;}if(target.isSaving||target.baseline!==baseline||target.generation!==generation){externalQueued=true;return;}if(fresh.baseline===target.baseline)return;if(target.dirty||target.issue){target.block({code:'CONFLICT',message:'ディスク側に変更があります。自動保存を停止しました。'});cancelSave();await showProblem();}else{target.reload(fresh);editor?.replaceText(fresh.text);notify('外部の変更を読み込みました。');}}
    catch(error){if(session===target&&!busy&&target.baseline===baseline&&target.generation===generation&&!target.isSaving){if(composing){externalQueued=true;return;}target.block(error);cancelSave();await showProblem();}}finally{externalChecking=false;if(externalQueued&&!busy&&!composing&&session?.status!=='saving'){externalQueued=false;setTimeout(()=>void checkExternal(),0);}}
  }
  async function quit() {await operation(async()=>{await persist();await settingsQueue;await invoke('app_exit');});}
  function keydown(event:KeyboardEvent) {
    if(quick){void quickKey(event);return;}
    if(errorDialog?.open||saveAsDialog?.open)return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='p'){event.preventDefault();void quickOpen();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void flush();}
    if(event.key==='Escape'&&naming)naming=null;
  }
  async function menuAction(action:string) {if(errorDialog?.open||saveAsDialog?.open||quick)return;if(action==='open-project')await chooseProject();else if(action==='new-markdown')await startName('markdown');else if(action==='new-folder')await startName('directory');else if(action==='image-insert')await insertImage();else if(action==='quick-open')await quickOpen();else if(action==='save')await flush();else if(action==='find')editor?.find();else if(action==='source')sourceMode=!sourceMode;else if(['bold','italic','strike','code','link'].includes(action))editor?.format(action as 'bold'|'italic'|'strike'|'code'|'link');}
  onMount(()=>{
    const unlisteners:Array<()=>void>=[];
    const focused=()=>void checkExternal();window.addEventListener('focus',focused);
    void (async()=>{
      if(!isTauri()){starting=false;contentError='Nagoriはデスクトップアプリです。npm run tauri dev で起動してください。';return;}
      try {
        unlisteners.push(await listen<{paths:string[];project:string}>('nagori:fs-changed',event=>{if(event.payload.project!==project)return;treeQueued=true;imagesQueued ||= event.payload.paths.some(path=>/\.(png|jpe?g|gif|webp)$/i.test(path));clearTimeout(fsTimer);fsTimer=setTimeout(()=>void processChanges(),150);}));
        unlisteners.push(await listen<string>('nagori:fs-error',event=>notify('ファイル監視のエラー: '+event.payload)));
        unlisteners.push(await listen('nagori:quit-requested',()=>void quit()));
        unlisteners.push(await listen<{action:string}>('nagori:menu',event=>void menuAction(event.payload.action)));
        const saved=await invoke<Settings>('settings_get');
        settings=startupSettings(saved,()=>window.matchMedia('(prefers-color-scheme: dark)').matches);settingsLoaded=true;
        if(settings.theme!==saved.theme||settings.fontSize!==saved.fontSize||settings.appearanceVersion!==saved.appearanceVersion)await persist();
        if(settings.lastProject){const recent=settings.recentFiles, last=settings.lastFile;try{await openProject(settings.lastProject,last);settings.recentFiles=[...new Set([...(settings.lastFile?[settings.lastFile]:[]),...recent])];void persist();}catch(error){project='';notify('前回のプロジェクトを開けません: '+failure(error).message);}}
      }catch(error){notify(failure(error).message);}finally{starting=false;performance.mark('nagori-ready');}
    })();
    return ()=>{unlisteners.forEach(unlisten=>unlisten());window.removeEventListener('focus',focused);cancelSave();clearTimeout(fsTimer);releaseImages();};
  });
</script>

<svelte:window onkeydown={keydown}/>
<div class="app-shell" class:working={busy} class:sidebar-hidden={!sidebarVisible}>
  <header class="global-bar">
    <div class="brand">
      <img class="brand-icon" src={nagoriIcon} alt="" width="36" height="36"/>
      <img class="brand-wordmark brand-wordmark-light" src={nagoriWordmark} alt="Nagori" width="108" height="36"/>
      <img class="brand-wordmark brand-wordmark-dark" src={nagoriWordmarkDark} alt="Nagori" width="108" height="36"/>
    </div>
    <button class="quick-button" onclick={()=>void quickOpen()} disabled={!project||busy} aria-label="ファイル名・パスで検索"><Icon name="search"/> <span>ファイル名・パスで検索…</span><kbd>⌘ P</kbd></button>
    <div class="global-actions">
      <span class="status" class:problem={!!issue} aria-live="polite">{#if session}<span class="status-dot" class:unsaved={status==='dirty'||status==='saving'} aria-hidden="true"></span>{readonly?'読み取り専用':labels[status]}{#if issue}<button onclick={()=>void showProblem()}>対応する</button>{/if}{:else}<span class="local-label">ローカルのMarkdown</span>{/if}</span>
      <button class="icon-button" disabled={starting||!settingsLoaded} aria-label={settings.theme==='dark'?'ライトモードに切り替える':'ダークモードに切り替える'} title={settings.theme==='dark'?'ライトモードに切り替える':'ダークモードに切り替える'} onclick={()=>{settings.theme=nextTheme(settings.theme);void persist();}}><Icon name={settings.theme==='dark'?'moon':'sun'}/></button>
      <button class="icon-button" aria-label={sidebarVisible?'サイドバーを隠す':'サイドバーを表示'} title={sidebarVisible?'サイドバーを隠す':'サイドバーを表示'} aria-controls="file-sidebar" aria-expanded={sidebarVisible} onclick={()=>sidebarVisible=!sidebarVisible}><Icon name="sidebar"/></button>
    </div>
  </header>
  <aside id="file-sidebar" class="sidebar" aria-label="ファイルと設定" hidden={!sidebarVisible}>
    <div class="workspace-heading"><span title={project}>{project?projectName:'WORKSPACE'}</span><div class="tree-actions"><button aria-label="記事を作成" title="記事を作成" disabled={!project||busy} onclick={()=>void startName('markdown')}><Icon name="plus" size={17}/></button><button aria-label="フォルダを作成" title="フォルダを作成" disabled={!project||busy} onclick={()=>void startName('directory')}><Icon name="folder-plus" size={17}/></button></div></div>
    <nav class="file-tree" aria-label="プロジェクト内のファイル">
      {#if !project}<p class="tree-empty">フォルダを開くと、<br/>記事がここに並びます。</p>{/if}
      {#if naming && naming.kind!=='rename'}<form class="inline-name new-name" onsubmit={(event)=>{event.preventDefault();void commitName();}}><small>{naming.parent||'プロジェクト直下'}に{naming.kind==='markdown'?'記事':'フォルダ'}を作成</small><input aria-label="新しい名前" bind:this={renameInput} bind:value={naming.value} onkeydown={(event)=>{if(event.key==='Escape')naming=null;}}/><button type="submit" disabled={busy}>作成</button>{#if naming.error}<small class="error-text">{naming.error}</small>{/if}</form>{/if}
      {#each rows as row (row.path)}
        {#if naming?.kind==='rename'&&naming.entry?.path===row.path}
          <form class="inline-name" style:padding-left={`${12+row.depth*16}px`} onsubmit={(event)=>{event.preventDefault();void commitName();}}><input aria-label="名前を変更" bind:this={renameInput} bind:value={naming.value}/><button type="submit" disabled={busy}>↵</button>{#if naming.error}<small class="error-text">{naming.error}</small>{/if}</form>
        {:else}
          <button class="tree-row" class:active={current?.path===row.path} class:selected={selected===row.path} style:padding-left={`${12+row.depth*16}px`} title={row.path} disabled={busy} onclick={()=>void selectEntry(row)} oncontextmenu={(event)=>void contextMenu(event,row)} onkeydown={(event)=>{if(event.key==='F2'){event.preventDefault();if(row.kind!=='symlink')void startName('rename',row);}else if(event.shiftKey&&event.key==='F10'){event.preventDefault();void contextMenu(event as unknown as MouseEvent,row);}else if((event.key==='Backspace'||event.key==='Delete')&&event.metaKey&&row.kind!=='symlink'){event.preventDefault();void trash(row);}else if(row.kind==='directory'&&event.key==='ArrowRight'&&!expanded.includes(row.path)){event.preventDefault();void toggle(row);}else if(row.kind==='directory'&&event.key==='ArrowLeft'&&expanded.includes(row.path)){event.preventDefault();void toggle(row);}}}><span class="file-icon" class:folder={row.kind==='directory'}>{#if row.kind==='directory'}<span class="tree-chevron"><Icon name={expanded.includes(row.path)?'down':'right'} size={12}/></span><Icon name={expanded.includes(row.path)?'folder-open':'folder'}/>{:else}<Icon name={row.kind==='image'?'image':row.kind==='symlink'?'external':'file'}/>{/if}</span><span class="file-name">{row.name}</span>{#if current?.path===row.path}<span class="active-dot" aria-hidden="true"></span>{/if}</button>
        {/if}
      {/each}
      {#if project && !rows.length}<p class="tree-empty">まだファイルがありません。<br/>＋ から最初の記事を。</p>{/if}
    </nav>
    <div class="sidebar-bottom"><button class="open-folder" onclick={()=>void chooseProject()} disabled={busy||starting}><Icon name="folder-open" size={17}/>{project?'別のフォルダを開く':'フォルダを開く'}</button><details class="settings"><summary>本文の表示設定 <Icon name="settings" size={16}/></summary><label>本文サイズ <output>{settings.fontSize}px</output><input type="range" min="12" max="32" step="1" disabled={starting||!settingsLoaded} bind:value={settings.fontSize} onchange={()=>void persist()}/></label></details><div class="sidebar-note">WRITE · EDIT · STAY WITH YOUR IDEAS</div></div>
  </aside>
  <main>
    <header class="editor-header"><div class="breadcrumb"><Icon name={current?.kind==='image'?'image':'file'} size={17}/><span>{project?projectName:'Nagori'}</span>{#if current}<span class="slash">/</span><strong title={current.path}>{current.path}</strong>{/if}</div><div class="header-actions">{#if current?.kind==='markdown'&&session}<button class="mode-toggle" aria-pressed={sourceMode} title="表示の切り替え" onclick={()=>sourceMode=!sourceMode}>{sourceMode?'ソース':'Live Preview'}</button><details class="document-menu"><summary aria-label="記事の操作" title="記事の操作"><Icon name="more"/></summary><div class="menu-popover"><button disabled={readonly||busy} onclick={()=>void insertImage()}>画像を挿入…</button><button onclick={()=>editor?.find()}>記事内を検索 <kbd>⌘ F</kbd></button><button onclick={()=>void flush()}>保存 <kbd>⌘ S</kbd></button><hr/><button onclick={()=>editor?.format('bold')} disabled={readonly}>太字 <kbd>⌘ B</kbd></button><button onclick={()=>editor?.format('italic')} disabled={readonly}>斜体 <kbd>⌘ I</kbd></button><button onclick={()=>editor?.format('strike')} disabled={readonly}>取り消し線</button><button onclick={()=>editor?.format('code')} disabled={readonly}>インラインコード</button><button onclick={()=>editor?.format('link')} disabled={readonly}>リンク <kbd>⌘ K</kbd></button></div></details>{/if}</div></header>
    <section class="content" aria-label="記事の編集とプレビュー">
      {#if starting}<div class="empty-state"><span class="welcome-mark"><Icon name="file" size={44}/></span><p>書く場所を、準備しています。</p></div>
      {:else if contentError}<div class="empty-state"><span class="state-icon"><Icon name="file" size={42}/></span><h1>{current?.name??'Nagori'}</h1><p>{contentError}</p>{#if project}<button onclick={()=>void reveal(current??undefined)}>Finderで表示</button>{/if}</div>
      {:else if current?.kind==='markdown'&&session}<Editor {initialText} {documentKey} readonly={readonly||busy} {sourceMode} fontSize={settings.fontSize} onChange={changed} onComposition={composition} onSave={()=>void flush()} onLink={(href)=>void link(href)} {resolveImage} onReady={(api)=>editor=api}/>
      {:else if current?.kind==='image'}<div class="image-preview"><img src={imageUrl} alt={current.name}/><p>{current.name}<span>{imageDimensions}</span></p></div>
      {:else}<div class="empty-state welcome"><span class="welcome-mark"><Icon name="file" size={44}/></span><div class="eyebrow">A LITTLE SPACE TO WRITE</div><h1>言葉の、居場所。</h1><p>{project?'左のファイルを選ぶか、最初の記事を作ってみましょう。':'いつものフォルダで、思考をほどく。\nMarkdownを書くための、静かな場所。'}</p><button class="primary" onclick={()=>project?void startName('markdown'):void chooseProject()} disabled={busy}>{project?'＋ 新しい記事':'フォルダを開く'}</button><small>{project?'⌘ P で、記事をすばやく探せます。':'Markdown · ローカル保存 · macOS'}</small></div>{/if}
    </section>
    <footer><span>{current?.kind==='image'?'画像プレビュー':'あなたのファイルは、このMacに。'}</span><span>{session?`${chars.toLocaleString()} 文字　 ·　 Markdown`:'Nagori 0.1'}</span></footer>
  </main>
</div>
{#if notice}<div class="toast" role="status">{notice}<button aria-label="通知を閉じる" onclick={()=>notice=''}><Icon name="close" size={15}/></button></div>{/if}
<dialog class="quick-panel" bind:this={quickDialog} oncancel={(event)=>{event.preventDefault();closeQuick();}} aria-label="Quick Open"><div class="quick-input"><Icon name="search" size={20}/><input bind:this={quickInput} bind:value={query} oninput={()=>quickIndex=0} placeholder="ファイル名やパスで検索…" aria-label="ファイルを検索"/><kbd>esc</kbd></div><div class="quick-label">{query?'検索結果':'最近開いたファイル'}</div><div class="quick-results">{#each results as entry,i}<button id={'quick-'+i} class:highlighted={i===quickIndex} onclick={()=>{closeQuick(false);void selectEntry(entry);}}><span class="file-icon"><Icon name={entry.kind==='markdown'?'file':'image'}/></span><span><strong>{entry.name}</strong><small>{entry.path}</small></span>{#if i===quickIndex}<kbd>↵</kbd>{/if}</button>{/each}{#if !results.length}<p>{query?'一致するファイルがありません。':'最近開いたファイルはありません。名前を入力して検索できます。'}</p>{/if}</div><div class="quick-hint">↑ ↓ 選択　 ↵ 開く <span>プロジェクト内のMarkdownと画像</span></div></dialog>
<dialog class="error-dialog" bind:this={errorDialog} onclose={()=>editor?.focus()}><h2>{issue?.code==='CONFLICT'?'外部の変更と競合しています':issue?.code==='MISSING'?'ファイルが見つかりません':'保存できませんでした'}</h2><p>{issue?.message}</p><p class="muted">編集中の内容は、この画面に保持しています。</p>{#if diskLabel}<details><summary>ディスク側の最新内容（先頭部分）</summary><pre>{diskLabel}</pre></details>{/if}<div class="dialog-actions">{#if issue?.code==='CONFLICT'}<button onclick={()=>void reloadDisk()}>ディスク内容を採用</button><button class="danger" disabled={!disk} onclick={()=>void overwriteDisk()}>編集内容で上書き</button>{:else if issue?.code!=='MISSING'}<button onclick={()=>void retrySave()}>再試行</button>{/if}<button class="primary" onclick={()=>void beginSaveAs()}>別名保存…</button><button onclick={()=>void discardAndClose()}>記事を閉じる…</button><button onclick={()=>errorDialog.close()}>あとで対応</button></div></dialog>
<dialog class="save-as-dialog" bind:this={saveAsDialog} onclose={()=>saveAs=false}><form onsubmit={(event)=>{event.preventDefault();void commitSaveAs();}}><h2>別名で保存</h2><p>プロジェクト内の相対パスを入力してください。既存ファイルは上書きしません。</p><input aria-label="保存先の相対パス" bind:this={saveAsInput} bind:value={saveAsPath}/>{#if saveAsError}<p class="error-text">{saveAsError}</p>{/if}<div class="dialog-actions"><button type="button" onclick={()=>saveAsDialog.close()}>キャンセル</button><button class="primary" type="submit" disabled={busy}>保存</button></div></form></dialog>
