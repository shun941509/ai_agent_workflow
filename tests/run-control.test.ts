import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBlock,validateGraph,type Block,type Edge,type Graph} from '../src/domain';
import {executeGraph,type EngineServices} from '../src/engine';

const block=(id:string,type:string,config:Block['config']={},graph?:Graph)=>createBlock(type,{id,title:id,config,graph});
const start=block('s','input.user_request'), end=block('out','output.answer');
const flow=(from:string,to:string,out='next'):Edge=>({id:from+'-'+out+'-'+to,kind:'flow',from,to,out,input:'in'});
const data=(from:string,to:string):Edge=>({id:from+'-value-'+to,kind:'data',from,to,out:'value',input:'input'});
const wire=(from:string,to:string,route='next')=>[flow(from,to,route),data(from,to)];
const line=(nodes:Block[]):Graph=>({nodes,edges:nodes.slice(1).flatMap((n,i)=>wire(nodes[i].id,n.id))});
const run=(g:Graph,input='{}',extra:Partial<EngineServices>={})=>executeGraph(g,{runId:'control-check',input},
  {model:async()=>{throw new Error('모델 연결 실패');},tool:async()=>{throw new Error('예상하지 않은 호출');},...extra});
const bad=block('check','data.validate',{requiredFields:['필수']});

test('20 정상 경로와 각 분기에는 성공 시 도달할 후속 단계가 필요하다',()=>{
  const h=block('h','error.handle'),g=line([start,h,end]);
  assert.ok(validateGraph(g).some(i=>i.nodeId==='s'));
  for(const [type,routes] of [['control.branch',['yes','no']],['approval.action',['approved','rejected']],['quality.evidence',['verified','insufficient','conflicting']]] as const){
    const stage=block('stage',type,{tool:'reservations.create'});
    const graph={nodes:[start,stage,h,end],edges:[...wire('s','stage'),...wire('stage','h',routes[0]),...wire('h','out'),...routes.slice(1).map(route=>flow('stage','out',route))]};
    assert.ok(validateGraph(graph).some(i=>i.nodeId==='stage'&&i.routeId===routes[0]),type);
  }
});

test('21 필수 객체는 null을 거절한다',async()=>{
  const g=line([start,block('v','data.validate',{requiredFields:['payload'],types:{payload:'object'}}),end]);
  assert.equal((await run(g,'{"payload":null}')).status,'failed');
  assert.equal((await run(g,'{"payload":{}}')).status,'completed');
});

test('22 빈 문자열 비교와 누락된 필드를 구분한다',async()=>{
  const b=block('b','control.branch',{path:'title',operator:'equals',expected:''});
  const g={nodes:[start,b,block('yes','control.terminate',{status:'success',message:'yes'}),block('no','control.terminate',{status:'success',message:'no'})],
    edges:[...wire('s','b'),flow('b','yes','yes'),flow('b','no','no')]};
  assert.equal((await run(g,'{}')).output,'no');
  assert.equal((await run(g,'{"title":""}')).output,'yes');
});

test('23 내부 반복 횟수 초과는 연결된 오류 처리로 이어진다',async()=>{
  const loop=block('loop','control.loop',{maxIterations:1},line([start,end]));
  const g=line([start,block('json','document.read',{format:'json'}),loop,end]);
  g.nodes.push(block('h','error.handle',{message:'항목 수 확인'}),block('notice','output.answer'));
  g.edges.push(...wire('loop','h'),...wire('h','notice'));
  assert.equal((await run(g,'[1,2]')).output,'항목 수 확인');
});

test('24 데이터의 error 필드는 합류 실패를 뜻하지 않는다',async()=>{
  const g=line([start,block('json','document.read',{format:'json'}),block('j','control.join',{partialFailure:'fail'}),end]);
  const result=await run(g,'{"error":"필드 이름","role":"담당자"}');
  assert.equal(result.status,'completed');
  assert.deepEqual(result.checkpoint.steps['root/out'].values.value,[{error:'필드 이름',role:'담당자'}]);
});

