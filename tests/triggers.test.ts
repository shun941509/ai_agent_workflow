import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBlock,type Block,type Graph} from '../src/domain';

process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-trigger-'));
const { authenticate, usage } = await import('../src/server/auth');
const { legacyGuestSession } = await import('./legacy-guest');
const {createProject,saveProject,project,snapshot,publish,openProject,revoke}=await import('../src/server/projects');
const {triggerList,enableTrigger,disableTrigger,acceptEvent,ownerEvent,dispatchDue,nextTime}=await import('../src/server/triggers');
const {startRun,workOne,runGet,runList,replyRun}=await import('../src/server/runs');
const {resolveWorkflowRefs}=await import('../src/server/workflow-refs');
const {all,one}=await import('../src/server/db');
const {readJsonBody}=await import('../src/server/request-json');

function account(login:string){return authenticate('signup',login,'local-test-password','').user;}
function node(type:string,id:string,config:Block['config']={}){return createBlock(type,{id,title:id,config});}
function line(nodes:Block[]):Graph{
  return {nodes,edges:nodes.slice(1).flatMap((n,i)=>(['flow','data'] as const).map(kind=>({id:i+kind,from:nodes[i].id,to:n.id,kind,out:kind==='flow'?'next':'value',input:kind==='flow'?'in':'input'})))};
}
function pub(user:ReturnType<typeof account>,p:{id:string;revision?:number},visibility='public'){
  const {number}=snapshot(user,{id:p.id,revision:project(p.id).revision});publish(user,{id:p.id,version:number,visibility});return number;
}

test('이벤트 토큰은 해당 소유자의 고정 게시판과 시작 블록만 실행하며 동일 이벤트는 한 번만 접수한다',async()=>{
  const owner=account('event-owner'),guest=legacyGuestSession().user;
  const a=line([node('control.trigger','opened',{trigger:'event',event:'open'}),node('output.answer','send')]);
  const b=line([node('control.trigger','other',{trigger:'event',event:'open'}),node('output.answer','other-end')]);
  const p=createProject(owner,{title:'자료 도착',graph:{nodes:[...a.nodes,...b.nodes],edges:[...a.edges,...b.edges.map(e=>({...e,id:'other-'+e.id}))]}});
  const version=pub(owner,p);
  assert.equal(triggerList(owner,p.id).triggers.length,2);
  assert.throws(()=>enableTrigger(guest,{id:p.id,node:'opened',input:'입력',version}));
  const rule=enableTrigger(owner,{id:p.id,node:'opened',input:'업로드',version});
  assert.ok(rule.secret);assert.throws(()=>acceptEvent(rule.id,'invalid',{eventId:'evt-1'}));
  const recvd=acceptEvent(rule.id,rule.secret!,{eventId:'evt-1',input:'새로운 질문'});
  assert.deepEqual(acceptEvent(rule.id,rule.secret!,{eventId:'evt-1',input:'새로운 질문'}),recvd);
  assert.throws(()=>acceptEvent(rule.id,rule.secret!,{eventId:'evt-1',input:'바뀐 질문'}));
  assert.equal(runList(owner,p.id).length,1);assert.equal(await workOne(),true);
  const r=runGet(owner,recvd.runId);assert.equal(r.output,'새로운 질문');assert.equal(r.state,'completed');
  assert.ok(!r.events.some((e:{nodeId:string})=>e.nodeId==='other'||e.nodeId==='other-end'));
  assert.throws(()=>runGet(guest,r.id));assert.throws(()=>ownerEvent(guest,{id:rule.id,eventId:'x'}));
  assert.equal(usage(guest).run.used,0);
  disableTrigger(owner,rule.id);assert.throws(()=>acceptEvent(rule.id,rule.secret!,{eventId:'evt-2'}));
  const rearmed=enableTrigger(owner,{id:p.id,node:'opened',input:'업로드',version});assert.notEqual(rearmed.secret,rule.secret);
  pub(owner,p);assert.throws(()=>acceptEvent(rearmed.id,rearmed.secret!,{eventId:'evt-3'}),/게시 버전/);
});

test('지연됐던 일정 하나를 큐에 전달하고 재선점과 중복 실행을 방지한다',async()=>{
  const owner=account('schedule-owner'),base=Date.parse('2026-01-01T00:00:00Z');
  assert.equal(nextTime('매일 09:00',base),base+86400000);
  assert.equal(nextTime('2026-01-01T00:00:00Z',base),null);
  assert.throws(()=>nextTime('매 0분',base));assert.throws(()=>nextTime('매일 26:10',base));
  const p=createProject(owner,{graph:line([node('control.trigger','timer',{trigger:'schedule',schedule:'매 15분'}),node('output.answer','output')])});
  const version=pub(owner,p,'private'),a=enableTrigger(owner,{id:p.id,node:'timer',version,input:'오전 보고서'},base);
  assert.equal(a.nextAt,'2026-01-01T00:15:00.000Z');
  assert.equal(dispatchDue(base+60000),false);
  const later=base+55*60000;assert.equal(dispatchDue(later),true);assert.equal(dispatchDue(later),false);
  const r=runList(owner,p.id)[0];assert.equal(await workOne(),true);assert.equal(runGet(owner,r.id).output,'오전 보고서');
  const origin=one<{data:string}>('SELECT data FROM run_origins WHERE run=?',r.id);
  assert.equal(JSON.parse(origin!.data).scheduledAt,'2026-01-01T00:15:00.000Z');
  assert.equal(triggerList(owner,p.id).registrations[0].nextAt,new Date(later+15*60000).toISOString());
  disableTrigger(owner,a.id);
});

