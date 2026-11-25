import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createBlock,type Block,type Graph} from '../src/domain';
import {token} from '../src/engine/session';
import type {EngineCheckpoint} from '../src/engine/types';
import {authenticate} from '../src/server/auth';
import {assetShare,writeAsset} from '../src/server/assets';
import {one,set} from '../src/server/db';
import {publishedSourceIndex} from '../src/server/knowledge';
import {createProject,publish,snapshot} from '../src/server/projects';
import {replyRun,runGet,startRun,workOne} from '../src/server/runs';

process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-legacy-materials-'));
const account=(login:string)=>authenticate('signup',login,'test-only-password','').user;
const node=(id:string,type:string,config:Block['config']={})=>createBlock(type,{id,config});
const start=node('start','input.user_request'),out=node('out','output.answer');
function line(...nodes:Block[]):Graph{
  return {nodes,edges:nodes.slice(1).flatMap((n,i)=>(['data','flow'] as const).map(kind=>({
    id:[nodes[i].id,n.id,kind].join('/'),from:nodes[i].id,to:n.id,kind,out:kind==='data'?'value':'next',input:kind==='data'?'input':'in',
  })))};
}
function preProvenance(id:string){
  const cp:EngineCheckpoint=JSON.parse(one<{checkpoint:string}>('SELECT checkpoint FROM runs WHERE id=?',id)!.checkpoint);
  delete cp.fileOriginVersion;delete cp.finalFilePaths;
  Object.values(cp.steps).forEach(step=>{delete step.fileOrigins;});
  set('UPDATE runs SET checkpoint=? WHERE id=?',JSON.stringify(cp),id);
}

test('46–47 이전 자료판의 인용을 허용된 원문 행에서 복구하고 기존 발행 식별자를 유지한다',async()=>{
  const author=account('legacy-lines-author'),reader=account('legacy-lines-reader');
  const text='  원문 인용  ',asset=writeAsset(author,{kind:'document',name:'도서 규칙',payload:{content:text}});
  assetShare(author,asset.id,'public',false,1);
  const doc={id:asset.id,assetId:asset.id,title:'도서 규칙',version:'1',content:text,location:'27행'};
  const old={passage:{id:asset.id,assetId:asset.id,title:doc.title,version:'1',quote:text.trim(),location:'1행'},titleTerms:['도서'],bodyTerms:['원문']};
  const snapshotText=JSON.stringify({documents:[doc],version:'1',index:[old]}),digest=token(JSON.parse(snapshotText));
  set('INSERT INTO knowledge_document_indexes VALUES(?,?)',token(doc),JSON.stringify([old]));
  assert.deepEqual(publishedSourceIndex([doc])[0].passage,{...old.passage,quote:text,location:'27행'});
  assert.equal(one<{entries:string}>('SELECT entries FROM knowledge_document_indexes WHERE digest=?',token(doc))?.entries,JSON.stringify([old]));
  const graph=line(start,node('search','knowledge.search',{storeKey:'옛 발행본',version:'1'}),out);
  const p=createProject(author,{graph}),prefix='knowledge:'+token('옛 발행본')+':';
  for(const [part,value] of [['snapshot:'+digest,snapshotText],['release:1',digest]])
    set('INSERT INTO memory VALUES(?,?,?,?,?)',author.id,p.id,'live',prefix+part,value);
  const version=snapshot(author,{id:p.id,revision:p.revision}).number;
  publish(author,{id:p.id,version,visibility:'public'});
  const job=startRun(reader,{id:p.id,input:'원문',requestKey:'legacy-quote',mode:'live'});
  await workOne();const done=runGet(reader,job.id);
  assert.equal(done.state,'completed',done.error);
  const quote=done.events.find(e=>e.kind==='lookup')?.data as {passages:{quote:string;location:string}[]};
  assert.equal(quote.passages[0].location,'27행');assert.equal(quote.passages[0].quote,text);
  assert.equal(one<{value:string}>('SELECT value FROM memory WHERE project=? AND name=?',p.id,prefix+'snapshot:'+digest)!.value,snapshotText);
  assetShare(author,asset.id,'private',false);
  assert.equal(runGet(reader,job.id).events.length,0);
});

test('52 이전 완료 기록의 하위 팀 파일을 복구하고 동일한 내용의 이용자 JSON과 중간 파일은 제외한다',async()=>{
  const user=account('legacy-files-user'),team=node('team','agent.team',{goal:'파일 작성'});
  team.graph=line(start,node('make','file.create',{fileName:'결과.txt'}),out);
  const run=async(graph:Graph,input:string)=>{
    const p=createProject(user,{graph}),job=startRun(user,{id:p.id,mode:'test',input,requestKey:crypto.randomUUID()});
    await workOne();assert.equal(runGet(user,job.id).state,'completed');
    preProvenance(job.id);
    return runGet(user,job.id);
  };
  const genuine=await run(line(start,team,out),'원래 내용');
  assert.ok('files' in genuine);
  assert.deepEqual(genuine.files.map(f=>[f.path,f.fileName,f.content]),[['root/team/graph/make','결과.txt','원래 내용']]);

  const read=node('read','document.read',{format:'json'}),fake=node('fake','data.transform',{path:'other'});
  const graph=line(start,read,fake,out);
  const draft=line(read,node('body','data.transform',{path:'body'}),team,node('notice','control.terminate',{message:'중간 작업 종료'}));
  graph.nodes.push(...draft.nodes.slice(1));graph.edges.push(...draft.edges);
  const userValue={fileName:'결과.txt',format:'text',content:'원래 내용'};
  const spoof=await run(graph,JSON.stringify({body:userValue.content,other:userValue}));
  assert.ok('files' in spoof);assert.deepEqual(spoof.files,[]);
});

test('52 이전 회신 대기 기록을 재개할 때 파일을 만드는 단계를 다시 실행하지 않고 최종 파일을 복구한다',async()=>{
  const user=account('legacy-resume-user'),make=node('make','file.create',{fileName:'확인.txt'}),wait=node('ask','input.form',{prompt:'전달할까요?'});
  const graph=line(start,make,wait,out);
  graph.edges.find(e=>e.kind==='data'&&e.to==='out')!.from='make';
  const p=createProject(user,{graph}),job=startRun(user,{id:p.id,mode:'test',input:'이전 파일',requestKey:'resume'});
  await workOne();const waiting=runGet(user,job.id);
  assert.equal(waiting.state,'waiting');preProvenance(job.id);
  assert.ok('files' in waiting);assert.deepEqual(waiting.files,[]);
  replyRun(user,{runId:job.id,waitId:waiting.prompt.id,value:'확인'});
  await workOne();const done=runGet(user,job.id);
  assert.equal(done.state,'completed');assert.ok('files' in done);
  assert.deepEqual(done.files.map(f=>[f.path,f.content]),[['root/make','이전 파일']]);
  assert.equal(done.events.filter(e=>e.kind==='start'&&e.nodeId==='make').length,1);
});
