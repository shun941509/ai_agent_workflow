import {createBlock,type Block,type Graph} from '../domain';
import type {KnowledgeCollection,KnowledgeSnapshot,Source} from '../engine';
import {token} from '../engine/session';
import {buildIndex,originalPassageLines,type IndexedPassage} from '../engine/values';
import type {User} from './auth';
import {pins,readAsset,type Visibility} from './assets';
import {all,one,set,tx} from './db';
import {requireThat,StudioError} from './errors';

type Collection={project:string;owner:string;scope:string;collection:string;version:string};
type SourcePin={assetId:string;version:string;assetGrant?:string};
type Receipt={project:string;scope:string;collection:string;version:string;digest:string};

function collection(project:string,scope:string,name:unknown,version:unknown):Collection{
  requireThat(typeof name==='string'&&name.trim()&&(typeof version==='number'&&Number.isSafeInteger(version)||typeof version==='string'&&version.trim()),422,'자료집 이름과 고정 버전을 입력하세요.');
  const row=one<{owner:string}>('SELECT owner FROM active_projects WHERE id=?',project);
  requireThat(row,404,'자료집이 속한 Agent를 찾을 수 없습니다.');
  return {project,owner:row.owner,scope,collection:name,version:String(version)};
}
function prefix(c:Collection){return 'knowledge:'+token(c.collection)+':';}
function load(c:Collection,key:string){return one<{value:string}>('SELECT value FROM memory WHERE owner=? AND project=? AND scope=? AND name=?',c.owner,c.project,c.scope,prefix(c)+key)?.value;}
function write(c:Collection,key:string,value:string){set('INSERT OR REPLACE INTO memory VALUES(?,?,?,?,?)',c.owner,c.project,c.scope,prefix(c)+key,value);}
function requiredSnapshot(c:Collection,digest:string){
  const stored=load(c,'snapshot:'+digest);
  requireThat(stored,409,'색인된 자료판을 찾을 수 없습니다.');
  return JSON.parse(stored) as KnowledgeSnapshot;
}
function checkPins(user:User,refs:SourcePin[],audience?:Visibility){
  const graph={nodes:refs.map((config,i)=>createBlock('resource.context',{id:'source-'+i,config})),edges:[]};
  return pins(graph,user,audience).nodes.map(({config})=>({assetId:String(config.assetId),version:String(config.version),...(config.assetGrant?{assetGrant:String(config.assetGrant)}:{})}));
}
function sourcePins(snapshot:Pick<KnowledgeSnapshot,'documents'>,attached:Map<string,SourcePin>){
  const refs=new Map<string,SourcePin>();
  for(const doc of snapshot.documents)if(doc.assetId){
    const key=doc.assetId+':'+doc.version;
    refs.set(key,attached.get(key)??{assetId:doc.assetId,version:doc.version});
  }
  return [...refs.values()];
}
function authorize(user:User,c:Collection,expected?:string,audience?:Visibility){
  const digest=load(c,'release:'+c.version);
  requireThat(digest&&(!expected||digest===expected),409,'검색 가능한 자료판을 찾을 수 없습니다. 발행 상태와 고정 버전을 확인하세요.');
  const manifest=load(c,'sources:'+digest);
  // Older indexes contain source identities in the snapshot itself.
  const refs:SourcePin[]=manifest?JSON.parse(manifest):sourcePins(requiredSnapshot(c,digest),new Map());
  checkPins(user,refs,audience);
  return digest;
}
function walk(graph:Graph,project:string,visit:(node:Block,project:string)=>void){
  for(const node of graph.nodes){
    visit(node,project);
    if(node.graph)walk(node.graph,(node.type==='workflow.tool'||node.type==='workflow.call')&&node.config.workflowId||project,visit);
  }
}

function inlineDocument({id,title,config}:Block):Source{
  return {id,title,version:String(config.version||'1'),content:String(config.content??'')};
}

export function evictInlineDocumentIndexes(graph:Graph){
  walk(graph,'',node=>{
    if(node.type==='resource.context'&&!node.config.assetId)
      set('DELETE FROM knowledge_document_indexes WHERE digest=?',token(inlineDocument(node)));
  });
}

