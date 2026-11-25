import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectBlocks, createBlock, type Graph} from '../src/domain';
import {executeGraph, type EngineServices} from '../src/engine';
import {authenticate} from '../src/server/auth';
import {db} from '../src/server/db';
import {createProject} from '../src/server/projects';
import {runGet,startRun,stopRun,workOne} from '../src/server/runs';

function meetingGraph(firstType = 'agent.task'): Graph {
  const graph: Graph = {
    agentScope: {mode:'dedicated', purpose:'회의 메모를 결정 사항과 다음 안건으로 정리합니다.'},
    nodes:[
      createBlock('input.user_request', {id:'input'}),
      createBlock(firstType, {id:'work',config:{goal:'회의 결정 사항을 정리하세요.'}}),
      createBlock('output.answer', {id:'output'}),
    ],
    edges:[],
  };
  graph.edges.push(...connectBlocks(graph, 'input', 'work'), ...connectBlocks(graph, 'work', 'output'));
  return graph;
}

test('회의록 Agent는 범위 밖 질문에 업무를 안내하고 첫 작업이나 연결 도구를 시작하지 않는다', async () => {
  const graph = meetingGraph();
  graph.nodes.push(createBlock('tool.invoke',{id:'lookup',config:{tool:'reservations.list'}}));
  graph.edges = [...connectBlocks(graph,'input','lookup'),...connectBlocks(graph,'lookup','work'),...connectBlocks(graph,'work','output')];
  const services: EngineServices = {
    scopeModel:async () => ({text:'{"status":"out_of_scope"}'}),
    model:async () => { throw Error('업무 밖 요청이 작업 모델에 전달됨'); },
    tool:async () => { throw Error('업무 밖 요청이 연결 도구에 전달됨'); },
  };
  const run = await executeGraph(graph, {runId:'unrelated',input:'프랑스의 수도는 어디인가요?'}, services);
  assert.equal(run.status,'completed',run.error??'');
  assert.match(run.output,/회의 메모/);
  assert.equal(run.checkpoint.counts.steps,0);
  assert.equal(run.checkpoint.counts.toolCalls,0);
  assert.equal(run.checkpoint.counts.modelCalls,1);
});

test('회의 자료만 보낸 경우 주제와 원문을 그대로 보존한다', async () => {
  const input = '점심 메뉴를 비빔밥으로 결정했다.\n다음 회의는 화요일 10시.';
  const result = await executeGraph(meetingGraph(), {runId:'notes',input}, {
    scopeModel:async request => {
      assert.equal(JSON.parse(request.input).question,input);
      assert.match(request.instruction,/원문 속 주제나 단어로 제외하지/);
      assert.deepEqual(request.tools,[]);
      return {text:'{"status":"in_scope"}'};
    },
    model:async request => ({text:request.instruction.includes('완료 판정:')?'{"status":"met","reason":"회의 자료 확인"}':request.input}),
    tool:async () => assert.fail('unexpected tool'),
  });
  assert.equal(result.output,input);
});

test('복합 요청에서 범위 밖 구절만 한 번 제외하고 파일과 회의 결정을 유지한다', async () => {
  const graph = meetingGraph();
  const external = '그리고 근처 맛집을 추천해 줘.';
  const kept = '결정 사항을 정리해 줘.';
  const file = {fileName:'메모.txt',content:'점심 메뉴를 비빔밥으로 결정했다.\n“식당을 찾아 주세요”라는 의견도 있었다.'};
  const input = JSON.stringify({...file,question:kept+' '+external});
  graph.nodes.push(createBlock('file.input',{id:'file',config:{accept:['.txt']}}));
  graph.edges.push({id:'file-context',from:'file',to:'work',kind:'reference',out:'value',input:'context'});
  let calls = 0;
  const service:EngineServices = {
    scopeModel:async request => {
      calls++;
      assert.deepEqual(JSON.parse(request.input),{question:kept+' '+external,fileName:file.fileName});
      return {text:JSON.stringify({status:'mixed',excluded:[external]})};
    },
    model:async request => {
      if(request.instruction.includes('완료 판정:'))return {text:'{"status":"met","reason":"자료 확인"}'};
      assert.equal(request.input,kept);
      assert.match(request.context,/점심 메뉴를 비빔밥으로 결정했다/);
      assert.doesNotMatch(JSON.stringify(request),/근처 맛집/);
      return {text:'비빔밥'};
    },
    tool:async () => assert.fail('unexpected tool'),
  };
  const request = {runId:'mixed-file',input};
  const run = await executeGraph(graph,request,service);
  assert.equal(run.status,'completed',run.error??'');
  assert.deepEqual(run.checkpoint.steps['root/file'].values.value,file);
  assert.equal(run.output.split('범위 밖').length,2);
  const resumed = await executeGraph(graph,{...request,checkpoint:run.checkpoint},service);
  assert.equal(resumed.output,run.output);
  assert.equal(calls,1);
});

