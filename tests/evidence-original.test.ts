import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBlock, type Edge} from '../src/domain';
import {executeGraph, type EngineRequest, type EngineServices, type Passage} from '../src/engine';
import {buildIndex} from '../src/engine/values';

const edge=(from:string,to:string,kind:Edge['kind']='flow',out=kind==='flow'?'next':'value',input=kind==='flow'?'in':'input'):Edge=>
  ({id:[from,to,kind,out,input].join('-'),from,to,kind,out,input});
const candidate={id:'manual',title:'매뉴얼',version:'2',location:'2행',quote:'일요일 운영'};
const modelReply={text:JSON.stringify({status:'verified',reason:'안내 시간 문구를 찾았습니다.',references:[{index:0,quote:'일요일 운영'}]})};
const model=async()=>modelReply;
const services:EngineServices={model,tool:async()=>{throw Error('unexpected tool');}};
const resultOf=(r:Awaited<ReturnType<typeof executeGraph>>)=>r.checkpoint.steps['root/check'].values.value;
test('동일 발행 구절을 직접 연결해도 두 검색 방식 모두 상충 원문 두 개와 물리적 2행을 유지한다',async()=>{
  const documents=['3일','5일'].map((days,i)=>({id:'d'+i,title:'규정',version:'1',content:'서문\r반납 '+days}));
  for(const matchMode of ['literal','ranked']){
    const graph={nodes:[createBlock('input.user_request',{id:'q'}),
      createBlock('resource.context',{id:'d0',title:'규정',config:{version:'1',content:documents[0].content}}),
      createBlock('knowledge.search',{id:'search',config:{query:'반납',storeKey:'규정집',version:'7',topK:2,matchMode}}),
      createBlock('quality.evidence',{id:'check',config:{requireOriginal:true}}),createBlock('output.answer',{id:'out'})],
      edges:[edge('q','search'),edge('q','search','data'),edge('d0','search','reference','ref','context'),edge('search','check'),
        edge('search','check','data'),edge('check','out','flow','conflicting'),edge('check','out','data')]};
    const oldIndex=documents.map(d=>({passage:{id:d.id,title:d.title,version:'1',location:'1행',quote:d.content},bodyTerms:['반납'],titleTerms:[]}));
    const r=await executeGraph(graph,{runId:matchMode,input:'반납'},{...services,knowledge:()=>({
      read:async()=>({version:'7',documents,index:oldIndex}),stage:async()=>undefined,release:async()=>{},
    }),model:async()=>({text:JSON.stringify({status:'conflicting',references:[{index:0,quote:'반납 3일'},{index:1,quote:'반납 5일'}]})})});
    assert.equal(r.status,'completed',r.error??'');
    assert.deepEqual((r.checkpoint.steps['root/search'].values.value as Passage[]).map(p=>[p.id,p.version,p.indexVersion,p.location,p.quote]),
      [['d0','1','7','2행','반납 3일'],['d1','1','7','2행','반납 5일']]);
    assert.equal((resultOf(r) as {status:string}).status,'conflicting');
  }
});
function audit(strict=false) {
  const nodes=[createBlock('file.input',{id:'file'}),createBlock('document.read',{id:'read',config:{format:'json'}}),
    createBlock('quality.evidence',{id:'check',config:{requireOriginal:strict,includeSourceLines:true}}),createBlock('output.answer',{id:'end'})];
  const edges=[edge('file','read'),edge('file','read','data'),edge('read','check'),edge('read','check','data'),
    ...['verified','insufficient','conflicting'].map(out=>edge('check','end','flow',out)),edge('check','end','data')];
  return {nodes,edges};
}
function request(passages:unknown[]):EngineRequest {
  return {runId:'evidence',input:JSON.stringify({fileName:'후보.json',content:JSON.stringify(passages)})};
}

