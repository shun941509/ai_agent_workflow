import {executeGraph,type EngineCheckpoint,type EngineServices,type EngineRequest,type EngineEvent} from '../engine';
import {completedRunFiles} from '../engine/legacy-files';
import {membershipQuestion,type Block,type Graph} from '../domain';
import {isIntroExampleAnswer} from '../domain/intro-example-answer';
import {beginnerRuleSource,sourceSnapshot,type TestSources} from '../domain/source-preview';
import {charge,type User} from './auth';
import {toolScopeOwner} from './guest-work';
import {all,digest,key,now,one,set,tx} from './db';
import {model} from './model';
import {pins} from './assets';
import {bindRunAssets} from './run-assets';
import type {McpPin} from '../domain/mcp-scope';
import {project,getVersion,owned,canProject,canReadProjectEdition,runnable,stripGraphGrants,type Project} from './projects';
import {attachmentError,attachmentFrom,fileExtensions,literalRunQuestion,questionText,runInputLimit,type FileExample} from '../domain/run-input';
import {record} from '../engine/values';
import {replyFieldError} from '../domain/reply-form';
import {requireThat,stringArg,StudioError} from './errors';
import {library,externalMcp,externalDefinitions} from './mcp';
import {resolveWorkflowRefs} from './workflow-refs';
import {authorizeKnowledgeHistory,bindKnowledge,publishedSourceIndex} from './knowledge';
type Row={id:string;conversation:string;owner:string;input:string;state:string;output:string;error:string;checkpoint:string|null;prompt:string|null;retries:string|null;created:string;updated:string;lease:string|null;request_key:string};
type Conv={id:string;owner:string;project:string;version:number|null;graph:string;mode:'live'|'test';scope:string;link_token:string|null;created:string};
type Operation={id:string;run:string;owner:string;tool:string;args:string;scope:string;status:string;result:string|null};
const builtin=['reservations.list','reservations.create','reservations.cancel'];
const parse=(s:string|null)=>s?JSON.parse(s):null;
function readCheckpoint(raw:string|null):EngineCheckpoint|undefined{
  if(!raw)return undefined;
  // Older checkpoints may have saved expanded workflow graphs in start events.
  return JSON.parse(raw,(key,value)=>{
    if(key==='config'&&value&&typeof value==='object'){delete value.assetGrant;delete value.workflowGrant;}
    return value;
  });
}
function row(id:string){const r=one<Row>('SELECT * FROM runs WHERE id=?',id);requireThat(r,404,'실행을 찾을 수 없습니다.');return r;}
function conversation(id:string){const c=one<Conv>('SELECT * FROM conversations WHERE id=?',id);requireThat(c,404,'대화를 찾을 수 없습니다.');return c;}
function activeUser(id:string){const user=one<User>('SELECT id,login FROM people WHERE id=?',id);requireThat(user,403,'계정을 확인하세요.');return user;}
type SharedView = {token?: string; shareGeneration?: string};
function checkSharedView(p:Project,user:User,view?:SharedView){
  if (view?.token !== undefined || view?.shareGeneration !== undefined)
    requireThat(canProject(p,user,view.token,view.shareGeneration),403,'이 Agent를 사용할 권한이 없습니다.');
}
function access(user:User,c:Conv,p=project(c.project)){requireThat(c.owner===user.id&&canReadProjectEdition(p,user,c.version,c.link_token ?? ''),403,'이 대화를 실행할 권한이 없습니다.');
 const graph=pins(resolveWorkflowRefs(JSON.parse(c.graph),user,p.id,{expand:true}),user);
 if(c.mode==='test')applyFixtureDocuments(graph,runFixture(c.id).documents);
 authorizeKnowledgeHistory(user,c.id,graph,p.id,c.mode==='test'?c.scope:'live');
 return graph;}