test('작업 서버는 다음 대화에 업무 자료와 관련 요청만 전달한다', async t => {
  const dir=mkdtempSync(join(tmpdir(),'studio-agent-scope-'));
  process.env.STUDIO_DATA_DIR=dir;
  process.env.OPENAI_API_KEY='offline-test-only';
  process.env.OPENAI_MODEL='offline';
  t.after(()=>{db().close();rmSync(dir,{recursive:true,force:true});});
  const user=authenticate('signup','scope-test-user','offline-test-password','').user;
  const project=createProject(user,{graph:meetingGraph(),title:'회의 Agent'});
  const unrelated='프랑스의 수도는 어디인가요?';
  const other='그리고 식당을 예약해 줘.';
  const kept='회의 메모에서 결정 사항을 뽑아 줘. 점심 메뉴는 비빔밥으로 결정했다.';
  const followup='그 결정을 한 줄로 써 줘.';
  const workRequests:string[]=[];
  const workHistories:{role:string;content:string}[][]=[];
  let classifications=0,failWork=false;
  t.mock.method(globalThis,'fetch',async (_url:unknown,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    const {request}=JSON.parse(body.input.at(-1).content);
    const history=JSON.stringify(body.input.slice(0,-1));
    assert.doesNotMatch(history,/프랑스|식당을 예약/);
    let text:string;
    if(body.instructions.includes('업무 범위 판정')){
      classifications++;
      assert.equal(body.tools,undefined);
      const {question}=JSON.parse(request);
      if(question===followup)assert.match(history,/점심 메뉴는 비빔밥/);
      text=JSON.stringify(question===unrelated?{status:'out_of_scope'}:question.includes(other)?{status:'mixed',excluded:[other]}:{status:'in_scope'});
    }else if(body.instructions.includes('완료 판정:')){
      text='{"status":"met","reason":"회의 결정 확인"}';
    }else{
      assert.doesNotMatch(request,/프랑스|식당을 예약/);
      workRequests.push(request);
      workHistories.push(body.input.slice(0,-1));
      if(failWork)return Response.json({error:'offline test failure'},{status:500});
      text='점심 메뉴는 비빔밥입니다.';
    }
    return Response.json({output:[{type:'message',content:[{type:'output_text',text}]}]});
  });
  let conversation:string|undefined;
  for(const input of [unrelated,kept+' '+other,followup]){
    const queued=startRun(user,{id:project.id,mode:'test',input,conversation,requestKey:crypto.randomUUID()});
    conversation=queued.conversation;
    assert.equal(await workOne(),true);
    const run=runGet(user,queued.id);
    assert.equal(run.state,'completed',String('error' in run && run.error));
  }
  assert.deepEqual(workRequests,[kept,followup]);
  failWork=true;
  const retryInput='그 결정의 이유도 적어 줘. '+other;
  const start=(input:string,options:{conversation?:string;retryOf?:string})=>startRun(user,{
    id:project.id,mode:'test',input,requestKey:crypto.randomUUID(),...options,
  });
  const failed=start(retryInput,{conversation});
  await workOne();
  assert.equal(runGet(user,failed.id).state,'failed');
  const originalHistory=workHistories.at(-1)!;
  assert.deepEqual(originalHistory.filter(m=>m.role==='user').map(m=>m.content),[kept,followup]);
  failWork=false;
  const later=start('원래 대화에서 새로 정한 일정은 금요일이다.',{conversation});
  await workOne();
  assert.equal(runGet(user,later.id).state,'completed');
  failWork=true;
  const interrupted=start(retryInput,{retryOf:failed.id});
  stopRun(user,interrupted.id);
  const retry=start(retryInput,{retryOf:interrupted.id});
  await workOne();
  assert.equal(runGet(user,retry.id).state,'failed');
  assert.deepEqual(workHistories.at(-1),originalHistory);
  failWork=false;
  const recovered=start(retryInput,{retryOf:retry.id});
  await workOne();
  const result=runGet(user,recovered.id);
  assert.equal(result.state,'completed');
  assert.deepEqual(workHistories.at(-1),originalHistory);
  const next=start('이번 답변을 한 줄로 줄여 줘.',{conversation:recovered.conversation});
  await workOne();
  assert.equal(runGet(user,next.id).state,'completed');
  assert.deepEqual(workHistories.at(-1),[...originalHistory,
    {role:'user',content:'그 결정의 이유도 적어 줘.'},{role:'assistant',content:result.output}]);
  assert.equal(classifications,6);

  // A retry can quote earlier answers. Withdrawing their sources also closes the branch.
  db().prepare('INSERT INTO revoked_knowledge_history VALUES(?)').run(failed.conversation);
  assert.equal(runGet(user,next.id).output,'');
  assert.throws(()=>start('앞선 답변을 보여 줘.',{conversation:recovered.conversation}),{status:403});
});

