import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type { Block, Graph, Edge } from '../src/domain/types';
import { executeGraph as runEngine, type EngineServices, type EngineRequest, type ModelInput } from '../src/engine';
import { libraryTemplates, templates } from '../src/domain/templates';
import {catalog} from '../src/domain/catalog';
import {encodeRunQuestion} from '../src/domain/run-input';
import { legacyGuestSession } from './legacy-guest';
import {createProject,openProject,runnable,saveProject} from '../src/server/projects';
import {readAsset} from '../src/server/assets';
import {scopeModel} from './scope-fixture';
import {EngineExportMatrix} from './engine-export-matrix';

process.env.STUDIO_DATA_DIR=mkdtempSync(join(tmpdir(),'studio-capability-matrix-'));
const designer=legacyGuestSession().user;
const observedResults=new Set<string>();
const exportMatrix=new EngineExportMatrix();
async function executeGraph(graph:Graph,request:EngineRequest,adapters:EngineServices){
  const saved=createProject(designer,{graph,title:'블록 검증'});
  const restored=openProject(designer,saved.id).graph!;
  assert.equal(JSON.stringify(restored),JSON.stringify(graph));
  const result=await runEngine(restored,request,adapters);
  exportMatrix.compare(designer,saved.id,restored,result);
  for(const event of result.events)if(event.kind==='result'&&event.blockType)observedResults.add(event.blockType);
  return result;
}
after(()=>{
  const missing=catalog.filter(def=>!observedResults.has(def.type)).map(def=>def.type);
  assert.deepEqual(missing,[],'SQLite 재열기 후 동작 결과가 확인되지 않은 블록');
  exportMatrix.finish();
});

function block(id:string,type:string,config:Block['config']={},graph?:Graph):Block {
  return {id,type,title:id,x:0,y:0,config,graph};
}
function edge(from:string,to:string,kind:Edge['kind']='flow',out=kind==='flow'?'next':'value',input=kind==='flow'?'in':'input'):Edge {
  return {id:[from,to,kind,out,input].join('-'),from,to,kind,out,input};
}
function wire(from:string,to:string,route='next'){return [edge(from,to,'flow',route),edge(from,to,'data')];}
const src=block('q','input.user_request'),out=block('out','output.answer');
function linear(nodes:Block[]):Graph{
  return {nodes,edges:nodes.slice(1).flatMap((n,i)=>wire(nodes[i].id,n.id))};
}
const simple=(type:string,config:Block['config']={},graph?:Graph)=>linear([src,block('stage',type,config,graph),out]);
function services(extra:Partial<EngineServices>={}):EngineServices {
  return {
    scopeModel,
    model:async r=>({text:'모델 결과: '+r.input}),
    tool:async()=>{throw Error('승인 없이 도구 호출');},
    ...extra,
  };
}
const run=(graph:Graph,input:string,extra:Partial<EngineServices>={},request:Partial<EngineRequest>={})=>
  executeGraph(graph,{runId:'run-1',input,...request},services(extra));

test('질문란에 붙여넣은 파일 모양 JSON도 하위 Workflow까지 원문 질문으로 전달한다',async()=>{
  const graph=simple('workflow.call',{},linear([src,out]));
  const question='{"fileName":"안내.txt","content":"형식 예시","question":"질문 속 항목"}';
  for(const literal of [question,JSON.stringify({$studioInput:'question',question})]){
    const result=await run(graph,encodeRunQuestion(literal));
    assert.equal(result.status,'completed');
    assert.equal(result.output,literal);
  }
  const legacy=await run(graph,JSON.stringify({fileName:'안내.txt',content:'파일 원문',question:'질문 속 항목'}));
  assert.equal(legacy.output,'질문 속 항목');
});

test('위임은 대표에게 반환하고 인계는 새 담당자가 다음 단계와 최종 답변을 맡는다',async()=>{
  for(const type of ['agent.delegate','agent.handoff']){
    const graph=linear([src,block('transfer',type,{role:'자료 담당',instruction:'자료를 검토합니다.'}),block('wrap','ai.single_task',{goal:'결과 전달'}),out]);
    const seen:ModelInput[]=[];
    const response=await run(graph,'자료',{model:async request=>{seen.push(request);return {text:'확인 결과'};}});
    assert.equal(response.status,'completed');
    const owner=type==='agent.delegate'?'대표 Agent':'자료 담당';
    assert.equal(seen.length,2);
    assert.equal(seen[0].context,'이 경로를 담당하는 역할: 자료 담당\n사용자 원래 질문: 자료');
    assert.equal(seen[1].context,'이 경로를 담당하는 역할: '+owner);
    assert.equal(response.checkpoint.steps['root/out'].responsible,owner);
  }
});

test('팀 목표는 모든 담당자에게 전달되고 상위 Skill은 선택한 담당자의 모델 요청에만 포함된다',async()=>{
  for(const type of ['agent.delegate','agent.handoff','agent.create_dynamic']){
    for(const nested of [false,true]){
      const member=block('member',type,{role:'회원증 담당',instruction:'발급 절차를 확인하세요.',inheritedSkillIds:['block:membership']},
        nested?simple('ai.single_task',{goal:'필요 서류 조회'}):undefined);
      const sibling=block('sibling','agent.delegate',{role:'운영시간 담당',instruction:'운영시간을 안내하세요.'});
      const inner=linear([src,member,sibling,out]);
      inner.nodes.push(block('local','instruction.skill',{content:'서류 원본을 확인하세요.'}));
      inner.edges.push(edge('local',member.id,'reference','ref','skill'));
      const graph=simple('agent.team',{goal:'도서관 첫 방문을 안내하세요.'},inner);
      for(const [id,content] of [['membership','발급 시 신분증을 확인하세요.'],['hours','휴관일을 확인하세요.']]){
        graph.nodes.push(block(id,'instruction.skill',{content}));
        graph.edges.push(edge(id,'stage','reference','ref','skill'));
      }
      const requests:ModelInput[]=[];
      const result=await run(graph,'중앙관',{model:async request=>{requests.push(request);return {text:'완료'};}});
      assert.equal(result.status,'completed',result.error??'팀 실행 완료');
      assert.equal(requests.length,2);
      for(const request of requests){
        assert.match(request.instruction,/도서관 첫 방문을 안내하세요/);
        assert.doesNotMatch(request.instruction,/휴관일을 확인하세요/);
        assert.deepEqual(request.tools,[]);
      }
      assert.match(requests[0].instruction,/발급 절차를 확인하세요/);
      assert.match(requests[0].instruction,/발급 시 신분증을 확인하세요/);
      assert.match(requests[0].instruction,/서류 원본을 확인하세요/);
      assert.doesNotMatch(requests[1].instruction,/발급 시 신분증|서류 원본|발급 절차/);
    }
  }
});

