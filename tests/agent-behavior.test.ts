import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBlock, migrateGraph, validateGraph, type Block, type Graph, type Edge} from '../src/domain';
import {childScopeInstructions} from '../src/domain/agent-context';
import {executeGraph,type EngineRequest,type EngineServices} from '../src/engine';
import {reviewProposal} from '../src/server/proposal';
import {model} from '../src/server/model';
import {externalDefinitions} from '../src/server/mcp';
import {buildAgentZip} from '../src/server/agent-zip';
import {strFromU8,unzipSync} from 'fflate';

const block=(type:string,id:string,config:Block['config']={},graph?:Graph)=>createBlock(type,{id,config,graph});
const start=block('input.user_request','start'), end=block('output.answer','end');
function edge(from:string,to:string,kind:Edge['kind']='flow',out=kind==='flow'?'next':'value',input=kind==='flow'?'in':'input'):Edge{
  return {id:[from,to,kind,out,input].join('/'),from,to,kind,out,input};
}
function linear(...nodes:Block[]):Graph {
  return {nodes,edges:nodes.slice(1).flatMap((n,i)=>[edge(nodes[i].id,n.id),edge(nodes[i].id,n.id,'data')])};
}
const run=(g:Graph,input:string,services:Partial<EngineServices>={},resume:Partial<EngineRequest>={})=>executeGraph(g,{runId:'review',input,...resume},{
  model:async()=>({text:'ok'}),tool:async()=>{throw Error('예상하지 않은 도구');},...services,
});

test('빈 통과 점수는 70으로, 명시적 0점은 0으로 평가한다',async()=>{
  for(const [threshold,expected] of [['',false],[0,true]] as const){
    const r=await run(linear(start,block('quality.evaluate','eval',{threshold}),end),'초안',{
      model:async()=>({text:'{"score":50,"reason":"필요한 항목 누락"}'})});
    assert.equal(JSON.parse(r.output).passed,expected);
  }
});

test('원래 질문·작업 조건·결과를 판정하고 빠진 항목을 다시 작성한다',async()=>{
  const goal=block('agent.task','plan',{goal:'일정 요약',criterion:'담당자와 마감일을 포함',maxSteps:2});
  const graph=linear(start,goal,end);
  let attempts=0;
  const result=await run(graph,'김 담당, 8월 7일 마감',{model:async request=>{
    if(!request.instruction.includes('완료 판정:'))return {text:++attempts===1?'김 담당':'김 담당 · 8월 7일'};
    const data=JSON.parse(request.input);
    assert.equal(data.question,'김 담당, 8월 7일 마감');
    assert.equal(data.criterion,goal.config.criterion);
    return {text:JSON.stringify(data.answer.includes('8월')?{status:'met',reason:'둘 다 있음'}:{status:'unmet',reason:'마감일 누락'})};
  }});
  assert.equal(result.output,'김 담당 · 8월 7일');
  assert.deepEqual(result.events.filter(e=>e.detail.startsWith('완료 판정')).map(e=>e.detail),['완료 판정 · 미충족','완료 판정 · 충족']);
});

test('검색 원문을 그대로 인용해도 주장이 반대이면 분기 뒤 최종 답변을 보류한다',async()=>{
  const search=block('knowledge.search','search',{query:'대출 한도'});
  const branch=block('control.branch','branch'),ai=block('ai.single_task','answer');
  const graph=linear(start,search,branch,ai,end);
  graph.edges.find(e=>e.from==='branch'&&e.kind==='flow')!.out='yes';
  graph.nodes.push(block('resource.context','rules',{content:'대출 한도는 3권입니다.'}));
  graph.edges.push(edge('rules','search','reference','ref','context'));
  const result=await run(graph,'대출 한도는?',{model:async req=>{
    if(req.instruction.includes('완료 판정:')){
      const review=JSON.parse(req.input);
      assert.equal(review.evidence[0].quote,'대출 한도는 3권입니다.');
      assert.match(review.answer,/7권/);
      return {text:'{"status":"unmet","reason":"인용과 주장이 반대"}'};
    }
    assert.equal(JSON.parse(req.input).candidates[0].quote,'대출 한도는 3권입니다.');
    return {text:'{"answer":"7권입니다.","references":[{"index":0,"quote":"3권입니다."}]}'};
  }});
  assert.equal(result.status,'completed',result.error??'');
  assert.doesNotMatch(result.output,/7권/);
  assert.match(result.output,/확인할 수 없/);
});

