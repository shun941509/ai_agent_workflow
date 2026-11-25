import type {Block,Graph} from '../domain';
import type {ExportMcp,ExportPackage,ExportResource} from '../domain/agent-export';
import {exportMcp} from './agent-mcp-export';
import {normalizeKnowledgeReferences} from '../domain/knowledge-reference';
import type {User} from './auth';
import {readAsset,skillFiles,type BundleFile} from './assets';
import {digest,tx} from './db';
import {requireThat,stringArg,StudioError} from './errors';
import {exportCollectionSources,type ExportCollectionStage} from './knowledge';
import {graphShape,owned,stripGraphGrants} from './projects';
import {resolveWorkflowRefs} from './workflow-refs';

type ExportInput = {id:unknown; title:unknown; graph:unknown; selected?:unknown; previewId?:unknown};
type ResourceKind = ExportResource['kind'];
type Material = {key:string; name:string; kind:ResourceKind; version:string; available:boolean; content?:string; attachments?:BundleFile[]; mcp?:ExportMcp};
const byteLimit=32*1024*1024;
const materialKey=(...parts:unknown[])=>'r-'+digest(JSON.stringify(parts)).slice(0,24);
const sourceKey=(origin:string,id:string,version:string,content:string)=>materialKey('source',origin,id,version,digest(content));
const isUnavailable=(error:unknown)=>error instanceof StudioError&&[400,403,404,409,422].includes(error.status);
const mainName=(kind:ResourceKind)=>kind==='skill'?'SKILL.md':kind==='workflow'?'AGENTS.md':'source.md';
const credentialField=/^(?:credentialEnv|testUrl|authorization|proxy-authorization|api[_-]?key|x-api-key|(?:access|refresh|bearer)?[_-]?token|password|(?:client[_-]?)?secret|secretAccessKey|private[_-]?key)$/i;
const collectionBindings={
  release:'exportCollection',draft:'exportDraft',index:'exportIndex','published-digest':'exportPublished',
} as const;

// Only take package files from validated Skill uploads. Local credentials never belong in a portable bundle.
function portableAttachment(path:string){
  return !path.split('/').some(part=>/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.git|\.npmrc|\.pypirc|id_(?:rsa|ed25519)|.*\.(?:key|pem|p12|pfx))$/i.test(part));
}

