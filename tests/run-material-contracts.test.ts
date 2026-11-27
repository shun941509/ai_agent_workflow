import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBlock,portsFor,type Block,type Graph} from '../src/domain';
import {executeGraph,type EngineServices} from '../src/engine';
import {buildIndex} from '../src/engine/values';
import {authenticate} from '../src/server/auth';
import {createProject} from '../src/server/projects';
import {startRun,runGet,runList,replyRun,workOne} from '../src/server/runs';
import {set} from '../src/server/db';
import {writeAsset} from '../src/server/assets';

process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-material-contract-'));
const account=(name:string)=>authenticate('signup',name,'integration-test-pass','').user;

const node=(type:string,id:string,config:Block['config']={})=>createBlock(type,{id,config});
function sequence(...nodes:Block[]):Graph {
  const edges:Graph['edges']=[];
  nodes.slice(1).forEach((n,i)=>{
    edges.push({id:'f'+i,from:nodes[i].id,to:n.id,kind:'flow',out:'next',input:'in'},
      {id:'d'+i,from:nodes[i].id,to:n.id,kind:'data',out:'value',input:'input'});
  });
  return {nodes,edges};
}
const services:EngineServices={model:async q=>({text:q.input}),tool:async()=>assert.fail('예상하지 않은 도구 호출')};
const run=(graph:Graph,input:string,overrides:Partial<EngineServices>={})=>executeGraph(graph,{input,runId:'material'}, {...services,...overrides});
const output=()=>node('output.answer','out');
const attachment=(content:string,fileName='문서.txt')=>JSON.stringify({fileName,content,question:'자료 확인'});

test('41 표의 빈 열과 행 경계를 모델 입력에 보존한다',async()=>{
  const graph=sequence(node('file.input','f'),node('document.read','r',{format:'csv'}),node('ai.single_task','ai'),output());
  const result=await run(graph,attachment('품목,입고,출고\n도서,,3\n도서,3,','자료.csv'));
  assert.deepEqual(JSON.parse(result.output),[['품목','입고','출고'],['도서','','3'],['도서','3','']]);
});
test('42 별도 파일을 요청한 단계는 첫 첨부와 확장자가 같아도 기다린다',async()=>{
  const graph=sequence(node('file.input','new',{attachmentMode:'request'}),output());
  const input=attachment('17:00');
  const waiting=await run(graph,input);
  assert.equal(waiting.status,'waiting');
  const done=await executeGraph(graph,{runId:'material',input,checkpoint:waiting.checkpoint,reply:{waitId:waiting.wait!.id,value:attachment('19:00')}},services);
  assert.equal(done.output,'19:00');
});
test('43 반복 항목에서 question과 파일 필드가 함께 유지된다',async()=>{
  const loop=node('control.loop','loop');
  loop.graph=sequence(node('input.user_request','i'),node('data.transform','t',{operation:'select',path:'fileName'}),output());
  const graph=sequence(node('file.input','f'),node('document.read','r',{format:'json'}),loop,output());
  assert.equal((await run(graph,attachment(JSON.stringify([{fileName:'단계.txt',content:'값',question:'질문'}])))).output,'단계.txt');
});
test('44 압축 모델이 원래 파일 이름을 읽고 48 분해형 한글 50글자로 요약한다',async()=>{
  const graph=sequence(node('file.input','f'),node('context.compress','compress',{maxLength:50,preserve:'파일 이름'}),output());
  const summary='회의록.txt'+'한'.normalize('NFD').repeat(43);
  const result=await run(graph,attachment('내용','회의록.txt'),{model:async q=>{
    assert.match(q.input,/회의록\.txt/);assert.match(q.input,/내용/);return {text:summary};
  }});
  assert.equal(result.output,summary,result.error??'');
  for(const text of [summary+'한','', '파일명 누락']){
    const invalid=await run(graph,attachment('내용','회의록.txt'),{model:async()=>({text})});
    assert.equal(invalid.status,'failed',text);
    assert.match(invalid.error!,/길이|비어|빠졌/);
  }
});
test('45 문서 읽기의 원래 행 포트를 연결해 빈 행을 포함한 번호를 전달한다',async()=>{
  const reader=node('document.read','r',{format:'text'});
  assert.ok(portsFor(reader).outputs.some(port=>port.id==='lines'));
  const graph=sequence(node('file.input','f'),reader,node('data.transform','select',{operation:'select',path:'2.location'}),output());
  graph.edges.find(e=>e.from==='r'&&e.kind==='data')!.out='lines';
  assert.equal((await run(graph,attachment('첫 행\n\n셋째'))).output,'3');
});
test('46 발췌 위치와 47 들여쓰기·끝 공백을 다시 색인해도 보존한다',async()=>{
  const line='  참고 문구  ';
  const passage=buildIndex([{id:'doc',title:'원문',version:'8',content:'\n\n\n'+line}])[0].passage;
  assert.equal(passage.quote,line);
  const graph=sequence(node('file.input','f'),node('document.read','r',{format:'json'}),node('knowledge.manage','index',{operation:'prepare',version:'2'}),node('data.transform','p',{operation:'select',path:'index.0.passage'}),output());
  const result=await run(graph,attachment(JSON.stringify([passage])));
  assert.deepEqual(JSON.parse(result.output),{...passage,indexVersion:'2'});
});
test('51 JSON 표시 형식이 문자열의 따옴표와 개행을 올바르게 직렬화한다',async()=>{
  const graph=sequence(node('input.user_request','i'),node('output.answer','out',{format:'json'}));
  assert.equal(JSON.parse((await run(graph,'본문\n"인용"')).output),'본문\n"인용"');
});

