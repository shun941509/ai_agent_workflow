import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {strFromU8,unzipSync} from 'fflate';
import {createBlock,type Graph} from '../src/domain';
import {executeGraph} from '../src/engine';
import {buildAgentZip} from '../src/server/agent-zip';
import {authenticate} from '../src/server/auth';
import {set} from '../src/server/db';
import {createProject} from '../src/server/projects';
import {replyRun,runGet,startRun,workOne} from '../src/server/runs';

process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-private-history-'));
process.env.OPENAI_API_KEY='offline-test';
process.env.OPENAI_MODEL='offline-test';

function wire(graph:Graph,from:string,to:string,kind:'flow'|'data',input=kind==='flow'?'in':'input'){
  graph.edges.push({id:String(graph.edges.length),from,to,kind,out:kind==='flow'?'next':'value',input});
}

for(const operation of ['block','mask'] as const)for(const legacy of [false,true]){
  test(operation+' 처리가 양식 보존과 질문·답변·우회 연결보다 우선한다 · '+(legacy?'이전 체크포인트':'현재 체크포인트'),async t=>{
    const actor=authenticate('signup','privacy-'+operation+'-'+legacy,'integration-test-pass','').user;
    const graph:Graph={nodes:[
      createBlock('input.user_request',{id:'question'}),
      createBlock('input.form',{id:'form',config:{prompt:'연락처',fields:['연락처','지점'],historyFields:'*'}}),
      createBlock('safety.redact',{id:'privacy',config:{operation,categories:['email']}}),
      createBlock('ai.single_task',{id:'ai',config:{goal:'처리 안내'}}),
      createBlock('output.answer',{id:'answer'}),
    ],edges:[]};
    wire(graph,'question','form','flow'); wire(graph,'form','privacy','flow'); wire(graph,'form','privacy','data');
    let predecessor='privacy';
    if(operation==='block'){
      graph.nodes.push(createBlock('error.handle',{id:'recover',config:{strategy:'continue',message:'처리 완료'}}));
      graph.nodes.push(createBlock('output.answer',{id:'clear'}));
      wire(graph,'privacy','clear','flow'); wire(graph,'privacy','clear','data');
      wire(graph,'privacy','recover','flow'); wire(graph,'privacy','recover','data'); predecessor='recover';
    }
    wire(graph,predecessor,'ai','flow'); wire(graph,predecessor,'ai','data');
    wire(graph,'question','ai','data','question');
    wire(graph,'ai','answer','flow'); wire(graph,'ai','answer','data');
    const p=createProject(actor,{graph});
    const email='masked@example.org',ordinary='other@example.org';
    const calls:{role:string;content:string}[][]=[];
    t.mock.method(globalThis,'fetch',async (_url:unknown,init:RequestInit)=>{
      calls.push(JSON.parse(String(init.body)).input);
      return Response.json({output:[{type:'message',content:[{type:'output_text',text:'접수 완료 '+email}]}]});
    });
    let conversation:string|undefined;
    for(let i=0;i<2;i++){
      const queued=startRun(actor,{id:p.id,mode:'test',input:i?'다음 질문':'연락 '+email+' 또는 '+ordinary,conversation,requestKey:'privacy-'+i});
      conversation=queued.conversation;
      await workOne();const waiting=runGet(actor,queued.id);
      assert.equal(waiting.state,'waiting',waiting.error);
      replyRun(actor,{runId:queued.id,waitId:waiting.prompt.id,value:JSON.stringify({연락처:i?'next@example.org':email,지점:'서점'})});
      await workOne();const done=runGet(actor,queued.id);assert.equal(done.state,'completed',done.error);
      if(legacy&&!i)set(`UPDATE runs SET checkpoint=json_set(json_remove(checkpoint,'$.privacyChecks'),
        '$.historyDetails',json(?)) WHERE id=?`,JSON.stringify({form:{title:'회신',value:{연락처:email,지점:'서점'}}}),queued.id);
    }
    assert.equal(calls.length,2);
    for(const call of calls)assert.ok(!JSON.stringify(call).includes(email));
    const prior=calls[1].slice(0,-1);
    assert.deepEqual(prior.map(x=>x.role),['user','assistant']);
    assert.ok(prior[0].content.includes(ordinary));
    assert.match(prior[0].content,/서점/);
    assert.match(prior[1].content,/접수 완료/);
    if(operation==='mask')assert.ok(prior.every(x=>x.content.includes('[이메일 가림]')));
  });
}