export function evictAssetKnowledgeInTransaction(ids: readonly string[]) {
  const selected = JSON.stringify(ids);
  const assets = 'SELECT value FROM json_each(?)';
  // Once source receipts have been erased, their conversations must remain closed.
  set(`INSERT OR IGNORE INTO revoked_knowledge_history(conversation)
       SELECT conversation FROM knowledge_source_reads WHERE asset IN (${assets})`, selected);
  set(`DELETE FROM knowledge_source_reads WHERE asset IN (${assets})`, selected);
  set(`DELETE FROM knowledge_document_indexes
       WHERE json_extract(entries,'$[0].passage.assetId') IN (${assets})`, selected);
  // Discard materialized text. The release digest, manifests and collection read receipts
  // still identify the unavailable edition, including when reopening historical runs.
  for (const [part, documentsPath] of [['draft','$'], ['snapshot','$.documents']]) {
    // Collection names are hashed. A version string can itself contain colons.
    const name = 'knowledge:' + '?'.repeat(64) + ':' + part + ':*';
    set(`DELETE FROM memory WHERE name GLOB ? AND EXISTS (
           SELECT 1 FROM json_tree(CASE WHEN json_valid(memory.value) THEN memory.value END, ?) doc
           WHERE doc.key='assetId' AND doc.atom IN (${assets})
         )`, name, documentsPath, selected);
  }
}

/** Publish only a searchable edition whose original sources cover the Agent's full audience. */
export function validateKnowledgePublication(graph:Graph,project:string,user:User,visibility:Visibility){
  const documents:Block[]=[],lookups:Collection[]=[],producers=new Set<string>();
  let searches=false;
  walk(graph,project,(node,origin)=>{
    if(node.type==='resource.context')documents.push(node);
    if(node.type==='knowledge.search'||node.type==='agent.task'&&node.config.allowedTools?.includes('knowledge.search'))searches=true;
    if(!node.config.storeKey)return;
    if(node.type==='knowledge.manage'&&node.config.operation==='publish')producers.add(token([origin,node.config.storeKey,String(node.config.version)]));
    if(node.type==='knowledge.search')lookups.push(collection(origin,'live',node.config.storeKey,node.config.version));
  });
  for(const c of lookups){
    if(visibility==='private'&&c.owner===user.id&&producers.has(token([c.project,c.collection,c.version]))&&!load(c,'release:'+c.version))continue;
    authorize(user,c,undefined,visibility);
    if(visibility!=='private')authorize({id:'@publication-reader',login:null},c);
  }
  if(searches)for(const node of documents){
    const {config}=node;
    let doc=inlineDocument(node);
    if(config.assetId){
      const {asset,payload,version}=readAsset(user,config.assetId,config.version,config.assetGrant);
      doc={id:asset.id,title:asset.name,version:String(version),content:payload.content,assetId:asset.id};
    }
    const digest=token(doc);
    if(!one('SELECT 1 FROM knowledge_document_indexes WHERE digest=?',digest))
      set('INSERT INTO knowledge_document_indexes VALUES(?,?)',digest,JSON.stringify(buildIndex([doc])));
  }
}

export function publishedSourceIndex(documents:Source[]):IndexedPassage[]{
  return documents.flatMap(doc=>{
    const stored=one<{entries:string}>('SELECT entries FROM knowledge_document_indexes WHERE digest=?',token(doc));
    return stored?originalPassageLines(JSON.parse(stored.entries),[doc]):buildIndex([doc]);
  });
}

/** A design JSON carries collection names, while published editions belong to their project. */
export function missingImportedCollections(graph:Graph,projectId:string,user:User){
  const missing=new Set<string>();
  walk(graph,projectId,(node,origin)=>{
    if(!node.config.storeKey || !['knowledge.search','knowledge.manage'].includes(node.type))return;
    const name=String(node.config.storeKey),version=String(node.config.version??'');
    if(!version){missing.add(name+' · 버전 미지정');return;}
    if(!origin){missing.add(name+' · '+version+'판');return;}
    const c=collection(origin,'live',name,version);
    try{authorize(user,c);}
    catch(error){if(!(error instanceof StudioError))throw error;missing.add(name+' · '+version+'판');}
  });
  return [...missing];
}