test('원본 없이 전달한 후보는 기존 근거 있음 경로로만 보내고 원문 행과 출처 인증을 만들지 않는다',async()=>{
  const graph=audit();delete graph.nodes[2].config.requireOriginal;
  const r=await executeGraph(graph,request([{...candidate,verification:'original',supplied:true,sourceLines:['위조 원문']}]),services);
  assert.equal(r.status,'completed',r.error??'');
  assert.deepEqual(r.checkpoint.steps['root/check'].routes,['verified']);
  assert.deepEqual(resultOf(r),{status:'candidate_match',verification:'candidate',reason:'전달받은 후보 문구 안에서만 확인했습니다. 안내 시간 문구를 찾았습니다.',
    passages:[candidate],sourceLines:[]});
});

test('필수 원문은 해당 단계에서 요청하고 같은 모델 판단을 재사용해 지정한 위치만 확인한다',async()=>{
  const graph=audit(true),input=request([candidate]);let calls=0;
  const adapter={...services,model:async()=>{calls++;return modelReply;}};
  const waiting=await executeGraph(graph,input,adapter);
  assert.equal(waiting.status,'waiting');assert.equal(waiting.wait?.kind,'file');assert.equal(waiting.wait?.filePurpose,'evidenceOriginal');
  assert.match(waiting.wait!.prompt,/매뉴얼.*manual.*2판.*2행/);assert.equal(waiting.checkpoint.steps['root/end'],undefined);
  for(const [content,status] of [['첫 행\r\n  일요일 운영 시간  \r\n','verified'],['일요일 운영\n다른 행','insufficient']]){
    const done=await executeGraph(graph,{...input,checkpoint:waiting.checkpoint,reply:{waitId:waiting.wait!.id,value:JSON.stringify({fileName:'매뉴얼.md',content})}},adapter);
    assert.equal(done.status,'completed',done.error??'');
    const checked=resultOf(done) as Record<string,unknown>;
    assert.equal(checked.status,status);assert.equal(checked.verification,status==='verified'?'original':'none');
    assert.equal(checked.originalSource,status==='verified'?'supplied':undefined);
    assert.deepEqual(checked.sourceLines,status==='verified'?['  일요일 운영 시간  ']:[]);
  }
  assert.equal(calls,1);
});

test('판이 없는 후보는 판 번호를 회신한 뒤 해당 판의 전체 원문을 대조할 때까지 대기한다',async()=>{
  const graph=audit(true);
  for(const version of [undefined,null,'  ',{number:2}]){
    const input=request([{...candidate,version,originalSource:'connected',sourceLines:[candidate.quote]}]);
    let calls=0;
    const adapter={...services,model:async()=>{calls++;return modelReply;}};
    let r=await executeGraph(graph,input,adapter);
    assert.equal(r.status,'waiting');assert.equal(r.wait?.kind,'question');
    assert.match(r.wait!.prompt,/manual.*2행.*판 번호/);
    for(const value of [{fileName:'2판.txt',content:candidate.quote},{'판 번호':'  '},{'판 번호':{value:'2'}}]){
      r=await executeGraph(graph,{...input,checkpoint:r.checkpoint,reply:{waitId:r.wait!.id,value:JSON.stringify(value)}},adapter);
      assert.equal(r.status,'waiting');assert.equal(r.wait?.kind,'question');assert.ok(r.wait.fieldError);
      assert.equal(r.checkpoint.steps['root/end'],undefined);
    }
    r=await executeGraph(graph,{...input,checkpoint:r.checkpoint,reply:{waitId:r.wait!.id,value:JSON.stringify({'판 번호':'2'})}},adapter);
    assert.equal(r.status,'waiting');assert.match(r.wait!.prompt,/manual.*2판.*2행/);assert.equal(r.wait!.kind,'file');
    for(const [content,status] of [['제목\n일요일 운영 안내','verified'],['일요일 운영 안내\n다른 내용','insufficient']]){
      const done=await executeGraph(graph,{...input,checkpoint:r.checkpoint,reply:{waitId:r.wait!.id,value:JSON.stringify({fileName:'원문.txt',content})}},adapter);
      assert.equal(done.status,'completed',done.error??'');
      const result=resultOf(done) as {status:string;verification:string;passages:Passage[];originalSource?:string};
      assert.equal(result.status,status);
      if(status==='verified'){
        assert.deepEqual(result.passages,[candidate]);assert.equal(result.verification,'original');assert.equal(result.originalSource,'supplied');
      }else assert.equal(result.verification,'none');
    }
    assert.equal(calls,1);
    const optional=await executeGraph(audit(),input,services);
    assert.equal((resultOf(optional) as {status:string}).status,'candidate_match');assert.equal(optional.wait,undefined);
  }
});

