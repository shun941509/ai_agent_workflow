import assert from 'node:assert/strict';
import test from 'node:test';
import {createBlock,type Block,type Graph} from '../src/domain';
import {executeGraph,type EngineServices} from '../src/engine';
import {completedRunFiles} from '../src/engine/legacy-files';
import {ModelPrivacy} from '../src/engine/model-privacy';

const service:EngineServices={model:async()=>assert.fail(),tool:async()=>assert.fail()};
function sequence(...nodes:Block[]):Graph {
  return {nodes,edges:nodes.slice(1).flatMap((node,index)=>[
    {id:'flow'+index,kind:'flow',from:nodes[index].id,to:node.id,out:'next',input:'in'},
    {id:'data'+index,kind:'data',from:nodes[index].id,to:node.id,out:'value',input:'input'},
  ])};
}
const step=(type:string,id:string,config:Block['config']={})=>createBlock(type,{id,config});
const run=(graph:Graph,input:string,services=service)=>executeGraph(graph,{input,runId:'structured'},services);
const output=()=>step('output.answer','out',{format:'json'});

test('구조화한 첨부의 일반 필드·키·중첩 배열을 검사하고 가린 형태 그대로 전달한다',async()=>{
  const data={title:'민원',content:'본문',caseId:'case@example.org',places:[0,false,null,{'key@example.org':'부산','[이메일 가림]':'서울'}]};
  const graph=sequence(step('file.input','attachment'),step('document.read','read',{format:'auto'}),
    step('safety.redact','privacy',{operation:'mask',categories:['email']}),output());
  const input=JSON.stringify({fileName:'case.JSON',content:JSON.stringify(data)});
  const result=await run(graph,input);
  assert.equal(result.status,'completed',result.error??'');
  assert.deepEqual(JSON.parse(result.output),{...data,caseId:'[이메일 가림]',places:[0,false,null,{'[이메일 가림] (2)':'부산','[이메일 가림]':'서울'}]});
  for(const old of [false,true]){
    const cp=structuredClone(result.checkpoint);
    if(old)delete cp.privacyChecks;
    const privacy=new ModelPrivacy();
    privacy.restore(cp,graph);privacy.assertReady();
    assert.equal(privacy.text('case@example.org / key@example.org'),'[이메일 가림] / [이메일 가림]');
  }
  graph.nodes[2].config.operation='block';
  const blocked=await run(graph,input);
  assert.equal(blocked.status,'failed');assert.match(blocked.error!,/민감정보/);
  const clean=await run(graph,JSON.stringify({fileName:'case.json',content:'[false,null,0,{"content":"공개"}]'}));
  assert.deepEqual(JSON.parse(clean.output),[false,null,0,{content:'공개'}]);
});

test('파일을 만든 뒤 가리면 가린 파일명과 본문을 다운로드하고 차단·실패하면 파일이 없다',async()=>{
  const graph=sequence(step('input.user_request','i'),step('file.create','draft',{fileName:'name@example.org.txt',format:'text'}),
    step('safety.redact','privacy',{operation:'mask',categories:['phone','email']}),output());
  const value='연락처 010-1234-5678';
  const result=await run(graph,value);
  assert.deepEqual(completedRunFiles(graph,result.checkpoint),[{path:'root/draft',fileName:'[이메일 가림]',content:'연락처 [전화번호 가림]'}]);
  graph.nodes[2].config.operation='block';
  const denied=await run(graph,value);
  assert.equal(denied.status,'failed');
  assert.deepEqual(completedRunFiles(graph,denied.checkpoint),[]);
});

test('구형 검사에서 본문 밖의 이메일을 놓친 기록도 다음 호출의 문맥을 보호한다',async()=>{
  const graph=sequence(step('file.input','file'),step('document.read','read',{format:'json'}),
    step('safety.redact','guard',{categories:['email']}),step('input.form','pause'),step('ai.single_task','model'),output());
  const email='old@example.org';
  const input=JSON.stringify({fileName:'a.json',content:JSON.stringify({title:'원문',content:'일반 본문',caseId:email})});
  const waiting=await run(graph,input);
  assert.equal(waiting.status,'waiting');
  const checkpoint=structuredClone(waiting.checkpoint);
  delete checkpoint.privacyVersion;
  checkpoint.privacyChecks=[];
  checkpoint.steps['root/guard'].values.value='일반 본문';
  const calls:string[]=[];
  const services={...service,model:async(request:{input:string})=>{calls.push(request.input);return {text:'확인'};}};
  const resumed=await executeGraph(graph,{input,runId:'structured',checkpoint,reply:{value:'다시 '+email,waitId:waiting.wait!.id}},services);
  assert.equal(resumed.status,'completed',resumed.error??'');
  assert.deepEqual(calls,['다시 [이메일 가림]']);
});

