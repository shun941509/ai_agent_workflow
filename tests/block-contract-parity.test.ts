import assert from 'node:assert/strict';
import {test} from 'node:test';
import {connectBlocks,createBlock,validateGraph} from '../src/domain/graph';
import {designPreparation} from '../src/domain/export-design-preparation';
import type {Block,Graph} from '../src/domain/types';
import {executeGraph,type EngineServices} from '../src/engine';
import {at} from '../src/engine/values';

const node=(type:string,id:string,config={})=>createBlock(type,{id,title:id,config});
const input=()=>node('input.user_request','start');
const end=(id='end')=>node('output.answer',id);
function chain(nodes:Block[]):Graph{
  const graph:Graph={nodes,edges:[]};
  for(let i=1;i<nodes.length;i++)graph.edges.push(...connectBlocks(graph,nodes[i-1].id,nodes[i].id));
  return graph;
}
const services:EngineServices={model:async()=>({text:'ok'}),tool:async()=>{throw Error('unexpected tool');}};

test('분류 이름을 연결한 소비자는 선택한 이름 또는 null을 받는다',async()=>{
  const graph=chain([input(),node('ai.classify','classify',{categories:['일정','도서']})]);
  graph.nodes.push(end());
  for(const route of ['category:일정','category:도서','other']){
    graph.edges.push(...connectBlocks(graph,'classify','end',[{kind:'flow',out:route,input:'in'}]));
  }
  graph.edges.push(...connectBlocks(graph,'classify','end',[{kind:'data',out:'category',input:'input'}]));
  assert.deepEqual(validateGraph(graph),[]);
  for(const category of ['도서',null]){
    const result=await executeGraph(graph,{runId:'classify-port',input:'원래 요청'},{...services,model:async()=>({text:JSON.stringify({category})})});
    assert.equal(result.status,'completed');
    assert.equal(result.checkpoint.steps['root/end'].values.value,category);
    assert.equal(result.checkpoint.steps['root/classify'].values.value,'원래 요청');
  }
});

test('동일한 승인 식은 승인한 실제 값을 사용하고 다른 식·값은 다시 승인한다',async()=>{
  for(const [args,count,expected] of [
    [{note:'{{input}}'},1,'접수'],[{},1,'접수'],[{note:'다른 값'},2,'다른 값'],
  ] as const){
    const graph=chain([input(),node('approval.action','approve',{tool:'reservations.create',args:{note:'{{input}}'}})]);
    graph.nodes.push(node('tool.invoke','write',{tool:'reservations.create',args}),end(),end('declined'));
    for(const [route,target] of [['approved','write'],['rejected','declined']]){
      graph.edges.push(...connectBlocks(graph,'approve',target,[{kind:'flow',out:route,input:'in'},{kind:'data',out:'value',input:'input'}]));
    }
    graph.edges.push(...connectBlocks(graph,'write','end'));
    assert.deepEqual(validateGraph(graph),[]);
    const sent:unknown[]=[];
    const adapters={...services,allowedTools:['reservations.create'],tool:async(_:string,args:unknown)=>{sent.push(args);return {receipt:'R-7'};}};
    const request={runId:'approval',input:'접수'};
    let result=await executeGraph(graph,request,adapters);
    for(let i=0;i<count;i++){
      assert.equal(result.status,'waiting');
      assert.ok(result.wait);
      result=await executeGraph(graph,{...request,checkpoint:result.checkpoint,reply:{waitId:result.wait.id,approved:true,value:'승인'}},adapters);
    }
    assert.equal(result.status,'completed');
    assert.deepEqual(sent,[{note:expected}]);
  }
});

test('검증·변환은 같은 배열 경로와 점을 포함한 키를 읽고 공백과 빈 목록을 거부한다',async()=>{
  const graph=chain([input(),node('data.validate','validate',{requiredFields:['0.id','0.tags'],types:{'0.id':'number'}}),
    node('data.transform','rename',{operation:'rename',path:'0.id',target:'customer.id'}),
    node('data.transform','read',{operation:'select',path:'customer.id'}),end()]);
  for(const tags of ['   ',[],['x']]){
    const result=await executeGraph(graph,{runId:'paths',input:JSON.stringify([{id:0,tags}])},services);
    if(Array.isArray(tags)&&tags.length)assert.equal(result.output,'0');
    else assert.match(result.error??'',/0.tags/);
  }
  assert.equal(at({'a.b':1,a:{b:0}},'a.b'),0);
  assert.equal(at({'a.b':1},'a.b'),1);
  assert.equal(at({'constructor.name':'private'},'constructor.name'),undefined);
});