test('첨부의 가림 이후 대기를 재개하고 같은 원문을 다시 선택하면 가린 값만 보존한다',async()=>{
  const graph:Graph={nodes:[
    createBlock('file.input',{id:'file',config:{historyFields:'code'}}),
    createBlock('document.read',{id:'read',config:{format:'json'}}),
    createBlock('safety.redact',{id:'mask',config:{operation:'mask',categories:['phone']}}),
    createBlock('input.form',{id:'wait',config:{prompt:'다음'}}),
    createBlock('data.transform',{id:'select',config:{operation:'select',path:'note'}}),
    createBlock('ai.single_task',{id:'ai'}),
    createBlock('output.answer',{id:'end'}),
  ],edges:[]};
  for(const [from,to] of [['file','read'],['read','mask'],['mask','wait'],['wait','select'],['select','ai'],['ai','end']]){
    wire(graph,from,to,'flow');
    wire(graph,from==='wait'?'read':from,to,'data');
  }
  const phone='010-1234-5678',input=JSON.stringify({fileName:'test.json',content:JSON.stringify({code:'보관',note:phone})});
  const calls:string[]=[];
  const services={model:async(q:{input:string})=>{calls.push(q.input);return {text:'확인'};},tool:async()=>assert.fail()};
  const wait=await executeGraph(graph,{runId:'resume',input},services);
  assert.equal(wait.status,'waiting');
  const done=await executeGraph(graph,{runId:'resume',input,checkpoint:wait.checkpoint,reply:{value:'계속',waitId:wait.wait!.id}},services);
  assert.equal(done.status,'completed',done.error??'');
  assert.deepEqual(calls,['[전화번호 가림]']);
  assert.deepEqual(done.checkpoint.historyDetails?.['root/select'],{title:'값 변환',value:{note:'[전화번호 가림]'}});
  assert.deepEqual(done.checkpoint.historyDetails?.['root/file'],{title:'test.json',value:{code:'보관'}});
});

test('이전 버전이 검사 기록을 비워 둔 경우에도 첨부 추가 필드를 다음 문답에서 가린다',async t=>{
  const actor=authenticate('signup','old-attachment-history','integration-test-pass','').user;
  const graph:Graph={nodes:[createBlock('file.input',{id:'file'}),createBlock('document.read',{id:'read',config:{format:'json'}}),
    createBlock('safety.redact',{id:'guard',config:{operation:'mask',categories:['email']}}),
    createBlock('ai.single_task',{id:'model',config:{goal:'처리 결과 안내'}}),createBlock('output.answer',{id:'end'})],edges:[]};
  for(const [from,to] of [['file','read'],['read','guard'],['guard','model'],['model','end']]){wire(graph,from,to,'flow');wire(graph,from,to,'data');}
  const email='old-field@example.org',calls:{role:string;content:string}[][]=[];
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
    calls.push(JSON.parse(String(init.body)).input);
    return Response.json({output:[{type:'message',content:[{type:'output_text',text:'완료'}]}]});
  });
  const project=createProject(actor,{graph});
  const input=(question:string,caseId:string)=>JSON.stringify({fileName:'case.json',question,content:JSON.stringify({title:'민원',content:'본문',caseId})});
  const first=startRun(actor,{id:project.id,mode:'test',input:input('접수 '+email,email),requestKey:'old-file'});
  await workOne();assert.equal(runGet(actor,first.id).state,'completed');
  set(`UPDATE runs SET output=?,checkpoint=json_set(json_remove(checkpoint,'$.privacyVersion'),'$.privacyChecks',json('[]'),
    '$.steps."root/guard".values.value','본문') WHERE id=?`,'처리 '+email,first.id);
  const second=startRun(actor,{id:project.id,mode:'test',input:input('다음','일반'),conversation:first.conversation,requestKey:'next-file'});
  await workOne();assert.equal(runGet(actor,second.id).state,'completed');
  assert.deepEqual(calls[1].slice(0,-1).map(row=>row.content),['접수 [이메일 가림]','처리 [이메일 가림]']);
});

