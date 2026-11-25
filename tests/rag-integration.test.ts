import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBlock,type Graph} from '../src/domain';
import {executeGraph} from '../src/engine';
import {token} from '../src/engine/session';
import { authenticate, type User } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import {assetShare,writeAsset} from '../src/server/assets';
import {all,db,one,tx} from '../src/server/db';
import {createProject,deleteProject,openProject,projectCopy,publish,saveProject,snapshot} from '../src/server/projects';
import {purgeProjectsInTransaction} from '../src/server/project-purge';
import {replyRun,runGet,runList,startRun,workOne} from '../src/server/runs';

process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-rag-'));
after(()=>{db().close();rmSync(process.env.STUDIO_DATA_DIR!,{recursive:true,force:true});});
const member=(name:string)=>authenticate('signup',name,'long-test-password','').user;
function graph(action:'build'|'search'|'withdraw',assetId?:string,sourceVersion=1,collection='대출 이용 규정',wait=false):Graph{
  const build=action==='build',steps=build?['prepare','index','publish']:[action];
  const nodes=[createBlock('input.user_request',{id:'input'}),...steps.map((operation,i)=>createBlock(
    operation==='search'?'knowledge.search':'knowledge.manage',{id:'step-'+i,config:{operation,storeKey:collection,version:'2026'}})),
    createBlock('output.answer',{id:'out'})];
  const flow=['input',...steps.map((_,i)=>'step-'+i),...(wait?['wait']:[]),'out'];
  const edges:Graph['edges']=flow.slice(1).map((id,i)=>({id:'flow-'+i,from:flow[i],to:id,kind:'flow',out:'next',input:'in'}));
  steps.forEach((_,i)=>edges.push({id:'data-'+i,from:'input',to:'step-'+i,kind:'data',out:'value',input:'input'}));
  edges.push({id:'value',from:'step-'+(steps.length-1),to:'out',kind:'data',out:'value',input:'input'});
  if(wait)nodes.push(createBlock('input.form',{id:'wait',config:{prompt:'계속 진행할까요?'}}));
  if(assetId){
    nodes.push(createBlock('resource.context',{id:'source',config:{assetId,version:sourceVersion}}));
    edges.push({id:'evidence',from:'source',to:'step-0',kind:'reference',out:'ref',input:'context'});
  }
  return {nodes,edges};
}
async function run(user:User,id:string,options:Record<string,unknown>={}){
  const job=startRun(user,{id,requestKey:crypto.randomUUID(),mode:'live',input:'대출 한도',...options});
  assert.equal(await workOne(),true);return runGet(user,job.id);
}
async function approve(user:User,id:string){
  const wait=runGet(user,id);assert.equal(wait.state,'waiting',wait.error);
  replyRun(user,{runId:id,waitId:wait.prompt.id,approved:true,value:'승인'});
  assert.equal(await workOne(),true);return runGet(user,id);
}
const saveVersion=(user:User,id:string,g:Graph)=>{
  const p=openProject(user,id);
  const draft=saveProject(user,{id,title:p.title,revision:p.revision,graph:g});
  return snapshot(user,{id,revision:draft.revision}).number;
};