function mine(user:User,id:string){const r=row(id);requireThat(r.owner===user.id,403,'본인의 실행만 열 수 있습니다.');return r;}
type CaseSnapshot={caseId:string|null;title:string;expected:string};
function runCase(id:string){return one<CaseSnapshot>('SELECT case_id AS caseId,title,expected FROM run_case_snapshots WHERE run=?',id);}
function runFixture(id:string){return parse(one<{data:string}>('SELECT data FROM run_fixtures WHERE conversation=?',id)?.data??null)??{};}
function applyFixtureDocuments(graph:Graph,documents:unknown,path:string[]=[]){
  if(!documents||typeof documents!=='object'||Array.isArray(documents))return;
  const sources=record(documents);
  for(const node of graph.nodes){
    const address=[...path,node.id],doc=sources[JSON.stringify(address)]??sources[node.id];
    if(node.type==='resource.context'&&typeof doc==='string'){
      node.config.content=doc;delete node.config.assetId;delete node.config.assetGrant;
    }
    if(node.graph)applyFixtureDocuments(node.graph,documents,address);
  }
}
const numberedRuns=`SELECT r.id, row_number() OVER (ORDER BY r.rowid) AS runNumber
  FROM runs r JOIN conversations c ON c.id=r.conversation WHERE r.owner=? AND c.project=?`;

function usedEditions(graph:Graph,events:EngineEvent[]) {
  const references = new Map<string,Block[]>();
  function index(nodes:Block[]) {
    for(const node of nodes){
      const entries=references.get(node.id);
      if(entries)entries.push(node);else references.set(node.id,[node]);
      if(node.graph)index(node.graph.nodes);
    }
  }
  index(graph.nodes);
  const editions=new Map<string,{title:string;version:number}>();
  for(const event of events){
    const ref=event.data as {type?:string;version?:unknown;assetId?:string|null}|undefined;
    if(event.kind!=='result'||!ref?.version||!['resource.context','instruction.skill','connection.mcp'].includes(ref.type??''))continue;
    const version=Number(ref.version);
    if(!Number.isSafeInteger(version)||version<1)continue;
    if(Object.hasOwn(ref,'assetId')){
      if(ref.assetId)editions.set(JSON.stringify([event.title,version]),{title:event.title,version});
      continue;
    }
    const candidates=event.path==='root/'+encodeURIComponent(event.nodeId)?graph.nodes:references.get(event.nodeId)??[];
    const matches=candidates.filter(node=>node.id===event.nodeId && node.type===ref.type && node.title===event.title && Number(node.config.version)===version);
    // An inline document or a test fixture can carry a version field from the original block.
    if(!matches.length||matches.some(node=>!node.config.assetId))continue;
    editions.set(JSON.stringify([event.title,version]),{title:event.title,version});
  }
  return [...editions.values()];
}

function dto(r:Row,full=true,view?:SharedView,number?:number){const c=conversation(r.conversation),p=project(c.project);
  const runNumber=number??one<{runNumber:number}>(`SELECT runNumber FROM (${numberedRuns}) WHERE id=?`,r.owner,c.project,r.id)!.runNumber;
  const summary={id:r.id,conversation:c.id,project:c.project,mode:c.mode,version:c.version,state:r.state,created:r.created,updated:r.updated,runNumber};
  const viewer=activeUser(r.owner);
  checkSharedView(p,viewer,view);
  let graph:Graph;
  try{graph=access(viewer,c,p);}catch(error){
    if(!(error instanceof StudioError))throw error;
    return {...summary,...(!canProject(p,viewer,c.link_token ?? '')?{projectAccessRevoked:true}:{}),
      input:'',output:'',error:'현재 접근할 수 없는 자료가 포함된 실행입니다.',prompt:null,events:[],operations:[],usedEditions:[]};
  }
  const snapshot=runCase(r.id);
  const beginnerDraft=full && p.lesson==='beginner' && p.owner===viewer.id && c.mode==='test' && !c.version;
  const fixture=full && (snapshot || beginnerDraft) ? runFixture(c.id) : undefined;
  const checkpoint=readCheckpoint(r.checkpoint),events=checkpoint?.events??[];
  const files=full && r.state==='completed' && checkpoint?completedRunFiles(graph,checkpoint):[];
  return {...summary,input:r.input,output:r.output,error:r.error,prompt:parse(r.prompt),usedEditions:usedEditions(graph,events),
  ...(beginnerDraft && typeof fixture?.documents?.rules!=='string'
    ? {beginnerRule:beginnerRuleSource(graph)} : {}),
  ...(p.lesson==='intro' && p.owner===viewer.id ? {isExampleAnswer:c.mode==='test' && r.state==='completed' &&
    r.input.trim()===membershipQuestion && isIntroExampleAnswer(graph,r.output)} : {}),
  files,outputFormat:checkpoint?.outputFormat,
  prompts:r.state==='waiting'?Object.values(checkpoint?.waits??{}):[],
  ...(snapshot?{testCase:full?{...snapshot,fixture}:snapshot}:{}),
  events:full?events:[],operations:full?all<Operation>('SELECT * FROM operations WHERE run=?',r.id).map(o=>({id:o.id,tool:o.tool,status:o.status,result:parse(o.result)})):[]};}