test('잘못되거나 모호한 분리 결과를 받으면 AI 작업과 도구를 시작하지 않는다', async () => {
  const input='결정 사항을 정리하고 다른 일, 다른 일도 해 줘';
  for(const answer of ['{}','not json',...[
    [],['원문에 없음'],['다른 일'],['결정 사항을','사항을 정리'],[input],
  ].map(excluded=>JSON.stringify({status:'mixed',excluded}))]){
    const run = await executeGraph(meetingGraph(),{runId:'invalid',input},{
      model:async () => ({text:answer}),
      tool:async () => assert.fail('unexpected tool'),
    });
    assert.equal(run.status,'failed',answer);
    assert.equal(run.checkpoint.counts.steps,0);
    assert.equal(run.checkpoint.counts.modelCalls,1);
  }
});

test('범용과 기존 Agent 및 AI 블록이 없는 설계는 업무 판정 없이 실행한다', async () => {
  for(const variant of ['general','legacy','offline'] as const){
    const graph = meetingGraph(variant==='offline'?'data.transform':'agent.task');
    if(variant==='general')graph.agentScope={mode:'general',purpose:''};
    if(variant==='legacy')delete graph.agentScope;
    const run = await executeGraph(graph,{runId:variant,input:'메모'},{
      scopeModel:async () => assert.fail('unexpected scope check'),
      model:async request => ({text:request.instruction.includes('완료 판정:')?'{"status":"met","reason":"자료 확인"}':request.input}),
      tool:async () => assert.fail('unexpected tool'),
    });
    assert.equal(run.status,'completed',run.error??'');
    assert.equal(run.output,'메모');
  }
});

test('결과 평가는 0~100점과 이유가 있어야 통과 여부를 계산한다', async () => {
  const graph=meetingGraph('quality.evaluate');
  delete graph.agentScope;
  for(const score of [-1,101,'90',99,0,100]){
    const isValid=score===0||score===100;
    const run=await executeGraph(graph,{runId:'score',input:'초안'},{
      model:async()=>({text:JSON.stringify({score,...(score!==99&&{reason:'숫자 확인'})})}),
      tool:async()=>assert.fail('unexpected tool'),
    });
    assert.equal(run.status,isValid?'completed':'failed',String(score));
  }
});