test('미완료 모델 메시지와 도구 호출을 산출물로 받지 않는다',async t=>{
  process.env.OPENAI_API_KEY='test-only';process.env.OPENAI_MODEL='test-only';
  const body={status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'부분 답변'}]}]};
  t.mock.method(globalThis,'fetch',async()=>Response.json(body));
  await assert.rejects(model({instruction:'요약',input:'입력',context:'',tools:[]}),/완료되지/);
  const g=linear(start,block('ai.single_task','answer'),block('file.create','artifact'),end);
  const r=await run(g,'요약',{model});
  assert.equal(r.status,'failed');assert.equal(r.output,'');
  assert.deepEqual(r.events.find(e=>e.kind==='error'&&e.nodeId==='answer')?.data,{partialText:'부분 답변'});
  assert.ok(!r.events.some(e=>e.kind==='result'&&e.nodeId==='artifact'));
});

test('고정 MCP 조회에서 실제 입력 스키마를 읽고 모델에 허용된 도구만 제시한다',async t=>{
  process.env.OPENAI_API_KEY='test-only';process.env.OPENAI_MODEL='test-only';
  const parameters={type:'object',required:['branch'],properties:{branch:{type:'string'}}};
  let listed=false,offered=false;
  t.mock.method(globalThis,'fetch',async (url:string,init:RequestInit)=>{
    const req=JSON.parse(String(init.body));
    if(url.includes('openai.com')){
      assert.equal(req.tools.length,1);assert.deepEqual(req.tools[0].parameters,parameters);
      assert.equal(req.tools[0].description,'도서관 지점 조회');offered=true;
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'안내'}]}]});
    }
    if(req.method==='notifications/initialized')return new Response(null,{status:202});
    const result=req.method==='initialize'?{protocolVersion:'2025-03-26'}:{tools:[
      {name:'lookup',description:'도서관 지점 조회',inputSchema:parameters},{name:'hidden',inputSchema:parameters}]};
    listed ||= req.method==='tools/list';
    return Response.json({jsonrpc:'2.0',id:req.id,result});
  });
  const defs=await externalDefinitions({url:'https://test.invalid',tools:['lookup']},false);
  assert.deepEqual([...defs.keys()],['lookup']);
  const name='mcp.pin.lookup',agent=block('agent.task','agent',{allowedTools:[name]});
  const graph=linear(start,agent,end);
  graph.nodes.push(block('connection.mcp','conn',{assetId:'pin',version:2}));graph.edges.push(edge('conn','agent','reference','ref','mcp'));
  const result=await run(graph,'조회',{model,toolDefinition:async(tool,pin)=>{
    assert.equal(tool,name);assert.deepEqual(pin,{assetId:'pin',version:2});return defs.get('lookup');
  }});
  assert.equal(result.output,'안내');assert.ok(listed&&offered);
});

test('하위 Workflow의 사용 기준을 모델에 전하고 같은 도구 이름을 설계와 실행에서 거절한다',async()=>{
  const tool=(id:string)=>block('workflow.tool',id,{name:'policy',description:'휴관일을 확인할 때'},linear(start,end));
  const g=linear(start,block('agent.task','agent'),end);g.nodes.push(tool('a'));g.edges.push(edge('a','agent','reference','ref','workflow'));
  const good=await run(g,'휴관일',{model:async req=>{
    assert.equal(req.toolDefinitions?.['workflow.policy'].description,'휴관일을 확인할 때');return {text:'확인'};
  }});assert.equal(good.output,'확인');
  g.nodes.push(tool('b'));g.edges.push(edge('b','agent','reference','ref','workflow'));
  assert.ok(validateGraph(g).some(i=>i.nodeId==='agent'&&i.message.includes('중복')));
  assert.match((await run(g,'휴관일')).error!,/중복/);
});

