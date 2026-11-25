import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBlock,type Graph} from '../src/domain';
import {authenticate} from '../src/server/auth';
import {db,set} from '../src/server/db';
import {createProject,inspectImportedDesign,listProjects,openProject,projectCopy,publish,saveProject,snapshot} from '../src/server/projects';
import {lastTestSources,runGet,startRun,workOne} from '../src/server/runs';
import {assetList} from '../src/server/assets';
import {deleteAsset,listTrashedAssets,purgeTrashedAssets} from '../src/server/asset-trash';
import {legacyGuestSession} from './legacy-guest';

const dir=mkdtempSync(join(tmpdir(),'studio-editor-contracts-'));
process.env.STUDIO_DATA_DIR=dir;
after(()=>{db().close();rmSync(dir,{recursive:true,force:true});});
const owner=authenticate('signup','editor-check','editor-password','').user;
const visitor=authenticate('signup','copy-check','editor-password','').user;
function echo(text:string):Graph{
  return {nodes:[createBlock('input.user_request',{id:'q'}),createBlock('resource.context',{id:'rules',config:{content:text}}),createBlock('output.answer',{id:'a'})],
    edges:[{id:'flow',from:'q',to:'a',kind:'flow',input:'in',out:'next'},{id:'value',from:'rules',to:'a',kind:'data',input:'input',out:'value'}]};
}
function wrapper(type:string,id:string,config:Record<string,unknown>,graph?:Graph):Graph{
  return {nodes:[createBlock('input.user_request',{id:'q'}),createBlock(type,{id,title:id,config,graph}),createBlock('output.answer',{id:'a'})],
    edges:[{id:'go',from:'q',to:id,kind:'flow',out:'next',input:'in'},{id:'request',from:'q',to:id,kind:'data',out:'value',input:'input'},
      {id:'finish',from:id,to:'a',kind:'flow',out:'next',input:'in'},{id:'answer',from:id,to:'a',kind:'data',out:'value',input:'input'}]};
}
test('53,54,58 같은 첨부·시험 자료를 새 초안에서 다시 실행하고 선택한 버전의 시험만 조회한다',async()=>{
  const p=createProject(owner,{title:'자료 재시험',graph:echo('기준 3권')});
  const first=snapshot(owner,{id:p.id,revision:p.revision}).number;
  const attachment=JSON.stringify({fileName:'제목.txt',content:'첨부 원문',question:'대출 한도'});
  const args={id:p.id,mode:'test',input:attachment,caseTitle:'분관 자료',caseExpected:'7권',caseFixture:{documents:{rules:'7권'}}};
  const old=startRun(owner,{...args,version:first,requestKey:crypto.randomUUID()});
  await workOne();assert.equal(runGet(owner,old.id).output,'7권');
  const updated=saveProject(owner,{...p,graph:echo('두 번째 초안')});
  assert.throws(()=>startRun(owner,{id:p.id,mode:'test',input:'질문',draftRevision:p.revision,requestKey:crypto.randomUUID()}),{status:409});
  const second=snapshot(owner,{id:p.id,revision:updated.revision}).number;
  assert.equal(lastTestSources(owner,p.id,second),null);
  const again=startRun(owner,{id:p.id,mode:'test',caseFromRun:old.id,draftRevision:updated.revision,requestKey:crypto.randomUUID()});
  await workOne();const result=runGet(owner,again.id);
  assert.notEqual(old.conversation,again.conversation);assert.equal(result.version,null);assert.equal(result.input,attachment);
  assert.equal(result.output,'7권');assert.ok('testCase' in result && result.testCase && 'fixture' in result.testCase);
  assert.deepEqual(result.testCase.fixture,args.caseFixture);
  const evidence=lastTestSources(owner,p.id,first);
  assert.equal(evidence?.runId,old.id);assert.equal(evidence?.answer,'7권');assert.equal(evidence?.question,'대출 한도 · 제목.txt');
  assert.equal(lastTestSources(owner,p.id)?.runId,again.id);
});
test('55 팀과 저장된 하위 Workflow를 실행할 때 시험 문서 원문이 적용된다',async()=>{
  const child=createProject(owner,{title:'준비 규정',graph:echo('3권')});
  const ver=snapshot(owner,{id:child.id,revision:child.revision});
  for(const [title,graph] of [
    ['팀',wrapper('agent.team','team',{goal:'규정 안내'},echo('3권'))],
    ['다른 Workflow',wrapper('workflow.call','child',{workflowId:child.id,version:ver.number})],
  ] as const){
    const p=createProject(owner,{title,graph});
    const run=startRun(owner,{id:p.id,input:'규정 문의',mode:'test',caseFixture:{documents:{rules:'시험 7권'}},requestKey:crypto.randomUUID()});
    await workOne();const actual=runGet(owner,run.id);
    assert.equal(actual.state,'completed',actual.error);assert.equal(actual.output,'시험 7권',title);
  }
});
test('61,62 게시가 바뀐 뒤에도 본 버전을 한 번만 복사한다',()=>{
  const p=createProject(owner,{title:'복사 원본',graph:echo('3권')});
  const first=snapshot(owner,{id:p.id,revision:p.revision}).number;
  publish(owner,{id:p.id,visibility:'public',version:first});
  const observed=openProject(visitor,p.id);
  const next=saveProject(owner,{...p,graph:echo('5권')});
  const second=snapshot(owner,{id:p.id,revision:next.revision}).number;
  publish(owner,{id:p.id,visibility:'public',version:second});
  const intent={id:p.id,published:true,version:observed.publicVersion,requestKey:crypto.randomUUID()};
  const copy=projectCopy(visitor,intent);
  assert.equal(copy.graph?.nodes.find(n=>n.id==='rules')?.config.content,'3권');
  assert.equal(projectCopy(visitor,intent).id,copy.id);assert.equal(listProjects(visitor).filter(p=>p.mine).length,1);
  assert.throws(()=>projectCopy(visitor,{...intent,version:second}),{status:409});
});
test('66 가져오기 전에 현재 프로젝트와 하위 설계에서 빠진 자료집·판을 알린다',()=>{
  const p=createProject(owner,{title:'가져오기'});
  const block=createBlock('knowledge.search',{id:'lookup',config:{storeKey:'분관 규정',version:7}});
  const graph=wrapper('agent.team','team',{goal:'검색'},{nodes:[block],edges:[]});
  assert.deepEqual(inspectImportedDesign(owner,{id:p.id,graph}),['분관 규정 · 7판']);
  assert.deepEqual(inspectImportedDesign(owner,{graph}),['분관 규정 · 7판']);
  assert.deepEqual(inspectImportedDesign(owner,{id:p.id,graph:echo('새 자료')}),[]);
});
test('67 게스트가 유지한 예제와 삭제한 예제의 설치 이력을 로그인 후 유지한다',()=>{
  const guest=legacyGuestSession();
  createProject(guest.user,{lesson:'dynamic'});createProject(guest.user,{lesson:'peer-review'});
  const items=assetList(guest.user),deleted=items.find(a=>a.exampleLesson==='dynamic')!;
  assert.ok(deleted.revision);
  deleteAsset(guest.user,{id:deleted.id,revision:deleted.revision});
  purgeTrashedAssets(guest.user,{items:listTrashedAssets(guest.user)});
  authenticate('signup','guest-receipts','receipt-password','');
  const member=authenticate('login','guest-receipts','receipt-password',guest.cookie,true).user;
  assert.deepEqual(assetList(member).map(a=>[a.id,a.exampleLesson]),items.filter(a=>a.id!==deleted.id).map(a=>[a.id,a.exampleLesson]));
});
test('67 게스트에게 설치 이력만 남아 있어도 같은 예제를 다시 설치하지 않는다',()=>{
  const guest=legacyGuestSession();
  set('INSERT INTO installed_lesson_materials(owner,lesson) VALUES(?,?)',guest.user.id,'dynamic');
  authenticate('signup','receipt-only','receipt-password','');
  const member=authenticate('login','receipt-only','receipt-password',guest.cookie,true).user;
  createProject(member,{lesson:'dynamic'});
  assert.deepEqual(assetList(member),[]);
});