test('a released search uses the author’s immutable edition across accounts, rechecks sources for traces and resume, and copies independently',async()=>{
  const author=member('rag-public-author'),reader=member('rag-public-reader'),third=member('rag-source-owner');
  const doc=writeAsset(third,{kind:'knowledge',name:'이용 규정',payload:{content:'회원증을 지참하세요.\n대출 한도는 7권입니다.'}});
  assetShare(third,doc.id,'public',false);
  const p=createProject(author,{title:'규정 안내',graph:graph('build',doc.id)});
  const builder=snapshot(author,{id:p.id,revision:p.revision}).number;
  publish(author,{id:p.id,version:builder,visibility:'private'});
  assert.equal((await approve(author,(await run(author,p.id)).id)).state,'completed');
  const searchable=saveVersion(author,p.id,graph('search'));
  publish(author,{id:p.id,version:searchable,visibility:'public'});
  for(const visitor of [author,reader,legacyGuestSession().user]){
    const result=await run(visitor,p.id);
    assert.equal(result.state,'completed',result.error);
    assert.match(result.output,/7권/);assert.match(result.output,/2행/);assert.match(result.output,/이용 규정/);
  }
  const copied=projectCopy(reader,{id:p.id,published:true});
  const absent=saveVersion(author,p.id,graph('search',undefined,1,'없는 자료집'));
  assert.throws(()=>publish(author,{id:p.id,version:absent,visibility:'public'}),/자료판/);
  const waitingVersion=saveVersion(author,p.id,graph('search',undefined,1,'대출 이용 규정',true));
  publish(author,{id:p.id,version:waitingVersion,visibility:'public'});
  const waiting=await run(reader,p.id);assert.equal(waiting.state,'waiting',waiting.error);
  assert.match(JSON.stringify(waiting.events),/7권/);
  assetShare(third,doc.id,'private',false);
  assert.throws(()=>replyRun(reader,{runId:waiting.id,waitId:waiting.prompt.id,value:'예'}),/권한/);
  assert.doesNotMatch(JSON.stringify(runGet(reader,waiting.id)),/7권/);
  assert.doesNotMatch(JSON.stringify(runList(reader,p.id)),/7권/);
  const revoked=await run(reader,p.id);assert.equal(revoked.state,'failed');
  assert.doesNotMatch(JSON.stringify(revoked),/7권/);
  assert.throws(()=>publish(author,{id:p.id,version:searchable,visibility:'public'}),/권한|공개/);
  const independent=await run(reader,copied.id,{mode:'test'});
  assert.equal(independent.state,'completed',independent.error);assert.match(independent.output,/7권/);
  assetShare(third,doc.id,'public',false,1);
  writeAsset(third,{id:doc.id,baseVersion:1,name:'새 이용 규정',payload:{content:'대출 한도는 9권입니다.'}});
  assetShare(third,doc.id,'public',false,2);
  const changed=saveVersion(author,p.id,graph('build',doc.id,2));
  publish(author,{id:p.id,version:changed,visibility:'private'});
  const conflict=await run(author,p.id);assert.equal(conflict.state,'failed');assert.match(conflict.error,/새 버전/);
  publish(author,{id:p.id,version:searchable,visibility:'public'});
  assert.match((await run(reader,p.id)).output,/7권/);
  const memoryGraph=graph('search');
  memoryGraph.nodes[1]=createBlock('memory.access',{id:'step-0',config:{operation:'write',key:'knowledge:'+token('대출 이용 규정')+':release:2026'}});
  const writePersonal=saveVersion(author,p.id,memoryGraph);
  publish(author,{id:p.id,version:writePersonal,visibility:'private'});
  assert.equal((await run(author,p.id)).state,'completed');
  publish(author,{id:p.id,version:searchable,visibility:'public'});
  assert.match((await run(reader,p.id)).output,/7권/);
  const withdraw=saveVersion(author,p.id,graph('withdraw'));
  publish(author,{id:p.id,version:withdraw,visibility:'public'});
  assert.equal((await run(reader,p.id)).state,'failed');
  const sandbox=await run(author,p.id,{mode:'test'});
  assert.equal(sandbox.state,'waiting');assert.equal((await approve(author,sandbox.id)).state,'completed');
  publish(author,{id:p.id,version:searchable,visibility:'public'});assert.match((await run(reader,p.id)).output,/7권/);
  publish(author,{id:p.id,version:withdraw,visibility:'private'});
  assert.equal((await approve(author,(await run(author,p.id)).id)).state,'completed');
  assert.throws(()=>publish(author,{id:p.id,version:searchable,visibility:'public'}),/발행 상태/);
});