test('31 선택한 회신과 32 선택한 첨부 항목만 다음 문답의 모델 이력에 담긴다',async t=>{
  const actor=account('history-fields');
  const graph=sequence(node('file.input','file'),node('document.read','read',{format:'json'}),
    node('data.transform','public',{operation:'select',path:'public'}),
    node('input.form','form',{prompt:'수령 정보',fields:['지점','비고'],historyFields:'지점'}),
    node('ai.single_task','ai',{goal:'접수 결과 안내'}),output());
  const p=createProject(actor,{graph});
  process.env.OPENAI_API_KEY='offline-test';process.env.OPENAI_MODEL='offline-test';
  const histories:string[]=[];
  t.mock.method(globalThis,'fetch',async (_url:unknown,init:RequestInit)=>{
    histories.push(JSON.stringify(JSON.parse(String(init.body)).input.slice(0,-1)));
    return Response.json({output:[{type:'message',content:[{type:'output_text',text:'접수 완료'}]}]});
  });
  let conversation:string|undefined;
  for(let i=0;i<2;i++){
    const queued=startRun(actor,{id:p.id,mode:'test',input:attachment(JSON.stringify({public:'공개 입력',secret:'비공개 원문'}),'문서.json'),conversation,requestKey:'fields-'+i});
    conversation=queued.conversation;
    await workOne();const waiting=runGet(actor,queued.id);
    replyRun(actor,{runId:queued.id,waitId:waiting.prompt.id,value:JSON.stringify({지점:'솔바람점',비고:'제외할 회신'})});
    await workOne();assert.equal(runGet(actor,queued.id).state,'completed');
  }
  assert.equal(histories[0],'[]');assert.match(histories[1],/공개 입력/);assert.match(histories[1],/솔바람점/);
  assert.doesNotMatch(histories[1],/비공개 원문|제외할 회신/);
});

test('33 최근 100건 밖의 대기를 회신할 수 있고 34 중복 회신은 내용이 같은 경우만 성공한다',async()=>{
  const actor=account('older-waits');
  const p=createProject(actor,{graph:sequence(node('input.user_request','i'),node('input.form','q',{prompt:'선택하세요'}),output())});
  const queued=startRun(actor,{id:p.id,mode:'test',input:'오래된 질문',requestKey:'older'});
  await workOne();
  for(let i=0;i<100;i++)set("INSERT INTO runs(id,conversation,owner,request_key,input,state,created,updated) VALUES(?,?,?,?,?,'completed','2025','2025')",
    'history-'+i,queued.conversation,actor.id,'history-'+i,'후속');
  const waiting=runList(actor,p.id).find(r=>r.id===queued.id);
  assert.equal(waiting?.state,'waiting');
  const reply={runId:queued.id,waitId:waiting!.prompt.id,value:'승인',approved:true};
  replyRun(actor,reply);replyRun(actor,reply);
  assert.throws(()=>replyRun(actor,{...reply,value:'거절',approved:false}),{status:409});
  await workOne();assert.equal(runGet(actor,queued.id).output,'승인');
});