test('동적 담당자는 직접 호출과 하위 설계에서 자신의 역할로 일하고 결과를 팀장에게 반환한다',async()=>{
  const nested=linear([src,block('research','ai.single_task',{goal:'지점 조사'}),out]);
  for(const childGraph of [undefined,nested]){
    const spawn=block('spawn','agent.create_dynamic',{role:'지점 조사 담당',maxCreatedAgents:2},childGraph);
    const team=linear([src,spawn,block('collect','ai.single_task',{goal:'조사 결과 종합'}),out]);
    const requests:ModelInput[]=[];
    const result=await run(simple('agent.team',{responsible:'운영 팀장'},team),'북부,남부',{
      model:async request=>{requests.push(request);return {text:request.input};},
    });
    assert.equal(result.status,'completed');
    assert.equal(requests.length,3);
    const researchers=requests.slice(0,2);
    assert.deepEqual(researchers.map(req=>req.input).sort(),['남부','북부']);
    for(const req of researchers){
      assert.equal(req.context,'이 경로를 담당하는 역할: 지점 조사 담당');
    }
    assert.equal(requests[2].context,'이 경로를 담당하는 역할: 운영 팀장');
    assert.equal(result.checkpoint.steps['root/stage/graph/collect'].responsible,'운영 팀장');
  }
});

test('동료 검토 의견은 작성자 이름을 생략해도 검토자와 상대 초안에 묶여 원문과 함께 최종 작업에 전달된다',async()=>{
  const lesson=templates.find(item=>item.id==='peer-review')!;
  const graph=structuredClone(lesson.graph);
  const source=graph.nodes.find(node=>node.id==='team')!.graph!.nodes.find(node=>node.id==='source')!;
  const evidence='토요일에는 오후 3시에 문을 닫습니다.';
  source.config.content=evidence;
  const factRole='사실 검토 담당',editorRole='안내문 편집 담당';
  const factDraft='토요일 폐관 시각은 오후 6시입니다.',editorDraft='토요일은 오후 여섯 시까지 이용하세요.';
  const revisedGuide='토요일에는 오후 3시까지 방문하세요.';
  const sharedDraft='오후 6시까지 이용 가능합니다.';
  for(const sameFeedback of [false,true]){
    const firstDraft=sameFeedback?sharedDraft:factDraft;
    const secondDraft=sameFeedback?sharedDraft:editorDraft;
    const finalRequests:ModelInput[]=[];
    const model:EngineServices['model']=async request=>{
      const title=request.instruction.split('\n')[0];
      if(title==='작업: 방문 안내문 수정'){
        finalRequests.push(request);
        return {text:revisedGuide};
      }
      if(title.includes('동료 검토'))return {text:request.input+' → '+revisedGuide+'\n도서관 원문 “'+evidence+'”'};
      return {text:title==='작업: '+factRole+' 초안'?firstDraft:secondDraft};
    };
    const result=await run(graph,lesson.question,{model});
    assert.equal(result.status,'completed');
    assert.equal(finalRequests.length,1);
    const correction=' → '+revisedGuide+'\n도서관 원문 “'+evidence+'”';
    const records=[{[factRole+' → '+editorRole+' 초안']:secondDraft+correction},
      {[editorRole+' → '+factRole+' 초안']:firstDraft+correction}];
    const start=result.events.find(event=>event.nodeId==='revise'&&event.kind==='start')!;
    const bindings=start.data as {input:unknown[];question:string};
    assert.deepEqual(bindings.input,records);
    assert.equal(bindings.question,lesson.question);
    for(const record of records)assert.ok(finalRequests[0].input.includes(JSON.stringify(record,null,2)));
    assert.ok(finalRequests[0].context.includes(evidence));
    assert.ok(finalRequests[0].context.includes(lesson.question));
    const headingsAndBodies=records.flatMap(record=>Object.entries(record).map(([heading,body])=>heading+'\n'+body));
    assert.equal(result.output,[revisedGuide,...headingsAndBodies].join('\n\n'));
  }
});

test('새 질문에 실제 입력, Skill과 고정 자료판을 모델 서비스에 넘기고 도구 권한은 늘리지 않는다',async()=>{
  const g=simple('ai.single_task',{goal:'회의록 작성'});
  g.nodes.push(block('skill','instruction.skill',{assetId:'s',version:'7'}),block('doc','resource.context',{content:'근거 자료'}));
  g.edges.push(edge('skill','stage','reference','ref','skill'),edge('doc','stage','reference','ref','context'));
  const requests:ModelInput[]=[];
  const res=await run(g,'새 회의 내용',{
    asset:async(id,version)=>({id,version:version!,title:'인용 Skill',content:'근거 문장을 붙이세요.'}),
    model:async r=>{requests.push(r);return {text:'회의 결정 사항'};},
  });
  assert.equal(res.status,'completed'); assert.equal(res.output,'회의 결정 사항');
  assert.match(requests[0].instruction,/근거 문장/);assert.match(requests[0].context,/근거 자료/);
  assert.deepEqual(requests[0].tools,[]);
});