test('제안된 예약 도구는 제작자가 허용할 때까지 해당 블록에 연결 필요로 표시한다',()=>{
  const proposal=linear(start,block('agent.task','reserve',{goal:'예약 조회',allowedTools:['reservations.list']}),end);
  const draft=reviewProposal(proposal,{nodes:[],edges:[]});
  assert.deepEqual(draft.nodes[1].config.allowedTools,[]);
  assert.ok(validateGraph(draft).some(i=>i.nodeId==='reserve'&&i.fieldKey==='allowedTools'&&i.message.includes('reservations.list')));
  draft.nodes[1].config.allowedTools=['reservations.list'];
  assert.ok(!validateGraph(draft).some(i=>i.message.includes('도구 연결 필요')));
});

test('공백을 포함한 양식 필드와 승인된 인자 객체를 같은 쓰기 호출에 전달한다',async()=>{
  const form=block('input.form','form',{prompt:'도서 제목 입력',fields:['도서 제목']});
  const approval=block('approval.action','approve',{tool:'reservations.create',args:{book:'{{input.도서 제목}}',branch:'중앙'}});
  const invoke=block('tool.invoke','write',{tool:'reservations.create'});
  const g=linear(start,form,approval,invoke,end);
  g.edges.find(e=>e.from==='approve'&&e.kind==='flow')!.out='approved';
  const args={book:'봄날',branch:'중앙'},seen:unknown[]=[];
  const svc={tool:async(_name:string,value:Record<string,unknown>)=>{seen.push(value);return {id:'R1'};}};
  const a=await run(g,'예약',svc);
  const b=await run(g,'예약',svc,{checkpoint:a.checkpoint,reply:{value:JSON.stringify({'도서 제목':'봄날'})}});
  assert.deepEqual(b.wait?.operation?.args,args);assert.deepEqual(seen,[]);
  const c=await run(g,'예약',svc,{checkpoint:b.checkpoint,reply:{value:'',approved:true}});
  assert.equal(c.status,'completed',c.error??'');assert.deepEqual(seen,[args]);
  invoke.config.args='{{input.args}}';
  assert.ok(!validateGraph(g).some(i=>i.nodeId==='write'&&i.message.includes('자료 형식')));
  const withObject=await run(g,'예약',svc,{checkpoint:b.checkpoint,reply:{value:'',approved:true}});
  assert.equal(withObject.status,'completed',withObject.error??'');
  assert.deepEqual(seen,[args,args]);
});

test('조회 실패와 빈 자료 검색은 각각 한 번 다시 선택하며 이전에 찾은 구절들을 함께 보존한다',async()=>{
  const g=linear(start,block('agent.task','agent',{allowedTools:['reservations.list'],maxSteps:6}),end);
  for(const recover of [true,false]){
    let reads=0;
    const r=await run(g,'조회',{isReadOnlyTool:()=>true,tool:async()=>{if(++reads===1||!recover)throw Error('연결 오류');return {count:3};},
      model:async req=>/count/.test(req.context)?{text:'3건'}:{text:'',tool:{name:'reservations.list',args:{}}}});
    assert.equal(reads,2);
    if(recover)assert.equal(r.output,'3건');else assert.match(r.error!,/연결 오류/);
  }
  g.nodes[1].config.allowedTools=['knowledge.search'];
  g.nodes.push(block('resource.context','doc',{content:'apple first\nzebra second'}));
  g.edges.push(edge('doc','agent','reference','ref','context'));
  for(const mode of ['empty','recover','multiple']){
    let attempts=0;
    const r=await run(g,'검색',{model:async req=>{
      if(req.instruction.includes('완료 판정:'))return {text:'{"status":"met","reason":"원문 확인"}'};
      const query=mode==='empty'?'QQQQ':mode==='recover'?['QQQQ','apple'][attempts]:['apple','zebra'][attempts];
      attempts++;
      if(query)return {text:'',tool:{name:'knowledge.search',args:{query}}};
      const {candidates}=JSON.parse(req.input);
      assert.deepEqual(candidates.map((p:{quote:string})=>p.quote),mode==='recover'?['apple first']:['apple first','zebra second']);
      return {text:JSON.stringify({answer:'apple',references:[{index:0,quote:'apple'}]})};
    }});
    if(mode==='empty'){assert.equal(attempts,2);assert.match(r.output,/근거/);}else assert.match(r.output,/apple/);
  }
});