test('37 작업 슬롯이 바쁜 동안에도 예약 시각마다 한 번씩 접수한다',async(t)=>{
  const base=Date.parse('2028-06-10T00:00:00Z'),owner=account('scheduler-slots');
  t.mock.timers.enable({apis:['Date','setInterval'],now:base});
  const {startScheduleClock}=await import('../src/server/triggers');
  const p=createProject(owner,{graph:line([node('control.trigger','timer',{trigger:'schedule',schedule:'매 1분'}),node('output.answer','end')])});
  const version=pub(owner,p,'private'),rule=enableTrigger(owner,{id:p.id,node:'timer',version,input:'정시 보고'});
  const stop=startScheduleClock();
  try{
    // No workOne call is available to drain these jobs.
    t.mock.timers.tick(120000);
    const instants=()=>all<{at:string}>("SELECT json_extract(o.data,'$.scheduledAt') AS at FROM run_origins o JOIN runs r ON r.id=o.run WHERE r.owner=? ORDER BY at",owner.id).map(x=>x.at);
    assert.deepEqual(instants(),[new Date(base+60000).toISOString(),new Date(base+120000).toISOString()]);
    t.mock.timers.tick(400);assert.equal(instants().length,2);
  }finally{stop();disableTrigger(owner,rule.id);while(await workOne()){}}
});

test('38 게시 버전을 바꾸고 다시 복구해도 예약은 소유자가 재개할 때까지 멈춘다',()=>{
  const base=Date.parse('2028-06-11T00:00:00Z'),owner=account('schedule-republish');
  const p=createProject(owner,{graph:line([node('control.trigger','t',{trigger:'schedule',schedule:'매 1분'}),node('output.answer','end')])});
  const version=pub(owner,p,'private'),rule=enableTrigger(owner,{id:p.id,node:'t',version,input:'정시 보고'},base);
  pub(owner,p,'private');
  publish(owner,{id:p.id,version,visibility:'private'});
  const paused=triggerList(owner,p.id).registrations[0];
  assert.equal(paused.enabled,false);assert.equal(paused.nextAt,null);
  const preview=triggerList(owner,p.id).triggers[0].resumeAt;
  assert.ok(preview&&Date.parse(preview)>Date.now());
  assert.equal(dispatchDue(base+120000),false);
  const resumed=enableTrigger(owner,{id:p.id,node:'t',version,input:'재개한 보고'},base+120000);
  assert.equal(resumed.nextAt,new Date(base+180000).toISOString());
  disableTrigger(owner,rule.id);
});

test('39 잘못된 일자를 거절하고 윤일과 시간대 경계는 보존한다',()=>{
  for(const value of ['2027-02-29T15:00Z','2028-02-30T09:00+09:00','2027-04-31T01:00-06:00']){
    assert.throws(()=>nextTime(value,0),/일정/);
  }
  assert.equal(nextTime('2028-02-29T01:00+09:00',0),Date.parse('2028-02-28T16:00Z'));
});

test('40 공백이 있는 이벤트 이름은 게시 등록부터 실행까지 같은 이름으로 처리한다',async()=>{
  const owner=account('event-whitespace'),p=createProject(owner,{graph:line([node('control.trigger','t',{trigger:'event',event:'  book.arrived  '}),node('output.answer','end')])});
  const version=pub(owner,p,'private'),rule=enableTrigger(owner,{id:p.id,node:'t',version,input:'새 자료'});
  assert.equal(triggerList(owner,p.id).triggers[0].setting,'book.arrived');
  const id=acceptEvent(rule.id,rule.secret!,{eventId:'first'}).runId;
  while(runGet(owner,id).state==='queued')await workOne();
  assert.equal(runGet(owner,id).output,'새 자료');disableTrigger(owner,rule.id);
});