test('추가 질문·이벤트·사람 검토는 직전 작업을 다시 수행하지 않고 같은 실행을 재개한다',async()=>{
  for(const type of ['input.form','control.wait','review.human']){
    const g=linear([src,block('first','ai.single_task'),block('wait',type,{prompt:'자료를 보내 주세요.'}),out]);
    let calls=0;
    const model=async()=>{calls++;return {text:'첫 응답'};};
    const a=await run(g,'질문',{model});assert.equal(a.status,'waiting');
    const b=await run(g,'질문',{model},{checkpoint:a.checkpoint,reply:{value:'새 자료',waitId:a.wait!.id}});
    assert.equal(b.status,'completed');assert.equal(b.output,'새 자료');assert.equal(calls,1);
  }
});

test('저장된 회신 번호와 기한은 재개해도 유지되고, 기한 없는 질문은 계속 대기한다', async t => {
  const start = Date.parse('2030-01-01T00:00:00.000Z');
  t.mock.timers.enable({apis:['Date'],now:start});
  // These prompt IDs and the legacy wait's default deadline were issued before form deadlines existed.
  const legacyWaitId = 'root/stage#55ee7f73782e7c065da9e2fb';
  const legacyQuestionId = 'root/stage#02fba0ee346663e56cdf7535';
  const waitGraph = simple('control.wait',{prompt:'기존 질문'});
  const wait = await run(waitGraph,'요청');
  assert.equal(wait.wait?.id,legacyWaitId);
  assert.equal(wait.wait.expiresAt,'2030-01-01T01:00:00.000Z');
  t.mock.timers.setTime(start+30*60_000);
  const restored = await run(waitGraph,'요청',{}, {checkpoint:wait.checkpoint});
  assert.deepEqual(restored.wait,wait.wait);
  const accepted = await run(waitGraph,'요청',{}, {checkpoint:restored.checkpoint,reply:{waitId:legacyWaitId,value:'회신'}});
  assert.equal(accepted.output,'회신');

  // timeoutMinutes was never a form setting. Previously imported metadata must not start a timer.
  for (const config of [{timeoutMinutes:20},{replyTimeoutMinutes:0}]) {
    const question = simple('input.form',{prompt:'기존 질문',...config});
    const pending = await run(question,'요청');
    assert.equal(pending.wait?.id,legacyQuestionId);
    assert.equal(pending.wait.expiresAt,undefined);
    t.mock.timers.setTime(Date.now()+24*60*60_000);
    const completed = await run(question,'요청',{}, {checkpoint:pending.checkpoint,reply:{waitId:legacyQuestionId,value:'다음 날 회신'}});
    assert.equal(completed.output,'다음 날 회신');
  }
});

test('사람 검토에는 연결한 초안이 보이며 기존 문구에 삽입한 초안은 중복되지 않는다', async () => {
  const draft='이번 토요일에는 오후 4시에 닫습니다.';
  const prompt='마감 시각을 확인해 주세요.';
  const graph=simple('review.human',{prompt});
  const waiting=await run(graph,draft);
  assert.equal(waiting.wait?.reviewDraft,draft);
  assert.equal(waiting.wait.prompt,prompt);
  const oldCheckpoint=structuredClone(waiting.checkpoint);
  delete oldCheckpoint.waits[waiting.wait.id].reviewDraft;
  const restored=await run(graph,draft,{}, {checkpoint:oldCheckpoint});
  assert.equal(restored.wait?.id,waiting.wait.id);
  assert.equal(restored.wait.reviewDraft,draft);
  const replied=await run(graph,draft,{}, {checkpoint:oldCheckpoint,reply:{waitId:waiting.wait.id,value:'시각 확인 완료'}});
  assert.equal(replied.output,'시각 확인 완료');
  const inline=await run(simple('review.human',{prompt:prompt+' {{input}}'}),draft);
  assert.equal(inline.wait?.prompt,prompt+' '+draft);
  assert.equal(inline.wait.reviewDraft,null);
});

test('기한 내에 도착한 양식 회신에도 필수 항목 검사를 적용한다', async () => {
  const question = simple('input.form',{prompt:'수령 지점을 입력하세요.',fields:['지점'],replyTimeoutMinutes:30});
  const pending = await run(question,'예약');
  assert.ok(pending.wait?.expiresAt);
  const receivedAt = Date.parse(pending.wait.expiresAt)-1;
  const resume = (value:string) => run(question,'예약',{}, {checkpoint:pending.checkpoint,reply:{waitId:pending.wait!.id,value,receivedAt}});
  const missing = await resume('{}');
  assert.equal(missing.status,'waiting');
  assert.equal(missing.wait?.id,pending.wait.id);
  assert.match(missing.wait?.fieldError ?? '',/필수 항목.*지점/);
  const filled = await run(question,'예약',{}, {checkpoint:missing.checkpoint,
    reply:{waitId:pending.wait.id,value:'{"지점":"중앙관"}',receivedAt}});
  assert.deepEqual(filled.checkpoint.steps['root/stage'].values.value,{지점:'중앙관'});
});

test('병렬 담당자가 동시에 시작하고 실패한 하나의 원인과 확인된 답을 모은다',async()=>{
  const nodes=[src,block('parallel','control.parallel',{maxConcurrency:2}),block('a','agent.delegate',{role:'시간',instruction:'시간 담당'}),
    block('b','agent.handoff',{role:'준비물',instruction:'준비물 담당'}),block('join','control.join',{partialFailure:'report'}),out];
  const edges=[...wire('q','parallel'),...wire('parallel','a'),...wire('parallel','b'),...wire('a','join'),...wire('b','join'),...wire('join','out')];
  let active=0,peak=0;
  const res=await run({nodes,edges},'방문 안내',{model:async req=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,8));active--;
    if(req.instruction.includes('준비물'))throw Error('조회 오류');return {text:'10시~16시'};
  }});
  assert.equal(res.status,'completed');assert.equal(peak,2);assert.match(res.output,/10시~16시/);
  assert.match(res.output,/조회 오류/);assert.equal(res.events.filter(x=>x.nodeId==='out'&&x.kind==='result').length,1);
});