test('업무 범위 판정이 이전 문답에서 가린 이메일을 포함한 요청을 분리한다',async t=>{
  const actor=authenticate('signup','privacy-mixed','integration-test-pass','').user;
  const graph:Graph={agentScope:{mode:'dedicated',purpose:'회의록 정리'},nodes:[
    createBlock('input.user_request',{id:'input'}),createBlock('safety.redact',{id:'mask',config:{operation:'mask',categories:['email']}}),
    createBlock('ai.single_task',{id:'ai',config:{goal:'회의록 정리'}}),createBlock('output.answer',{id:'end'}),
  ],edges:[]};
  for(const [from,to] of [['input','mask'],['mask','ai'],['ai','end']]){
    wire(graph,from,to,'flow');wire(graph,from,to,'data');
  }
  const email='mixed@example.org',calls:{input:{content:string}[];instructions:string}[]=[];
  t.mock.method(globalThis,'fetch',async (_url:unknown,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));calls.push(body);
    const scope=body.instructions.includes('업무 범위 판정:');
    const text=scope?(calls.length===1?'{"status":"in_scope"}':'{"status":"mixed","excluded":["이메일 확인 [이메일 가림]"]}'):'회의록 완료';
    return Response.json({output:[{type:'message',content:[{type:'output_text',text}]}]});
  });
  const p=createProject(actor,{graph});
  const first=startRun(actor,{id:p.id,mode:'test',input:'회의록 '+email,requestKey:'scope-first'});
  await workOne();assert.equal(runGet(actor,first.id).state,'completed');
  const second=startRun(actor,{id:p.id,mode:'test',input:'회의록 작성. 이메일 확인 '+email,conversation:first.conversation,requestKey:'scope-second'});
  await workOne();const done=runGet(actor,second.id);
  assert.equal(done.state,'completed',done.error);
  assert.ok(!JSON.stringify(calls.slice(2)).includes(email));
  assert.match(calls[2].input.at(-1)!.content,/이메일 확인 \[이메일 가림\]/);
  assert.equal(JSON.parse(calls[3].input.at(-1)!.content).request,'회의록 작성.');
});

test('구형 하위 검사에서 암시적으로 받은 전화번호만 복원해 붙여 쓴 원문도 가린다',async()=>{
  const child:Graph={nodes:[
    createBlock('input.user_request',{id:'start'}),createBlock('safety.redact',{id:'mask',config:{categories:['phone']}}),
    createBlock('output.answer',{id:'out'}),
  ],edges:[]};
  wire(child,'start','mask','flow');wire(child,'mask','out','flow');wire(child,'mask','out','data');
  const team=createBlock('agent.team',{id:'team'});team.graph=child;
  const graph:Graph={nodes:[createBlock('input.user_request',{id:'i'}),team,createBlock('input.form',{id:'wait'}),
    createBlock('ai.single_task',{id:'ai'}),createBlock('output.answer',{id:'out'})],edges:[]};
  for(const [from,to] of [['i','team'],['team','wait'],['wait','ai'],['ai','out']]){
    wire(graph,from,to,'flow');wire(graph,from,to,'data');
  }
  const phone='010-1234-5678',other='010-5555-5555';
  const requests:string[]=[];
  const services={model:async(q:{input:string})=>{requests.push(q.input);return {text:'완료'};},tool:async()=>assert.fail()};
  const old=await executeGraph(graph,{runId:'nested',input:phone},services);
  assert.equal(old.status,'waiting');
  delete old.checkpoint.privacyChecks;
  old.checkpoint.events.find(e=>e.kind==='start'&&e.nodeId==='mask')!.data={};
  const resume=async()=>executeGraph(graph,{runId:'nested',input:phone,checkpoint:old.checkpoint,
    reply:{value:'ID'+phone+'suffix, '+other,waitId:old.wait!.id}},services);
  assert.equal((await resume()).status,'completed');
  assert.deepEqual(requests,['ID[전화번호 가림]suffix, '+other]);
  delete old.checkpoint.steps['root/team/graph/start'];
  old.checkpoint.events=old.checkpoint.events.filter(e=>e.nodeId!=='start');
  assert.equal((await resume()).status,'completed');
  assert.equal(requests[1],'ID[전화번호 가림]suffix, '+other);
  old.checkpoint.events=old.checkpoint.events.filter(e=>e.nodeId!=='team');
  assert.equal((await resume()).status,'failed');
  assert.equal(requests.length,2);
});