export function runGet(user:User,id:string,view?:SharedView){return dto(mine(user,id),true,view);}
function selectedDesign(user:User,p:Project,b:any){
  const mode=b.mode==='test'?'test':'live';
  if(mode==='test')requireThat(p.owner===user.id,403,'사본을 만든 다음 시험할 수 있습니다.');
  const version=mode==='live'?p.public_version:b.version!=null?Number(b.version):null;
  requireThat(mode==='test'||version,409,'먼저 버전을 게시하세요.');
  if(mode==='test' && version===null && b.draftRevision!==undefined)
    requireThat(b.draftRevision===p.revision,409,'현재 초안이 다른 화면에서 변경되었습니다. 설계를 다시 열어 확인한 뒤 시험하세요.');
  const graph=resolveWorkflowRefs(JSON.parse(version?getVersion(p.id,version).graph:p.graph),user,p.id,{expand:true});
  return {mode,version,graph} as const;
}
export function inputFiles(user:User,b:any){
  const p=project(b.id);requireThat(canProject(p,user,b.token,b.shareGeneration),403,'이 Agent를 사용할 권한이 없습니다.');
  let graph:Graph,mode:'test'|'live';
  if(b.conversation){
    const c=conversation(b.conversation);
    requireThat(c.project===p.id,400,'다른 Agent의 대화입니다.');
    graph=access(user,c);mode=c.mode;
  }else ({graph,mode}=selectedDesign(user,p,b));
  const formats=new Set<string>();let hasFile=false,unrestricted=false;
  const examples:FileExample[]=[];
  function collect(design:Graph,includeExamples:boolean){
    for(const node of design.nodes){
      if(node.type==='file.input'){
        const accepted=fileExtensions(node.config.accept);
        if(node.config.attachmentMode!=='request'){
          hasFile=true;
          if(!accepted.length)unrestricted=true;
          for(const ext of accepted)formats.add(ext);
        }
        if(includeExamples && typeof node.config.content==='string' && node.config.content.length){
          examples.push({blockTitle:node.title,fileName:String(node.config.fileName||'예시'+(accepted[0]||'.txt')),content:node.config.content});
        }
      }
      if(node.graph)collect(node.graph,includeExamples&&(!node.config.workflowId||project(String(node.config.workflowId)).owner===user.id));
    }
  }
  const includeExamples=b.examples===true && mode==='test' && p.owner===user.id;
  collect(graph,includeExamples);
  return {accept:hasFile?(unrestricted?'':[...formats].join(',')):null,...(includeExamples?{examples}:{})};
}
export function runList(user:User,id:string,conversationId?:string,view?:SharedView){
  checkSharedView(project(id),user,view);
  const query=`SELECT r.*, n.runNumber FROM (${numberedRuns}) n JOIN runs r ON r.id=n.id`;
  const rows=conversationId
    ? all<Row & {runNumber:number}>(query+' WHERE r.conversation=? ORDER BY n.runNumber DESC',user.id,id,conversationId)
    : all<Row & {runNumber:number}>(query+' WHERE r.state=\'waiting\' OR n.runNumber>(SELECT coalesce(max(runNumber),0)-100 FROM ('+numberedRuns+')) ORDER BY n.runNumber DESC',user.id,id,user.id,id);
  return rows.map(r=>dto(r,false,undefined,r.runNumber));
}
export function stats(user:User,id:string){owned(user,id);return all('SELECT state,count(*) n FROM runs JOIN conversations c ON c.id=runs.conversation WHERE c.project=? GROUP BY state',id);}
export function lastTestSources(user:User,id:string,version?:number):TestSources|null {
  const p=owned(user,id);
  if(version!==undefined)getVersion(id,version);
  const last=one<{runId:string;conversation:string;created:string;state:string}>(
    "SELECT r.id runId,c.id conversation,r.created,r.state FROM runs r JOIN conversations c ON c.id=r.conversation WHERE r.owner=? AND c.project=? AND c.mode='test'"+
    (version===undefined?'':' AND c.version=?')+' ORDER BY r.rowid DESC LIMIT 1',user.id,id,...(version===undefined?[]:[version]));
  if(!last)return null;
  const c=conversation(last.conversation);
  const target={runId:last.runId,version:c.version,created:last.created,state:last.state};
  try {
    access(user,c,p);
    const r=version===undefined?undefined:row(last.runId);
    return {...target,caseTitle:runCase(last.runId)?.title,sources:sourceSnapshot(JSON.parse(c.graph)),
      ...(r?{question:questionText(r.input),answer:r.output,error:r.error}:{})};
  } catch(error) {
    if(!(error instanceof StudioError))throw error;
    return {...target,sources:null};
  }
}
export function startRun(user:User,b:any){return tx(()=>enqueueRun(user,b));}
/** Caller owns a SQLite write transaction; only a validated automation may supply an origin. */
export function enqueueRun(user:User,b:any,origin?:EngineRequest['trigger']){
 const requestKey=stringArg(b.requestKey,'요청 번호',160);
 const editedFixture=b.caseFixture!==undefined;
 const storedCase=Boolean(b.caseId&&!editedFixture),copiedCase=Boolean(b.caseFromRun);
 if(b.caseId||copiedCase)requireThat(b.mode==='test'&&!b.conversation&&!b.retryOf,400,'시험 사례는 새 시험 대화에서 사용할 수 있습니다.');
 if(copiedCase)requireThat(!b.caseId&&!editedFixture,400,'비교할 시험 실행을 확인하세요.');
 let userInput=(!storedCase&&!copiedCase)||b.input!=null?stringArg(b.input,'입력',runInputLimit):'';
 if(editedFixture)requireThat(b.mode==='test' && !b.conversation && !b.retryOf && b.caseFixture!==null &&
   typeof b.caseFixture==='object' && !Array.isArray(b.caseFixture),400,'현재 편집한 시험 자료는 새 시험 대화에서 사용할 수 있습니다.');
 const fingerprint=digest(canonical([b.id,userInput,b.mode==='test'?'test':'live',b.version==null?null:Number(b.version),b.conversation??null,b.caseId??null,b.retryOf??null,origin??null,...(editedFixture?[b.caseFixture]:[]),...(editedFixture&&b.caseExpected!==undefined?[b.caseTitle??'',b.caseExpected]:[]),...(copiedCase?[b.caseFromRun]:[])]));
   const p=project(b.id);
   requireThat(canProject(p,user,b.token,b.shareGeneration),403,'이 Agent를 사용할 권한이 없습니다.');
   const previous=one<Row>('SELECT * FROM runs WHERE owner=? AND request_key=?',user.id,requestKey);
   if(previous){
     const intent=one<{fingerprint:string}>('SELECT fingerprint FROM run_intents WHERE run=?',previous.id);
     const recorded=one<{data:string}>('SELECT data FROM run_origins WHERE run=?',previous.id);
     const prior=conversation(previous.conversation);
     requireThat((!intent||intent.fingerprint===fingerprint)&&(previous.input===userInput||Boolean(intent&&(storedCase||copiedCase)))&&prior.project===b.id&&(!origin||recorded?.data===JSON.stringify(origin)),409,'요청 번호가 이미 사용됐습니다.');
     requireThat(canReadProjectEdition(p,user,prior.version,prior.link_token ?? ''),403,'이 대화를 실행할 권한이 없습니다.');
     return dto(previous);
   }
   const retry=b.retryOf?mine(user,b.retryOf):null;
   if(retry)requireThat(['stopped','failed'].includes(retry.state)&&conversation(retry.conversation).project===p.id,409,'중지·실패한 실행만 다시 시도할 수 있습니다.');
   if(retry)requireThat(retry.input===userInput,409,'재시도에는 원래 입력을 사용하세요.');
   let c:Conv,snapshot=retry?runCase(retry.id):undefined;
   if(b.conversation&&!retry){c=conversation(b.conversation);requireThat(c.project===p.id,400,'다른 Agent의 대화입니다.');access(user,c);
     requireThat(!one("SELECT id FROM runs WHERE conversation=? AND state IN ('queued','running','waiting')",c.id),409,'진행 중인 실행을 먼저 마치거나 중지하세요.');}
   else{
     const old=retry?conversation(retry.conversation):null;
     const {mode,version:ver,graph:design}=old?{mode:old.mode,version:old.version,graph:access(user,old)}:selectedDesign(user,p,b);
     let graph:Graph=old?design:pins(runnable(design),user);
     bindRunAssets(graph,user).validate();
     const id=key(),scope=old?.scope??(mode==='test'||!user.login?'test:'+id:'live');
     let fixture:any=old?runFixture(old.id):{};
     if(b.caseId){
       const tc=one<{id:string;title:string;expected:string;input:string;fixture:string}>('SELECT id,title,expected,input,fixture FROM cases WHERE id=? AND owner=? AND project=?',String(b.caseId),user.id,p.id);
       requireThat(tc,404,'내 시험 사례를 확인하세요.');
       snapshot={caseId:tc.id,title:tc.title,expected:tc.expected};
       if(storedCase){userInput=tc.input;fixture=JSON.parse(tc.fixture);}
     }
     if(editedFixture){
       fixture=b.caseFixture;
       if(b.caseExpected!==undefined){
         requireThat(typeof b.caseExpected==='string'&&b.caseExpected.length<=30000&&typeof b.caseTitle==='string'&&b.caseTitle.length<=140,400,'사례 이름과 기대 결과를 확인하세요.');
         snapshot={caseId:snapshot?.caseId??null,title:b.caseTitle,expected:b.caseExpected};
       }
     }
     if(copiedCase){
       const source=mine(user,b.caseFromRun),prior=conversation(source.conversation);
       snapshot=runCase(source.id);
       requireThat(prior.mode==='test'&&prior.project===p.id,400,'같은 프로젝트의 시험 실행을 선택하세요.');
       access(user,prior,p);userInput=source.input;fixture=runFixture(prior.id);
     }
     if(!old)applyFixtureDocuments(graph,fixture?.documents);
     // Gallery visits and direct links both bind the new conversation to the current publication.
     c={id,owner:user.id,project:p.id,version:ver,graph:JSON.stringify(graph),mode,scope,link_token:p.owner===user.id?null:p.token,created:now()};
     set('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)',c.id,c.owner,c.project,c.version,c.graph,c.mode,c.scope,c.link_token,c.created);
     set('INSERT INTO run_fixtures VALUES(?,?)',id,JSON.stringify(fixture));}
   charge(user,'run');const id=key(),t=now();
   set("INSERT INTO runs(id,conversation,owner,request_key,input,state,retries,created,updated) VALUES(?,?,?,?,?,'queued',?,?,?)",id,c.id,user.id,requestKey,userInput,retry?.id??null,t,t);
   set('INSERT INTO run_intents VALUES(?,?)',id,fingerprint);
   if(snapshot)set('INSERT INTO run_case_snapshots(run,case_id,title,expected) VALUES(?,?,?,?)',id,snapshot.caseId,snapshot.title,snapshot.expected);
   const initial=origin??(retry?parse(one<{data:string}>('SELECT data FROM run_origins WHERE run=?',retry.id)?.data??null):undefined);
   if(initial)set('INSERT INTO run_origins VALUES(?,?)',id,JSON.stringify(initial));
   return dto(row(id));
}
export function stopRun(user:User,id:string){const r=mine(user,id);
 if(['queued','running','waiting'].includes(r.state))set("UPDATE runs SET state='stopped',prompt=NULL,lease=NULL,lease_until=0,updated=? WHERE id=? AND state IN ('queued','running','waiting')",now(),id);return dto(row(id));}