test('하위 Workflow는 고정된 판을 사용하고 공개되지 않은 판과 권한 철회 후 재개 및 순환 참조를 차단한다',async()=>{
  const owner=account('workflow-owner'),other=account('workflow-reader'),guest=legacyGuestSession().user;
  const child=createProject(owner,{graph:line([node('input.user_request','start'),node('input.form','wait',{prompt:'최종 내용'}),node('output.answer','out')])});
  const v1=pub(owner,child);
  const snapOnly=snapshot(owner,{id:child.id,revision:project(child.id).revision}).number;
  const make=(version:number)=>line([node('input.user_request','first'),node('workflow.call','call',{workflowId:child.id,version}),node('output.answer','done')]);
  assert.throws(()=>resolveWorkflowRefs(make(snapOnly),other,'parent',{expand:true}),/공유 가능한/);
  const parent=createProject(other,{graph:make(v1)});pub(other,parent);
  const r=startRun(guest,{id:parent.id,mode:'live',requestKey:'use-v1',input:'1판 입력'});await workOne();
  assert.equal(runGet(guest,r.id).state,'waiting');
  const r2=startRun(guest,{id:parent.id,mode:'live',requestKey:'second',input:'2판 시작 전'});await workOne();
  const pendingId=runGet(guest,r2.id).prompt.id;
  const newChild=saveProject(owner,{id:child.id,revision:project(child.id).revision,title:'새 판',graph:line([node('input.user_request','start'),node('output.answer','out')])});pub(owner,newChild);
  replyRun(guest,{runId:r.id,waitId:runGet(guest,r.id).prompt.id,value:'1판 회신'});await workOne();
  assert.equal(runGet(guest,r.id).output,'1판 회신');
  revoke(owner,child.id);
  assert.equal(runGet(guest,r2.id).prompt,null);
  assert.throws(()=>replyRun(guest,{runId:r2.id,waitId:pendingId,value:'차단'}),/권한/);
  assert.throws(()=>startRun(guest,{id:parent.id,mode:'live',requestKey:'denied',input:'차단 확인'}));
  const draft=createProject(owner,{graph:make(v1)});
  saveProject(owner,{id:child.id,title:'순환',revision:project(child.id).revision,graph:line([node('input.user_request','in'),node('workflow.call','call',{workflowId:draft.id}),node('output.answer','out')])});
  pub(owner,draft,'private');
  assert.throws(()=>snapshot(owner,{id:child.id,revision:project(child.id).revision}),/상위 Workflow/);
  assert.ok(all('SELECT * FROM project_releases').length>0);
});

test('이벤트 인자는 소유자 승인을 대체하지 않으며 거절한 작업은 도구에 전송하지 않는다',async()=>{
  const owner=account('approval-event'),guest=legacyGuestSession().user;
  const graph=line([node('control.trigger','ready',{trigger:'event',event:'reserve'}),
    node('tool.invoke','reserve',{tool:'reservations.create',args:{book:'비 오는 날',branch:'동관'}}),node('output.answer','out')]);
  const p=createProject(owner,{graph}),version=pub(owner,p,'private');
  const a=enableTrigger(owner,{id:p.id,node:'ready',version,input:'예약 요청'});const r=acceptEvent(a.id,a.secret!,{eventId:'E77',input:'승인함'});
  await workOne();const waiting=runGet(owner,r.runId);assert.equal(waiting.state,'waiting');assert.equal(waiting.prompt.kind,'approval');
  assert.deepEqual(waiting.prompt.operation.args,{book:'비 오는 날',branch:'동관'});assert.equal(waiting.operations.length,0);
  assert.throws(()=>replyRun(guest,{runId:r.runId,waitId:waiting.prompt.id,approved:true}));
  replyRun(owner,{runId:r.runId,waitId:waiting.prompt.id,approved:false});await workOne();
  const rejected=runGet(owner,r.runId);assert.equal(rejected.state,'failed');assert.equal(rejected.operations.length,0);
  disableTrigger(owner,a.id);
});

test('외부 Workflow 버전과 깊이 한도, 길이 헤더를 생략한 JSON 바이트 제한',async()=>{
  const owner=account('ref-limits');
  const leaf=createProject(owner,{graph:line([node('input.user_request','s'),node('output.answer','o')])});pub(owner,leaf);
  const linked=(id:string,version:unknown)=>line([node('input.user_request','s'),node('workflow.call','wf',{workflowId:id,version}),node('output.answer','o')]);
  for(const invalid of [true,[1],0,-1,'0','1.5'])assert.throws(()=>resolveWorkflowRefs(linked(leaf.id,invalid),owner,'independent',{expand:true}),/정수/);
  let g=linked(leaf.id,1);for(let i=0;i<8;i++)g=line([node('input.user_request','s'),{...node('workflow.call','wf'),graph:g},node('output.answer','o')]);
  assert.throws(()=>resolveWorkflowRefs(g,owner,'independent',{expand:true}),/깊이/);
  const req=new Request('http://local/',{method:'POST',body:'"입력"'});
  await assert.rejects(readJsonBody(req,5),/너무 큽니다/);
  assert.deepEqual(await readJsonBody(new Request('http://local/',{method:'POST',body:'{"내용":1}'}),100),{내용:1});
});