test('메일 주소로 이름을 지은 보존 항목 두 개와 원래 가림 표시 이름의 항목을 모두 남긴다',async()=>{
  const graph:Graph={nodes:[
    createBlock('file.input',{id:'file',config:{historyFields:'contacts'}}),
    createBlock('safety.redact',{id:'guard',config:{categories:['email']}}),createBlock('output.answer',{id:'end'}),
  ],edges:[]};
  for(const [from,to] of [['file','guard'],['guard','end']]){wire(graph,from,to,'flow');wire(graph,from,to,'data');}
  const content=JSON.stringify({contacts:{'one@example.org':{city:'Seoul'},'two@example.org':{city:'Busan'},'[이메일 가림]':{city:'Daejeon'}}});
  const done=await executeGraph(graph,{runId:'keys',input:JSON.stringify({fileName:'cities.json',content})},
    {model:async()=>assert.fail(),tool:async()=>assert.fail()});
  assert.equal(done.status,'completed',done.error??'');
  assert.deepEqual(done.checkpoint.historyDetails?.['root/file'],{title:'cities.json',value:{contacts:{
    '[이메일 가림] (2)':{city:'Seoul'},'[이메일 가림] (3)':{city:'Busan'},'[이메일 가림]':{city:'Daejeon'}}}});
  graph.nodes[0].config.historyFields='*';
  const wildcard=await executeGraph(graph,{runId:'wildcard',input:JSON.stringify({fileName:'cities.json',content})},
    {model:async()=>assert.fail(),tool:async()=>assert.fail()});
  const retained=wildcard.checkpoint.historyDetails?.['root/file'] as {value:string};
  assert.deepEqual(Object.values(JSON.parse(retained.value).contacts),[{city:'Seoul'},{city:'Busan'},{city:'Daejeon'}]);
});

test('런타임 없는 ZIP은 차단·가림과 첨부 항목 보존, 세션 인계 조건을 명시한다',()=>{
  for(const operation of ['block','mask'])for(const split of [false,true]){
    const graph:Graph={nodes:[
      createBlock('file.input',{id:'file',config:{historyFields:'*'}}),
      createBlock('data.transform',{id:'select',config:{operation:'select',path:'contact'}}),
      createBlock('safety.redact',{id:'guard',config:{operation,categories:['email','phone']}}),
      createBlock('agent.delegate',{id:'review',config:{role:'확인 담당',task:'정리'}}),
      createBlock('output.answer',{id:'answer'}),
    ],edges:[]};
    for(const [from,to] of [['file','select'],['select','guard'],['guard','review'],['review','answer']]){
      wire(graph,from,to,'flow');wire(graph,from,to,'data');
    }
    if(split)graph.nodes.push(createBlock('ai.single_task',{id:'long',config:{goal:'가'.repeat(6000)}}));
    const files=unzipSync(buildAgentZip({title:'민감정보',graph,resources:[],files:[]}));
    assert.equal(Object.hasOwn(files,'workflow/index.md'),split);
    const instructions=strFromU8(files['AGENTS.md']);
    const stages=Object.entries(files).filter(([path])=>path==='AGENTS.md'||path.startsWith('workflow/step-')).map(([,data])=>strFromU8(data)).join('\n');
    const role=Object.entries(files).find(([path])=>path.startsWith('agents/')&&path.endsWith('.md'));
    assert.ok(role);
    assert.match(strFromU8(role[1]),/처리된 인계값만 받는 새 세션/);
    assert.match(strFromU8(role[1]),/격리할 수 없으면 호출을 멈추고/);
    assert.match(instructions,/차단·가림 결과를 유지/);
    assert.match(stages,/선택한 값도 다음 문답에/);
    assert.match(stages,/객체의 모든 키와 값, 중첩 배열, 파일명과 첨부 본문/);
    assert.match(instructions,/새 세션에서 재개/);
    assert.match(instructions,/지원되지 않으면 원문이 재전달되기 전에 중단/);
    assert.match(stages,operation==='block'?/오류 경로를 따르세요/:/\[전화번호 가림\]/);
  }
});