function collect(user:User,input:ExportInput,selected?:Set<string>):ExportPackage {
  const projectId=stringArg(input.id,'Agent',160);
  owned(user,projectId);
  const title=stringArg(input.title,'Agent 이름',140);
  const missingChildren=new WeakSet<Block>();
  const graph=normalizeKnowledgeReferences(resolveWorkflowRefs(graphShape(input.graph),user,projectId,{
    expand:true,onUnavailable:node=>missingChildren.add(node),
  }));
  const resources=new Map<string,ExportPackage['resources'][number]>(),files:BundleFile[]=[];
  const names=new Map<string,string>(),usedNames=new Set<string>();
  const producedStages=new Set<string>();
  const missingCollections:{node:Block; stage:ExportCollectionStage; producer:string; material:Material; step:string}[]=[];
  let bytes=0;

  function register(material:Material,steps:string[]){
    const {key,name,kind,version,available}=material;
    const existing=resources.get(key);
    if(existing){
      existing.steps=[...new Set([...existing.steps,...steps])];
      return key;
    }
    const included=available&&Boolean(selected?.has(key));
    const directory='resources/'+key+'/';
    const paths=kind==='mcp'?[]:[directory+mainName(kind)];
    const resource:ExportPackage['resources'][number]={key,name,kind,version,available,included,steps:[...new Set(steps)],files:paths};
    if(material.mcp){
      resource.mcpMode=material.mcp.url?'remote':'manual';
      if(material.mcp.url)resource.mcpUrl=material.mcp.url;
      if(included)resource.mcp=material.mcp;
    }
    resources.set(key,resource);
    if(included&&kind!=='mcp'){
      const content=material.content??'';
      bytes+=Buffer.byteLength(content);
      requireThat(bytes<=byteLimit,413,'선택한 자료가 32 MiB를 넘습니다. 자료 선택을 줄여 주세요.');
      files.push({path:paths[0],data:Buffer.from(content).toString('base64')});
      if(material.attachments?.length){
        for(const file of skillFiles(material.attachments)){
          if(file.path.toLowerCase()==='skill.md'||!portableAttachment(file.path))continue;
          bytes+=Buffer.byteLength(file.data,'base64');
          requireThat(bytes<=byteLimit,413,'선택한 자료가 32 MiB를 넘습니다. 자료 선택을 줄여 주세요.');
          const path=directory+file.path;
          paths.push(path);
          files.push({path,data:file.data});
        }
      }
    }
    return key;
  }

  function connectedMaterial(node:Block,kind:ResourceKind,path:string[],origin:string):Material{
    const c=node.config,version=String(c.version||'1'),content=String(c.content??'');
    const key=node.type==='resource.context'?sourceKey(origin,node.id,version,content):materialKey('inline',path,version,digest(content));
    const fallback={key,kind,name:node.title,version,available:kind!=='mcp'&&content.length>0,content};
    if(!c.assetId){
      if(kind==='mcp'&&typeof c.server==='string'&&c.server.trim()){
        const server=c.server.trim(),key=materialKey('manual-mcp',path,version,server);
        const label=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(server)?server:node.title;
        return {...fallback,key,available:true,mcp:exportMcp(key,label)};
      }
      return fallback;
    }
    try{
      const item=readAsset(user,String(c.assetId),c.version||undefined,c.assetGrant);
      const appropriate=kind==='document'?['document','knowledge'].includes(item.asset.kind):kind===item.asset.kind;
      requireThat(appropriate,422,'블록과 연결 자료의 유형이 다릅니다.');
      node.config.version=item.version;
      if(item.asset.kind==='skill'&&item.payload.requiresScripts)node.config.requiresScripts=true;
      const key=materialKey('asset',item.asset.id,item.version);
      return {key,kind:item.asset.kind,name:item.asset.name,version:String(item.version),available:true,
        content:item.payload.content,attachments:item.payload.files,
        ...(kind==='mcp'?{mcp:exportMcp(key,item.asset.name,item.payload)}:{})};
    }catch(error){
      if(!isUnavailable(error))throw error;
      return {...fallback,key:materialKey('missing',path),available:false,content:undefined};
    }
  }

  function collection(node:Block,origin:string,step:string){
    const c=node.config,name=String(c.storeKey),version=String(c.version||'1'),identity=materialKey('collection',origin,name);
    let localName=names.get(identity);
    if(!localName){
      localName=name;
      for(let i=2;usedNames.has(localName);i++)localName=name+' ('+i+')';
      names.set(identity,localName);usedNames.add(localName);
    }
    c.storeKey=localName;
    const edition=materialKey(identity,version);
    const manage=node.type==='knowledge.manage';
    if(manage&&c.operation==='publish')producedStages.add(edition+'release');
    if(manage&&c.operation==='index')producedStages.add(edition+'index');
    const stages:ExportCollectionStage[]=manage?['draft']:['release'];
    if(manage&&c.operation==='withdraw')stages.push('release');
    if(manage&&c.operation==='publish')stages.push('release','index','published-digest');
    for(const stage of stages){
      const binding=collectionBindings[stage];
      const missing:Material={key:materialKey(edition,stage,'missing'),kind:'knowledge',name,version,available:false};
      try{
        const documents=exportCollectionSources(user,origin,name,version,stage,manage);
        if(documents){
          c[binding]=documents.map(doc=>register({
            key:doc.assetId?materialKey('asset',doc.assetId,Number(doc.version)):sourceKey(origin,doc.id,String(doc.version),doc.content),
            kind:'document',name:doc.title,version:String(doc.version),available:true,content:doc.content,
          },[step]));
        }else if(stage==='release'&&(!manage||c.operation==='withdraw')||stage==='index'){
          // A different block can publish or index this edition during the exported run.
          missingCollections.push({node,stage,producer:edition+stage,material:missing,step});
        }
      }catch(error){
        if(!isUnavailable(error))throw error;
        c[binding]=[register(missing,[step])];
      }
    }
  }

  function visit(current:Graph,origin:string,ids:string[],titles:string[]){
    for(const node of current.nodes){
      const c=node.config,path=[...ids,node.id],labels=[...titles,node.title],step=labels.join(' › ');
      delete c.exportResource;
      for(const binding of Object.values(collectionBindings))delete c[binding];
      delete c.knowledgeBinding;
      for(const field of Object.keys(c))if(credentialField.test(field))delete c[field];
      if(c.args&&typeof c.args==='object')
        c.args=JSON.parse(JSON.stringify(c.args,(field,value)=>credentialField.test(field)?undefined:value));
      const linkedWorkflow=['workflow.call','workflow.tool'].includes(node.type)&&c.workflowId;
      if(missingChildren.has(node)){
        c.exportResource=register({key:materialKey('workflow',path),kind:'workflow',name:node.title,version:String(c.version??''),available:false},[step]);
      }
      if(node.graph)visit(node.graph,linkedWorkflow?String(c.workflowId):origin,path,labels);
      if(linkedWorkflow)delete c.workflowId;
      if(c.storeKey&&['knowledge.manage','knowledge.search'].includes(node.type))collection(node,origin,step);
      const kind=node.type==='instruction.skill'?'skill':node.type==='connection.mcp'?'mcp':
        node.type==='resource.context'||(node.type==='file.input'&&c.content)?'document':undefined;
      if(!kind)continue;
      const material=connectedMaterial(node,kind,path,origin);
      const targets=current.edges.filter(edge=>edge.from===node.id).map(edge=>current.nodes.find(candidate=>candidate.id===edge.to))
        .filter((target):target is Block=>Boolean(target)).map(target=>[...titles,target.title].join(' › '));
      c.exportResource=register(material,[step,...targets]);
      delete c.content;
      if(kind==='mcp'){
        // Only the pinned, readable edition can provide an exportable endpoint or tool list.
        node.config={exportResource:c.exportResource,...(c.assetId?{assetId:c.assetId}:{}),version:c.version};
      }else delete c.assetId;
    }
  }
  visit(graph,projectId,[],[]);
  for(const pending of missingCollections){
    if(!producedStages.has(pending.producer))
      pending.node.config[collectionBindings[pending.stage]]=[register(pending.material,[pending.step])];
  }
  stripGraphGrants(graph);
  if(selected)requireThat([...selected].every(key=>resources.get(key)?.included),409,'자료판이나 접근 권한이 변경되었습니다. 내보내기를 다시 열어 자료 목록을 확인하세요.');
  return {title,graph,resources:[...resources.values()],files};
}

function preview(pkg:ExportPackage){
  const resources=pkg.resources.map(({included,files,mcp,...resource})=>resource);
  const previewId=digest(JSON.stringify([pkg.title,pkg.graph,resources]));
  return {resources,previewId};
}

export function previewAgentExport(user:User,input:ExportInput){
  return preview(tx(()=>collect(user,input)));
}

export function prepareAgentExport(user:User,input:ExportInput){
  requireThat(Array.isArray(input.selected)&&input.selected.every(key=>typeof key==='string'),400,'포함할 자료 목록을 확인하세요.');
  const selected=new Set<string>(input.selected);
  const pkg=tx(()=>collect(user,input,selected));
  requireThat(typeof input.previewId==='string'&&input.previewId===preview(pkg).previewId,409,
    '연결한 설계나 자료판이 변경되었습니다. 자료를 다시 확인한 뒤 내려받으세요.');
  for(const resource of pkg.resources)delete resource.mcpUrl;
  return pkg;
}