test('25 병렬 중지는 동시에 실행된 하위 설계의 후속 쓰기를 막는다',async()=>{
  const child=line([start,block('write','memory.access',{operation:'write',key:'k'}),end]);
  const nested=block('child','workflow.call',{},child);
  const stage=block('split','control.parallel',{maxConcurrency:2});
  const stop=block('stop','control.terminate',{status:'cancelled',message:'여기서 마침'});
  const g={nodes:[start,stage,nested,stop,end],edges:[...wire('s','split'),...wire('split','child'),flow('split','stop'),...wire('child','out')]};
  let writes=0;
  const result=await run(g,'내용',{memory:async(_,v)=>{if(v!==undefined)writes++;return v;}});
  assert.equal(result.status,'stopped');
  assert.equal(writes,0);
  const write=block('write','memory.access',{operation:'write',key:'same-batch'});
  const direct={nodes:[start,stage,stop,write,end],edges:[...wire('s','split'),flow('split','stop'),...wire('split','write'),...wire('write','out')]};
  assert.equal((await run(direct,'내용',{memory:async(_,v)=>{if(v!==undefined)writes++;return v;}})).status,'stopped');
  assert.equal(writes,0);
});

test('26 분류를 선택하기 전의 실패는 선택하지 않은 가지의 오류 처리기를 깨우지 않는다',async()=>{
  const g={nodes:[start,block('c','ai.classify',{categories:['질문']}),block('lane','data.transform'),block('h','error.handle',{message:'가지 오류'}),end],
    edges:[...wire('s','c'),...wire('c','lane','category:질문'),...wire('lane','h'),...wire('h','out')]};
  const result=await run(g);
  assert.equal(result.status,'failed');
  assert.match(result.error!,/모델 연결 실패/);
  assert.equal(result.checkpoint.steps['root/h'].state,'skipped');
});

test('27 선택하지 않은 가지로 향하는 데이터선만으로 실패가 합류에서 처리되지 않는다',async()=>{
  const g={nodes:[start,bad,block('branch','control.branch',{operator:'equals',expected:'yes'}),block('skip','data.transform'),block('ok','data.transform'),
    block('j','control.join',{partialFailure:'fail'}),end],edges:[...wire('s','check'),...wire('s','branch'),flow('branch','skip','yes'),data('check','skip'),
    ...wire('branch','ok','no'),...wire('skip','j'),...wire('ok','j'),...wire('j','out')]};
  const result=await run(g);
  assert.equal(result.status,'failed');
  assert.match(result.error!,/필수/);
});

test('28 공용 오류 처리기는 성공한 선행 블록이 있어도 실제 실패 원인을 받는다',async()=>{
  const h=block('h','error.handle');
  const g={nodes:[start,bad,h,end],edges:[...wire('s','check'),...wire('s','h'),flow('check','h'),...wire('h','out')]};
  const result=await run(g);
  assert.equal(result.status,'completed');
  assert.deepEqual(JSON.parse(result.output),{error:'입력 검증 실패: 필수',role:'check'});
});

test('29 오류 처리기의 중단 안내는 노드 저장 순서와 무관하다',async()=>{
  const h=block('h','error.handle',{strategy:'stop',message:'설정한 중단'});
  const g=line([start,bad,h,end]);
  for(const nodes of [g.nodes,[end,h,bad,start]]){
    const result=await run({...g,nodes});
    assert.equal(result.error,'설정한 중단');
  }
});

test('30 종료 블록의 중지 안내와 출처를 실행 기록에 보존한다',async()=>{
  const g=line([start,block('cancel','control.terminate',{status:'cancelled',message:'운영자가 정한 종료'})]);
  const result=await run(g);
  assert.equal(result.status,'stopped');
  assert.equal(result.output,'운영자가 정한 종료');
  assert.ok(result.events.some(e=>e.nodeId==='cancel'&&e.kind==='stop'&&e.detail==='운영자가 정한 종료'));
});