export function replyRun(user:User,b:any){return tx(()=>{const r=mine(user,b.runId),c=conversation(r.conversation),p=project(c.project);
 checkSharedView(p,user,b);access(user,c,p);
 const waitId=stringArg(b.waitId,'대기 번호',1000),checkpoint=readCheckpoint(r.checkpoint);
 const shown=parse(r.prompt),prompt=checkpoint?.waits[waitId]??(shown?.id===waitId?shown:null);
 const repeated=one<{data:string}>('SELECT data FROM replies WHERE run=? AND wait_id=?',r.id,waitId);
 if(repeated && !(r.state==='waiting' && prompt?.id===waitId && prompt.fieldError)){
   const previous=JSON.parse(repeated.data);
   requireThat(previous.approved===b.approved && previous.value===(b.value??''),409,'다른 회신이 먼저 접수되었습니다. 실행 상태를 확인하세요.');
   return dto(r);
 }
 requireThat((r.state==='waiting'||r.state==='queued')&&prompt?.id===waitId,409,'이 승인 또는 질문은 이미 종료되었거나 처리 중입니다.');
 const receivedAt=Date.now();
 requireThat(!prompt.expiresAt || receivedAt<Date.parse(prompt.expiresAt),409,'대기 기한이 지났습니다.');
 if(prompt.kind==='approval')requireThat(typeof b.approved==='boolean',400,'승인 또는 거절을 선택하세요.');
 if(prompt.kind==='file'){
   requireThat(typeof b.value==='string' && b.value.length<=runInputLimit,400,'첨부 전송 내용은 40,000자까지 가능합니다.');
   const problem=attachmentError(attachmentFrom(b.value),prompt.fileAccept??[]);
   requireThat(!problem,400,problem);
 }
 const value=typeof b.value==='string'?b.value:'';requireThat(value.length<=40000&&(value.trim()||typeof b.approved==='boolean'),400,'답을 입력하세요.');
 if(prompt.fields?.length){
   const fieldError=replyFieldError(prompt.fields,record(value));
   requireThat(!fieldError,400,fieldError);
 }
 set('INSERT OR REPLACE INTO replies VALUES(?,?,?)',r.id,waitId,JSON.stringify({waitId,value,approved:b.approved,receivedAt}));
 set("UPDATE runs SET state='queued',prompt=NULL,lease=NULL,lease_until=0,updated=? WHERE id=?",now(),r.id);return dto(row(r.id));});}