test('제목과 본문 형식은 여러 필드와 중첩 목록을 연결 순서대로 표시하고 일부 실패 정책을 따른다',async()=>{
  const joinNode=block('join','control.join',{merge:'sections',partialFailure:'report'});
  const graph=linear([src,block('read','document.read',{format:'json'}),joinNode,out]);
  const values=['최종 안내문',[{근거:{원문:'토요일은 오후 4시에 닫습니다.'},담당:['가','나']}],{error:'검토 기한 만료',role:'다른 검토자'}];
  const result=await run(graph,JSON.stringify(values));
  assert.equal(result.output,'최종 안내문\n\n근거\n원문\n토요일은 오후 4시에 닫습니다.\n\n담당\n가\n\n나\n\nerror\n검토 기한 만료\n\nrole\n다른 검토자');
  joinNode.config.partialFailure='fail';
  assert.equal((await run(graph,JSON.stringify(values))).status,'completed');
});

test('동적 Agent 상한 초과에서 선택 전 0명, 선택 후 정확히 세 담당자만 생성된다',async()=>{
  const g=simple('agent.create_dynamic',{role:'조사',instruction:'지점 확인',maxCreatedAgents:3,maxInFlightAgents:2});
  const a=await run(g,'서울,인천,대구,부산');assert.equal(a.status,'waiting');assert.equal(a.checkpoint.counts.agents,0);
  const b=await run(g,'서울,인천,대구,부산',{}, {checkpoint:a.checkpoint,reply:{value:'서울,대구,부산'}});
  assert.equal(b.status,'completed');assert.equal(b.checkpoint.counts.agents,3);
  const selectionResult = JSON.parse(b.output);
  assert.deepEqual(selectionResult.excluded,['인천']);
  assert.deepEqual(selectionResult.selection,{reason:'creation_limit',requestedCount:4,selectedCount:3});
});

test('검색 후보가 있어도 실제 인용을 찾지 못하면 답할 근거가 없다고 분기한다',async()=>{
  const search=block('search','knowledge.search'),evidence=block('check','quality.evidence'),doc=block('doc','resource.context',{content:'회원증 문의는 안내데스크에서 처리합니다.',version:'2'});
  const yes=block('yes','ai.single_task'),no=block('no','input.form',{prompt:'준비물 안내문을 보내 주세요.'});
  const g={nodes:[src,doc,search,evidence,yes,no,out],edges:[...wire('q','search'),edge('doc','search','reference','ref','context'),...wire('search','check'),
    edge('q','check','data','value','question'),...wire('check','yes','verified'),...wire('check','no','insufficient'),...wire('yes','out'),...wire('no','out')]};
  const r=await run(g,'회원증 준비물',{model:async()=>({text:JSON.stringify({status:'verified',references:[{index:0,quote:'신분증을 가져오세요.'}]})})});
  assert.equal(r.status,'waiting');assert.equal(r.wait?.kind,'question');
  assert.equal(r.checkpoint.steps['root/yes'].state,'skipped');assert.equal(r.checkpoint.steps['root/check'].routes[0],'insufficient');
});

test('승인한 요청과 인자를 결합하고 다른 인자는 다시 승인받는다',async()=>{
  const book={book:'책 한 권',branch:'중앙'},approve=block('confirm','approval.action',{tool:'reservations.create',args:book});
  const target=block('create','tool.invoke',{tool:'reservations.create',args:book});
  const g={nodes:[src,approve,target,out],edges:[...wire('q','confirm'),...wire('confirm','create','approved'),...wire('create','out')]};
  const seen:unknown[]=[];
  const tool:EngineServices['tool']=async(name,args,action)=>{seen.push([name,args,action]);return {reservationId:'R-1'};};
  const a=await run(g,'예약',{tool});assert.equal(a.status,'waiting');assert.ok(a.wait?.operation);
  const b=await run(g,'예약',{tool},{checkpoint:a.checkpoint,reply:{value:'예',approved:true}});
  assert.equal(b.status,'completed');assert.equal(seen.length,1);assert.match(b.output,/R-1/);
  const changed=structuredClone(g);changed.nodes.find(n=>n.id==='create')!.config.args={...book,branch:'서부'};
  const c=await run(changed,'예약',{tool},{checkpoint:a.checkpoint,reply:{value:'예',approved:true}});
  assert.equal(c.status,'waiting');assert.equal(c.wait?.operation?.args.branch,'서부');assert.equal(seen.length,1);
});

test('중지 플래그는 이미 보내진 작업의 후속 호출을 막고 요청 식별자를 남긴다',async()=>{
  let stopped=false,calls=0;
  const tool:EngineServices['tool']=async()=>{calls++;stopped=true;return {reservationId:'R-3'};};
  const g=linear([src,block('reserve','tool.invoke',{tool:'reservations.create',args:{book:'한 권'}}),block('later','tool.invoke',{tool:'reservations.list'}),out]);
  const a=await run(g,'예약',{tool,isStopped:()=>stopped});
  const b=await run(g,'예약',{tool,isStopped:()=>stopped},{checkpoint:a.checkpoint,reply:{value:'예',approved:true}});
  assert.equal(b.status,'stopped');assert.equal(calls,1);
  assert.ok(b.events.some(e=>e.kind==='tool'&&e.nodeId==='reserve'));assert.ok(!b.events.some(e=>e.nodeId==='later'));
});

test('nested teams, reusable Workflow, calls selected by Agent, and bounded repetitions use child graph outputs',async()=>{
  const child=linear([src,block('echo','ai.single_task'),out]);
  for(const type of ['agent.team','workflow.call','control.loop']){
    const result=await run(simple(type,{},child),'회의');
    assert.equal(result.status,'completed');assert.match(result.output,/모델 결과: 회의/);
    assert.equal(result.events.filter(e=>e.nodeId==='echo'&&e.kind==='result').length,1);
  }
  const g=simple('agent.task',{maxSteps:3});g.nodes.push(block('nested','workflow.tool',{name:'summarize'},child));
  g.edges.push(edge('nested','stage','reference','ref','workflow'));
  const res=await run(g,'상담',{model:async req=>req.tools.length&&!req.context.includes('tool')?{text:'',tool:{name:'workflow.summarize',args:{note:'확인'}}}:{text:'완료'}});
  assert.equal(res.status,'completed');assert.equal(res.output,'완료');
});