test('판 확인 회신은 지정한 판의 연결 원문에서만 위치를 대조한다',async()=>{
  const graph=audit(true);
  graph.nodes.push(createBlock('resource.context',{id:'manual',config:{version:'2',content:'제목\n일요일 운영 안내'}}));
  graph.edges.push(edge('manual','check','reference','ref','context'));
  const input=request([{...candidate,version:''}]);
  const pending=await executeGraph(graph,input,services);
  assert.equal(pending.status,'waiting');assert.equal(pending.wait?.kind,'question');
  const resume=(version:string)=>executeGraph(graph,{...input,checkpoint:pending.checkpoint,
    reply:{waitId:pending.wait!.id,value:JSON.stringify({'판 번호':version})}},services);
  const connected=await resume(' 2 ');
  assert.equal(connected.status,'completed');
  const result=resultOf(connected) as {status:string;passages:Passage[];originalSource?:string};
  assert.equal(result.status,'verified');assert.equal(result.passages[0].version,'2');assert.equal(result.originalSource,undefined);
  const other=await resume('3');
  assert.equal(other.status,'waiting');assert.equal(other.wait!.kind,'file');assert.match(other.wait!.prompt,/manual.*3판/);
});

test('이전 실행의 판 미지정 파일 대기와 회신은 현재 판을 증명하지 않는다',async()=>{
  const graph=audit(true),input=request([{...candidate,version:null}]);
  const pending=await executeGraph(graph,input,services);
  const id='root/check#original:previous#file';
  const old={...pending.checkpoint,waits:{[id]:{id,kind:'file' as const,filePurpose:'evidenceOriginal' as const,prompt:'원문 파일을 첨부하세요.'}}};
  for(const reply of [undefined,{waitId:id,value:JSON.stringify({fileName:'2판.txt',content:'제목\n일요일 운영'})}]){
    const resumed=await executeGraph(graph,{...input,checkpoint:old,reply},services);
    assert.equal(resumed.status,'waiting');assert.equal(resumed.wait?.kind,'question');assert.equal(Object.keys(resumed.checkpoint.waits).length,1);
    assert.equal(resumed.checkpoint.steps['root/check'],undefined);
  }
});

test('같은 출처의 같은 행에 서로 다른 규정이 있으면 판이 확정된 뒤에만 독립된 상충 근거로 센다',async()=>{
  const graph=audit(true);
  graph.nodes.push(createBlock('resource.context',{id:'manual',config:{version:'2',content:'제목\n일요일 운영'}}));
  graph.edges.push(edge('manual','check','reference','ref','context'));
  const input=request([candidate,{...candidate,version:undefined,quote:'휴관'}]);
  const adapter={...services,model:async()=>({text:JSON.stringify({status:'conflicting',references:[
    {index:0,quote:'일요일 운영'},{index:1,quote:'휴관'},
  ]})})};
  const waiting=await executeGraph(graph,input,adapter);
  assert.equal(waiting.wait?.kind,'question');assert.match(waiting.wait!.prompt,/휴관/);
  const identify=(version:string)=>executeGraph(graph,{...input,checkpoint:waiting.checkpoint,
    reply:{waitId:waiting.wait!.id,value:JSON.stringify({'판 번호':version})}},adapter);
  const same=await identify('2');
  assert.equal(same.status,'completed');assert.deepEqual(same.checkpoint.steps['root/check'].routes,['insufficient']);
  const other=await identify('3');assert.match(other.wait!.prompt,/3판/);
  const both=await executeGraph(graph,{...input,checkpoint:other.checkpoint,reply:{waitId:other.wait!.id,
    value:JSON.stringify({fileName:'매뉴얼.md',content:'제목\n일요일 휴관'})}},adapter);
  const result=resultOf(both) as {status:string;originalSource:string;passages:Passage[]};
  assert.equal(result.status,'conflicting');assert.equal(result.originalSource,'mixed');
  assert.deepEqual(result.passages.map(p=>p.version),['2','3']);
});

