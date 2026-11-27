import assert from 'node:assert/strict';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {createBlock} from '../src/domain/graph';
import {swTeamTemplates} from '../src/domain/sw-team-templates';
import type {Edge, Graph} from '../src/domain/types';
import {parallelInstructions} from '../src/server/agent-parallel-instructions';
import {buildAgentZip} from '../src/server/agent-zip';
import {executeGraph} from '../src/engine';

const block = (id: string, type: string, config = {}) => createBlock(type, {id, title:id, config});
function edge(from: string, to: string, kind: 'data' | 'flow' = 'flow'): Edge {
  return {id:[from,to,kind].join('-'), from, to, kind, out:kind === 'data' ? 'value' : 'next', input:kind === 'data' ? 'input' : 'in'};
}

test('실제 코드 검토 ZIP에서 두 위임 호출을 시작한 뒤 결과를 기다리고 두 의견을 합류에 전달한다', () => {
  const template = swTeamTemplates.find(item => item.id === 'sw-code-review')!;
  const files = unzipSync(buildAgentZip({title:template.title, graph:template.graph, resources:[], files:[]}));
  const pages = Object.entries(files).filter(([path]) => path === 'AGENTS.md' || /^workflow\/step-/.test(path))
    .map(([,data]) => strFromU8(data));
  const fork = pages.find(text => text.includes('같은 차수의 위임을 모두 시작한 뒤'))!;
  assert.ok(fork);
  assert.match(fork, /최대 2개/);
  assert.match(fork, /‘두 검토 의견 모으기’ \(join\)/);
  const join = pages.find(text => text.includes('전달된 입력값을 연결 순서대로'))!;
  assert.ok(join);
  assert.match(join, /‘개발자의 코드 검토’ \(developer\) → ‘QA의 시험 사례 검토’ \(qa\)/);
  assert.match(join, /합류를 실패로 처리/);
  assert.match(join, /줄바꿈으로 이어 붙인 텍스트/);
});

test('병렬 제한은 그래프 안의 첫 합류까지 적용하고, 합류 입력 순서는 연결 종류를 따른다', () => {
  const graph: Graph = {nodes:[
    block('outer','control.parallel',{maxConcurrency:0,failurePolicy:'stop'}),
    block('inner','control.parallel',{maxConcurrency:3}),
    block('a','agent.delegate'), block('b','agent.delegate'), block('c','ai.single_task'),
    block('first','control.join',{merge:'sections',partialFailure:'report'}), block('last','control.join'),
  ], edges:[
    edge('outer','inner'), edge('outer','c'), edge('inner','a'), edge('inner','b'),
    edge('a','first'), edge('b','first'), edge('b','first','data'), edge('a','first','data'),
    edge('first','last'), edge('c','last'),
  ]};
  const notes = parallelInstructions(graph);
  const outer = notes.get('outer')!.join('\n'), inner = notes.get('inner')!.join('\n');
  assert.match(outer, /최대 1개/);
  assert.match(outer, /새 작업을 중단/);
  assert.match(outer, /호출 부모의 오류 처리기와 후속 합류를 건너뛰고/);
  assert.match(outer, /‘first’/);
  assert.match(outer, /‘last’/);
  assert.match(inner, /최대 3개/);
  assert.match(inner, /‘first’/);
  assert.doesNotMatch(inner, /‘last’/);
  const join = notes.get('first')!.join('\n');
  assert.match(join, /입력값을 연결 순서대로 모으세요 — ‘b’ \(b\) → ‘a’ \(a\)/);
  assert.match(join, /실행 경로의 결과를 연결 순서대로 모으세요 — ‘a’ \(a\) → ‘b’ \(b\)/);
  assert.match(join, /조건에서 제외된 경로는 건너뛰세요/);
  assert.match(join, /직접 연결한 데이터선은 선택한 출구와 관계없이/);
  assert.match(join, /정상 결과에 error 또는 role 필드/);
  assert.match(join, /팀의 최종 응답 담당/);
  assert.match(join, /회신 후 이어가고 이미 완료한 작업의 결과는 재사용/);
  assert.match(join, /사유\(error\).*성공한 결과와 함께 보존/);
  assert.match(join, /항목 이름을 제목으로/);
  assert.match(notes.get('last')!.join('\n'), /자료형을 유지한 목록/);
});