test('쓰기를 승인한 뒤 마지막 판단 한도 또는 완료 판정 오류가 나도 실제 영수증을 표시한다',async()=>{
  for(const failReview of [false,true]){
    const agent=block('agent.task','agent',{allowedTools:['reservations.create'],maxSteps:failReview?3:1,goal:'예약 생성'});
    const graph=linear(start,agent,end);
    let writes=0;
    const svc:Partial<EngineServices>={tool:async()=>{writes++;return {reservationId:'R-42'};},
      model:async req=>{
        if(req.instruction.includes('완료 판정:'))throw Error('판정 연결 실패');
        if(req.context.includes('R-42'))return {text:'예약 성공'};
        return {text:'',tool:{name:'reservations.create',args:{book:'책',branch:'중앙'}}};
      }};
    const a=await run(graph,'예약',svc);assert.equal(a.status,'waiting');assert.equal(writes,0);
    const b=await run(graph,'예약',svc,{checkpoint:a.checkpoint,reply:{value:'',approved:true}});
    assert.equal(writes,1);assert.equal(b.status,'failed');assert.match(b.output,/처리가 확인된 작업[\s\S]+R-42/);
    assert.match(b.error!,failReview?/판정 연결 실패/:/판단 횟수 한도/);
  }
});

test('내장·고정판 하위 Agent는 담당 범위를 확인하고 내보낼 지침과 설계 JSON에 담당 범위를 보존한다',async()=>{
  const inner=linear(start,block('ai.single_task','child'),end);
  inner.agentScope={mode:'dedicated',purpose:'도서관 대출 안내만 작성합니다.'};
  for(const pinned of [false,true]){
    const parent=linear(start,block('workflow.call','call',pinned?{workflowId:'saved',version:1}:{},pinned?undefined:inner),end);
    const r=await run(parent,'음식 배달',{scopeModel:async req=>{
      assert.deepEqual(JSON.parse(req.context),{purpose:inner.agentScope!.purpose});
      return {text:'{"status":"out_of_scope"}'};},
      model:async()=>assert.fail('하위 모델 실행'),workflow:async()=>inner});
    assert.match(r.error!,/하위 Agent의 업무 범위/);
    assert.ok(!r.events.some(e=>e.nodeId==='child'));
    if(!pinned){
      const exported=JSON.stringify({format:'workflow-studio-v1',title:'도서관',graph:parent});
      const restored=migrateGraph(JSON.parse(exported).graph).nodes.find(node=>node.id==='call')?.graph;
      assert.deepEqual(restored?.agentScope,inner.agentScope);
      assert.deepEqual(childScopeInstructions(restored),['','하위 Agent의 담당 업무 — 도서관 대출 안내만 작성합니다.',
        '위임할 입력이 이 범위에 속하는지 먼저 확인하세요. 범위 밖이면 하위 작업을 중단하고, 섞여 있으면 업무에 해당하는 부분만 전달하세요.',
        '하위 역할의 주 입력과 참조용 원래 질문에는 이 판정을 거친 요청을 사용하세요.']);
      assert.deepEqual(childScopeInstructions(parent),[]);
      const zip=unzipSync(buildAgentZip({title:'도서관',graph:parent,resources:[],files:[]}));
      const text=Object.entries(zip).filter(([n])=>n.endsWith('.md')).map(([,v])=>strFromU8(v)).join('\n');
      assert.match(text,/하위 Agent의 담당 업무 — 도서관 대출 안내만 작성합니다/);
    }
  }
});

test('인계받은 역할에는 앞 단계가 요약한 입력과 최초 질문이 함께 전달된다',async()=>{
  const graph=linear(start,block('ai.single_task','draft'),block('agent.handoff','role',{role:'마감 확인'}),end);
  const r=await run(graph,'원래 질문과 제약',{model:async req=>{
    if(req.instruction.includes('마감 확인')){assert.equal(req.input,'앞 단계 초안');assert.match(req.context,/원래 질문과 제약/);return {text:'인계 완료'};}
    return {text:'앞 단계 초안'};
  }});
  assert.equal(r.output,'인계 완료');
});