test('동적 담당 작업은 반환한 후보의 판과 원문을 확인할 때까지 대기하고 하위 결과 자체는 보존한다',async()=>{
  const spawn=createBlock('agent.create_dynamic',{id:'spawn',config:{role:'자료 담당',resultRequirement:'evidence',failurePolicy:'collect'}});
  spawn.graph=audit();
  spawn.graph.nodes.push(createBlock('resource.context',{id:'manual',config:{version:'2',content:'제목\n일요일 운영 안내'}}));
  spawn.graph.edges.push(edge('manual','check','reference','ref','context'));
  const graph={nodes:[createBlock('input.user_request',{id:'entry'}),spawn,createBlock('output.answer',{id:'out'})],
    edges:[edge('entry','spawn'),edge('entry','spawn','data'),edge('spawn','out'),edge('spawn','out','data')]};
  const input={runId:'dynamic-edition',input:JSON.stringify({fileName:'후보.json',question:'서점',content:JSON.stringify([{...candidate,version:undefined}])})};
  let pending=await executeGraph(graph,input,services);
  assert.equal(pending.status,'waiting');assert.equal(pending.wait?.kind,'question');assert.match(pending.wait!.prompt,/서점.*manual.*판 번호/);
  assert.equal(pending.checkpoint.steps['root/spawn/dynamic-0/check'].evidenceStatus,'candidate_match');
  const resume=(version:string)=>executeGraph(graph,{...input,checkpoint:pending.checkpoint,
    reply:{waitId:pending.wait!.id,value:JSON.stringify({'판 번호':version})}},services);
  const matched=await resume('2');assert.equal(matched.status,'completed',matched.error??matched.wait?.prompt??'');
  const checked=JSON.parse(matched.output).results[0];
  assert.equal(checked.status,'verified');assert.equal(checked.evidence[0].passages[0].version,'2');
  assert.equal(checked.result.status,'candidate_match');
  pending=await resume('3');assert.equal(pending.status,'waiting');assert.match(pending.wait!.prompt,/3판/);
  const done=await executeGraph(graph,{...input,checkpoint:pending.checkpoint,reply:{waitId:pending.wait!.id,
    value:JSON.stringify({fileName:'3판.txt',content:'일요일 운영\n다른 행'})}},services);
  assert.equal(JSON.parse(done.output).results[0].status,'insufficient');
  spawn.config.resultRequirement='output';
  const optional=await executeGraph(graph,input,services);
  assert.equal(optional.status,'completed');assert.equal(JSON.parse(optional.output).results[0].result.status,'candidate_match');
});

test('현재 판의 연결 자료에서만 원문 행을 비교하고 후보가 주장한 다른 버전이나 자료 ID를 조회하지 않는다',async()=>{
  const g=audit();
  g.nodes.push(createBlock('resource.context',{id:'bound',config:{assetId:'manual',version:2}}));
  g.edges.push(edge('bound','check','reference','ref','context'));
  const reads:string[]=[];
  const adapter={...services,asset:async(id:string,version?:string)=>{
    reads.push(id+':'+version);return {id,title:'등록 매뉴얼',version:'2',content:'다른 행\n일요일 운영 10시'};
  }};
  for(const [input,status] of [[candidate,'verified'],[{...candidate,version:'3'},'candidate_match'],[{...candidate,id:'other',assetId:'manual'},'candidate_match'],
    [{...candidate,location:'1행'},'insufficient']] as const){
    const r=await executeGraph(g,request([input]),adapter);assert.equal(r.status,'completed',r.error??'');
    const checked=resultOf(r) as Record<string,unknown>;assert.equal(checked.status,status);
    if(status==='verified')assert.deepEqual(checked.passages,[{...candidate,title:'등록 매뉴얼'}]);
  }
  assert.deepEqual(reads,['manual:2','manual:2','manual:2','manual:2']);
});

