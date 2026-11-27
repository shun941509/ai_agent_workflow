'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BookOpen, ChevronRight, Database, FileText, FolderSearch, LockKeyhole, Plus, Search, Trash2, Unplug } from 'lucide-react';
import TrashList, { type TrashEntry } from './TrashList';
import StudioDialog from './StudioDialog';
import {intentHash,StudioApiError} from './client';
import {clearConflictDraft,conflictEntry,readConflictDraft,writeConflictDraft,type ResourceFile as FileEntry,type ResourcePayload as Payload} from './resource-conflict-draft';
import {useResourceLeave, type ResourceLeaveGuard} from './use-resource-leave';
import {rememberResourceList,rememberResourceViewport,resourceListKey,resourceListPosition,type ResourceKind as Kind,type ResourceListPosition,type ResourceRoute} from './resource-navigation';
import './ResourceLibrary.css';
import type {MaterialLesson} from '../domain/optional-lesson-materials';
import {assetNumber, duplicateAssetNames} from './resource-labels';
import {useCopyField, type CopyResult} from './use-copy-field';

type Visibility='private'|'link'|'public';
export interface AssetItem {id:string;name:string;kind:Kind;visibility:Visibility;version:number;mine:boolean;revision?:number;token?:string;publicVersion?:number;releasedVersions?:number[];exampleLesson?:MaterialLesson}
export type TrashedAsset = TrashEntry & Pick<AssetItem, 'name' | 'kind' | 'version'> & {exampleLesson?:MaterialLesson|null};
interface ResourceDetail {asset:AssetItem;version:number;payload:Payload;receivedAsset?:AssetItem}
interface SkillImport {
  files:FileEntry[]; content:string; main:string; name:string; removed:string[]; overwrite:boolean;
  changed:string[]; replace:string[];
}
interface Props {
  assets:AssetItem[]; onChange:()=>Promise<void>; api:(action:string,data?:any)=>Promise<any>;
  sharedCatalog?:boolean;
  onConnect?:(asset:AssetItem, version:number)=>void;
  onOpenCopy?:(asset:AssetItem)=>void;
  folderLink:ReactNode; onDeleted:(item:AssetItem)=>void;
  onRoute:(route:ResourceRoute,replace?:boolean)=>void;
  onReceive:(item:AssetItem)=>void;
  leaveGuard:RefObject<ResourceLeaveGuard|null>;
  searchRef?:RefObject<HTMLInputElement|null>;
  initial?:string|null; initialVersion?:string; token?:string|null; isAdmin?:boolean;
}
const labels:Record<Kind,string>={document:'참고 자료',knowledge:'지식 저장소',skill:'Skill',mcp:'MCP 연결'};
const scopes:Record<Visibility,string>={private:'나만 사용',link:'비밀 링크',public:'모두에게 공개'};
const catalogScopes=[['public','모두에게 공개'],['shared','직접 받은 자료']] as const;
const libraryScopes=[['all','전체'],['mine','내 자료'],['shared','직접 받은 자료'],['public','모두에게 공개']] as const;
const kindDescriptions:Record<Kind,string>={
  document:'Agent가 답변의 근거로 읽을 원문',knowledge:'질문에 맞는 원문을 검색할 자료집',
  skill:'작업 방법을 기록한 SKILL.md와 부속 파일',mcp:'허용한 도구를 제공하는 서버 연결',
};
const kindIcons={document:FileText,knowledge:Database,skill:BookOpen,mcp:Unplug};
function KindIcon({kind}:{kind:Kind}) {
  const Icon=kindIcons[kind];
  return <span className={'rl-icon '+kind} aria-hidden="true"><Icon size={19}/></span>;
}
const limit=5_000_000;
function b64(bytes:Uint8Array) {
  if(typeof bytes.toBase64==='function')return bytes.toBase64();
  let s='';
  for(let i=0;i<bytes.length;i+=16000) s+=String.fromCharCode(...bytes.subarray(i,i+16000));
  return btoa(s);
}
function bytes(data:string) {
  if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(data);
  const binary=atob(data),decoded=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)decoded[i]=binary.charCodeAt(i);
  return decoded;
}
function pathKey(path:string){return path.normalize('NFC').toLowerCase();}
function cleanBundle(entries:FileEntry[]) {
  const main=entries.filter(f=>/(^|\/)SKILL\.md$/i.test(f.path)).sort((a,b)=>a.path.length-b.path.length)[0];
  if(!main)throw new Error('가져올 폴더에 SKILL.md가 필요합니다.');
  const prefix=main.path.slice(0,main.path.lastIndexOf('/')+1);
  const seen=new Set<string>();
  return entries.map(entry=>{
    if(!entry.path.startsWith(prefix))throw new Error('모든 부속 파일을 SKILL.md가 있는 폴더 안에 넣어 주세요.');
    const path=entry.path.slice(prefix.length);
    if(path.includes('\\')||path.includes(':')||path.split('/').some(p=>!p||p==='..'||p==='.')||seen.has(pathKey(path)))throw new Error('파일 경로나 중복된 파일을 확인하세요.');
    seen.add(pathKey(path));return {...entry,path};
  });
}
async function importFiles(files:File[],mode:'md'|'folder'|'zip') {
  if(!files.length) return [];
  if(files.length>128||files.reduce((n,f)=>n+f.size,0)>limit) throw new Error('Skill은 파일 128개, 5MB까지 등록할 수 있습니다.');
  if(mode==='zip') {
    let size=0,count=0;const paths=new Set<string>();
    const entries=unzipSync(new Uint8Array(await files[0].arrayBuffer()),{filter(f){
      if(f.name.endsWith('/'))return false;
      const name=pathKey(f.name);if(paths.has(name))throw new Error('ZIP에 중복된 파일이 있습니다.');paths.add(name);
      size+=f.originalSize;count++;if(size>limit||count>128)throw new Error('압축을 풀면 파일 또는 용량 한도를 넘습니다.');
      return true;
    }});
    return cleanBundle(Object.entries(entries).map(([path,data])=>({path,data:b64(data)})));
  }
  return cleanBundle(await Promise.all(files.map(async f=>({
    path:mode==='md'?'SKILL.md':f.webkitRelativePath||f.name,data:b64(new Uint8Array(await f.arrayBuffer())),
  }))));
}
function download(fileName:string,raw:Uint8Array,mime:string){
  const copy=new Uint8Array(raw);const url=URL.createObjectURL(new Blob([copy.buffer],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
function exportBundle(entries:FileEntry[],name:string){
  const dictionary:Record<string,Uint8Array>=Object.create(null);
  for(const item of entries)dictionary[item.path]=bytes(item.data);
  download(name.replace(/[\\/:*?"<>|]/g,'-')+'.zip',zipSync(dictionary),'application/zip');
}
function fileSize(data:string){return Math.floor(data.replace(/=+$/,'').length*3/4);}
function checkBundleSize(files:FileEntry[]){
  if(files.length>128||files.reduce((total,file)=>total+fileSize(file.data),0)>limit)
    throw new Error('SKILL.md와 부속 파일을 합쳐 128개, 5MB까지 등록할 수 있습니다.');
}
// Only a digest and a key are kept in this entry, so a lost response can be retried after a reload.
async function assetRequestKey(inputs:unknown[]){
  const fingerprint=await intentHash(inputs);
  const previous=window.history.state?.assetCreation;
  if(previous?.fingerprint===fingerprint)return previous.key as string;
  const key=crypto.randomUUID();
  window.history.replaceState({...window.history.state,assetCreation:{fingerprint,key}},'');
  return key;
}
function finishAssetRequest(requestKey:string){
  if(!requestKey||window.history.state?.assetCreation?.key!==requestKey)return;
  const state={...window.history.state};delete state.assetCreation;
  window.history.replaceState(state,'');
}
function previewText(file:FileEntry){
  if(fileSize(file.data)>300_000)return null;
  const data=bytes(file.data);if(data.includes(0))return null;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return null;}
}
function SourcePreview({body,code=false,label='원문 내용'}:{body:string;code?:boolean;label?:string}){
  const source=useRef<HTMLPreElement>(null);
  const [scrollable,setScrollable]=useState(false);
  useLayoutEffect(()=>{
    const element=source.current!;
    const measure=()=>setScrollable(element.scrollHeight>element.clientHeight);
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(element);
    return ()=>observer.disconnect();
  },[body]);
  const tokens=code?body.split(/(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|from|const|def|function|return|let|class|if|else|async|await|true|false|None|null)\b)/g):null;
  return <pre ref={source} className="rl-source" tabIndex={scrollable?0:undefined} role={scrollable?'region':undefined} aria-label={scrollable?label:undefined}>{tokens?
    <code>{tokens.map((s,i)=>i%2?<span key={i} className={s.startsWith('//')||s.startsWith('#')?'rl-comment':'rl-keyword'}>{s}</span>:s)}</code>:body}</pre>;
}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="rl-field"><span>{label}</span>{children}</label>;}
function ResourceCopyField({label, value, identifierLabel, copy, notify}:{
  label:string; value:string; identifierLabel?:string; copy:ReturnType<typeof useCopyField>; notify:(message:string)=>void;
}) {
  const input=useRef<HTMLInputElement>(null);
  function report(result:CopyResult) {
    if(result==='copied') notify((identifierLabel??label)+'를 복사했습니다.');
    else if(result==='selected') notify(identifierLabel?'선택된 도구 식별자를 복사하세요.':'선택된 주소를 복사하세요.');
    else notify(identifierLabel?'도구 식별자를 선택해 복사하세요.':label+' 입력란에서 직접 복사하세요.');
  }
  return <div className={identifierLabel?'rl-actions':'rl-actions rl-share-address'}>
    <Field label={label}><input ref={input} aria-label={identifierLabel} readOnly value={value} onFocus={event=>event.currentTarget.select()}/></Field>
    <button type="button" aria-label={identifierLabel?undefined:label+' 복사'}
      onClick={event=>void copy(input.current,event.currentTarget,report)}>{identifierLabel?'식별자 복사':'주소 복사'}</button>
  </div>;
}
function message(e:unknown){return e instanceof Error?e.message:'요청을 처리하지 못했습니다.';}
function names(input:string){return [...new Set(input.split(/[,\n]/).map(s=>s.trim()).filter(Boolean))];}
function blank(kind:Kind):Payload {return kind==='mcp'?{content:'',url:'',tools:[],readOnlyTools:[]}:{content:'',files:kind==='skill'?[]:undefined};}

function draftKey(kind:Kind) { return kind==='knowledge'?'document':kind; }
function changedPayload(draft:Payload, original?:Payload) {
  const textFields=['content','url','testUrl','credentialEnv'] as const;
  if (textFields.some(field=>(draft[field]??'')!==(original?.[field]??''))) return true;
  if (!!draft.requiresScripts !== !!original?.requiresScripts) return true;
  const files=draft.files??[], previous=original?.files??[];
  return files.length!==previous.length || files.some((f,i)=>f.path!==previous[i].path || f.data!==previous[i].data);
}

function replaceMainFile(files:FileEntry[],data:string):FileEntry[] {
  const main=files.find(f=>f.path.toLowerCase()==='skill.md');
  return main?files.map(f=>f===main?{...f,data}:f):[{path:'SKILL.md',data},...files];
}

function ComparisonSide({title,name,kind,payload}:{title:string;name:string;kind:Kind;payload:Payload}) {
  const fields=kind==='mcp'?[
    ['MCP 서버 주소',payload.url],['시험용 서버 주소',payload.testUrl],['허용 도구',payload.tools?.join(', ')],
    ['조회 전용 도구',payload.readOnlyTools?.join(', ')],['자격증명 환경변수',payload.credentialEnv],
  ]:[];
  return <section><h3>{title}</h3><p>{name}</p>{kind==='mcp'?
    <dl>{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'없음'}</dd></div>)}</dl>:
    <SourcePreview body={payload.content} label={title+' 원문'}/>}
    {kind==='skill'&&<p>필수 스크립트 · {payload.requiresScripts?'있음':'없음'}</p>}
  </section>;
}

function compareAttachments(draft:Payload,latest:Payload) {
  const entries=(p:Payload)=>new Map((p.files??[]).filter(f=>f.path.toLowerCase()!=='skill.md').map(f=>[f.path,f.data]));
  const mine=entries(draft),current=entries(latest);
  return Array.from(new Set([...mine.keys(),...current.keys()])).filter(path=>mine.get(path)!==current.get(path))
    .map(path=>({path,status:!mine.has(path)?'최신판에만 있음':!current.has(path)?'내 초안에만 있음':'파일 내용이 다름'}));
}

export function AssetTrash({folderLink, onRestore}: {
  folderLink:ReactNode; onRestore:(item:TrashedAsset)=>Promise<void>;
}) {
  return <section aria-label="자료 휴지통">
    <div className="section-heading first">
      <h1>휴지통</h1>
      <div className="project-folder-actions">{folderLink}</div>
    </div>
    <TrashList scope="asset" titleOf={item=>item.name} subtitleOf={item=>`${labels[item.kind]} · ${item.version}판 · ${item.exampleLesson ? '실습 예제 · ' : ''}자료 번호 ${assetNumber(item.id)}`}
      onRestore={onRestore}/>
  </section>;
}

export default function ResourceLibrary({assets,onChange,api,initial,initialVersion,token,isAdmin,folderLink,onDeleted,onRoute,searchRef,onReceive,leaveGuard,sharedCatalog=false,onConnect,onOpenCopy}:Props) {
  const [filters,setFilters]=useState(resourceListPosition);
  const {kind:kindFilter,query}=filters;
  const scope=sharedCatalog && filters.scope!=='shared'?'public':filters.scope;
  const sectionTitle=sharedCatalog?'공유 도구 및 자료':'도구 및 자료';
  const library=useRef<HTMLElement>(null);
  const [mode,setMode]=useState<'list'|'view'|'create'|'edit'|'loading'>(initial?'loading':'list');
  const heading=useRef<HTMLHeadingElement>(null);
  const [detail,setDetail]=useState<ResourceDetail|null>(null);
  const [kind,setKind]=useState<Kind>('document'),[name,setName]=useState(''),[payload,setPayload]=useState<Payload>(blank('document'));
  const kindDrafts=useRef<Partial<Record<Kind,Payload>>>({});
  const [selectedFile,setSelectedFile]=useState('SKILL.md');
  const [visible,setVisible]=useState<Visibility>('private');
  const keepEditing=useRef<HTMLButtonElement>(null);
  const lastDraftField=useRef<HTMLElement|null>(null);
  const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[notice,setNotice]=useState('');
  const copyField=useCopyField(mode==='view'&&!busy?detail:null);
  const [toolsText,setToolsText]=useState(''),[readOnlyText,setReadOnlyText]=useState('');
  const [pendingImport,setPendingImport]=useState<SkillImport|null>(null);
  const [conflictKey,setConflictKey]=useState<string>();
  const [latest,setLatest]=useState<ResourceDetail|null>(null);
  const [backupError,setBackupError]=useState(false);
  const importCancel=useRef<HTMLButtonElement>(null);
  const editMode=mode==='create'||mode==='edit';
  const original=mode==='edit'?detail:null;
  const dirty=editMode && (name!==(original?.asset.name??'') || changedPayload(payload,original?.payload)
    || toolsText!==(original?.payload.tools??[]).join('\n') || readOnlyText!==(original?.payload.readOnlyTools??[]).join('\n')
    || mode==='create' && Object.entries(kindDrafts.current).some(([key,draft])=>key!==draftKey(kind)&&changedPayload(draft)));
  const leave=useResourceLeave(dirty || !!conflictKey, leaveGuard, () => {
    clearConflict();
    if(detail)show(detail);else resetList();
  });
  function clearConflict() {
    if(conflictKey)void clearConflictDraft(conflictKey).catch(()=>{});
    setConflictKey(undefined);setLatest(null);setBackupError(false);
  }
  useEffect(()=>{
    if(!conflictKey||!detail||mode!=='edit')return;
    let active=true;
    void writeConflictDraft(conflictKey,{id:detail.asset.id,baseVersion:detail.version,name,payload,toolsText,readOnlyText})
      .then(()=>{if(active)setBackupError(false);}).catch(()=>{if(active)setBackupError(true);});
    return ()=>{active=false;};
  },[conflictKey,detail,mode,name,payload,toolsText,readOnlyText]);
  function continueEditing() {
    leave.keep();
    requestAnimationFrame(()=>{if(lastDraftField.current?.isConnected)lastDraftField.current.focus();});
  }
  const actions=useRef({api,onChange,onReceive}); actions.current={api,onChange,onReceive};
  const requestNumber=useRef(0);
  const receipt=useRef<{id:string;edition:string;notice:string}|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<AssetItem|null>(null);
  const [impact,setImpact]=useState<{projectTitles:string[]}|null>(null);
  const [impactError,setImpactError]=useState('');
  const [deleteError,setDeleteError]=useState('');
  const deleting=useRef(false);
  const deleteTrigger=useRef<HTMLButtonElement>(null);
  const localSearch=useRef<HTMLInputElement>(null),cancelButton=useRef<HTMLButtonElement>(null);
  const searchInput=searchRef??localSearch;
  const folderPicker=useRef<HTMLInputElement>(null),mdPicker=useRef<HTMLInputElement>(null),zipPicker=useRef<HTMLInputElement>(null);
  useLayoutEffect(()=>{
    if(mode!=='list' && mode!=='loading' && document.activeElement===document.body)heading.current?.focus();
  },[mode]);
  function filterList(change:Partial<ResourceListPosition>){
    const next={...resourceListPosition(),...change,scrollY:window.scrollY};
    setFilters(next);
    rememberResourceList(next);
  }
  function switchCatalogTab(event:KeyboardEvent<HTMLDivElement>){
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    let next:'public'|'shared';
    switch(event.key){
      case 'Home':next='public';break;
      case 'End':next='shared';break;
      case 'ArrowLeft':case 'ArrowRight':next=scope==='shared'?'public':'shared';break;
      default:return;
    }
    event.preventDefault();
    event.currentTarget.querySelector<HTMLButtonElement>('[data-resource-return="scope-'+next+'"]')?.focus();
    filterList({scope:next,focus:'scope-'+next});
  }
  useLayoutEffect(()=>{
    if(initial||mode!=='list')return;
    const element=library.current;
    const key=resourceListKey();
    const address=window.location.href;
    const position=resourceListPosition();
    setFilters(position);
    let ready=false;
    let lastFocus=position.focus;
    let timer:ReturnType<typeof setTimeout>|undefined;
    function saveViewport() {
      if(!ready)return;
      const active=document.activeElement?.closest<HTMLElement>('[data-resource-return],.project-folder-link');
      if(active&&element?.contains(active))lastFocus=active.dataset.resourceReturn??'trash';
      rememberResourceViewport(key,{focus:lastFocus,scrollY:window.scrollY});
    }
    function afterScroll() {
      if(timer)return;
      timer=setTimeout(()=>{
        timer=undefined;
        if(window.location.href===address)saveViewport();
      },180);
    }
    const frame=requestAnimationFrame(()=>{
      const saved=resourceListPosition();
      const focus=saved.focus;
      if(focus){
        const target=focus==='trash'?library.current?.querySelector<HTMLElement>('.project-folder-link'):
          library.current?.querySelector<HTMLElement>('[data-resource-return="'+CSS.escape(focus)+'"]');
        (target??searchInput.current)?.focus({preventScroll:true});
      }
      window.scrollTo({top:saved.scrollY,behavior:'instant'});
      ready=true;
    });
    element?.addEventListener('focusin',saveViewport);
    window.addEventListener('scroll',afterScroll,{passive:true});
    window.addEventListener('scrollend',saveViewport);
    window.addEventListener('popstate',saveViewport,true);
    window.addEventListener('pagehide',saveViewport);
    return ()=>{
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      element?.removeEventListener('focusin',saveViewport);
      window.removeEventListener('scroll',afterScroll);
      window.removeEventListener('scrollend',saveViewport);
      window.removeEventListener('popstate',saveViewport,true);
      window.removeEventListener('pagehide',saveViewport);
    };
  },[initial,mode,searchInput]);
  useEffect(()=>{
    if (!deleteTarget) return;
    let current=true;
    actions.current.api('asset.deleteImpact',{id:deleteTarget.id})
      .then(result=>{if(current)setImpact(result);})
      .catch(error=>{if(current)setImpactError(message(error));});
    return ()=>{current=false;};
  },[deleteTarget]);
  useEffect(()=>{folderPicker.current?.setAttribute('webkitdirectory','');},[mode,kind]);
  function show(value:ResourceDetail){
    setLatest(null);setConflictKey(undefined);setPendingImport(null);setBackupError(false);
    setDetail(value);setKind(value.asset.kind);setName(value.asset.name);setPayload(value.payload);
    setSelectedFile(value.payload.files?.find(f=>f.path.toLowerCase()==='skill.md')?.path??'SKILL.md');
    setVisible(value.asset.visibility);setMode('view');
  }
  async function readDetail(id:string,version?:string,sharedToken?:string|null) {
    const seq=++requestNumber.current;setBusy(true);setErr('');setNotice('');
    try {
      const result:ResourceDetail=await actions.current.api('asset.read',{
        id,version:version??(sharedCatalog?'published':undefined),token:sharedToken??undefined,sharedCatalog
      });
      if(seq!==requestNumber.current)return;
      if(result.receivedAsset)actions.current.onReceive(result.receivedAsset);
      const key=!sharedCatalog&&result.asset.mine?conflictEntry(id):undefined;
      const draft=key?await readConflictDraft(key).catch(()=>undefined):undefined;
      if(seq!==requestNumber.current)return;
      if(key && draft?.id===id && (!version || version===String(draft.baseVersion))) {
        const base:ResourceDetail=result.version===draft.baseVersion?result:await actions.current.api('asset.read',{id,version:draft.baseVersion});
        if(seq!==requestNumber.current)return;
        show(base);setMode('edit');setName(draft.name);setPayload(draft.payload);setToolsText(draft.toolsText);setReadOnlyText(draft.readOnlyText);
        setSelectedFile(draft.payload.files?.find(f=>f.path.toLowerCase()==='skill.md')?.path??'SKILL.md');
        setConflictKey(key);
        return;
      }
      if(seq===requestNumber.current){
        show(result);
        if(receipt.current?.id===id&&receipt.current.edition===version)setNotice(receipt.current.notice);
        receipt.current=null;
      }
    }catch(e){if(seq===requestNumber.current){setMode('loading');setDetail(null);setErr(message(e));}}
    finally{if(seq===requestNumber.current)setBusy(false);}
  }
  useEffect(()=>{
    if(initial){
      if(detail?.asset.id!==initial){
        setMode('loading');
        window.scrollTo({top:0,behavior:'instant'});
      }
      void readDetail(initial,initialVersion,token);
    } else resetList();
    return()=>{requestNumber.current++;};
  },[initial,initialVersion,token,sharedCatalog]);
  function resetList(){
    setLatest(null);setConflictKey(undefined);setPendingImport(null);setBackupError(false);
    requestNumber.current++;setBusy(false);setMode('list');setDetail(null);setErr('');setNotice('');
    setDeleteTarget(null);receipt.current=null;
  }
  function toList(){
    if(initial)onRoute('list');
    else resetList();
  }
  function savedDetail(item:AssetItem,notice:string){
    const edition=String(item.version);
    receipt.current={id:item.id,edition,notice};
    onRoute({id:item.id,edition});
  }
  function askDelete(item:AssetItem,trigger:HTMLButtonElement){
    if(!item.mine || busy)return;
    const latest=assets.find(asset=>asset.id===item.id);
    deleteTrigger.current=trigger;
    setDeleteTarget(latest??item);
    setImpact(null);
    setImpactError('');
    setDeleteError('');
  }
  function cancelDelete(){
    if(deleting.current)return;
    setDeleteTarget(null);
    requestAnimationFrame(()=>{
      if(deleteTrigger.current?.isConnected)deleteTrigger.current.focus();
      else searchInput.current?.focus();
    });
  }
  const listedTarget=deleteTarget&&assets.find(item=>item.id===deleteTarget.id);
  const deleteTargetChanged=Boolean(deleteTarget && (!listedTarget || listedTarget.revision!==deleteTarget.revision));
  const checkingImpact=!impact && !impactError;
  async function confirmDelete(){
    if(!deleteTarget || !deleteTarget.mine || deleteTargetChanged || checkingImpact || deleting.current)return;
    deleting.current=true;
    setBusy(true);
    setDeleteError('');
    const seq=requestNumber.current;
    try{
      await api('asset.delete',{id:deleteTarget.id,revision:deleteTarget.revision});
      if(seq===requestNumber.current){
        setDeleteTarget(null);
        resetList();
        onDeleted(deleteTarget);
        requestAnimationFrame(()=>searchInput.current?.focus());
      }
    }catch(error){
      if(seq===requestNumber.current){
        setDeleteError(message(error));
        await onChange().catch(()=>{});
      }
    }finally{
      deleting.current=false;
      if(seq===requestNumber.current)setBusy(false);
    }
  }
  function start(type:Kind='document'){
    kindDrafts.current={};
    setKind(type);setName('');setPayload(blank(type));setDetail(null);setMode('create');setErr('');setNotice('');
    setSelectedFile('SKILL.md');setToolsText('');setReadOnlyText('');
  }
  function selectKind(next:Kind){
    if(kind===next||busy)return;
    // 참고 자료와 지식 저장소는 같은 원문을 사용한다. Skill 파일과 MCP 설정은 종류별로 보관한다.
    kindDrafts.current[draftKey(kind)]=payload;
    setPayload(kindDrafts.current[draftKey(next)]??blank(next));
    setKind(next);setErr('');setNotice('');
  }
  function edit(){
    if(!detail)return;setPayload(detail.payload);setName(detail.asset.name);
    setToolsText((detail.payload.tools??[]).join('\n'));setReadOnlyText((detail.payload.readOnlyTools??[]).join('\n'));
    setMode('edit');setErr('');setNotice('');
  }
  function change(p:Partial<Payload>){setPayload(old=>({...old,...p}));}
  function applyImport(next:SkillImport) {
    const keep=new Set(next.changed.filter(path=>!next.replace.includes(path)));
    const current=new Map(payload.files?.map(file=>[pathKey(file.path),file]));
    const files=next.files.map(file=>keep.has(file.path)?current.get(pathKey(file.path))??file:file);
    try{checkBundleSize(files);}catch(error){setErr(message(error));return;}
    change({files,content:next.content});
    setSelectedFile(next.main);setName(current=>current.trim()?current:next.name);
    setPendingImport(null);setErr('');setNotice('Skill 파일 구성을 반영했습니다. 저장하면 새 판이 만들어집니다.');
  }
  async function upload(e:ChangeEvent<HTMLInputElement>,type:'md'|'zip'|'folder'){
    const files=Array.from(e.target.files??[]);e.target.value='';if(!files.length)return;
    const seq=requestNumber.current;
    setBusy(true);setErr('');
    try {
      const entries=await importFiles(files,type),main=entries.find(f=>f.path.toLowerCase()==='skill.md')!;
      if(seq!==requestNumber.current)return;
      const existing=payload.files??[];
      const mainPath=type==='md'?(existing.find(f=>f.path.toLowerCase()==='skill.md')?.path??main.path):main.path;
      const nextFiles=type==='md'?replaceMainFile(existing,main.data):entries;
      checkBundleSize(nextFiles);
      const content=strFromU8(bytes(main.data));
      const oldFiles=new Map(existing.map(file=>[pathKey(file.path),file]));
      const retained=new Set(nextFiles.map(f=>pathKey(f.path)));
      const changed=nextFiles.filter(file=>{
        const path=pathKey(file.path),old=oldFiles.get(path);
        return path!=='skill.md'&&old&&old.data!==file.data;
      }).map(file=>file.path);
      const update:SkillImport={files:nextFiles,main:mainPath,content,
        name:type==='folder'?files[0].webkitRelativePath.split('/')[0]:files[0].name.replace(/\.(zip|md)$/i,''),
        removed:existing.filter(f=>!retained.has(pathKey(f.path))).map(f=>f.path),changed,replace:[],
        overwrite:content!==payload.content && payload.content!==(original?.payload.content??'')};
      if(update.removed.length || update.changed.length || update.overwrite)setPendingImport(update);
      else applyImport(update);
    }catch(error){if(seq===requestNumber.current)setErr(message(error));}finally{if(seq===requestNumber.current)setBusy(false);}
  }
  async function compareLatest(){
    if(!detail||busy)return;
    const seq=requestNumber.current;
    setBusy(true);setErr('');
    try{
      const current=await api('asset.read',{id:detail.asset.id});
      if(seq===requestNumber.current)setLatest(current);
    }catch(error){if(seq===requestNumber.current)setErr(message(error));}
    finally{if(seq===requestNumber.current)setBusy(false);}
  }
  async function save(asCopy=false,baseVersion=detail?.version){
    const seq=requestNumber.current;
    setBusy(true);setErr('');setNotice('');
    try {
      const body:Partial<Payload>={...payload};
      if(kind==='skill') {
        body.files=replaceMainFile(body.files??[],b64(strToU8(payload.content)));
        checkBundleSize(body.files);
        delete body.content;
      }
      if(kind==='mcp') {body.tools=names(toolsText);body.readOnlyTools=names(readOnlyText);}
      const savedName=asCopy?name.trim().slice(0,117)+' 사본':name;
      const id=asCopy?undefined:detail?.asset.id;
      const requestKey=await assetRequestKey(id?['edition',id,baseVersion,kind,savedName,body]:['save',detail?.asset.id,kind,savedName,body]);
      const saved:AssetItem=await api('asset.save',{id,baseVersion,kind,name:savedName,payload:body,requestKey});
      if(seq===requestNumber.current){
        finishAssetRequest(requestKey);
        clearConflict();
        savedDetail(saved,asCopy?'작성한 초안을 내 자료에 독립 사본으로 저장했습니다.':saved.version+'판을 저장했습니다.');
      }
      await onChange();
    }catch(e){
      if(seq!==requestNumber.current)return;
      if(!asCopy&&detail&&e instanceof StudioApiError&&e.status===409){
        const key=conflictEntry(detail.asset.id,true)!;
        try{await writeConflictDraft(key,{id:detail.asset.id,baseVersion:detail.version,name,payload,toolsText,readOnlyText});}
        catch{if(seq===requestNumber.current)setBackupError(true);}
        if(seq===requestNumber.current){
          if(latest)setNotice('비교를 연 뒤 새 판이 저장되었습니다. 최신판과 다시 비교하세요.');
          setLatest(null);setConflictKey(key);
        }
      }else setErr(e instanceof TypeError?'저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 저장하면 처음 저장한 판을 엽니다.':message(e));
    }finally{if(seq===requestNumber.current)setBusy(false);}
  }
  async function applyShare(rotate=false){
    if(!detail?.asset.mine)return;const seq=requestNumber.current;setBusy(true);setErr('');setNotice('');
    try {
      await api('asset.share',{id:detail.asset.id,revision:detail.asset.revision,
        ...(rotate?{rotate:true}:{version:detail.version,visibility:visible})});
      await onChange();
      if(seq!==requestNumber.current)return;
      const notice=rotate?'기존 링크를 철회하고 새 주소를 만들었습니다.':visible==='private'?'나만 사용하는 자료로 변경했습니다.':detail.version+'판을 공유했습니다.';
      if(token||initialVersion==='published'&&visible==='private'){
        receipt.current={id:detail.asset.id,edition:String(detail.version),notice};
        onRoute({id:detail.asset.id,edition:String(detail.version)},true);
      }else{
        const reading=requestNumber.current+1;
        await readDetail(detail.asset.id,initialVersion);
        if(requestNumber.current===reading)setNotice(notice);
      }
    }catch(e){
      if(seq!==requestNumber.current)return;
      if(e instanceof StudioApiError&&e.status===409){
        try{
          const current:ResourceDetail=await api('asset.read',{id:detail.asset.id,version:detail.version});
          if(seq!==requestNumber.current)return;
          const edition=initialVersion==='published'&&current.asset.publicVersion?'published':String(detail.version);
          if(token||initialVersion==='published'&&edition!=='published'){
            receipt.current={id:detail.asset.id,edition,notice:message(e)};
            onRoute({id:detail.asset.id,edition},true);
          }else if(edition==='published'){
            const reading=requestNumber.current+1;
            await readDetail(detail.asset.id,edition);
            if(requestNumber.current===reading)setErr(message(e));
          }else{show(current);setErr(message(e));}
          await onChange().catch(()=>{});
        }catch(refreshError){if(seq===requestNumber.current)setErr(message(refreshError));}
      }else setErr(message(e));
    }finally{if(seq===requestNumber.current)setBusy(false);}
  }
  async function copy(){
    if(!detail)return;const seq=requestNumber.current;setBusy(true);setErr('');setNotice('');
    try {const requestKey=await assetRequestKey([sharedCatalog?'shared-copy':'copy',detail.asset.id,detail.version]);
      const copy:AssetItem=await api('asset.copy',{id:detail.asset.id,version:detail.version,token:detail.asset.id===initial?token:undefined,requestKey,sharedCatalog});
      await onChange();if(seq===requestNumber.current){
        finishAssetRequest(requestKey);
        if(sharedCatalog&&onOpenCopy)onOpenCopy(copy);
        else savedDetail(copy,'내 자료에 독립 사본을 만들었습니다.');
      }
    }catch(e){if(seq===requestNumber.current)setErr(message(e));}finally{if(seq===requestNumber.current)setBusy(false);}
  }
  const scoped=assets.filter(a=>scope==='all'||scope==='mine'&&a.mine||scope==='shared'&&!a.mine&&a.visibility==='link'||scope==='public'&&a.visibility==='public');
  const list=scoped.filter(a=>(kindFilter==='all'||a.kind===kindFilter) && a.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const duplicates=duplicateAssetNames(list);
  const hasFilters=Boolean(query.trim()||kindFilter!=='all');
  function resetFilters() {
    filterList({kind:'all',query:'',focus:'search'});
    searchInput.current?.focus();
  }
  function filesView(){
    const files=payload.files?.length?payload.files:editMode&&payload.content?[{path:'SKILL.md',data:''}]:[];
    if(!files.length)return null;
    const currentFile=files.find(f=>f.path===selectedFile);
    const editingMain=editMode && currentFile?.path.toLowerCase()==='skill.md';
    const size=editingMain?strToU8(payload.content).length:currentFile?fileSize(currentFile.data):0;
    const preview=editingMain?(size<=300_000?payload.content:null):currentFile?previewText(currentFile):null;
    return <section className="rl-files"><h3>파일 구성</h3>
      <div className="rl-filegrid"><ul>{files.map(f=><li key={f.path}><button type="button" aria-pressed={selectedFile===f.path} onClick={()=>setSelectedFile(f.path)}>{f.path}</button></li>)}</ul>
        <div>{currentFile&&<><div className="rl-filetitle"><strong>{currentFile.path}</strong><small>{size.toLocaleString()} B</small>
          <button type="button" onClick={()=>download(currentFile.path.split('/').at(-1)!,editingMain?strToU8(payload.content):bytes(currentFile.data),'application/octet-stream')}>이 파일 내려받기</button></div>
          {preview===null?<p>다운로드하여 확인할 수 있는 파일입니다.</p>:<SourcePreview body={preview} label={currentFile.path+' 내용'} code={/\.(js|ts|py|sh|ps1|json|ya?ml|tsx)$/i.test(currentFile.path)}/>}</>}</div></div>
    </section>;
  }
  const shared=detail?.asset;
  const canManage=Boolean(!sharedCatalog&&shared?.mine);
  const publishedUrl=shared?.publicVersion && shared.visibility!=='private' &&
    (shared.visibility==='public' || shared.token) ? new URL('/',window.location.origin) : null;
  if (publishedUrl && shared) {
    publishedUrl.searchParams.set('asset',shared.id);
    if (shared.visibility==='link' && shared.token) publishedUrl.searchParams.set('token',shared.token);
    publishedUrl.searchParams.set('edition','published');
  }
  const attachmentChanges=latest&&kind==='skill'?compareAttachments(payload,latest.payload):[];
  const fixedUrl=publishedUrl && detail?.asset.releasedVersions?.includes(detail.version) ? new URL(publishedUrl) : null;
  if (fixedUrl && detail) fixedUrl.searchParams.set('edition',String(detail.version));
  return <><section ref={library} className="resource-library" aria-label={sectionTitle} onClickCapture={event=>{
    if(mode!=='list')return;
    const control=(event.target as Element).closest<HTMLElement>('[data-resource-return],.project-folder-link');
    if(control)rememberResourceList({...filters,focus:control.dataset.resourceReturn??'trash',scrollY:window.scrollY});
  }}>
    <header className="rl-header"><div>{mode!=='list'&&<button className="rl-back" type="button" onClick={()=>leave.proceed(toList)}>← {sectionTitle}</button>}
      <h1 ref={heading} tabIndex={-1}>{mode==='list'?sectionTitle:mode==='create'?'새 자료 등록':mode==='edit'?'자료 수정':mode==='loading'?(err?'자료를 열 수 없습니다':'자료 열기'):detail?.asset.name}</h1>
      {mode==='loading'&&busy&&<p role="status">자료를 불러오는 중입니다.</p>}
      {mode==='list'&&<p>{sharedCatalog?'공유된 판을 골라 내 Workflow에 연결하거나 내 자료에 사본을 만드세요.':'Agent에 연결할 원문, 작업 지침, 지식 저장소와 도구를 관리합니다.'}</p>}</div>
      {!sharedCatalog&&mode==='list'&&<div className="project-folder-actions">{folderLink}
        <button type="button" className="rl-primary" data-resource-return="create" onClick={()=>start()}><Plus size={17} aria-hidden="true"/>자료 등록</button></div>}</header>
    {err&&<p className="rl-error" role="alert">{err}</p>}{notice&&<p className="rl-notice" role="status">{notice}</p>}
    {mode==='loading'&&initial&&err&&!busy&&<button type="button" onClick={async()=>{
      await readDetail(initial,initialVersion,token);
      requestAnimationFrame(()=>heading.current?.focus());
    }}>다시 불러오기</button>}
    {mode==='list'&&<div className="rl-list-surface">
      <div className="rl-scope" role={sharedCatalog?'tablist':'group'} aria-label="자료 범위"
        onKeyDown={sharedCatalog?switchCatalogTab:undefined}>{(sharedCatalog?catalogScopes:libraryScopes).map(([key,label])=>
        <button key={key} data-resource-return={'scope-'+key}
          {...(sharedCatalog?{role:'tab',id:'catalog-scope-'+key,'aria-selected':scope===key,'aria-controls':'catalog-results',tabIndex:scope===key?0:-1}:{'aria-pressed':scope===key})}
          onClick={()=>filterList({scope:key,focus:'scope-'+key})}>{label}</button>)}</div>
      <div {...(sharedCatalog?{id:'catalog-results',role:'tabpanel','aria-labelledby':'catalog-scope-'+scope}:{})}>
      <div className="rl-filter"><label className="rl-field rl-search"><span>검색</span><span className="rl-search-control"><Search size={17} aria-hidden="true"/>
        <input ref={searchInput} data-resource-return="search" type="search" placeholder="이름으로 찾기" value={query} onChange={e=>filterList({query:e.target.value})}/></span></label>
        <Field label="종류"><select data-resource-return="kind" aria-label="종류" value={kindFilter} onChange={e=>filterList({kind:e.target.value as Kind|'all'})}><option value="all">모든 종류</option>
        {Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
        <span className="rl-result-count" role="status">자료 {list.length.toLocaleString()}개</span></div>
      {list.length?<><div className="rl-column-head" aria-hidden="true"><span>이름</span><span>종류</span><span>자료판</span><span>공유 범위</span></div>
        <ul className="rl-assets" aria-label="자료 목록">{list.map(a=><li key={a.id}><button className="rl-asset-open" data-resource-return={a.id} disabled={busy} onClick={()=>onRoute({id:a.id,edition:String(a.version)})}>
        <span className="rl-name"><KindIcon kind={a.kind}/><span><strong>{a.name}</strong>{a.exampleLesson&&<small>실습 예제 (원본 1판)</small>}{duplicates.has(a.name)&&<small>자료 번호 {assetNumber(a.id)}</small>}</span></span>
        <span className="rl-kind-label">{labels[a.kind]}</span><span className="rl-edition">{a.version}판</span>
        <span className="rl-scope-label">{scopes[a.visibility]}</span><ChevronRight className="rl-open-arrow" size={16} aria-hidden="true"/></button>
        {!sharedCatalog&&a.mine&&<button type="button" className="rl-delete" aria-label={a.name+' 삭제'} disabled={busy}
          onClick={event=>askDelete(a,event.currentTarget)}><Trash2 size={16} aria-hidden="true"/></button>}</li>)}</ul></>:
        sharedCatalog&&!scoped.length?<div className="rl-empty"><h2>{scope==='shared'?'직접 받은 자료가 없습니다':'모두에게 공개된 자료가 없습니다'}</h2>
          {scope==='shared'&&<p>받은 비밀 링크를 열면 이곳에서 자료를 다시 찾을 수 있습니다.</p>}</div>:
        <div className="rl-empty"><FolderSearch size={28} aria-hidden="true"/><h2>{assets.length?'조건에 맞는 자료가 없습니다':'아직 등록한 자료가 없습니다'}</h2>
          <p>{assets.length?'범위, 종류 또는 검색어를 바꿔 보세요.':'안내문을 등록하거나 SKILL.md 파일을 가져와 시작하세요.'}</p>
          {hasFilters&&<button type="button" onClick={resetFilters}>검색 조건 초기화</button>}</div>}
      </div>
    </div>}
    {editMode&&<form className="rl-form" inert={busy} onFocusCapture={event=>{
      if(event.target.matches('input:not([hidden]),textarea,select'))lastDraftField.current=event.target;
    }} onSubmit={e=>{e.preventDefault();if(!busy)void (conflictKey?compareLatest():save());}}>
      {mode==='create'&&<fieldset className="rl-kind-field"><legend>자료 종류</legend><div className="rl-kindchoices">{(Object.keys(labels) as Kind[]).map(id=><button type="button" key={id}
        aria-pressed={id===kind} disabled={busy||(id==='mcp'&&isAdmin===false)} onClick={()=>selectKind(id)}>
        <strong><KindIcon kind={id}/>{labels[id]}</strong><small>{id==='mcp'&&isAdmin===false?'관리자만 등록할 수 있습니다.':kindDescriptions[id]}</small></button>)}</div>
        <p className="rl-selected-help">{kindDescriptions[kind]}{isAdmin===false&&' · MCP 등록은 관리자 전용'}</p></fieldset>}
      <Field label="이름"><input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder={kind==='skill'?'예: 근거 인용 Skill':'예: 도서관 이용규정'}/></Field>
      {kind==='skill'&&<><fieldset><legend>Skill 가져오기</legend><div className="rl-actions">
        <button type="button" disabled={busy} onClick={()=>mdPicker.current?.click()}>.md 파일</button><button type="button" disabled={busy} onClick={()=>folderPicker.current?.click()}>폴더 선택</button>
        <button type="button" disabled={busy} onClick={()=>zipPicker.current?.click()}>ZIP 파일</button></div>
        <input type="file" hidden accept=".md,text/markdown" ref={mdPicker} onChange={e=>void upload(e,'md')}/>
        <input type="file" hidden multiple ref={folderPicker} onChange={e=>void upload(e,'folder')}/><input type="file" hidden accept=".zip,application/zip" ref={zipPicker} onChange={e=>void upload(e,'zip')}/>
        <small>SKILL.md와 부속 파일을 합쳐 최대 128개, 5MB</small>
        </fieldset><label className="rl-check"><input type="checkbox" checked={!!payload.requiresScripts} onChange={e=>change({requiresScripts:e.target.checked})}/>이 Skill은 작업에 스크립트 실행이 꼭 필요합니다</label>
        {payload.requiresScripts&&<p className="rl-error">이 버전에서는 필수 스크립트를 실행할 수 없어 Agent 실행과 게시가 제한됩니다.</p>}</>}
      {kind!=='mcp'?<Field label={kind==='skill'?'SKILL.md 지침':'자료 본문'}><textarea required rows={9} value={payload.content} onChange={e=>change({content:e.target.value})} placeholder={kind==='skill'?'# 목적\n\n작업 단계를 입력하세요.':'Agent가 참고하거나 검색할 원문을 입력하세요.'}/></Field>:
        <><Field label="MCP 서버 주소"><input type="url" required placeholder="https://example.com/mcp" value={payload.url??''} onChange={e=>change({url:e.target.value})}/></Field>
        <Field label="시험용 서버 주소"><input type="url" value={payload.testUrl??''} onChange={e=>change({testUrl:e.target.value})}/></Field>
        <Field label="허용 도구 이름 (줄 또는 쉼표로 구분)"><textarea required rows={3} value={toolsText} onChange={e=>setToolsText(e.target.value)}/></Field>
        <Field label="조회 전용 도구"><textarea rows={2} value={readOnlyText} onChange={e=>setReadOnlyText(e.target.value)}/></Field>
        <Field label="서버 자격증명 환경변수 이름"><input value={payload.credentialEnv??''} placeholder="STUDIO_CONNECTOR_LIBRARY" onChange={e=>change({credentialEnv:e.target.value})}/></Field></>}
      {kind==='skill'&&filesView()}
      {conflictKey&&<section className="rl-conflict" aria-labelledby="resource-conflict-title">
        <h2 id="resource-conflict-title">다른 판이 먼저 저장됐습니다</h2>
        <p role="status">{backupError?'이 탭에서 작성 중인 초안을 먼저 사본으로 저장하세요. 브라우저 임시 보관을 사용할 수 없습니다.':
          '작성한 초안을 유지하고 있습니다. 최신판과 비교하거나 이 초안을 별도 자료로 저장하세요.'}</p>
      </section>}
      <div className="rl-actions rl-save-actions"><button type="button" disabled={busy} onClick={()=>leave.proceed(()=>detail?show(detail):toList())}>취소</button>
        {conflictKey&&<button type="button" disabled={busy} onClick={()=>void save(true)}>내 사본으로 저장</button>}
        <button disabled={busy} className="rl-primary" type="submit">{busy?'처리 중…':conflictKey?'최신판과 비교':mode==='edit'?'새 버전 저장':'등록'}</button></div>
    </form>}
    {mode==='view'&&detail&&<div className="rl-form rl-detail-layout"><div className="rl-actions rl-view-actions"><KindIcon kind={kind}/><strong>{labels[kind]}</strong>
        <select aria-label="자료 버전" value={detail.version} disabled={busy} onChange={e=>onRoute({id:detail.asset.id,edition:e.target.value,token:token??undefined})}>
          {(canManage?Array.from({length:detail.asset.version},(_,i)=>detail.asset.version-i):detail.asset.releasedVersions??[detail.version]).map(n=><option value={n} key={n}>{n}판{n===detail.asset.publicVersion?' · 게시됨':canManage&&n===detail.asset.version?' · 최신':''}</option>)}</select>
        </div>
      <section className="rl-document"><h2>{kind==='mcp'?'연결 정보':kind==='skill'?'작업 지침':'원문'}</h2>
      {kind==='mcp'?<><dl className="rl-details">
        <dt>{payload.builtin==='library'?'연결 대상':'서버 주소'}</dt><dd>{payload.builtin==='library'?'작업실 도서관 MCP':payload.url}</dd>
        {canManage&&<><dt>시험 연결</dt><dd>{payload.builtin==='library'?'격리 시험 지원':payload.testUrl||'미등록'}</dd></>}</dl>
        <section><h2>Workflow에 연결할 도구</h2>{payload.tools?.map(tool=>{
          const identifier='mcp.'+detail.asset.id+'.'+tool;
          return <ResourceCopyField key={tool} label={tool+' · '+(payload.readOnlyTools?.includes(tool)?'조회 전용':'실행 승인 필요')}
            identifierLabel={tool+' 도구 식별자'} value={identifier} copy={copyField} notify={setNotice}/>;
        })}</section></>:
        <SourcePreview body={payload.content} code={false}/>}
      {kind==='skill'&&payload.requiresScripts&&<p className="rl-error">필수 스크립트 실행 미지원</p>}
      </section>
      <aside className="rl-info" aria-label="자료 정보"><h2>자료 정보</h2>
        <dl><div><dt>자료판</dt><dd>{detail.version}판</dd></div><div><dt>공유 범위</dt><dd>{scopes[detail.asset.visibility]}</dd></div>
          <div><dt>사용 권한</dt><dd>{detail.asset.mine?'소유자':'공유된 판 열람'}</dd></div></dl>
      {sharedCatalog&&<div className="rl-catalog-use">
        <p>Workflow에 연결하면 선택한 {detail.version}판을 사용합니다. 사본은 내 자료에 독립적으로 보관됩니다.</p>
        <div className="rl-actions">
          {onConnect&&<button type="button" className="rl-primary" disabled={busy} onClick={()=>onConnect(detail.asset,detail.version)}>내 Workflow에 연결</button>}
          <button type="button" disabled={busy} onClick={()=>void copy()}>내 사본 만들기</button>
        </div>
      </div>}
      {(!sharedCatalog||kind==='skill'&&!!payload.files?.length)&&<div className="rl-actions">{canManage&&payload.builtin!=='library'&&detail.version===detail.asset.version&&<button disabled={busy} className="rl-primary" onClick={edit}>수정</button>}
        {!sharedCatalog&&onConnect&&!detail.asset.mine&&detail.asset.releasedVersions?.includes(detail.version)&&<button type="button" className="rl-primary" disabled={busy} onClick={()=>onConnect(detail.asset,detail.version)}>내 Workflow에 연결</button>}
        {!sharedCatalog&&<button disabled={busy} onClick={()=>void copy()}>이 버전의 사본 만들기</button>}
        {kind==='skill'&&payload.files?.length?<button onClick={()=>exportBundle(payload.files!,name)}>Skill ZIP 다운로드</button>:null}
        {canManage&&<button type="button" className="rl-delete" disabled={busy} onClick={event=>askDelete(detail.asset,event.currentTarget)}>
          <Trash2 size={16} aria-hidden="true"/>자료 삭제</button>}</div>}
      </aside>
      {kind==='skill'&&filesView()}
      {canManage&&<fieldset className="rl-sharing"><legend><LockKeyhole size={15} aria-hidden="true"/> 공유 설정</legend>
        <p>현재 공개 범위 · <strong>{scopes[detail.asset.visibility]}</strong>{detail.asset.visibility!=='private'&&detail.asset.publicVersion&&' · '+detail.asset.publicVersion+'판 게시 중'}</p>
        {visible!==detail.asset.visibility?
          <p role="status">적용 전 · {scopes[detail.asset.visibility]} → {scopes[visible]}{visible!=='private'&&' · '+detail.version+'판'}</p>:
          visible!=='private'&&detail.version!==detail.asset.publicVersion&&
          <p role="status">적용 전 · 게시판 {detail.asset.publicVersion}판 → {detail.version}판</p>}
        <div className="rl-actions rl-visibility-actions"><div className="rl-field"><label htmlFor="resource-share-visibility">공유 범위</label>
        <select id="resource-share-visibility" value={visible} disabled={busy} onChange={e=>{setVisible(e.target.value as Visibility);setNotice('');}}>
        {Object.entries(scopes).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></div>
        <button type="button" className="rl-primary" disabled={busy||visible===detail.asset.visibility&&(visible==='private'||detail.version===detail.asset.publicVersion)} onClick={()=>void applyShare()}>
          {visible==='private'?'나만 사용으로 변경':detail.version+'판 공유'}</button>
        {detail.asset.visibility==='link'&&visible==='link'&&<button type="button" className="rl-delete rl-rotate" disabled={busy} onClick={()=>void applyShare(true)}>현재 링크 철회·재발급</button>}</div>
        </fieldset>}
      {publishedUrl && <fieldset className="rl-share-links"><legend>현재 공유 주소 · {scopes[detail.asset.visibility]}</legend>
        <ResourceCopyField label="최신 게시판 주소" value={publishedUrl.href} copy={copyField} notify={setNotice}/>
        <small>지금은 {detail.asset.publicVersion}판을 엽니다. 새 판을 게시하면 이 주소에도 반영됩니다.</small>
        {fixedUrl ? <ResourceCopyField label={detail.version+'판 고정 주소'} value={fixedUrl.href} copy={copyField} notify={setNotice}/> :
          <small>선택한 {detail.version}판을 현재 범위로 공유하면 고정 주소가 생깁니다.</small>}
      </fieldset>}
    </div>}
  </section>
    {pendingImport&&<StudioDialog title="Skill 가져오기 확인" size={pendingImport.changed.length||pendingImport.removed.length?'form':'confirm'} onClose={()=>setPendingImport(null)} initialFocus={importCancel}
      footer={<><button type="button" ref={importCancel} className="btn" onClick={()=>setPendingImport(null)}>현재 내용 유지</button>
        <button type="button" className="btn primary" onClick={()=>applyImport(pendingImport)}>가져온 내용 적용</button></>}>
      {pendingImport.overwrite&&<p>작성 중인 SKILL.md 지침이 가져온 본문으로 교체됩니다.</p>}
      {pendingImport.removed.length>0&&<><p>새 파일 구성에서 빠지는 파일 {pendingImport.removed.length}개</p>
        <ul className="rl-import-removed">{pendingImport.removed.map(path=><li key={path}>{path}</li>)}</ul></>}
      {pendingImport.changed.length>0&&<fieldset className="rl-import-files"><legend>내용이 달라진 부속 파일 {pendingImport.changed.length}개</legend>
        <p>가져온 파일로 교체하려면 선택하세요. 선택하지 않은 파일은 현재 내용을 유지합니다.</p>
        {pendingImport.changed.map(path=><label key={path}><input type="checkbox" checked={pendingImport.replace.includes(path)}
          onChange={event=>setPendingImport({...pendingImport,replace:event.target.checked?[...pendingImport.replace,path]:pendingImport.replace.filter(file=>file!==path)})}/>{path} 교체</label>)}
      </fieldset>}
      {err&&<p className="rl-error" role="alert">{err}</p>}
    </StudioDialog>}
    {latest&&detail&&<StudioDialog title="최신판과 내 초안 비교" size="settings" dismissDisabled={busy} onClose={()=>setLatest(null)}
      footer={<><button type="button" className="btn" disabled={busy} onClick={()=>setLatest(null)}>계속 편집</button>
        <button type="button" className="btn" disabled={busy} onClick={()=>void save(true)}>내 사본으로 저장</button>
        <button type="button" className="btn primary" disabled={busy} onClick={()=>void save(false,latest.version)}>내 초안을 {latest.version+1}판으로 저장</button></>}>
      {err&&<p className="rl-error" role="alert">{err}</p>}
      <div className="rl-comparison"><ComparisonSide title={'최신 '+latest.version+'판'} name={latest.asset.name} kind={kind} payload={latest.payload}/>
        <ComparisonSide title={detail.version+'판에서 편집한 내 초안'} name={name} kind={kind} payload={kind==='mcp'?
          {...payload,tools:names(toolsText),readOnlyTools:names(readOnlyText)}:payload}/></div>
      {kind==='skill'&&<section><h3>부속 파일 차이</h3>
        {attachmentChanges.length===0?<p>부속 파일이 같습니다.</p>:<ul className="rl-import-removed">
          {attachmentChanges.map(f=><li key={f.path}>{f.path} · {f.status}</li>)}</ul>}</section>}
      <p>내 초안 전체를 {latest.version+1}판으로 저장하면 이전 판들은 그대로 보관됩니다.</p>
    </StudioDialog>}
    {leave.pending&&<StudioDialog title="저장하지 않은 자료" size="confirm" onClose={continueEditing} initialFocus={keepEditing} descriptionId="resource-draft-message"
      footer={<><button type="button" className="btn primary" ref={keepEditing} onClick={continueEditing}>계속 작성</button>
        <button type="button" className="btn" onClick={leave.discardAndProceed}>변경 버리기</button></>}>
      <p id="resource-draft-message">{name?'‘'+name+'’ 자료에':'이 자료에'} 저장하지 않은 변경이 있습니다. 변경을 버리고 나갈까요?</p>
    </StudioDialog>}
    {deleteTarget&&<StudioDialog title="자료 삭제" size="standard" descriptionId="delete-asset-summary" initialFocus={cancelButton}
      dismissDisabled={busy} onClose={cancelDelete}
      footer={<><button ref={cancelButton} type="button" className="btn" disabled={busy} onClick={cancelDelete}>취소</button>
        <button type="button" className="btn danger" disabled={busy||checkingImpact||deleteTargetChanged} onClick={()=>void confirmDelete()}>
          {busy?'이동 중…':'휴지통으로 이동'}</button></>}>
      <p className="delete-project-name" id="delete-asset-summary"><strong>{deleteTarget.name}</strong> 자료의 모든 판을 휴지통으로 옮길까요?
        현재 공유 범위는 ‘{scopes[deleteTarget.visibility]}’입니다.</p>
      <p>삭제하면 이 자료를 사용하는 Agent가 원문이나 도구에 접근할 수 없어 실행과 게시에 영향을 받을 수 있습니다.
        편집기의 블록과 연결선은 그대로 남습니다.</p>
      {impact?.projectTitles.length ? <div><p>초안 또는 저장한 버전에 이 자료를 직접 연결한 내 Agent</p>
        <ul className="purge-project-names">{impact.projectTitles.map((title,index)=><li key={index}>{title}</li>)}</ul></div>
        : impactError ? <p role="alert">연결된 내 Agent를 확인하지 못했습니다. {impactError}</p>
        : !impact && <p role="status">연결된 내 Agent를 확인하는 중입니다.</p>}
      <p>3일 동안 휴지통에서 복구할 수 있습니다. 이후에는 자동으로 영구 삭제됩니다.
        복구하면 ‘나만 사용’으로 돌아오며, 다시 공유하려면 공유 범위를 설정해야 합니다.</p>
      {deleteTarget.visibility!=='private'&&<p>기존 공유 주소로는 이 자료에 접근할 수 없게 됩니다.</p>}
      {deleteTargetChanged&&<p role="alert">자료가 변경되었습니다. 취소한 뒤 자료를 다시 확인하세요.</p>}
      {deleteError&&<p className="modal-error" role="alert">{deleteError}</p>}
    </StudioDialog>}
  </>;
}
export {ResourceLibrary};
