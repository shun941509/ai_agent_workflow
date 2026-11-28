import type {Block,Graph} from '../domain';
import {exportStepNames,exportStepPaths,sharedEditionLabel,type ExportMcp,type ExportPackage,type ExportResource} from '../domain/agent-export';
import {designPreparation} from '../domain/export-design-preparation';
import {resourcePreparation} from '../domain/export-resource-preparation';
import {exportMcp} from './agent-mcp-export';
import {authoredSkillName} from './agent-skill-export';
import {locateMaterialFiles,type MaterialFiles} from './agent-material-files';
import {normalizeKnowledgeReferences} from '../domain/knowledge-reference';
import type {User} from './auth';
import {readAsset,skillFiles,type BundleFile} from './assets';
import {digest,tx} from './db';
import {requireThat,stringArg,StudioError} from './errors';
import {exportCollectionSources,exportPublicationStatus,type ExportCollectionStage} from './knowledge';
import {graphShape,owned,stripGraphGrants} from './projects';
import {resolveExportWorkflowRefs} from './workflow-refs';

type ExportInput = {id:unknown; title:unknown; graph:unknown; selected?:unknown; previewId?:unknown};
type ResourceKind = ExportResource['kind'];
type Material = {key:string; name:string; kind:ResourceKind; version:string; available:boolean; content?:string; attachments?:BundleFile[]; mcp?:ExportMcp; source?:ExportPackage['resources'][number]['source']; unavailableReason?:ExportResource['unavailableReason']};
const byteLimit=32*1024*1024;
const materialKey=(...parts:unknown[])=>'r-'+digest(JSON.stringify(parts)).slice(0,24);
const sourceKey=(origin:string,id:string,version:string,content:string)=>materialKey('source',origin,id,version,digest(content));
const isUnavailable=(error:unknown)=>error instanceof StudioError&&[400,403,404,409,422].includes(error.status);
const mainName=(kind:ResourceKind)=>kind==='skill'?'SKILL.md':kind==='workflow'?'AGENTS.md':'source.md';
const credentialField=/^(?:credentialEnv|testUrl|authorization|proxy-authorization|api[_-]?key|x-api-key|(?:access|refresh|bearer)?[_-]?token|password|(?:client[_-]?)?secret|secretAccessKey|private[_-]?key)$/i;
const argumentReference=/^\{\{\s*[\p{L}\p{N}_.-]+\s*\}\}$/u;
function portableArgs(value:unknown,required:string[],path:string[]=[],sensitive=false):unknown{
  if(Array.isArray(value))return value.map((item,index)=>portableArgs(item,required,[...path,String(index)],sensitive));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,item])=>
    [field,portableArgs(item,required,[...path,field],sensitive||credentialField.test(field))]));
  if(!sensitive||value==null||typeof value==='string'&&argumentReference.test(value))return value;
  const type=typeof value==='number'?'숫자':typeof value==='boolean'?'참·거짓':'문자열';
  required.push(path.join('.')+' ('+type+')');
  return '<실행 환경에서 입력>';
}
const collectionBindings={
  release:'exportCollection',draft:'exportDraft',index:'exportIndex','published-digest':'exportPublished',
} as const;

// A later block or an independent branch cannot supply the edition for this invocation.
function hasPriorStage(graph:Graph,node:Block,stage:'release'|'index',stored:boolean) {
  const memo=new Map<string,boolean>(),active=new Set<string>();
  const nodes=new Map(graph.nodes.map(item=>[item.id,item]));
  function before(id:string):boolean {
    if(memo.has(id))return memo.get(id)!;
    if(active.has(id))return false;
    active.add(id);
    const incoming=graph.edges.filter(e=>e.kind==='flow'&&e.to===id);
    const ready=incoming.length?incoming.every(edge=>{
      const prior=nodes.get(edge.from);
      if(!prior)return false;
      if(prior.type==='knowledge.manage'&&prior.config.storeKey===node.config.storeKey&&
        String(prior.config.version||'1')===String(node.config.version||'1')&&nodes.get(id)?.type!=='error.handle'){
        if(stage==='release'&&prior.config.operation==='withdraw')return false;
        if(prior.config.operation===(stage==='release'?'publish':'index'))return true;
      }
      return before(prior.id);
    }):stored;
    active.delete(id);memo.set(id,ready);
    return ready;
  }
  return before(node.id);
}