test('동명 파일 두 개는 서로 다른 하위 호출에서 왔을 때 각각 전달한다',async()=>{
  const loop=step('control.loop','each',{maxIterations:4});
  loop.graph=sequence(step('input.user_request','item'),step('file.create','report',{fileName:'보고서.txt',format:'text'}),output());
  const graph=sequence(step('file.input','attachment'),step('document.read','rows',{format:'json'}),loop,
    step('safety.redact','guard',{categories:['email']}),output());
  const content=JSON.stringify(['a@example.org','일반']);
  const done=await run(graph,JSON.stringify({fileName:'list.json',content}));
  assert.deepEqual(completedRunFiles(graph,done.checkpoint),[
    {path:'root/each/item-0/report',fileName:'보고서.txt',content:'[이메일 가림]'},
    {path:'root/each/item-1/report',fileName:'보고서.txt',content:'일반'},
  ]);
});

test('차단 후 오류 처리기가 성공해도 우회 연결에 남은 원본 파일을 공개하지 않는다',async()=>{
  const graph=sequence(step('input.user_request','start'),step('file.create','draft',{fileName:'회신.txt'}),
    step('safety.redact','guard',{operation:'block',categories:['email']}),step('error.handle','recover',{message:'차단됨'}),output());
  graph.edges.find(edge=>edge.to==='out'&&edge.kind==='data')!.from='draft';
  const result=await run(graph,'주소 case@example.org');
  assert.equal(result.status,'completed',result.error??'');
  assert.deepEqual(completedRunFiles(graph,result.checkpoint),[]);
  assert.ok(!result.output.includes('case@example.org'));
});

test('파일 입력은 첨부 이름과 이스케이프된 JSON 본문을 함께 가리고 점이 있는 첨부 항목을 보존한다',async()=>{
  const graph=sequence(step('file.input','file',{historyFields:'member.name',accept:'.org'}),step('safety.redact','guard',{categories:['email']}),output());
  const content='{"member.name":"회원","contacts":{"e\\u0040example.org":"주소"}}';
  const done=await run(graph,JSON.stringify({fileName:'f@example.org',content}));
  assert.equal(done.status,'completed',done.error??'');
  assert.deepEqual(JSON.parse(done.output),{fileName:'[이메일 가림]',content:JSON.stringify({'member.name':'회원',contacts:{'[이메일 가림]':'주소'}})});
  assert.deepEqual(done.checkpoint.historyDetails?.['root/file'],{title:'[이메일 가림]',value:{'member.name':'회원'}});
});

test('CSV 셀·빈칸·물리 행은 기억에 썼다가 읽고 파일을 다시 열어도 보존된다',async()=>{
  const memory=new Map<string,string>([['user:기존','[1,2]']]);
  const services={...service,memory:async(k:string,v?:string)=>{if(v!==undefined)memory.set(k,v);return memory.get(k);}};
  const graph=sequence(step('file.input','file'),step('document.read','read',{format:'auto'}),
    step('memory.access','save',{operation:'write',key:'표'}),step('memory.access','load',{operation:'read',key:'표'}),
    step('file.create','csv',{format:'csv',fileName:'복사.csv'}),step('document.read','reopen',{format:'auto'}),output());
  const rows=[['지점','안내'],['0','문장\r\n둘째 행'],['마지막','']];
  const result=await run(graph,JSON.stringify({fileName:'표.CSV',content:'지점,안내\r\n0,"문장\r\n둘째 행"\r\n마지막,'}),services);
  assert.equal(result.status,'completed',result.error??'');
  assert.deepEqual(result.checkpoint.steps['root/save'].values.value,rows);
  assert.deepEqual(JSON.parse(result.output),rows);
  assert.deepEqual(completedRunFiles(graph,result.checkpoint),[]);
  assert.equal((result.checkpoint.steps['root/read'].values.lines as unknown[]).length,4);
  const old=await run(sequence(step('input.user_request','i'),step('memory.access','load',{operation:'read',key:'기존'}),output()),'읽기',services);
  assert.equal(JSON.parse(old.output),'[1,2]');
});