test('파일을 자동으로 읽고 CSV로 다시 저장하면 열과 인용된 셀 내용을 보존한다',async()=>{
  const graph=linear([block('file','file.input'),block('read','document.read',{format:'auto'}),block('csv','file.create',{format:'csv',fileName:'복사.csv'}),out]);
  const save=async(fileName:string,content:string)=>{
    const result=await run(graph,JSON.stringify({fileName,content,question:'표 저장'}));
    assert.equal(result.status,'completed',result.error??'CSV 실행 결과');
    return result.checkpoint.steps['root/csv'].values.value as {content:string};
  };
  const table='"지점","안내"\r\n"중앙,본관","1층 ""안내""\n데스크"\r\n""';
  assert.equal((await save('운영표.CSV',table)).content,table);
  const objects=[{지점:'중앙관',권수:3},{지점:'분관',비고:'4층'}];
  assert.equal((await save('운영표.JSON',JSON.stringify(objects))).content,'"지점","권수","비고"\r\n"중앙관","3",""\r\n"분관","","4층"');
});

test('구조화된 입력, 변환, 검사, 문서 읽기와 파일 생성은 실제 값을 전달한다',async()=>{
  const file=block('file','file.input',{fileName:'회의.json',content:'{"decision":"승인"}',accept:'.json'});
  const g=linear([file,block('read','document.read',{format:'json'}),block('validator','data.validate',{requiredFields:['decision'],types:{decision:'string'}}),
    block('transform','data.transform',{operation:'rename',path:'decision',target:'결정'}),block('export','file.create',{format:'json',fileName:'결과.json'}),out]);
  const result=await run(g,JSON.stringify({fileName:'실제.json',content:'{"decision":"승인"}'}));assert.equal(result.status,'completed');
  assert.deepEqual(JSON.parse(result.output),{결정:'승인'});
  assert.equal(result.checkpoint.steps['root/export'].values.value && (result.checkpoint.steps['root/export'].values.value as {fileName:string}).fileName,'결과.json');
});

test('기억 저장·조회, 가림, 평가, 후보 선택, 문맥 압축과 보상 작업',async()=>{
  const memory=new Map<string,string>();
  const mem:EngineServices['memory']=async(k,v)=>{if(v!==undefined)memory.set(k,v);return memory.get(k);};
  const written=await run(simple('memory.access',{operation:'write',key:'meeting'}),'회의',{memory:mem});
  const read=await run(simple('memory.access',{operation:'read',key:'meeting'}),'불러오기',{memory:mem});
  assert.equal(written.output,read.output);
  const redacted=await run(simple('safety.redact',{operation:'mask',categories:['email']}),'mail a@b.kr');
  assert.match(redacted.output,/가림/);assert.ok(!redacted.output.includes('a@b.kr'));
  const evaluated=await run(simple('quality.evaluate',{criterion:'정확',threshold:90}),'초안',{model:async()=>({text:'{"score":80,"reason":"보완"}'})});
  assert.equal(JSON.parse(evaluated.output).passed,false);
  const selection = {model:async()=>({text:'{"choices":["B","허용되지 않음","B","A","C"]}'})};
  const candidate = await run(simple('agent.select_candidate',{candidates:['A','B','C'],criterion:'적합한 담당자'}),'질문',selection);
  assert.equal(candidate.status,'completed');
  assert.equal(candidate.checkpoint.steps['root/stage'].values.value,'B');
  const order = await run(simple('agent.coordinate',{tasks:['A','B','C'],goal:'필요한 작업 순서',maxSteps:2}),'질문',selection);
  assert.equal(order.status,'completed');
  assert.deepEqual(order.checkpoint.steps['root/stage'].values.value,['B','A']);
  const compressed=await run(simple('context.compress',{preserve:'제목',maxLength:60}),'아주 긴 자료',{model:async()=>({text:'제목'})});assert.equal(compressed.output,'제목');
  const undo=simple('error.compensate',{tool:'reservations.cancel',args:{reservationId:'R-1'}});
  const comp=await run(undo,'복구');
  assert.equal(comp.status,'waiting');assert.equal(comp.wait?.operation?.tool,'reservations.cancel');
  let calls=0;
  const completed=await run(undo,'복구',{tool:async(name,args,action)=>{
    assert.equal(name,'reservations.cancel');assert.deepEqual(args,{reservationId:'R-1'});assert.equal(action.approved,true);
    calls++;return {status:'cancelled'};
  }},{checkpoint:comp.checkpoint,reply:{waitId:comp.wait!.id,value:'취소 승인',approved:true}});
  assert.equal(completed.status,'completed');assert.equal(calls,1);
});

test('일정·이벤트 트리거는 일치하는 기동 원인만 통과시키고 명시적 종료가 결과를 전달한다',async()=>{
  for(const kind of ['schedule','event'] as const){
    const trigger=block('trigger','control.trigger',{trigger:kind,event:'opened'});
    const g=linear([trigger,block('end','control.terminate',{status:'success',message:'종료 확인'})]);
    const r=await run(g,'자료',{}, {trigger:{kind,name:'opened',scheduledAt:'2026-11-21T00:00:00Z'}});
    assert.equal(r.status,'completed');assert.equal(r.output,'종료 확인');
    const manual=await run(g,'자료');assert.equal(manual.status,'failed');
  }
});

test('기존 답변 블록은 저장된 양식 회신의 구조와 최종 입력 연결을 보존한다', async () => {
  const form = block('form','input.form',{prompt:'지점과 수량을 입력하세요.',fields:['지점','수량']});
  const answer = block('end','output.answer',{format:'json'});
  const graph = linear([src,form,answer]);
  assert.throws(() => runnable({...graph,edges:graph.edges.filter(e => e.to !== 'end' || e.kind !== 'data')}), /입력값/);
  const waiting = await run(runnable(graph),'원래 질문');
  assert.equal(waiting.status,'waiting');
  const reply = {지점:'중앙관',수량:2};
  const resumed = await run(graph,'원래 질문',{},{
    checkpoint:JSON.parse(JSON.stringify(waiting.checkpoint)),
    reply:{waitId:waiting.wait!.id,value:JSON.stringify(reply)},
  });
  assert.equal(resumed.status,'completed');
  assert.deepEqual(JSON.parse(resumed.output),reply);
  assert.deepEqual(resumed.checkpoint.steps['root/end'].values.value,reply);
  assert.equal(resumed.events.find(e => e.nodeId === 'end' && e.kind === 'result')?.blockType,'output.answer');
});