test('36 기한이 다른 두 대기 카드를 받고 뒤에 표시된 카드부터 회신한다',async()=>{
  const actor=account('parallel-prompts'),i=node('input.user_request','i'),split=node('control.parallel','p'),
    q=node('input.form','q',{prompt:'첫 질문'}),timed=node('input.form','t',{prompt:'시간 제한',replyTimeoutMinutes:1}),
    a=output(),b=node('output.answer','b');
  const graph=sequence(i,split,q,a);const further=sequence(split,timed,b);
  graph.nodes.push(timed,b);graph.edges.push(...further.edges.map(e=>({...e,id:'extra-'+e.id})));
  const p=createProject(actor,{graph}),queued=startRun(actor,{id:p.id,mode:'test',input:'시작',requestKey:'parallel'});
  await workOne();const waiting=runGet(actor,queued.id);
  assert.ok('prompts' in waiting);assert.equal(waiting.prompts.length,2);
  assert.ok(waiting.prompts.find(prompt=>prompt.prompt==='시간 제한')?.expiresAt);
  for(const prompt of waiting.prompts.toReversed())replyRun(actor,{runId:queued.id,waitId:prompt.id,value:prompt.prompt+' 완료'});
  await workOne();assert.match(runGet(actor,queued.id).output,/첫 질문 완료/);assert.match(runGet(actor,queued.id).output,/시간 제한 완료/);
});

test('49 발행 승인 후 연결한 다른 원문 대신 승인된 색인 원문을 돌려준다',async()=>{
  const memory=new Map<string,string>();
  const audit:Partial<EngineServices>={memory:async(k,v)=>{if(v!==undefined)memory.set(k,v);return memory.get(k);}};
  const design=(operation:string)=>sequence(node('file.input','f'),node('document.read','r',{format:'json'}),
    node('knowledge.manage','manage',{storeKey:'시험',version:'1',operation}),node('data.transform','body',{operation:'select',path:'documents.0.content'}),output());
  const material=(content:string)=>attachment(JSON.stringify({id:'doc',title:'원문',version:'1',content}));
  assert.equal((await run(design('index'),material('색인 A'),audit)).output,'색인 A');
  const graph=design('publish'),input=material('다른 B');
  const waiting=await run(graph,input,audit);
  assert.equal(waiting.status,'waiting');
  const result=await executeGraph(graph,{runId:'material',input,checkpoint:waiting.checkpoint,reply:{waitId:waiting.wait!.id,value:'승인',approved:true}},{...services,...audit});
  assert.equal(result.output,'색인 A',result.error??'');
});

test('50 같은 ID인 인라인 원문과 라이브러리 원문을 다른 팀에서 읽어도 실제 사용 판이 남는다',async()=>{
  const actor=account('edition-history');
  const asset=writeAsset(actor,{kind:'document',name:'등록 원문',payload:{content:'등록 원문'}});
  const teams=['inline','pinned'].map(id=>{
    const team=node('agent.team',id,{goal:'원문 읽기'}),graph=sequence(node('input.user_request','i'),output());
    const src=createBlock('resource.context',{id:'shared',title:'같은 자료',config:{version:'1',...(id==='pinned'?{assetId:asset.id}:{content:'직접 입력'})}});
    graph.nodes.push(src);graph.edges.find(e=>e.kind==='data')!.from=src.id;team.graph=graph;return team;
  });
  const p=createProject(actor,{graph:sequence(node('input.user_request','i'),...teams,output())});
  const queued=startRun(actor,{id:p.id,mode:'test',input:'자료',requestKey:'assets'});
  await workOne();const result=runGet(actor,queued.id);
  assert.equal(result.state,'completed',result.error);
  assert.deepEqual(result.usedEditions,[{title:'같은 자료',version:1}]);
});

test('52 최종 출력으로 전달된 실제 파일만 남고 대기 중 초안과 파일 모양 입력은 제외된다',async()=>{
  const inner=node('agent.team','team',{goal:'초안'});
  inner.graph=sequence(node('input.user_request','i'),node('file.create','file',{fileName:'초안.md'}),output());
  const graph=sequence(node('input.user_request','i'),inner,node('review.human','review',{prompt:'의견'}),output());
  const input='초안 원문',waiting=await run(graph,input);
  assert.equal(waiting.status,'waiting');assert.deepEqual(waiting.checkpoint.finalFilePaths??[],[]);
  const result=await executeGraph(graph,{input,runId:'material',checkpoint:waiting.checkpoint,reply:{value:'수정',waitId:waiting.wait!.id}},services);
  assert.deepEqual(result.checkpoint.finalFilePaths,[]);
  const selected=await run(sequence(node('input.user_request','i'),inner,output()),input);
  assert.deepEqual(selected.checkpoint.finalFilePaths,['root/team/graph/file']);
  const fake=await run(sequence(node('file.input','f'),node('document.read','r',{format:'json'}),output()),attachment(JSON.stringify({fileName:'가짜.txt',format:'text',content:'내용'})));
  assert.deepEqual(fake.checkpoint.finalFilePaths,[]);
});