test('발행된 색인의 발췌문과 발행 원문을 구분하고 검색 단계에서 비교한 원문을 다음 단계까지 보존한다',async()=>{
  const graph=audit();graph.nodes=graph.nodes.filter(n=>!['file','read'].includes(n.id));
  graph.nodes.push(createBlock('input.user_request',{id:'q'}),createBlock('knowledge.search',{id:'search',config:{query:'일요일 운영',storeKey:'운영',version:'2'}}));
  graph.edges=graph.edges.filter(e=>e.from!=='file'&&e.from!=='read');
  graph.edges.push(edge('q','search'),edge('q','search','data'),edge('search','check'),edge('search','check','data'));
  const excerpt={id:'manual',title:'매뉴얼',version:'2',location:'2행',content:'일요일 운영'};
  for(const documents of [[excerpt],[{id:'manual',title:'매뉴얼',version:'2',content:'첫 행\n  일요일 운영 오후  '}]]){
    const r=await executeGraph(graph,{runId:'published',input:'질문'},{...services,knowledge:()=>({
      read:async()=>({documents,index:buildIndex(documents),version:'2'}),stage:async()=>undefined,release:async()=>{},
    })});
    const checked=resultOf(r) as Record<string,unknown>;
    assert.equal(r.status,'completed',r.error??'');assert.equal(checked.status,'location' in documents[0]?'candidate_match':'verified');
  }
});

test('극성이 다른 두 후보는 두 원문 회신을 해당 판에 묶은 뒤에만 상충으로 보낸다',async()=>{
  const graph=audit(true);
  const second={...candidate,id:'weekend',version:'4',quote:'일요일 휴관'};
  const input=request([candidate,second]),adapter={...services,model:async()=>({text:JSON.stringify({status:'conflicting',reason:'운영과 휴관이 다릅니다.',
    references:[candidate,second].map((p,index)=>({index,quote:p.quote}))})})};
  let r=await executeGraph(graph,input,adapter);
  const rejected=await executeGraph(graph,{...input,checkpoint:r.checkpoint,reply:{waitId:r.wait!.id,value:JSON.stringify({fileName:'첫 판.txt',content:'다른 행'})}},adapter);
  assert.equal(rejected.status,'completed');assert.equal(rejected.wait,undefined);
  assert.equal((resultOf(rejected) as {status:string}).status,'insufficient');
  for(const p of [candidate,second]){
    assert.equal(r.status,'waiting');assert.ok(r.wait?.prompt.includes(p.id));
    r=await executeGraph(graph,{...input,checkpoint:r.checkpoint,reply:{waitId:r.wait!.id,value:JSON.stringify({fileName:'안내.txt',content:'제목\n'+p.quote})}},adapter);
  }
  assert.equal(r.status,'completed',r.error??'');
  const result=resultOf(r) as {status:string;verification:string;passages:Passage[]};
  assert.equal(result.status,'conflicting');assert.equal(result.verification,'original');assert.equal(result.passages.length,2);
});

test('후속 AI는 후보에서 확인한 내용을 등록 원문 근거로 바꾸지 않는다',async()=>{
  const g=audit(),answer=createBlock('ai.single_task',{id:'explain'});
  g.nodes.push(answer);
  for(const link of g.edges)if(link.to==='end')link.to=answer.id;
  g.edges.push(edge(answer.id,'end'),edge(answer.id,'end','data'));
  const r=await executeGraph(g,request([candidate]),{...services,model:async req=>{
    if(req.instruction.includes('완료 판정:'))return {text:JSON.stringify({status:'met',reason:'후보 한정 안내'})};
    if(req.instruction.includes('원문 후보에 근거해'))return {text:JSON.stringify({answer:'확인한 안내',references:[{index:0,quote:'일요일 운영'}]})};
    return modelReply;
  }});
  assert.equal(r.status,'completed',r.error??'');assert.match(r.output,/후보 문구와 일치/);
  assert.equal(r.checkpoint.steps['root/explain'].evidenceStatus,'candidate_match');assert.equal(r.checkpoint.steps['root/end'].evidenceStatus,'candidate_match');
});

