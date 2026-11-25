import {strFromU8,unzipSync} from 'fflate';
import {all,db,one,set,key,now,tx,digest} from './db';
import {requireThat,stringArg,StudioError} from './errors';
import type {User} from './auth';
import type {Graph} from '../domain';
import {normalizeKnowledgeReferences} from '../domain/knowledge-reference';
import {firstSourceSentence} from '../domain/source-preview';
import {optionalLessonMaterials,type MaterialLesson} from '../domain/optional-lesson-materials';
export type Visibility='private'|'link'|'public';
export type AssetKind='skill'|'mcp'|'document'|'knowledge';
export interface Asset {id:string;owner:string;name:string;kind:AssetKind;visibility:Visibility;token:string;version:number;revision:number}
export interface BundleFile {path:string;data:string}
export interface Payload {content:string; files?:BundleFile[]; requiresScripts?:boolean; builtin?:'library'; url?:string;testUrl?:string;credentialEnv?:string;tools?:string[]; readOnlyTools?:string[]}
export function visibility(v:unknown):Visibility {requireThat(v==='private'||v==='link'||v==='public',400,'공유 범위를 선택하세요.');return v;}
function safePath(path:string){
  requireThat(typeof path==='string'&&path.length>0&&path.length<300,400,'Skill 파일 경로를 확인하세요.');
  const parts=path.split('/');
  requireThat(parts.every(part=>part&&!/[\\:*?"<>|\u0000-\u001f]/u.test(part)&&!/[. ]$/.test(part)&&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),400,'Skill 파일 경로를 확인하세요.');
  return path;
}
function pathKey(path:string){return path.normalize('NFC').toLowerCase();}
function edition(value:unknown):number{
  const n=typeof value==='number'?value:typeof value==='string'&&/^[1-9]\d*$/.test(value)?Number(value):NaN;
  requireThat(Number.isSafeInteger(n)&&n>0,400,'자료 버전은 양의 정수여야 합니다.');
  return n;
}
export function skillFiles(files:BundleFile[]=[],archive?:string):BundleFile[]{
  if(archive){
    requireThat(archive.length<7_000_000,413,'ZIP 파일 크기가 너무 큽니다.');
    const names=new Set<string>();
    let total=0,count=0;
    try{
      const result=unzipSync(Buffer.from(archive,'base64'),{filter(info){
        if(info.name.endsWith('/')){safePath(info.name.slice(0,-1));return false;}
        const name=pathKey(safePath(info.name));requireThat(!names.has(name),400,'ZIP에 중복된 파일이 있습니다.');names.add(name);
        total+=info.originalSize;count++;requireThat(total<=5_000_000&&count<=128,413,'압축을 푼 Skill이 너무 큽니다.');return true;
      }});
      files=Object.entries(result).map(([path,bytes])=>({path,data:Buffer.from(bytes).toString('base64')}));
    }catch(error){if(error instanceof StudioError)throw error;throw new StudioError(400,'읽을 수 있는 ZIP 파일을 선택하세요.');}
  }
  requireThat(Array.isArray(files)&&files.length<=128,400,'Skill 파일 수를 확인하세요.');
  const paths=new Set<string>();let size=0;
  const cleaned=files.map(f=>{const path=safePath(f?.path);const name=pathKey(path);requireThat(!paths.has(name)&&typeof f.data==='string'&&f.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(f.data),400,'중복되거나 올바르지 않은 파일입니다.');paths.add(name);size+=Buffer.byteLength(f.data,'base64');requireThat(size<=5_000_000,413,'Skill 파일이 너무 큽니다.');return {path,data:f.data};});
  requireThat(cleaned.every(f=>!f.path.split('/').some((_,i,parts)=>i>0&&paths.has(pathKey(parts.slice(0,i).join('/'))))),400,'Skill 파일과 폴더 경로가 겹칩니다.');
  const main=cleaned.filter(f=>/(^|\/)SKILL\.md$/i.test(f.path)).sort((a,b)=>a.path.length-b.path.length)[0];
  requireThat(main,400,'SKILL.md 파일이 필요합니다.');const base=main.path.slice(0,main.path.lastIndexOf('/')+1);
  requireThat(cleaned.every(f=>f.path.startsWith(base)),400,'SKILL.md가 있는 폴더 안에 모든 자료를 넣어 주세요.');
  return cleaned.map(f=>({...f,path:f.path.slice(base.length)}));
}
function endpoint(value:unknown){const addr=stringArg(value,'HTTP MCP 주소',1000);requireThat(URL.canParse(addr),400,'올바른 HTTP MCP 주소를 입력하세요.');const u=new URL(addr);
  requireThat(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash,400,'인증 정보가 없는 HTTP 주소를 입력하세요.');return u.href;}
export function cleanPayload(user:User,kind:AssetKind,p:any):Payload {
  requireThat(p&&typeof p==='object',400,'자료 내용을 확인하세요.');
  if(kind==='mcp'){
    requireThat(user.login&&process.env.STUDIO_ADMIN_IDS?.split(',').includes(user.id),403,'MCP 서버 등록은 운영자에게 허용됩니다.');
    requireThat(Array.isArray(p.tools)&&p.tools.length>0&&p.tools.length<=30&&p.tools.every((s:any)=>typeof s==='string'&&/^[a-zA-Z0-9_.-]{1,64}$/.test(s)),400,'허용 도구 이름을 확인하세요.');
    const credentialEnv=p.credentialEnv?String(p.credentialEnv):undefined;
    requireThat(!credentialEnv||/^STUDIO_CONNECTOR_[A-Z0-9_]+$/.test(credentialEnv),400,'STUDIO_CONNECTOR_로 시작하는 환경변수를 지정하세요.');
    return {content:'',url:endpoint(p.url),testUrl:p.testUrl?endpoint(p.testUrl):undefined,credentialEnv,tools:p.tools,readOnlyTools:(Array.isArray(p.readOnlyTools)?p.readOnlyTools:[]).filter((s:string)=>p.tools.includes(s))};
  }
  if(kind==='skill'){const files=skillFiles(p.files?.length?p.files:p.archive?[]:[{path:'SKILL.md',data:Buffer.from(stringArg(p.content,'Skill 지침',200000)).toString('base64')}],p.archive);
    const main=files.find(f=>f.path.toLowerCase()==='skill.md')!;
    return {content:strFromU8(Buffer.from(main.data,'base64')),files,requiresScripts:p.requiresScripts===true};
  }
  return {content:stringArg(p.content,'자료 본문',1_000_000)};
}
export function assetRow(id:string){const a=one<Asset>('SELECT * FROM active_assets WHERE id=?',id);requireThat(a,404,'자료를 찾을 수 없습니다.');return a;}
export function canAsset(a:Asset,user:User,token?:string){return a.owner===user.id||a.visibility==='public'||(a.visibility==='link'&&(token===a.token||Boolean(one('SELECT 1 FROM grants WHERE owner=? AND kind=? AND target=? AND token=?',user.id,'asset',a.id,a.token))));}
function publishedEdition(a:Asset){return one<{version:number}>('SELECT version FROM asset_publications WHERE asset=?',a.id)?.version;}
function editionName(a:Asset,n:number){
  return one<{name:string}>('SELECT name FROM asset_edition_names WHERE asset=? AND version=?',a.id,n)?.name??
    (n===a.version?a.name:'이전 자료판');
}
function sharedEditions(a:Asset,scope:Visibility=a.visibility):number[]{
  if(a.visibility==='private'||scope==='private')return [];
  // Legacy publications recorded only the current audience. An older edition with unknown
  // audience stays private until its owner explicitly releases it again.
  return all<{version:number}>(`SELECT r.version FROM asset_releases r
    LEFT JOIN asset_release_audiences s ON r.asset=s.asset AND r.version=s.version
    LEFT JOIN asset_publications p ON p.asset=r.asset AND p.version=r.version
    WHERE r.asset=? AND (s.audience='public' OR (?='link' AND ?='link' AND s.audience='link')
      OR (s.audience IS NULL AND p.version IS NOT NULL AND (?='link' OR ?='public')))
    ORDER BY r.version DESC`,a.id,scope,a.visibility,scope,a.visibility).map(r=>r.version);
}
function readableEdition(user:User,a:Asset,version?:number|string,token?:string,sharedCatalog=false){
  requireThat(canAsset(a,user,token),403,'이 자료판을 읽을 권한이 없습니다.');
  if(sharedCatalog){
    requireThat(a.visibility!=='private',403,'현재 공유 중인 자료가 아닙니다.');
    if(a.visibility==='link'&&token!=null)requireThat(token===a.token,403,'이 자료의 공유 주소가 변경되었습니다.');
  }
  const ownDraft=a.owner===user.id&&!sharedCatalog;
  const n=edition(version??(ownDraft?a.version:publishedEdition(a)));
  if(!ownDraft)requireThat(sharedEditions(a).includes(n),403,'공유되지 않은 자료 버전입니다.');
  return {asset:a,version:n};
}
export function readAsset(user:User,id:string,version?:number|string,token?:string){
  return loadEdition(readableEdition(user,assetRow(id),version,token));
}
function loadEdition({asset:a,version:n}:{asset:Asset;version:number}){
  const r=one<{payload:string}>('SELECT payload FROM asset_versions WHERE asset=? AND number=?',a.id,n);requireThat(r,404,'자료 버전을 찾을 수 없습니다.');
  return {asset:{...a,name:editionName(a,n)},payload:JSON.parse(r.payload) as Payload,version:n};}

export function readLibraryAsset(user:User,id:string,requested?:number|string,token?:string,sharedCatalog=false) {
  const a=assetRow(id);
  if (a.visibility==='link' && token!=null)
    requireThat(token===a.token,403,'이 자료의 공유 주소가 변경되었습니다.');
  if (requested==='published') {
    const published=publishedEdition(a);
    requireThat(published,404,'현재 게시한 자료판이 없습니다.');
    requested=published;
  }
  const {asset,payload,version}=loadEdition(readableEdition(user,a,requested,token,sharedCatalog));
  const item=assetDto(asset,user,version,sharedCatalog);
  let receivedAsset:ReturnType<typeof assetDto>|undefined;
  if (!item.mine || sharedCatalog) {
    delete payload.credentialEnv;
    delete payload.testUrl;
  }
  if (a.visibility==='link') {
    if (token===a.token) {
      grant(user,'asset',a.id,a.token);
      if(!item.mine)receivedAsset={...item,name:editionName(a,item.version)};
    }
    // A reader with a redeemed link can also copy both URLs when reopening the library.
    item.token=a.token;
  }
  return {asset:item,payload,version,...(receivedAsset?{receivedAsset}:{})};
}

export function documentPreviews(user:User, pins:unknown) {
  requireThat(Array.isArray(pins) && pins.length <= 512,400,'미리 볼 자료 목록을 확인하세요.');
  return pins.map(pin => {
    requireThat(pin && typeof pin.id === 'string',400,'자료를 선택하세요.');
    try {
      const {asset,version}=readableEdition(user,assetRow(pin.id),pin.version,pin.token);
      if (asset.kind !== 'document' && asset.kind !== 'knowledge') return '';
      const row=one<{excerpt:string}>(`SELECT substr(json_extract(payload,'$.content'),1,512) AS excerpt
        FROM asset_versions WHERE asset=? AND number=?`,asset.id,version);
      return firstSourceSentence(row?.excerpt ?? '');
    } catch (error) {
      if (error instanceof StudioError && [400,403,404].includes(error.status)) return '';
      throw error;
    }
  });
}
export function assetDto(a:Asset,user:User,selected?:number,sharedCatalog=false){const published=publishedEdition(a),mine=a.owner===user.id,manage=mine&&!sharedCatalog,shown=manage?a.version:published??0;
  const exampleLesson=manage?one<{lesson:MaterialLesson}>('SELECT lesson FROM installed_lesson_materials WHERE owner=? AND asset=?',user.id,a.id)?.lesson:undefined;
  return {id:a.id,name:editionName(a,selected??shown),kind:a.kind,version:shown,publicVersion:published,releasedVersions:sharedEditions(a),visibility:a.visibility,mine,...(exampleLesson?{exampleLesson}:{}),...(manage?{token:a.token,revision:a.revision}:{})};}

function installMissingLessonMaterials(user:User) {
  const missing = all<{lesson:keyof typeof optionalLessonMaterials}>(`
    SELECT DISTINCT p.lesson FROM active_projects p
    WHERE p.owner=? AND p.lesson IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT 1 FROM installed_lesson_materials m WHERE m.owner=p.owner AND m.lesson=p.lesson)
  `, user.id, JSON.stringify(Object.keys(optionalLessonMaterials)));
  if (!missing.length) return;
  function install() {
    for (const {lesson} of missing) {
      const receipt = set('INSERT OR IGNORE INTO installed_lesson_materials(owner,lesson) VALUES(?,?)', user.id, lesson);
      if (receipt.changes) {
        const asset = writeAsset(user, optionalLessonMaterials[lesson]);
        set('UPDATE installed_lesson_materials SET asset=? WHERE owner=? AND lesson=?',asset.id,user.id,lesson);
      }
    }
  }
  if (db().isTransaction) install();
  else tx(install);
}

export function assetList(user:User){
  installMissingLessonMaterials(user);
  return all<Asset>("SELECT a.* FROM active_assets a WHERE owner=? OR visibility='public' OR (visibility='link' AND EXISTS(SELECT 1 FROM grants g WHERE g.owner=? AND g.kind='asset' AND g.target=a.id AND g.token=a.token)) ORDER BY name",user.id,user.id).map(a=>assetDto(a,user));
}
export function sharedAssetList(user:User){
  type Row = Pick<Asset,'id'|'kind'|'name'|'visibility'|'version'> & {mine:number};
  return all<Row>(`SELECT a.id, a.kind, a.visibility, p.version, a.owner=? AS mine,
      COALESCE(n.name, CASE WHEN p.version=a.version THEN a.name ELSE '이전 자료판' END) AS name
    FROM active_assets a JOIN asset_publications p ON p.asset=a.id
    LEFT JOIN asset_edition_names n ON n.asset=a.id AND n.version=p.version
    WHERE a.visibility='public' OR (a.visibility='link' AND a.owner<>? AND EXISTS
      (SELECT 1 FROM grants g WHERE g.owner=? AND g.kind='asset' AND g.target=a.id AND g.token=a.token))
    ORDER BY name, a.id`,user.id,user.id,user.id)
    .map(row=>({...row,mine:Boolean(row.mine),publicVersion:row.version}));
}
function saveAssetOnce(user:User,requestKey:unknown,inputs:unknown[],save:()=>ReturnType<typeof assetDto>,edition?:number){
  if(requestKey==null)return save();
  const request=stringArg(requestKey,'자료 저장 요청 번호',120);
  const fingerprint=digest(JSON.stringify(inputs));
  const previous=one<{asset:string;fingerprint:string}>('SELECT asset,fingerprint FROM asset_creation_requests WHERE owner=? AND request_key=?',user.id,request);
  if(previous){
    requireThat(previous.fingerprint===fingerprint,409,'다른 자료 저장에 사용한 요청입니다.');
    const existing=assetRow(previous.asset);
    requireThat(existing.owner===user.id,403,'내 자료만 열 수 있습니다.');
    const saved=assetDto(existing,user,edition);
    return {...saved,version:edition??saved.version};
  }
  const result=save();
  set('INSERT INTO asset_creation_requests(owner,request_key,fingerprint,asset) VALUES(?,?,?,?)',user.id,request,fingerprint,result.id);
  return result;
}
function storeEdition(user:User,kind:AssetKind,name:string,payload:Payload,previous?:Asset|null){
  const id=previous?.id??key(),version=(previous?.version??0)+1;
  if(previous)set('UPDATE assets SET name=?,version=? WHERE id=?',name,version,id);
  else set('INSERT INTO assets VALUES(?,?,?,?,?,?,?)',id,user.id,name,kind,'private',key(),version);
  set('INSERT INTO asset_versions VALUES(?,?,?,?)',id,version,JSON.stringify(payload),now());
  set('INSERT INTO asset_edition_names VALUES(?,?,?)',id,version,name);
  return assetDto(assetRow(id),user);
}

/** Created inside the lesson transaction. This edition never stores an endpoint or credential. */
export function createLibraryLookupConnection(user:User,name:string){
  return storeEdition(user,'mcp',name,{
    builtin:'library',content:'',tools:['reservations.list'],readOnlyTools:['reservations.list'],
  });
}

export function writeAsset(user:User,b:any){
  const prev=b.id?assetRow(b.id):null;requireThat(!prev||prev.owner===user.id,403,'내 자료만 편집할 수 있습니다.');
  const kind=prev?.kind??b.kind;requireThat(['skill','mcp','document','knowledge'].includes(kind),400,'자료 유형을 확인하세요.');
  if(prev?.kind==='mcp')requireThat(!readAsset(user,prev.id,prev.version).payload.builtin,409,'기본 도서관 MCP의 도구 설정은 고정되어 있습니다.');
  const name=stringArg(b.name,'이름',120),payload=cleanPayload(user,kind,b.payload);
  function persist(){const a=prev?assetRow(prev.id):null;requireThat(!a||Number(b.baseVersion)===a.version,409,'자료의 다른 판이 먼저 저장되었습니다.');
    return storeEdition(user,kind,name,payload,a);}
  const base=Number(b.baseVersion);
  const save=()=>prev
    ?saveAssetOnce(user,b.requestKey,['edition',prev.id,base,kind,name,payload],persist,base+1)
    :saveAssetOnce(user,b.requestKey,['save',kind,name,payload],persist,1);
  return db().isTransaction?save():tx(save);
}
export function assetShare(user:User,id:string,v:unknown,rotate:boolean,requested?:number|string,revision?:number) {return tx(()=>{const a=assetRow(id);requireThat(a.owner===user.id&&user.login,403,'로그인한 소유자만 공유할 수 있습니다.');
  const stale='자료가 변경되었습니다. 현재 게시판과 공개 범위를 확인한 뒤 다시 선택하세요.';
  requireThat(revision===undefined||revision===a.revision,409,stale);
  if(rotate){
    const published=publishedEdition(a);
    requireThat(a.visibility==='link'&&published&&(requested===undefined||edition(requested)===published),409,stale);
    set('UPDATE assets SET token=? WHERE id=?',key(),id);
    return assetDto(assetRow(id),user);
  }
  const audience=visibility(v),n=edition(requested??a.version);
  requireThat(one('SELECT 1 FROM asset_versions WHERE asset=? AND number=?',id,n),404,'자료 버전을 찾을 수 없습니다.');
  set('UPDATE assets SET visibility=?,token=? WHERE id=?',audience,a.visibility!==audience?key():a.token,id);
  if(audience==='private'){
    set('DELETE FROM asset_releases WHERE asset=?',id);set('DELETE FROM asset_publications WHERE asset=?',id);set('DELETE FROM asset_release_audiences WHERE asset=?',id);
  }else{
    set('INSERT OR IGNORE INTO asset_releases VALUES(?,?)',id,n);set('INSERT OR REPLACE INTO asset_publications VALUES(?,?)',id,n);set('INSERT OR REPLACE INTO asset_release_audiences VALUES(?,?,?)',id,n,audience);
  }
  return assetDto(assetRow(id),user);});}
export function grant(user:User,kind:'project'|'asset',target:string,token:string){
  if(kind==='asset'){
    set(`INSERT OR REPLACE INTO grants(owner,kind,target,token)
      SELECT ?,'asset',id,token FROM active_assets WHERE id=? AND visibility='link' AND token=?`,user.id,target,token);
  }else set('INSERT OR REPLACE INTO grants VALUES(?,?,?,?)',user.id,kind,target,token);
}
export function copyAssetInTransaction(user:User,id:string,version?:number|string,token?:string,destination?:string,sharedCatalog=false){const {asset,payload}=loadEdition(readableEdition(user,assetRow(id),version,token,sharedCatalog));const copy={...payload};delete copy.credentialEnv;
  if(asset.owner!==user.id||sharedCatalog)delete copy.testUrl;
  const target=destination?assetRow(destination):null;
  if(target)requireThat(target.id!==asset.id&&target.owner===user.id&&target.kind===asset.kind&&target.visibility==='private',409,'사본의 자료 정보를 확인하세요.');
  return storeEdition(user,asset.kind,asset.name.slice(0,117)+' 사본',copy,target);}
export function copyAsset(user:User,id:string,version?:number|string,token?:string,requestKey?:string,sharedCatalog=false){
  return tx(()=>saveAssetOnce(user,requestKey,[sharedCatalog?'shared-copy':'copy',id,version??null],()=>copyAssetInTransaction(user,id,version,token,undefined,sharedCatalog)));
}
export function pins(graph:Graph,user:User,publication?:Visibility):Graph{
  const copy=normalizeKnowledgeReferences(structuredClone(graph));
  function visit(g:Graph){for(const n of g.nodes){if(n.config.assetId){
    const{asset:a,version,payload}=readAsset(user,n.config.assetId,n.config.version,n.config.assetGrant);
    if(publication==='public')requireThat(a.visibility==='public',409,a.name+'의 공개 가능한 자료판을 선택하세요.');
    if(publication==='link')requireThat(a.visibility!=='private',409,a.name+'의 공유 가능한 자료판을 선택하세요.');
    const appropriate=n.type==='resource.context'?a.kind==='document'||a.kind==='knowledge':n.type==='instruction.skill'?a.kind==='skill':n.type==='connection.mcp'&&a.kind==='mcp';
    requireThat(appropriate,422,n.title+'에 맞는 유형의 자료를 연결하세요.');
    if(publication&&publication!=='private')requireThat(sharedEditions(a,publication).includes(version),409,a.name+'의 해당 버전을 먼저 같은 범위로 공유하세요.');
    requireThat(!(a.kind==='skill'&&payload.requiresScripts),409,a.name+'에는 지원하지 않는 필수 스크립트가 있습니다.');
    n.config.version=version;delete n.config.content;if(a.visibility==='link')n.config.assetGrant=a.token;else delete n.config.assetGrant;
  }if(n.graph)visit(n.graph);}}
  visit(copy);return copy;
}