// Only take package files from validated Skill uploads. Local credentials never belong in a portable bundle.
function portableAttachment(path:string){
  return !path.split('/').some(part=>/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.git|\.npmrc|\.pypirc|id_(?:rsa|ed25519)|.*\.(?:key|pem|p12|pfx))$/i.test(part));
}

function collect(user:User,input:ExportInput,selected?:Set<string>):ExportPackage {
  const projectId=stringArg(input.id,'Agent',160);
  const project=owned(user,projectId);
  const title=stringArg(typeof input.title==='string'&&!input.title.trim()?'이름 없는 Agent':input.title,'Agent 이름',140);
  const resolved=resolveExportWorkflowRefs(graphShape(input.graph),user,projectId);
  const graph=normalizeKnowledgeReferences(resolved.graph);
  const resources=new Map<string,ExportPackage['resources'][number]>(),files:BundleFile[]=[];
  const toolsByPin=new Map<string,readonly string[]>();
  const materialFiles=new Map<string,MaterialFiles>();
  const names=new Map<string,string>(),usedNames=new Set<string>();
  const collections:{node:Block; graph:Graph; stage:'release'|'index'; material:Material; step:string; stored:boolean}[]=[];
  let bytes=0;

  function register(material:Material,steps:string[],origin?:string){
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
    if(origin&&available&&['document','knowledge','skill'].includes(kind)){
      const sidecars=material.attachments?.filter(f=>f.path.toLowerCase()!=='skill.md'&&portableAttachment(f.path));
      materialFiles.set(key,{scope:materialKey('files',origin),content:material.content??'',sidecars});
    }
    if(kind==='skill'&&available)resource.skillName=authoredSkillName(material.content??'')??name;
    if(included && material.source)resource.source=material.source;
    if(material.unavailableReason)resource.unavailableReason=material.unavailableReason;
    if(material.mcp){
      resource.mcpMode=material.mcp.url?'remote':'manual';
      if(material.mcp.tokenEnv)resource.requiresAuth=true;
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
    const fallback={key,kind,name:node.title,version,available:kind!=='mcp'&&Boolean(content.trim()),content,
      ...(node.type==='resource.context'?{source:{id:node.id}}:{})};
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
      if(kind==='mcp')toolsByPin.set(JSON.stringify([item.asset.id,item.version]),item.payload.tools??[]);
      if(item.asset.kind==='skill'&&item.payload.requiresScripts)node.config.requiresScripts=true;
      const key=materialKey('asset',item.asset.id,item.version);
      return {key,kind:item.asset.kind,name:item.asset.name,version:String(item.version),available:kind==='mcp'||Boolean(item.payload.content?.trim()),
        content:item.payload.content,attachments:item.payload.files,
        ...(node.type==='resource.context'?{source:{id:item.asset.id,assetId:item.asset.id}}:{}),
        ...(kind==='mcp'?{mcp:exportMcp(key,item.asset.name,item.payload)}:{})};
    }catch(error){
      if(!isUnavailable(error))throw error;
      return {...fallback,key:materialKey('missing',path),available:false,content:undefined};
    }
  }

  function collection(current:Graph,node:Block,origin:string,step:string){
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
    const stages:ExportCollectionStage[]=!manage||c.operation==='withdraw'?['release']:c.operation==='publish'?['index']:['draft'];
    for(const stage of stages){
      const binding=collectionBindings[stage];
      const missing:Material={key:materialKey(edition,stage,'missing'),kind:'knowledge',name,version,available:false};
      try{
        const documents=exportCollectionSources(user,origin,name,version,stage,manage);
        if(manage&&c.operation==='publish')c.exportPublication=exportPublicationStatus(user,origin,name,version);
        if(documents){
          c[binding]=documents.map(doc=>register({
            key:doc.candidateOnly?materialKey('candidate',origin,doc.id,doc.version,doc.location,digest(doc.content)):
              doc.assetId?materialKey('asset',doc.assetId,Number(doc.version)):sourceKey(origin,doc.id,String(doc.version),doc.content),
            kind:'document',name:doc.title,version:String(doc.version),available:Boolean(doc.content.trim()),content:doc.content,
            source:{id:doc.id,assetId:doc.assetId,location:doc.location,candidateOnly:doc.candidateOnly},
          },[step],origin));
        }
        if(stage==='release'||stage==='index')collections.push({graph:current,node,stage,material:{...missing,
          unavailableReason:stage==='release'?'unpublished':'unindexed'},step,stored:Boolean(documents)});
      }catch(error){
        if(!isUnavailable(error))throw error;
        c[binding]=[register(missing,[step])];
      }
    }
  }

  function visit(current:Graph,origin:string,ids:string[],titles:string[],parentPath:string[]){
    const positions=exportStepPaths(current,parentPath);
    const stepNames=exportStepNames(current);
    for(const node of current.nodes){
      const c=node.config,path=[...ids,node.id],labels=[...titles,stepNames.get(node.id)!],step=labels.join(' › ');
      delete c.exportResource;
      delete c.exportSharedEdition;
      delete c.exportPublication;
      const shared=resolved.shared.get(node);
      if(shared)c.exportSharedEdition=shared;
      for(const binding of Object.values(collectionBindings))delete c[binding];
      delete c.knowledgeBinding;
      for(const field of Object.keys(c))if(credentialField.test(field))delete c[field];
      delete c.exportRequiredArgs;
      if(['approval.action','tool.invoke','error.compensate'].includes(node.type)&&c.args){
        const required:string[]=[];
        if(typeof c.args==='object')c.args=portableArgs(c.args,required);
        else if(typeof c.args==='string'&&!argumentReference.test(c.args)){
          c.args='<실행 환경에서 입력>';required.push('요청 인자 전체');
        }
        if(required.length)c.exportRequiredArgs=required;
      }
      const linkedWorkflow=['workflow.call','workflow.tool'].includes(node.type)&&c.workflowId;
      const problem=resolved.problems.get(node);
      if(problem){
        c.exportResource=register({key:materialKey('workflow',path),kind:'workflow',name:node.title,version:String(c.version??''),available:false,
          unavailableReason:problem==='unavailable'?undefined:problem},[step]);
      }
      if(node.graph){
        const position=positions.get(node.id)!;
        visit(node.graph,linkedWorkflow?String(c.workflowId):origin,shared?[shared]:path,
          shared?[sharedEditionLabel(c.version,position)]:labels,position);
      }
      if(linkedWorkflow)delete c.workflowId;
      if(c.storeKey&&['knowledge.manage','knowledge.search'].includes(node.type))collection(current,node,origin,step);
      const kind=node.type==='instruction.skill'?'skill':node.type==='connection.mcp'?'mcp':
        node.type==='resource.context'||(node.type==='file.input'&&c.content)?'document':undefined;
      if(!kind)continue;
      const material=connectedMaterial(node,kind,path,origin);
      const targets=current.edges.filter(edge=>edge.from===node.id).map(edge=>current.nodes.find(candidate=>candidate.id===edge.to))
        .filter((target):target is Block=>Boolean(target)).map(target=>[...titles,stepNames.get(target.id)!].join(' › '));
      c.exportResource=register(material,[step,...targets],origin);
      delete c.content;
      if(kind==='mcp'){
        // Only the pinned, readable edition can provide an exportable endpoint or tool list.
        node.config={exportResource:c.exportResource,...(c.assetId?{assetId:c.assetId}:{}),version:c.version};
      }else delete c.assetId;
    }
  }
  visit(graph,projectId,[],[],[]);
  for(const pending of collections){
    if(!hasPriorStage(pending.graph,pending.node,pending.stage,pending.stored)){
      const field=collectionBindings[pending.stage];
      pending.node.config[field]=[...(pending.node.config[field]??[]),register(pending.material,[pending.step])];
    }
  }
  stripGraphGrants(graph);
  if(selected)requireThat([...selected].every(key=>resources.get(key)?.included),409,'자료판이나 접근 권한이 변경되었습니다. 내보내기를 다시 열어 자료 목록을 확인하세요.');
  const materials=[...resources.values()];
  locateMaterialFiles(materials,files,materialFiles);
  // Use the resolved editions and portable bindings in both the preview and the downloaded guide.
  const preparation=[...designPreparation(graph,toolsByPin),...resourcePreparation(graph,materials)];
  return {title,lesson:project.lesson ?? undefined,graph,resources:materials,files,preparation};
}

function preview(pkg:ExportPackage){
  const resources=pkg.resources.map(({included,files,mcp,source,skillName,linkedFiles,...resource})=>resource);
  const preparation=pkg.preparation??[];
  const previewId=digest(JSON.stringify([pkg.title,pkg.graph,resources,preparation]));
  return {resources,preparation,previewId};
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