test('업무 전용 하위 설계의 위임·인계·내부 단발은 범위 판정 이후의 원래 질문을 사용한다', async()=>{
  const kept='반납 업무를 요약해 주세요.',excluded='점심도 추천해 주세요.';
  const single=linear(start,block('ai.single_task','summarize'),end);
  for(const type of ['agent.delegate','agent.handoff','nested-delegate']){
    const inner=linear(start,type==='nested-delegate'?block('agent.delegate','assign',{role:'요약'},single):
      block(type,'assign',{role:'요약'}),end);
    inner.agentScope={mode:'dedicated',purpose:'반납 업무'};
    const graph=linear(start,block('agent.delegate','outer',{role:'접수'},inner),end);
    const seen:string[]=[];
    const result=await run(graph,kept+' '+excluded,{scopeModel:async()=>({text:JSON.stringify({status:'mixed',excluded:[excluded]})}),
      model:async req=>{seen.push(JSON.stringify(req));assert.equal(req.input,kept);assert.match(req.context,/사용자 원래 질문: 반납/);return {text:'요약 완료'};}});
    assert.equal(result.output,'요약 완료',result.error??'');
    assert.equal(seen.length,1);assert.ok(!seen[0].includes(excluded));
  }
  const deterministic=linear(start,block('data.transform','text',{operation:'text'}),end);
  deterministic.agentScope={mode:'dedicated',purpose:'문장 변환'};
  assert.deepEqual(childScopeInstructions(deterministic),[]);
  const result=await run(linear(start,block('workflow.call','child',{},deterministic),end),kept,
    {scopeModel:async()=>assert.fail('결정적 변환의 범위 판정')});
  assert.equal(result.output,kept);
});

test('구형 선택 필드도 설치·검증·실행·단일 및 분할 ZIP에서 같은 후보와 기준을 사용한다',async()=>{
  for(const type of ['agent.select_candidate','agent.coordinate']){
    const job=block(type,'choose');
    job.config=type==='agent.select_candidate'?{tasks:['A','B','C'],goal:'구형 선택 기준'}:{candidates:['A','B','C'],criterion:'구형 선택 기준'};
    const graph=linear(start,job,end);
    assert.deepEqual(validateGraph(graph),[]);
    const migrated=migrateGraph(graph);
    assert.deepEqual(validateGraph(migrated),[]);
    const runGraph=await run(migrated,'검토',{model:async q=>{
      assert.match(q.instruction,/구형 선택 기준/);return {text:'{"choices":["bad","C","C","B"]}'};}});
    assert.deepEqual(runGraph.checkpoint.steps['root/choose'].values.value,type==='agent.select_candidate'?'C':['C','B']);
    for(const split of [false,true]){
      const root=structuredClone(graph);
      if(split)root.nodes[0].config.question='긴 입력\n'.repeat(205);
      const files=unzipSync(buildAgentZip({title:'구형 선택',graph:root,resources:[],files:[]}));
      assert.equal(Boolean(files['workflow/index.md']),split);
      const output=Object.entries(files).filter(([path])=>path==='AGENTS.md'||path.startsWith('workflow/step-')).map(([,bytes])=>strFromU8(bytes)).join('\n');
      assert.match(output,/구형 선택 기준/);assert.match(output,/\["A","B","C"\]/);
      assert.match(output,/유효 후보가 없으면/);
    }
  }
});

test('이름이 다른 고정 Workflow의 같은 블록 ID는 각자의 누적 생성 한도를 사용한다',async()=>{
  const graph=linear(start,block('agent.task','dispatch',{maxSteps:3}),end);
  for(const name of ['central','lake']){
    graph.nodes.push(block('workflow.tool',name,{name,description:name,workflowId:name,version:'1'}));
    graph.edges.push(edge(name,'dispatch','reference','ref','workflow'));
  }
  const inner=linear(start,block('data.transform','site',{path:'branch'}),block('agent.create_dynamic','same',{role:'조사',maxCreatedAgents:1}),end);
  let dispatch=0;
  const r=await run(graph,'조사',{workflow:async()=>inner,model:async req=>{
    if(req.tools.length){
      if(dispatch<2){const id=['central','lake'][dispatch++];return {text:'',tool:{name:'workflow.'+id,args:{branch:id}}};}
      return {text:'두 곳 완료'};
    }
    return {text:req.input};
  }});
  assert.equal(r.output,'두 곳 완료');assert.equal(r.checkpoint.counts.agents,2);
});