test('기존 종료 블록은 값 연결이 선택 사항이며 완료·중지·실패의 실행 상태를 보존한다', async () => {
  for (const [status,expectedState] of [['success','completed'],['cancelled','stopped'],['failed','failed']]) {
    const graph = {nodes:[src,block('end','control.terminate',{status,message:'종료 안내'})],edges:[edge('q','end')]};
    const result = await run(runnable(graph),'원래 요청');
    assert.equal(result.status,expectedState);
    assert.ok(result.events.some(e => e.nodeId === 'end' && e.blockType === 'control.terminate'));
    if (status === 'success') assert.equal(result.output,'종료 안내');
    if (status === 'failed') assert.equal(result.error,'종료 안내');
  }
  const graph = linear([src,block('read','document.read',{format:'json'}),block('end','control.terminate',{status:'success',message:''})]);
  const result = await run(runnable(graph),'{"수량":2}');
  assert.equal(result.status,'completed');
  assert.deepEqual(result.checkpoint.steps['root/end'].values.value,{수량:2});
});

test('오류 처리의 계속·기존 안내·대체 경로는 같은 값을 전달하고 중단은 후속 답변을 건너뛴다', async () => {
  const validate = block('check','data.validate',{requiredFields:['지점']});
  for (const strategy of ['continue','report','fallback','stop']) {
    for (const message of ['', '필수 항목을 확인하세요.']) {
      const handler = block('handle','error.handle',{strategy,message});
      const graph = linear([src,validate,handler,out]);
      const success = block('success','output.answer');
      graph.nodes.push(success);
      graph.edges.push(...wire('check','success'));
      const result = await run(runnable(graph),'{}');
      const steps = result.checkpoint.steps;
      assert.equal(steps['root/check'].state,'failed');
      assert.equal(steps['root/success'].state,'skipped');
      if (strategy === 'stop') {
        assert.equal(result.status,'failed');
        assert.equal(steps['root/handle'].error,message || steps['root/check'].error);
        assert.equal(steps['root/out'].state,'skipped');
      } else {
        assert.equal(result.status,'completed');
        const expected = message || {error:steps['root/check'].error,role:'check'};
        assert.deepEqual(steps['root/out'].values.value,expected);
        assert.deepEqual(message ? result.output : JSON.parse(result.output),expected);
      }
    }
  }
});

test('검색 자산 준비·색인과 조건 분기, 오류 처리, MCP 참조',async()=>{
  const g=linear([src,block('index','knowledge.manage',{operation:'index',version:'2'}),out]);
  g.nodes.push(block('document','resource.context',{content:'자료 한 줄\n둘째 줄'}));
  g.edges.push(edge('document','index','reference','ref','context'));
  const r=await run(g,'');const indexed=JSON.parse(r.output);
  assert.equal(indexed.lines,2);assert.equal(indexed.documents[0].version,'1');
  assert.equal(indexed.index[0].passage.indexVersion,'2');
  const branch=block('branch','control.branch',{operator:'contains',expected:'예약'});
  const check=block('validate','data.validate',{requiredFields:['reservationId']});
  const handle=block('handle','error.handle',{strategy:'fallback',message:'예약 번호 추가 필요'});
  const tool=block('tool','tool.invoke',{tool:'reservations.list'}),mcp=block('mcp','connection.mcp',{server:'도서관'});
  const graph={nodes:[src,branch,check,handle,tool,mcp,out],edges:[...wire('q','branch'),...wire('branch','validate','yes'),...wire('validate','handle'),
    ...wire('handle','out'),...wire('branch','tool','no'),edge('mcp','tool','reference','ref','mcp'),...wire('tool','out')]};
  const handled=await run(graph,'예약');assert.equal(handled.output,'예약 번호 추가 필요');assert.equal(handled.status,'completed');
  const direct=await run(graph,'다른 요청',{tool:async()=>({count:2})});assert.equal(direct.status,'completed');assert.equal(JSON.parse(direct.output).count,2);
  assert.ok(direct.events.find(e=>e.nodeId==='tool'&&e.kind==='start')?.data);
});

test('Agent 도구형 검색은 고정 자료에서 검색하고 다른 도구를 임의 호출하지 않는다',async()=>{
  const g=simple('agent.task',{allowedTools:['knowledge.search'],maxSteps:3});
  g.nodes.push(block('rules','resource.context',{content:'한 사람의 대출 한도는 3권입니다.'}));
  g.edges.push(edge('rules','stage','reference','ref','context'));
  let calls=0;
  const res=await run(g,'책을 몇 권까지 빌릴 수 있나요?',{allowedTools:['knowledge.search'],model:async()=>{
    if(++calls===1)return {tool:{name:'knowledge.search',args:{query:'책을 몇 권까지 빌릴 수 있나요?'}},text:''};return {text:'근거 확인'};
  }});
  assert.equal(res.status,'completed');const event=res.events.find(e=>e.kind==='lookup')!;assert.match(JSON.stringify(event.data),/3권/);
  const denied=await run(g,'예약',{allowedTools:['knowledge.search'],model:async()=>({text:'',tool:{name:'reservations.create',args:{book:'책'}}})});assert.equal(denied.status,'failed');assert.match(denied.error!,/허용되지/);
});