/** Materialize searchable editions alongside copied workflows, then install them under the new owner. */
export function prepareKnowledgeCopy(graph:Graph,sourceProject:string,user:User,copyAsset:(ref:SourcePin)=>{id:string;version:number}){
  const editions=new Map<string,{collection:string;version:string;snapshot:KnowledgeSnapshot}>();
  const names=new Map<string,string>(),used=new Set<string>();
  walk(graph,sourceProject,(node,origin)=>{
    if(!['knowledge.search','knowledge.manage'].includes(node.type)||!node.config.storeKey)return;
    const name=String(node.config.storeKey),id=token([origin,name]);
    let target=names.get(id);
    if(!target){
      target=name;
      for(let i=2;used.has(target);i++)target=name+' ('+i+')';
      names.set(id,target);used.add(target);
    }
    node.config.storeKey=target;
    if(node.type!=='knowledge.search')return;
    const c=collection(origin,'live',name,node.config.version),edition=token([origin,name,c.version]);
    if(editions.has(edition)||c.owner===user.id&&!load(c,'release:'+c.version))return;
    const digest=authorize(user,c),source=requiredSnapshot(c,digest);
    const manifest=load(c,'sources:'+digest),refs:SourcePin[]=manifest?JSON.parse(manifest):sourcePins(source,new Map());
    const remapped=new Map(refs.map(ref=>[ref.assetId+':'+ref.version,copyAsset(ref)]));
    const documents=source.documents.map(doc=>{
      if(!doc.assetId)return doc;
      const next=remapped.get(doc.assetId+':'+doc.version);
      requireThat(next,409,'색인의 원본 자료 버전을 확인할 수 없습니다.');
      const {asset}=readAsset(user,next.id,next.version);
      return {...doc,id:next.id,assetId:next.id,title:asset.name,version:String(next.version)};
    });
    editions.set(edition,{collection:target,version:c.version,snapshot:{documents,version:c.version,index:buildIndex(documents)}});
  });
  return (project:string)=>{
    for(const record of editions.values()){
      const c=collection(project,'live',record.collection,record.version),snap=record.snapshot,digest=token(snap);
      write(c,'snapshot:'+digest,JSON.stringify(snap));write(c,'sources:'+digest,JSON.stringify(sourcePins(snap,new Map())));
      write(c,'draft:'+c.version,JSON.stringify(snap.documents));write(c,'index:'+c.version,digest);
      write(c,'published-digest:'+c.version,digest);write(c,'release:'+c.version,digest);
    }
  };
}

/** Recheck all sources already supplied to this conversation, including on resume and trace reads. */
export function authorizeKnowledgeHistory(user:User,conversation:string,graph:Graph,project:string,scope:string){
  requireThat(!one('SELECT 1 FROM revoked_knowledge_history WHERE conversation=?',conversation),403,'실행에서 사용한 자료가 영구 삭제되어 기록을 열 수 없습니다.');
  const receipts=all<Receipt>('SELECT * FROM knowledge_reads WHERE conversation=?',conversation);
  for(const r of receipts)authorize(user,collection(r.project,r.scope,r.collection,r.version),r.digest);
  const sources=all<SourcePin>('SELECT asset AS assetId,version,source_grant AS assetGrant FROM knowledge_source_reads WHERE conversation=?',conversation);
  if(sources.length)checkPins(user,sources);
  // Old workers recorded the lookup in the checkpoint but stored the collection in the runner's personal namespace.
  // Reauthorize that exact edition before exposing saved excerpts or reusing history.
  walk(graph,project,(node,origin)=>{
    if(node.type!=='knowledge.search'||!node.config.storeKey)return;
    const name=node.config.storeKey,version=String(node.config.version??'');
    if(receipts.some(r=>r.project===origin&&r.collection===name&&r.version===version))return;
    const old=one(`SELECT 1 FROM runs r,json_each(r.checkpoint,'$.events') e WHERE r.conversation=?
      AND json_extract(e.value,'$.nodeId')=? AND json_extract(e.value,'$.kind')='lookup' LIMIT 1`,conversation,node.id);
    if(!old)return;
    const c=collection(origin,scope,name,version);
    requireThat(c.owner===user.id&&origin===project,403,'이전 검색 실행의 자료 권한을 확인할 수 없습니다.');
    const digest=authorize(user,c);
    set('INSERT OR IGNORE INTO knowledge_reads VALUES(?,?,?,?,?,?)',conversation,origin,scope,name,version,digest);
  });
}