function canonical(v:unknown):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v)??'null';}
async function reconcile(o:Operation){
 if(o.status==='confirmed')return {found:true,result:parse(o.result)};
 if(!builtin.includes(o.tool))return {found:false};
 const response=await library('studio.receipt',{},toolScopeOwner(o.owner,o.scope),o.scope,o.id);
 if(response.found)set("UPDATE operations SET status='confirmed',result=? WHERE id=?",JSON.stringify(response.result),o.id);
 return response;
}
export async function refreshReceipts(user:User,id:string,view?:SharedView){
 const r=mine(user,id),c=conversation(r.conversation);
 checkSharedView(project(c.project),user,view);
 access(user,c);
 for(const o of all<Operation>("SELECT * FROM operations WHERE run=? AND status='unknown'",id)){
   access(user,c);
   await reconcile(o);
 }
 return dto(row(id));
}
async function execute(id:string,lease:string){
 const r=row(id),c=conversation(r.conversation),user=activeUser(r.owner);
 const isStopped=()=>!one("SELECT 1 FROM runs WHERE id=? AND state='running' AND lease=?",id,lease);
 const requireRunning=()=>requireThat(!isStopped(),409,'중지된 실행입니다.');
 const authorizeDispatch=()=>{requireRunning();access(user,c);};
 const heartbeat=setInterval(()=>{set("UPDATE runs SET lease_until=? WHERE id=? AND lease=? AND state='running'",Date.now()+120_000,id,lease);},30000);
 try{
 const graph=access(user,c),assets=bindRunAssets(graph,user);
 const knowledge=bindKnowledge(graph,c.project,user,c.id,c.mode==='test'?c.scope:undefined);
 stripGraphGrants(graph);
 const history=all<{input:string;output:string;details:string|null}>("SELECT input,output,json_extract(checkpoint,'$.historyDetails') AS details FROM runs WHERE conversation=? AND state='completed' AND id!=? ORDER BY created",c.id,id)
   .flatMap(x=>{
     const file=attachmentFrom(x.input),question=literalRunQuestion(x.input)??(file?String(record(x.input).question??file.fileName):x.input);
     const details=x.details?Object.values(JSON.parse(x.details)):[];
     return [{role:'user' as const,content:details.length?question+'\n'+JSON.stringify(details):question},{role:'assistant' as const,content:x.output}];
   });
 const readOnly=(name:string,pin?:McpPin)=>{const ext=assets.connector(name,pin);return name==='reservations.list'||name==='knowledge.search'||Boolean(ext?.payload.readOnlyTools?.includes(ext.tool));};
 const definitions=new Map<string,ReturnType<typeof externalDefinitions>>();
 const services:EngineServices={knowledge,sourceIndex:publishedSourceIndex,
   toolDefinition:async(name,pin)=>{
     authorizeDispatch();
     const ext=assets.connector(name,pin);
     if(!ext)return;
     if(ext.payload.builtin==='library')return {description:'예약 목록 조회',parameters:{type:'object',properties:{},additionalProperties:false}};
     const edition=JSON.stringify(pin);
     let pending=definitions.get(edition);
     if(!pending){pending=externalDefinitions(ext.payload,c.scope.startsWith('test:'));definitions.set(edition,pending);}
     const definition=(await pending).get(ext.tool);
     requireThat(definition,422,'연결한 MCP 서버에서 도구의 인자 정의를 찾을 수 없습니다.');
     return definition;
   },
   model:async request=>{authorizeDispatch();return model(request);},isStopped,allowedTools:[...builtin,'knowledge.search',...assets.tools],isReadOnlyTool:readOnly,
   save:async state=>{set("UPDATE runs SET checkpoint=?,updated=? WHERE id=? AND state='running' AND lease=?",JSON.stringify(state),now(),id,lease);},
   asset:async(assetId,version)=>{const {asset,version:n,payload}=assets.read(assetId,version);return {id:assetId,title:asset.name,version:String(n),content:payload.content};},
   memory:async(name,value)=>{requireRunning();const scope=c.mode==='test'?c.scope:'live';
     if(value!==undefined)set('INSERT OR REPLACE INTO memory VALUES(?,?,?,?,?)',user.id,c.project,scope,name,value);
     return one<{value:string}>('SELECT value FROM memory WHERE owner=? AND project=? AND scope=? AND name=?',user.id,c.project,scope,name)?.value;},
   tool:async(name,args,action)=>{
    authorizeDispatch();
    const connection=assets.connector(name,action.connector);
    requireThat(builtin.includes(name)||connection,403,'허용된 도구를 선택하세요.');
    if(connection?.payload.builtin==='library')
      requireThat(connection.tool==='reservations.list',403,'이 도서관 연결은 예약 조회만 지원합니다.');
    const ext=connection?.payload.builtin==='library'?undefined:connection;
    const inSandbox=c.scope.startsWith('test:');
    if(ext)requireThat(!inSandbox||ext.payload.testUrl,409,'격리 시험 환경이 없는 연결입니다.');
    const libraryOwner=toolScopeOwner(user.id,c.scope);
    const call=(opId:string)=>ext?externalMcp(ext.payload,ext.tool,args,inSandbox):library(connection?.tool??name,args,libraryOwner,c.scope,opId,action.approved);
    if(!ext&&inSandbox){const fixture=one<{data:string}>('SELECT data FROM run_fixtures WHERE conversation=?',c.id);await library('studio.seed',{reservations:fixture?JSON.parse(fixture.data).reservations||[]:[]},libraryOwner,c.scope);authorizeDispatch();}
    if(readOnly(name,action.connector))return call(action.operationId);
    requireThat(action.approved,403,'이 행동에 대한 실행자의 승인이 필요합니다.');
    const argsText=canonical(args);
    let dispatchId=action.operationId;
    let old=one<Operation>('SELECT * FROM operations WHERE id=?',dispatchId);
    // Match the same graph node, loop iteration and tool call, not every reservation with equal arguments.
    const slot=action.operationId.slice(id.length);
    if(!old&&r.retries&&action.operationId.startsWith(id+'/')){
      let ancestor:string|null=r.retries;const visited=new Set<string>();
      while(ancestor&&!visited.has(ancestor)){
        visited.add(ancestor);
        const candidate=one<Operation>("SELECT * FROM operations WHERE id=? AND run=? AND owner=? AND scope=? AND tool=? AND args=? AND status IN ('unknown','confirmed')",ancestor+slot,ancestor,user.id,c.scope,name,argsText);
        if(candidate){old=candidate;dispatchId=candidate.id;break;}
        ancestor=row(ancestor).retries;
      }
    }
    if(old){requireThat(old.owner===user.id&&old.tool===name&&old.args===argsText&&old.scope===c.scope,409,'기존 요청과 승인 내용이 다릅니다.');
      if(old.status==='rejected')throw new Error('도구가 이전 요청을 거절했습니다.');const outcome=await reconcile(old);if(outcome.found)return outcome.result;
      requireThat(!ext,409,'외부 작업의 기존 처리 결과가 미확인입니다.');}
    // Receipt reconciliation can yield to a stop, deletion or revocation before a repeat dispatch.
    if(old)authorizeDispatch();else requireRunning();
    if(!old)set("INSERT INTO operations VALUES(?,?,?,?,?,?,'unknown',NULL,?)",dispatchId,id,user.id,name,argsText,c.scope,now());
    try{const result=await call(dispatchId);set("UPDATE operations SET status='confirmed',result=? WHERE id=?",JSON.stringify(result),dispatchId);return result;}
    catch(e){if(e instanceof StudioError&&e.status===422)set("UPDATE operations SET status='rejected' WHERE id=?",dispatchId);throw e;}
   }};
 const checkpoint=readCheckpoint(r.checkpoint);
 const pending=all<{data:string}>('SELECT data FROM replies WHERE run=? ORDER BY rowid',id).map(x=>JSON.parse(x.data)).filter(x=>checkpoint?.waits[x.waitId]&&!checkpoint?.replies[x.waitId]);
 const origin=one<{data:string}>('SELECT data FROM run_origins WHERE run=?',id);
 const req:EngineRequest={runId:id,input:r.input,checkpoint:checkpoint??undefined,replies:pending,history,trigger:origin?JSON.parse(origin.data):undefined};
 const result=await executeGraph(graph,req,services);
 set("UPDATE runs SET state=?,output=?,error=?,checkpoint=?,prompt=?,lease=NULL,lease_until=0,updated=? WHERE id=? AND state='running' AND lease=?",result.status,result.output,result.error??'',JSON.stringify(result.checkpoint),result.wait?JSON.stringify(result.wait):null,now(),id,lease);
 }catch(e){set("UPDATE runs SET state='failed',error=?,lease=NULL,lease_until=0,updated=? WHERE id=? AND state='running' AND lease=?",e instanceof Error?e.message:'실행에 실패했습니다.',now(),id,lease);}
 finally{clearInterval(heartbeat);}
}
export async function workOne(){
 const lease=key();const id=tx(()=>{
   // Refresh older question and review cards once from the pinned graph, preserving the wait ID.
   // A saved timer must also wake after a restart and while another parallel lane is waiting.
   set(`UPDATE runs SET state='queued',prompt=NULL,updated=? WHERE state='waiting' AND (
     (json_extract(prompt,'$.kind')='question' AND json_type(prompt,'$.fields') IS NULL) OR
     (json_extract(prompt,'$.kind')='review' AND json_type(prompt,'$.reviewDraft') IS NULL) OR EXISTS (
       SELECT 1 FROM json_each(runs.checkpoint,'$.waits') w
       WHERE json_type(w.value,'$.expiresAt')='text' AND json_extract(w.value,'$.expiresAt')<=?
     ))`,now(),now());
   const r=one<{id:string}>("SELECT id FROM runs WHERE state='queued' OR (state='running' AND lease_until<?) ORDER BY created LIMIT 1",Date.now());if(!r)return;
   set("UPDATE runs SET state='running',lease=?,lease_until=?,updated=? WHERE id=?",lease,Date.now()+120000,now(),r.id);return r.id;});
 if(!id)return false;await execute(id,lease);return true;
}