test('초급 실습의 안내 파일은 내 사본의 규정으로 작성한 답변과 인용을 그대로 담는다',async()=>{
  const lesson=templates.find(item=>item.id==='beginner')!;
  const copy=createProject(designer,{lesson:lesson.id});
  const check=async(graph:Graph,limit:number)=>{
    const quote='한 사람의 대출 한도는 '+limit+'권입니다.';
    const expected=limit+'권까지 빌릴 수 있습니다.\n“'+quote+'”';
    const result=await run(graph,lesson.question,{model:async request=>{
      assert.equal(request.input,lesson.question);
      assert.match(request.instruction,/사용한 원문을 한 문장 인용/);
      assert.ok(request.context.includes(quote));
      return {text:expected};
    }});
    assert.equal(result.status,'completed',result.error??'초급 실습 실행');
    assert.equal(result.output,expected);
    assert.deepEqual(result.checkpoint.steps['root/file'].values.value,{
      fileName:'대출안내.txt',format:'text',content:result.output,
    });
  };
  const graph=copy.graph!;
  await check(graph,3);
  const rules=graph.nodes.find(node=>node.id==='rules')!;
  rules.config.content=rules.config.content.replace('3권','5권');
  saveProject(designer,{id:copy.id,revision:copy.revision,title:copy.title,graph});
  await check(openProject(designer,copy.id).graph!,5);
  await check(createProject(designer,{lesson:lesson.id}).graph!,3);
});

test('도서관 여덟 실습 사본에서 추가 질문·도구·자료판이 전달되는 경로를 확인한다', async()=>{
  for(const lesson of libraryTemplates){
    const graph=createProject(designer,{lesson:lesson.id}).graph!;
    const calls:ModelInput[]=[];
    const model:EngineServices['model']=async req=>{
      calls.push(req);
      if(req.instruction.includes('"category"'))return {text:'{"category":"규정"}'};
      if(req.instruction.includes('"references"'))return {text:'{"status":"insufficient","references":[],"reason":"질문을 뒷받침하는 자료 없음"}'};
      return {text:'테스트 어댑터 결과 '+req.input.slice(0,24)};
    };
    const reservationTool=graph.nodes.find(node=>node.id==='lookup')?.config.tool;
    const adapters:Partial<EngineServices>={
      model,
      asset:async(id,version)=>{
        const entry=readAsset(designer,id,version);
        return {id,title:entry.asset.name,version:String(entry.version),content:entry.payload.content};
      },
      isReadOnlyTool:name=>name===reservationTool,
      tool:async(name,_args,action)=>{
        assert.equal(name,'mcp.'+action.connector?.assetId+'.reservations.list');
        return {reservations:[{book:'어린 왕자',branch:'중앙도서관'}]};
      },
    };
    let r=await run(graph,lesson.question,adapters);
    if(lesson.id==='intermediate'){
      assert.equal(r.status,'waiting');assert.ok(r.events.find(e=>e.kind==='lookup'));
      r=await run(graph,lesson.question,adapters,{checkpoint:r.checkpoint,reply:{value:'중앙점 안내문에 14일이라고 적혀 있습니다.'}});
      assert.ok(calls.some(c=>c.context.includes('분실물')&&c.input.includes('14일')));
    }
    assert.equal(r.status,'completed',lesson.id+' '+r.error);assert.ok(r.output&&calls.length>0);
    if(lesson.id==='parallel'){assert.equal(r.events.filter(e=>e.kind==='lookup').length,2);assert.equal(r.events.filter(e=>e.nodeId==='team'&&e.kind==='result').length,1);}
    if(lesson.id==='peer-review')assert.equal(r.events.filter(e=>e.nodeId.startsWith('review-')&&e.kind==='result').length,2);
    if(lesson.id==='dynamic')assert.equal(r.checkpoint.counts.agents,4);
    if(lesson.id==='beginner')assert.match(calls[0].instruction,/SKILL|근거 인용/);
    if(lesson.id==='library-visit'){
      assert.equal(calls.length,1);
      assert.match(calls[0].instruction,/방문 시간, 준비물, 예약 내역 순서/);
      assert.match(calls[0].input,/토요일 오전 10시부터 오후 4시/);
      assert.match(calls[0].input,/어린 왕자/);
      assert.ok(calls[0].context.includes(lesson.question));
      assert.match(calls[0].context,/회원증이 필요합니다/);
      assert.doesNotMatch(calls[0].context,/등록된 학생증/);
      graph.nodes.find(node=>node.id==='pickup')!.config.version='2';
      const second=await run(graph,lesson.question,adapters);
      assert.equal(second.status,'completed',second.error ?? '수령 규정 2판 실습 실행');
      assert.equal(calls[1].instruction,calls[0].instruction);
      assert.equal(calls[1].input,calls[0].input);
      assert.match(calls[1].context,/등록된 학생증도 가능합니다/);
      assert.doesNotMatch(calls[1].context,/회원증이 필요합니다/);
    }
  }
});

test('고정 자료판을 색인·승인 후 발행하고 원문 위치를 조회하며, 철회한 자료판은 조회하지 않는다',async()=>{
  const cache=new Map<string,string>(),memory:EngineServices['memory']=async(key,value)=>{
    if(value!==undefined)cache.set(key,value);return cache.get(key);
  };
  const service={memory};
  function manage(operation:string){
    const g=simple('knowledge.manage',{operation,storeKey:'규정',version:'2026-11'});
    if(operation==='prepare'){g.nodes.push(block('rules','resource.context',{content:'신분증을 가져오세요.\n대출 한도는 5권입니다.'}));g.edges.push(edge('rules','stage','reference','ref','context'));}
    return g;
  }
  for(const operation of ['publish','withdraw']){
    const unnamed=manage(operation);unnamed.nodes[1].config.storeKey=' ';
    assert.throws(()=>runnable(unnamed),/자료집 이름/);
    const direct=await run(unnamed,'',service);
    assert.equal(direct.status,'failed');assert.match(direct.error!,/자료집 이름/);
  }
  assert.match((await run(manage('withdraw'),'',service)).error!,/철회할 발행 자료판/);
  const prepared=await run(manage('prepare'),'',service);assert.equal(prepared.status,'completed');
  const indexed=await run(manage('index'),'',service);assert.equal(JSON.parse(indexed.output).lines,2);
  const query=simple('knowledge.search',{storeKey:'규정',version:'2026-11',topK:2});
  assert.equal((await run(query,'대출 한도',service)).status,'failed');
  const pub=await run(manage('publish'),'',service);assert.equal(pub.wait?.kind,'approval');
  const ignoreRelease:EngineServices['memory']=(key,value)=>memory(key,key.includes(':release:')?undefined:value);
  const lost=await run(manage('publish'),'',{memory:ignoreRelease},{checkpoint:pub.checkpoint,reply:{value:'예',approved:true}});
  assert.equal(lost.status,'failed');assert.match(lost.error!,/저장하지 못했습니다/);
  assert.ok(![...cache.keys()].some(key=>key.includes(':published-digest:')));
  assert.equal((await run(manage('publish'),'',service,{checkpoint:pub.checkpoint,reply:{value:'예',approved:true}})).status,'completed');
  assert.match((await run(manage('publish'),'',service)).error!,/이미 발행/);
  const search=await run(query,'대출 한도',service);assert.match(search.output,/5권/);assert.match(search.output,/2행/);
  const remove=await run(manage('withdraw'),'',service);
  assert.equal((await run(manage('withdraw'),'',service,{checkpoint:remove.checkpoint,reply:{value:'예',approved:true}})).status,'completed');
  assert.equal((await run(manage('withdraw'),'',service,{checkpoint:remove.checkpoint,reply:{value:'예',approved:true}})).status,'completed');
  assert.match((await run(manage('withdraw'),'',service)).error!,/철회할 발행 자료판/);
  assert.equal((await run(query,'대출 한도',service)).status,'failed');
});