export function bindKnowledge(graph:Graph,project:string,user:User,conversation:string,testScope?:string){
  const origins=new WeakMap<Block,string>(),attached=new Map<string,SourcePin>(),registered=new Map<string,string>();
  walk(graph,project,(node,origin)=>{
    const config=node.config;
    if(config.assetId)attached.set(config.assetId+':'+config.version,{assetId:config.assetId,version:String(config.version),assetGrant:config.assetGrant});
    if(!['knowledge.manage','knowledge.search'].includes(node.type)||!config.storeKey)return;
    origins.set(node,origin);
    // A resumed callable Workflow can come from its JSON checkpoint. Bind it only to a collection in the resolved graph.
    config.knowledgeBinding=token([origin,node.type,config.storeKey,config.version]);
    registered.set(config.knowledgeBinding,origin);
  });
  return (node:Block):KnowledgeCollection=>{
    const config=node.config,origin=origins.get(node)??registered.get(config.knowledgeBinding);
    requireThat(origin&&config.knowledgeBinding===token([origin,node.type,config.storeKey,config.version]),403,'이 설계에 연결되지 않은 자료집입니다.');
    const c=collection(origin,testScope??'live',config.storeKey,config.version);
    const manage=()=>requireThat(node.type==='knowledge.manage'&&user.id===c.owner,403,'자료집을 만든 사용자만 색인하거나 발행할 수 있습니다.');
    const currentRelease=()=>load(c,'release:'+c.version)??(testScope?load({...c,scope:'live'},'release:'+c.version):undefined);
    return {
      async read(){return tx(()=>{
        // A test can read the live edition until the test publishes or withdraws its own edition.
        const source=testScope&&load(c,'release:'+c.version)===undefined?{...c,scope:'live'}:c;
        const digest=authorize(user,source);
        set('INSERT OR REPLACE INTO knowledge_reads VALUES(?,?,?,?,?,?)',conversation,source.project,source.scope,source.collection,source.version,digest);
        return requiredSnapshot(source,digest);
      });},
      async stage(key,value){return tx(()=>{
        manage();const head=prefix(c);requireThat(key.startsWith(head),403,'자료집 범위를 확인하세요.');
        const part=key.slice(head.length);
        if(value===undefined&&part==='release:'+c.version)return currentRelease();
        if(value!==undefined){
          if(part.startsWith('snapshot:')){
            const snapshot=JSON.parse(value) as KnowledgeSnapshot,digest=part.slice('snapshot:'.length);
            requireThat(token(snapshot)===digest,409,'색인 내용과 자료판 식별자가 다릅니다.');
            const refs=checkPins(user,sourcePins(snapshot,attached));
            // Source grants are captured once. Rebuilding an identical snapshot cannot refresh revoked links.
            if(load(c,part)===undefined){write(c,part,value);write(c,'sources:'+digest,JSON.stringify(refs));}
          }else if(part.startsWith('draft:')){
            const refs=checkPins(user,sourcePins({documents:JSON.parse(value)},attached));
            write(c,part,value);write(c,'sources-'+part,JSON.stringify(refs));
          }else write(c,part,value);
        }
        if(value===undefined&&part.startsWith('snapshot:')){
          const id=part.slice('snapshot:'.length);
          const source=testScope&&!load(c,part)&&currentRelease()===id?{...c,scope:'live'}:c;
          const snapshot=requiredSnapshot(source,id),manifest=load(source,'sources:'+id);
          const refs=checkPins(user,manifest?JSON.parse(manifest):sourcePins(snapshot,attached));
          for(const ref of refs)set('INSERT OR REPLACE INTO knowledge_source_reads VALUES(?,?,?,?)',conversation,ref.assetId,ref.version,ref.assetGrant??null);
          return JSON.stringify(snapshot);
        }
        const stored=load(c,part);
        if(stored&&part.startsWith('draft:')){
          const manifest=load(c,'sources-'+part),refs=checkPins(user,manifest?JSON.parse(manifest):sourcePins({documents:JSON.parse(stored)},attached));
          for(const ref of refs)set('INSERT OR REPLACE INTO knowledge_source_reads VALUES(?,?,?,?)',conversation,ref.assetId,ref.version,ref.assetGrant??null);
        }
        return stored;
      });},
      async release(operation,approvedDigest,operationId){manage();tx(()=>{
        const receipt='operation:'+operationId;
        if(load(c,receipt)===approvedDigest)return;
        const current=operation==='publish'?load(c,'index:'+c.version):currentRelease();
        requireThat(current&&current===approvedDigest,409,'승인할 자료판이 변경되었습니다. 다시 확인하세요.');
        if(operation==='publish'){
          requireThat(currentRelease()!==current,409,'이미 발행한 자료판입니다.');
          const original=load(c,'published-digest:'+c.version);
          requireThat(!original||original===current,409,'게시 자료판은 변경할 수 없습니다. 새 버전을 사용하세요.');
          const manifest=load(c,'sources:'+current);
          checkPins(user,manifest?JSON.parse(manifest):sourcePins(requiredSnapshot(c,current),attached));
          write(c,'published-digest:'+c.version,current);
        }
        write(c,'release:'+c.version,operation==='publish'?current:'');
        write(c,receipt,approvedDigest);
      });}
    };
  };
}