test('중첩 팀에서 먼저 제시한 선택 수를 예약하고 동시 담당자의 생성으로 줄이지 않는다',async()=>{
  const spawn=block('agent.create_dynamic','inner',{
    role:'지점',separator:'/',maxCreatedAgents:2,maxDepth:2,failurePolicy:'collect'});
  const graph=linear(start,block('agent.create_dynamic','outer',{role:'지역',separator:';',maxCreatedAgents:2,maxInFlightAgents:2,
    failurePolicy:'collect'},linear(start,spawn,end)),end);
  const a=await run(graph,'A/B/C;D');
  assert.equal(a.status,'waiting',a.error??'');assert.equal(a.wait?.selectionCount,2);
  const b=await run(graph,'A/B/C;D',{}, {checkpoint:a.checkpoint,reply:{value:'["A","B"]',waitId:a.wait?.id}});
  assert.equal(b.status,'completed',b.error??'');
  const outcomes=JSON.parse(b.output).results;
  assert.deepEqual(outcomes[0].result.results.map((row:{target:string})=>row.target),['A','B']);
  assert.match(outcomes[1].error,/생성 한도/);
});

test('동적 팀의 필수 근거가 여러 개이면 각 원문 상태를 모으고 하위 설계 누락을 편집기에서 표시한다',async()=>{
  const spawn=block('agent.create_dynamic','inner',{role:'검토',resultRequirement:'evidence',failurePolicy:'collect'});
  const graph=linear(start,spawn,end);
  assert.ok(validateGraph(graph).some(i=>i.nodeId==='inner'&&i.fieldKey==='resultRequirement'));
  const nested:Graph={nodes:[start],edges:[]};
  for(const id of ['hours','pickup']){
    const search=block('knowledge.search',id,{query:id});
    const check=block('quality.evidence','check-'+id);
    const output=block('output.answer','out-'+id);
    nested.nodes.push(search,check,output,block('resource.context','doc-'+id,{content:id+' instruction'}));
    nested.edges.push(...linear(start,search,check).edges,edge('doc-'+id,id,'reference','ref','context'),edge(check.id,output.id,'data'));
    for(const status of ['verified','insufficient','conflicting'])nested.edges.push(edge(check.id,output.id,'flow',status));
  }
  spawn.graph=nested;
  for(const missing of [false,true]){
    const r=await run(graph,'중앙',{model:async req=>{
      const source=JSON.parse(req.context.split('\n').slice(1).join('\n'))[0].quote as string;
      return {text:JSON.stringify(missing&&source.includes('pickup')?{status:'insufficient',references:[]}:
        {status:'verified',references:[{index:0,quote:source}]})};
    }});
    const outcome=JSON.parse(r.output).results[0];
    assert.equal(outcome.status,missing?'insufficient':'verified');
    assert.deepEqual(outcome.evidence.map((v:{status:string})=>v.status),['verified',missing?'insufficient':'verified']);
  }
  const checkId='check-hours',terminal='out-hours';
  nested.nodes.push(block('ai.single_task','cited'));
  for(const e of nested.edges)if(e.from===checkId&&e.to===terminal)e.to='cited';
  nested.edges.push(edge('cited',terminal),edge('cited',terminal,'data'));
  const cited=await run(graph,'중앙',{model:async req=>{
    if(req.instruction.includes('완료 판정:'))return {text:'{"status":"met","reason":"근거와 안내가 일치"}'};
    if(req.instruction.includes('원문 후보에 근거해'))return {text:'{"answer":"hours","references":[{"index":0,"quote":"hours"}]}'};
    const source=JSON.parse(req.context.split('\n').slice(1).join('\n'))[0].quote as string;
    return {text:JSON.stringify({status:'verified',references:[{index:0,quote:source}]})};
  }});
  const row=JSON.parse(cited.output).results[0];
  assert.equal(row.status,'verified');
  assert.match(row.result[0],/근거/);
  assert.deepEqual(row.evidence.map((v:{status:string})=>v.status),['verified','verified']);
});

test('담당자 한 명 선택은 이전 작업 목록보다 현재 후보 A, B, C를 사용한다',async()=>{
  const g=linear(start,block('agent.select_candidate','select',{tasks:['OLD'],candidates:['A','B','C'],criterion:'지역 담당',goal:'OLD 기준'}),end);
  const r=await run(g,'후보',{model:async req=>{assert.doesNotMatch(req.instruction,/OLD/);assert.match(req.instruction,/지역 담당/);return {text:'{"choices":["B"]}'};}});
  assert.equal(r.output,'B');
});