test('연결한 문서와 새로 첨부한 원문을 함께 확인한 결과에 두 출처를 표시한다',async()=>{
  const graph=audit(true),second={...candidate,id:'weekend',quote:'일요일 휴관'};
  graph.nodes.push(createBlock('resource.context',{id:'manual',config:{version:'2',content:'제목\n일요일 운영 안내'}}));
  graph.edges.push(edge('manual','check','reference','ref','context'));
  const input=request([candidate,second]),adapter={...services,model:async()=>({text:JSON.stringify({
    status:'conflicting',reason:'운영과 휴관',references:[candidate,second].map((p,index)=>({index,quote:p.quote})),
  })})};
  const waiting=await executeGraph(graph,input,adapter);
  assert.equal(waiting.status,'waiting');assert.match(waiting.wait!.prompt,/weekend/);
  const done=await executeGraph(graph,{...input,checkpoint:waiting.checkpoint,reply:{waitId:waiting.wait!.id,
    value:JSON.stringify({fileName:'다른 원문.txt',content:'제목\n일요일 휴관 안내'})}},adapter);
  const result=resultOf(done) as Record<string,unknown>;
  assert.equal(result.status,'conflicting');assert.equal(result.originalSource,'mixed');
  assert.deepEqual(result.sourceLines,['일요일 운영 안내','일요일 휴관 안내']);
});

test('한 원문 행의 서로 다른 위치 표기는 독립된 두 상충 근거가 아니다',async()=>{
  const graph=audit(true);
  graph.nodes.push(createBlock('resource.context',{id:'manual',config:{version:'2',content:'제목\n일요일 운영 또는 휴관'}}));
  graph.edges.push(edge('manual','check','reference','ref','context'));
  const input=request([candidate,{...candidate,quote:'휴관',location:'line-2'}]);
  const r=await executeGraph(graph,input,{...services,model:async()=>({text:JSON.stringify({status:'conflicting',
    references:[{index:0,quote:'운영'},{index:1,quote:'휴관'}]})})});
  assert.equal(r.status,'completed',r.error??'');
  assert.equal((resultOf(r) as {status:string}).status,'insufficient');
  assert.deepEqual(r.checkpoint.steps['root/check'].routes,['insufficient']);
});

test('워커가 같은 실행에서 판 번호 양식과 원문 첨부 회신을 차례로 받아 근거를 저장한다',async t=>{
  process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-evidence-edition-'));
  process.env.OPENAI_API_KEY='offline-test-only';
  process.env.OPENAI_MODEL='offline';
  const {authenticate}=await import('../src/server/auth');
  const {createProject}=await import('../src/server/projects');
  const {runGet,startRun,replyRun,workOne}=await import('../src/server/runs');
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    return Response.json({output:[{type:'message',content:[{type:'output_text',text:modelReply.text}]}]});
  });
  const user=authenticate('signup','edition-user','offline-test-password','').user;
  const graph={...audit(true),agentScope:{mode:'general' as const,purpose:''}};
  const project=createProject(user,{graph});
  const item=startRun(user,{id:project.id,mode:'test',input:request([{...candidate,version:null}]).input,requestKey:'edition-reply'});
  assert.ok(await workOne());
  const question=runGet(user,item.id).prompt;
  assert.equal(question.kind,'question');assert.equal(question.fields[0].name,'판 번호');
  const reply=(id:string,value:unknown)=>replyRun(user,{runId:item.id,waitId:id,value:JSON.stringify(value)});
  assert.throws(()=>reply(question.id,{fileName:'3판.md',content:candidate.quote}),/판 번호/);
  assert.throws(()=>reply(question.id,{'판 번호':{value:3}}),/판 번호/);
  assert.equal(runGet(user,item.id).state,'waiting');
  reply(question.id,{'판 번호':' 3 '});assert.ok(await workOne());
  const upload=runGet(user,item.id).prompt;
  assert.equal(upload.filePurpose,'evidenceOriginal');assert.match(upload.prompt,/manual.*3판/);
  reply(upload.id,{fileName:'원문.md',content:'제목\n일요일 운영 안내'});assert.ok(await workOne());
  const done=runGet(user,item.id);assert.equal(done.state,'completed');assert.equal(calls,1);
  const result=JSON.parse(done.output);assert.equal(result.status,'verified');assert.equal(result.passages[0].version,'3');
  assert.deepEqual(result.sourceLines,['일요일 운영 안내']);
});