test('값 변환에 없는 항목은 해당 블록에서 오류로 처리하고, 존재하는 빈 값도 그대로 전달한다',async()=>{
  const g=simple('data.transform',{operation:'select',path:'자료.관수'});
  const input=JSON.stringify({자료:{권수:0}});
  const failed=await run(runnable(g),input);
  assert.equal(failed.status,'failed');
  assert.match(failed.error!,/stage.*자료\.관수/);
  assert.equal(failed.checkpoint.steps['root/out'].state,'skipped');
  g.nodes.push(block('handler','error.handle',{strategy:'continue',message:'항목을 확인하세요.'}),block('notice','output.answer'));
  g.edges.push(...wire('stage','handler'),...wire('handler','notice'));
  assert.equal((await run(runnable(g),input)).output,'항목을 확인하세요.');
  g.nodes[1].config.path='자료.권수';
  for(const value of [0,false,'',null]){
    const result=await run(g,JSON.stringify({자료:{권수:value}}));
    assert.equal(result.status,'completed');
    assert.equal(result.checkpoint.steps['root/out'].values.value,value);
    assert.equal(result.checkpoint.steps['root/handler'].state,'skipped');
  }
});

test('저장된 분류 이름 양끝에 공백이 있어도 기존 출력 연결로 실행한다',async()=>{
  const g=simple('ai.classify',{categories:[' 연장 ']});
  const category=g.edges.find(e=>e.from==='stage'&&e.kind==='flow')!;
  category.out='category: 연장 ';
  g.edges.push({...category,id:'fallback',out:'other'});
  const result=await run(runnable(g),'책을 더 빌리고 싶어요',{model:async()=>({text:'{"category":"연장"}'})});
  assert.equal(result.status,'completed');
  assert.deepEqual(result.checkpoint.steps['root/stage'].routes,['category: 연장 ']);
});

test('실제 검색 결과에 없는 최종 인용은 보류하며 참조된 제목·자료판·위치는 원문에서 가져온다',async()=>{
  const q='대출 기간',g=linear([src,block('lookup','knowledge.search'),block('ai','ai.single_task'),out]);
  g.nodes.push(block('document','resource.context',{version:'3',content:'대출 기간은 14일입니다.'}));
  g.edges.push(edge('document','lookup','reference','ref','context'));
  const mismatch=await run(g,q,{model:async()=>({text:JSON.stringify({answer:'기간은 20일',references:[{index:0,quote:'20일'}]})})});
  assert.ok(!mismatch.output.includes('20일'));assert.match(mismatch.output,/근거/);
  const ok=await run(g,q,{model:async request=>({text:request.instruction.includes('완료 판정:')?'{"status":"met","reason":"원문과 일치"}':
    JSON.stringify({answer:'14일입니다.',references:[{index:0,quote:'대출 기간은 14일입니다.'}]})})});
  assert.match(ok.output,/14일/);assert.match(ok.output,/document \(3판, 1행\)/);
});

test('잘못된 지점 수로 회신한 뒤 같은 실행에서 새 질문 번호로 다시 선택한다',async()=>{
  const g=simple('agent.create_dynamic',{role:'담당자',maxCreatedAgents:2});
  const a=await run(g,'A,B,C');const b=await run(g,'A,B,C',{}, {checkpoint:a.checkpoint,reply:{value:'A'}});
  assert.equal(b.status,'waiting');assert.notEqual(b.wait?.id,a.wait?.id);assert.equal(b.checkpoint.counts.agents,0);
  const result=await run(g,'A,B,C',{}, {checkpoint:b.checkpoint,reply:{waitId:b.wait?.id,value:'A,C'}});
  assert.equal(result.status,'completed');assert.deepEqual(JSON.parse(result.output).excluded,['B']);
});

test('한 분기에서 기다리는 동안 같은 병렬 작업의 다른 경로가 완료되고 재개 후 다시 실행되지 않는다',async()=>{
  const nodes=[src,block('split','control.parallel',{maxConcurrency:1}),block('wait','input.form',{prompt:'답을 주세요'}),
    block('other','ai.single_task'),block('join','control.join'),out];
  const g={nodes,edges:[...wire('q','split'),...wire('split','wait'),...wire('split','other'),...wire('wait','join'),...wire('other','join'),...wire('join','out')]};
  let calls=0;const service={model:async()=>{calls++;return {text:'다른 경로 결과'};}};
  const a=await run(g,'보류 시험',service);assert.equal(a.status,'waiting');assert.equal(calls,1);
  const done=await run(g,'보류 시험',service,{checkpoint:a.checkpoint,reply:{value:'회신'}});
  assert.equal(done.status,'completed');assert.equal(calls,1);assert.match(done.output,/회신/);assert.match(done.output,/다른 경로/);
});