test('evidence decisions survive a downstream answer block and conflicting citations require independent source locations',async()=>{
  const g=graph('search');g.nodes[1].config={query:'대출 한도'};
  const doc=createBlock('resource.context',{id:'rules',config:{content:'대출 한도는 5권입니다.\n대출 한도는 7권입니다.'}});
  const check=createBlock('quality.evidence',{id:'evidence'}),answer=createBlock('ai.single_task',{id:'answer',config:{goal:'대출 한도 안내'}});
  g.nodes.push(doc,check,answer);
  g.edges=g.edges.filter(e=>e.to!=='out');
  g.edges.push({id:'source',from:'rules',out:'ref',to:'step-0',input:'context',kind:'reference'});
  for(const [from,to,route] of [['step-0','evidence','next'],['evidence','answer','conflicting'],['evidence','answer','insufficient'],['answer','out','next']]){
    g.edges.push({id:from+route,from,to,out:route,input:'in',kind:'flow'});
    if(!g.edges.some(e=>e.from===from&&e.to===to&&e.kind==='data'))g.edges.push({id:from+'-value',from,to,out:'value',input:'input',kind:'data'});
  }
  for(const [expected,references] of [
    ['conflicting',[{index:0,quote:'5권'},{index:1,quote:'7권'}]],
    ['insufficient',[{index:0,quote:'5권'},{index:0,quote:'한도는 5권'}]],
    ['insufficient',[{index:null,quote:'5권'},{index:1,quote:'7권'}]]
  ] as const){
    let calls=0;
    const job=await executeGraph(g,{runId:crypto.randomUUID(),input:'대출 한도'},{model:async()=>{calls++;return {text:JSON.stringify({status:'conflicting',references})};},tool:async()=>{throw Error('unexpected tool');}});
    assert.equal(job.status,'completed',job.error??'');assert.equal(calls,1);
    const outcome=Object.entries(job.checkpoint.steps).find(([key])=>key.endsWith('/answer'))![1];
    assert.equal(outcome.values.status,expected);
    if(expected==='conflicting'){assert.match(job.output,/5권/);assert.match(job.output,/7권/);}
    else assert.match(job.output,/근거를 확인할 수 없/);
  }
});

test('a legacy document picker becomes an accessible reference and publishes a fixed search index',async()=>{
  const author=member('rag-legacy-owner'),visitor=member('rag-legacy-reader');
  const doc=writeAsset(author,{kind:'document',name:'대출 정책',payload:{content:'대출 한도는 11권입니다.'}});
  assetShare(author,doc.id,'public',false);
  const g=graph('search');g.nodes[1].config={query:'대출 한도',assetId:doc.id,version:1};
  const p=createProject(author,{graph:g,title:'기존 자료 선택기'});
  assert.equal(p.graph?.nodes.filter(n=>n.config.assetId===doc.id&&n.type==='resource.context').length,1);
  const version=snapshot(author,{id:p.id,revision:p.revision}).number;
  publish(author,{id:p.id,version,visibility:'public'});
  assert.ok(all<{entries:string}>('SELECT entries FROM knowledge_document_indexes').some(r=>r.entries.includes('11권')));
  const job=await run(visitor,p.id);assert.equal(job.state,'completed',job.error);assert.match(job.output,/11권/);
  assetShare(author,doc.id,'private',false);assert.doesNotMatch(JSON.stringify(runGet(visitor,job.id)),/11권/);
});

test('purging a project evicts its inline search passages atomically and preserves reusable asset editions',()=>{
  const author=member('rag-purge-owner');
  const doc=writeAsset(author,{kind:'document',name:'공용 문서',payload:{content:'공용 자료실 이용 안내'}});
  const g=graph('search',doc.id);
  g.nodes[1].config={query:'자료실'};
  const inline=createBlock('resource.context',{id:'local',title:'설계 메모',config:{content:'이 설계 전용 기록'}});
  g.nodes.push(inline);
  g.edges.push({id:'local-ref',from:inline.id,to:'step-0',kind:'reference',out:'ref',input:'context'});
  const p=createProject(author,{graph:g,title:'자료 검색'});
  const version=snapshot(author,{id:p.id,revision:p.revision}).number;
  publish(author,{id:p.id,version,visibility:'private'});
  const cached=(passage:string)=>Boolean(one('SELECT 1 FROM knowledge_document_indexes WHERE instr(entries,?)>0',passage));
  assert.ok(cached('이 설계 전용 기록'));
  assert.ok(cached('공용 자료실 이용 안내'));
  deleteProject(author,{id:p.id,revision:p.revision!});
  assert.throws(()=>tx(()=>{purgeProjectsInTransaction([p.id]);throw new Error('rollback');}),/rollback/);
  assert.ok(cached('이 설계 전용 기록'));
  assert.ok(one('SELECT 1 FROM deleted_projects WHERE project=?',p.id));
  tx(()=>purgeProjectsInTransaction([p.id]));
  assert.equal(cached('이 설계 전용 기록'),false);
  assert.ok(cached('공용 자료실 이용 안내'));
  assert.ok(one('SELECT 1 FROM asset_versions WHERE asset=? AND number=1',doc.id));
});