test('이전 체크포인트의 승인도 연결했던 원래 인자로 한 번만 이어간다',async()=>{
  const args={note:'{{input}}'};
  const approve=node('approval.action','approve',{tool:'reservations.create',args});
  const graph=chain([input(),approve]);
  graph.nodes.push(node('review.human','review',{prompt:'계속할까요?'}),node('tool.invoke','write',{tool:'reservations.create',args}),end());
  graph.edges.push(...connectBlocks(graph,'approve','review',[{kind:'flow',out:'approved',input:'in'},{kind:'data',out:'value',input:'input'}]));
  graph.edges.push(...connectBlocks(graph,'review','write',[{kind:'flow',out:'next',input:'in'}]));
  graph.edges.push(...connectBlocks(graph,'approve','write',[{kind:'data',out:'value',input:'input'}]));
  graph.edges.push(...connectBlocks(graph,'write','end'));
  const sent:unknown[]=[];
  const adapters={...services,allowedTools:['reservations.create'],tool:async(_:string,args:unknown)=>{sent.push(args);return '완료';}};
  const request={runId:'legacy-approval',input:'접수'};
  const pending=await executeGraph(graph,request,adapters);
  const approved=await executeGraph(graph,{...request,checkpoint:pending.checkpoint,reply:{approved:true,waitId:pending.wait!.id,value:'승인'}},adapters);
  assert.equal(approved.wait?.kind,'review');
  for(const [key,grant] of Object.entries(approved.checkpoint.memo)){
    if(key.startsWith('approval:')&&grant&&typeof grant==='object'&&'template' in grant)delete grant.template;
  }
  const done=await executeGraph(graph,{...request,checkpoint:approved.checkpoint,reply:{value:'계속',waitId:approved.wait!.id}},adapters);
  assert.equal(done.status,'completed');
  assert.deepEqual(sent,[{note:'접수'}]);
});

test('평가 결과의 텍스트와 JSON은 설계에서 설정한 통과 기준과 실제 판정을 표시한다',async()=>{
  for(const format of ['text','json']){
    const graph=chain([input(),node('quality.evaluate','score',{threshold:70,criterion:'적합'}),node('output.answer','end',{format})]);
    const result=await executeGraph(graph,{runId:'grade',input:'응답'},{...services,model:async()=>({
      text:JSON.stringify({score:69.5,threshold:20,passed:true,reason:'증빙 부족',title:'결과',content:'통과 안내'}),
    })});
    assert.equal(result.status,'completed');
    const {score,threshold,reason,passed,input:value}=JSON.parse(result.output);
    assert.deepEqual({score,threshold,reason,passed,value},{score:69.5,threshold:70,reason:'증빙 부족',passed:false,value:'응답'});
  }
});

test('검토 문구에 공백이 있는 입력 치환을 넣어도 초안은 한 번 표시한다',async()=>{
  const graph=chain([input(),node('review.human','review',{prompt:'검토할 내용 {{ input }}'}),end()]);
  const result=await executeGraph(graph,{runId:'review',input:'초안'},services);
  assert.equal(result.wait?.prompt,'검토할 내용 초안');
  assert.equal(result.wait?.reviewDraft,null);
});

test('설계 검증과 ZIP은 지원하지 않는 cron 등록 대신 같은 단계에서 일정을 고치도록 안내한다',()=>{
  const graph=chain([node('control.trigger','timer',{trigger:'schedule',schedule:'0 9 * * *'}),end()]);
  assert.ok(validateGraph(graph).some(i=>i.nodeId==='timer'&&i.fieldKey==='schedule'));
  const notes=designPreparation(graph).filter(n=>n.step==='timer');
  assert.equal(notes.length,1);
  assert.match(notes[0].action,/한국 표준시/);
  assert.doesNotMatch(notes[0].action,/등록하세요/);
});

test('여러 실패를 한 처리기에 연결하면 단계별 실패 사유가 모두 남는다',async()=>{
  const graph:Graph={nodes:[input(),node('data.transform','a',{operation:'select',path:'missingA'}),
    node('data.transform','b',{operation:'select',path:'missingB'}),node('error.handle','recover',{strategy:'continue',message:'사유 {{error}}'}),end()],edges:[]};
  for(const [from,to] of [['start','a'],['start','b'],['a','recover'],['b','recover'],['recover','end']])
    graph.edges.push(...connectBlocks(graph,from,to));
  const result=await executeGraph(graph,{runId:'errors',input:'{}'},services);
  assert.equal(result.status,'completed');
  assert.match(result.output,/missingA/);
  assert.match(result.output,/missingB/);
});