test('분할 ZIP의 하위 종료는 현재 항목을 반복 제어 단계에 돌려주고 모든 항목 뒤에 부모 경로를 진행한다',()=>{
  const loop=block('iterate','control.loop');
  loop.graph={nodes:[block('item','input.user_request'),block('result','output.answer')],edges:[edge('item','result'),edge('item','result','data')]};
  const start=block('in','input.user_request',{question:'시험\n'.repeat(220)});
  const graph:Graph={nodes:[start,loop,block('end','output.answer')],edges:[edge('in','iterate'),edge('iterate','end')]};
  const raw=unzipSync(buildAgentZip({title:'반복',graph,resources:[],files:[]}));
  const pages=Object.entries(raw).filter(([path])=>/^workflow\/step-/.test(path)).map(([path,data])=>[path,strFromU8(data)]);
  const [loopPath]=pages.find(([,body])=>body.includes('반복 처리 · iterate'))!;
  const [,terminal]=pages.find(([,body])=>body.includes('답변 전달 · result'))!;
  assert.ok(terminal.includes(']('+loopPath.slice('workflow/'.length)+')'));
  assert.match(terminal,/모든 항목이 끝난 뒤 부모의 다음 경로를 한 번/);
});

test('하위의 여러 종료값은 검토 회신 뒤 한 번 반환하고 일반 실패와 전체 중지는 서로 다른 시점에 끝난다',async()=>{
  for(const status of ['success','failed','cancelled']){
    const call=block('reuse','workflow.call');
    call.graph={nodes:[block('in','input.user_request'),block('review','review.human',{prompt:'초안 검토'}),
      block('answer','output.answer'),block('other','control.terminate',{status,message:'독립 종료'})],edges:[
      edge('in','review'),edge('in','review','data'),edge('review','answer'),edge('review','answer','data'),edge('in','other')]};
    const root:Graph={nodes:[block('start','input.user_request'),call,block('after','ai.single_task'),block('end','output.answer')],
      edges:[edge('start','reuse'),edge('reuse','after'),edge('reuse','after','data'),edge('after','end'),edge('after','end','data')]};
    let after=0;
    const services={model:async()=>{after++;return {text:'후속 완료'};},tool:async()=>null};
    const request={runId:'multiple',input:'초안'};
    const waiting=await executeGraph(root,request,services);
    assert.equal(after,0);
    if(status==='cancelled'){
      assert.equal(waiting.status,'stopped');assert.deepEqual(waiting.checkpoint.waits,{});continue;
    }
    assert.equal(waiting.status,'waiting',waiting.error??'');
    const resumed=await executeGraph(root,{...request,checkpoint:waiting.checkpoint,reply:{value:'검토 의견',waitId:waiting.wait!.id}},services);
    if(status==='failed'){
      assert.equal(resumed.status,'failed');assert.equal(after,0);continue;
    }
    assert.equal(resumed.status,'completed',resumed.error??'');assert.equal(after,1);
    assert.deepEqual(resumed.checkpoint.steps['root/reuse'].values.value,['검토 의견','독립 종료']);
    for(const split of [false,true]){
      if(split)root.nodes[0].config.question='긴 입력\n'.repeat(210);
      const files=unzipSync(buildAgentZip({title:'여러 종료',graph:root,resources:[],files:[]}));
      assert.equal(Boolean(files['workflow/index.md']),split);
      const pages=Object.entries(files).filter(([path])=>path==='AGENTS.md'||path.startsWith('workflow/step-')).map(([,data])=>strFromU8(data)).join('\n');
      assert.match(pages,/현재 호출의 모든 활성 경로가 끝날 때까지/);
      assert.match(pages,/여러 개면 설계의 블록 순서로 목록/);
    }
  }
});

test('일반 병렬 작업에는 역할 호출을 추가하지 않고 선택 밖의 MCP 이름은 노출하지 않는다', () => {
  const graph: Graph = {nodes:[
    block('fork','control.parallel'), block('summary','ai.single_task'), block('draft','agent.delegate',{role:' '}),
    block('join','control.join'), block('private-connector','connection.mcp'),
  ], edges:[edge('fork','summary'), edge('fork','draft'), edge('summary','join'), edge('private-connector','join','data')]};
  const notes = parallelInstructions(graph);
  assert.doesNotMatch(notes.get('fork')!.join('\n'), /하위 Agent/);
  assert.doesNotMatch(notes.get('join')!.join('\n'), /private-connector/);
  assert.deepEqual([...notes.keys()], ['fork','join']);
});

test('합류에 도달한 단일 데이터의 null, 빈 문자열, false, 0은 각각 목록 한 항목으로 남는다',async()=>{
  const graph:Graph={nodes:[block('q','input.user_request'),block('json','document.read',{format:'json'}),block('join','control.join',{merge:'list'}),
    block('end','output.answer',{format:'json'})],edges:[edge('q','json'),edge('q','json','data'),edge('json','join'),edge('json','join','data'),edge('join','end'),edge('join','end','data')]};
  for(const input of [null,'',false,0]){
    const result=await executeGraph(graph,{input:JSON.stringify(input),runId:'scalar-join'},{model:async()=>assert.fail(),tool:async()=>assert.fail()});
    assert.deepEqual(JSON.parse(result.output),[input],result.error??'');
  }
});
