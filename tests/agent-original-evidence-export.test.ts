import assert from 'node:assert/strict';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {activeExportPreparation, type ExportPackage} from '../src/domain/agent-export';
import {byType} from '../src/domain/catalog';
import {designPreparation} from '../src/domain/export-design-preparation';
import {connectBlocks, createBlock, validateGraph} from '../src/domain/graph';
import type {Graph} from '../src/domain/types';
import type {EngineEvent} from '../src/engine/types';
import {buildAgentZip} from '../src/server/agent-zip';
import {evidenceResultLabel} from '../src/ui/evidence-result';

function evidenceGraph(): Graph {
  const graph: Graph = {nodes:[
    createBlock('input.user_request', {id:'ask'}),
    createBlock('resource.context', {id:'doc', config:{content:'신청은 12월 1일까지입니다.', exportResource:'original'}}),
    createBlock('knowledge.search', {id:'search'}),
    createBlock('quality.evidence', {id:'check', config:{requireOriginal:true, includeSourceLines:true}}),
    createBlock('output.answer', {id:'end'}),
  ], edges:[]};
  for (const [from,to] of [['ask','search'], ['doc','search'], ['search','check']]) {
    graph.edges.push(...connectBlocks(graph,from,to));
  }
  for (const out of ['verified','insufficient','conflicting']) {
    graph.edges.push(...connectBlocks(graph,'check','end',[{kind:'flow', out, input:'in'}]));
  }
  graph.edges.push(...connectBlocks(graph,'check','end',[{kind:'data',out:'value',input:'input'}]));
  assert.deepEqual(validateGraph(graph),[]);
  return graph;
}

function download(graph: Graph, included: boolean) {
  const path = 'resources/original/source.md';
  const resource: ExportPackage['resources'][number] = {key:'original', name:'안내문', kind:'document',
    version:'1', available:true, included, steps:['안내문'], files:[path]};
  const bytes = buildAgentZip({title:'인용 확인',graph,resources:[resource],
    files:included ? [{path,data:Buffer.from('신청은 12월 1일까지입니다.').toString('base64')}] : []});
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name,body])=>[name,strFromU8(body)]));
}

test('원문 대조 필수는 기본 속성에서 고르고 선택한 원문과 실행 시점의 출처에 따라 해당 단계 준비를 표시한다', () => {
  const field = byType.get('quality.evidence')!.fields.find(f=>f.key==='requireOriginal');
  assert.ok(field);
  assert.equal(field.label,'원문 대조 필수');
  assert.equal(field.default,false);
  assert.ok(!field.advanced);
  const graph = evidenceGraph();
  const search = graph.nodes.find(node=>node.id==='search')!;
  const check = graph.nodes.find(node=>node.id==='check')!;
  const notes = () => designPreparation(graph).filter(item=>item.step===check.title && item.reason.includes('원문 대조 필수'));
  assert.equal(activeExportPreparation(notes(),['original']).length,0);
  assert.equal(activeExportPreparation(notes(),[]).length,1);
  for (const split of [false,true]) {
    if (split) graph.agentScope = {mode:'dedicated',purpose:'검토'.repeat(5000)};
    const files = download(graph,false);
    const body = split ? Object.entries(files).find(([path,body])=>path.startsWith('workflow/step-') && body.includes('근거·출처 확인 · check'))?.[1] : files['AGENTS.md'];
    assert.ok(body);
    assert.match(body,/판 번호가 비어 있으면 이 단계에서.*실제 판 번호 또는 판 이름을 확인할 때까지 기다리세요/);
    assert.match(body,/원문 파일을 요청하고 기다리세요.*같은 단계에서 대조/);
    assert.match(body,/위치가 없거나 인용이 일치하지 않으면 status=insufficient.*다른 파일을 다시 요청하지/);
    assert.match(body,/status=verified.*원문 대조 완료/);
    assert.match(body,/sourceLines 목록.*빈 목록/);
    assert.match(body,/README\.md#prep-3/);
    assert.match(files['README.md'],/id="prep-3"/);
    assert.doesNotMatch(download(graph,true)['README.md'],/근거 후보만으로 완료할 수 없습니다/);
  }
  search.config.storeKey = '발행 자료집';
  assert.equal(activeExportPreparation(notes(),['original']).length,1);
  delete check.config.requireOriginal;
  assert.deepEqual(notes(),[]);
  const normal = Object.values(download(graph,false)).find(body=>body.includes('근거·출처 확인 · check'));
  assert.match(normal!,/status=candidate_match.*후보 문구와 일치.*근거 있음/);
});

test('원문을 완료 조건으로 지정한 동적 Agent의 단계와 역할에 판 확인·대기를 명시한다',()=>{
  const graph=evidenceGraph();
  const spawn=createBlock('agent.create_dynamic',{id:'work',config:{role:'확인 담당',resultRequirement:'evidence'}});
  spawn.graph=graph;
  const parent:Graph={nodes:[spawn],edges:[]};
  const parentNotes=()=>designPreparation(parent).filter(item=>item.step===spawn.title && item.reason.includes('반환된 인용'));
  assert.deepEqual(parentNotes(),[]);
  graph.nodes.find(node=>node.id==='check')!.config.requireOriginal=false;
  assert.equal(parentNotes().length,1);
  for(const split of [false,true]){
    const wrapper:Graph={nodes:[spawn],edges:[]};
    if(split)wrapper.agentScope={mode:'dedicated',purpose:'검토'.repeat(5000)};
    const files=download(wrapper,false);
    assert.match(files['README.md'],/담당자가 반환한 인용에 판이 빠지면 판 번호를 확인/);
    assert.ok(Object.entries(files).some(([name,body])=>(name==='AGENTS.md'||name.startsWith('workflow/step-'))&&body.includes('그 대상의 완료를 보류')));
    assert.ok(Object.entries(files).some(([name,body])=>name.startsWith('agents/')&&body.includes('같은 작업에서 회신을 기다리세요')));
  }
});

test('근거 결과에 기록된 확인 범위를 표시하며 과거의 verified 응답을 원문 대조로 해석하지 않는다', () => {
  const event = (value:unknown): EngineEvent => ({kind:'result', blockType:'quality.evidence', data:{value},
    id:1,time:'',nodeId:'check',path:'root/check',title:'근거',detail:'근거 완료'});
  assert.equal(evidenceResultLabel(event({status:'candidate_match', verification:'candidate'})),'후보 문구와 일치');
  const original = {status:'verified', verification:'original', passages:[{version:'4'}]};
  assert.equal(evidenceResultLabel(event(original)),'원문 대조 완료');
  assert.equal(evidenceResultLabel(event({...original, originalSource:'supplied'})),'첨부 원문 대조 완료');
  assert.equal(evidenceResultLabel(event({...original, originalSource:'mixed'})),'연결·첨부 원문 대조 완료');
  assert.equal(evidenceResultLabel(event({...original, passages:[{version:'4'},{}]})),'근거 있음 (판 번호 미기록)');
  assert.equal(evidenceResultLabel(event({status:'verified',verification:'original'})),'근거 있음 (판 번호 미기록)');
  assert.equal(evidenceResultLabel(event({status:'verified'})),'근거 있음 (대조 범위 미기록)');
  assert.equal(evidenceResultLabel(event({status:'conflicting',verification:'candidate'})),'근거 상충 (후보 문구 대조)');
  assert.equal(evidenceResultLabel(event({status:'insufficient',verification:'none'})),'근거 부족');
  assert.equal(evidenceResultLabel({...event({status:'verified',verification:'original'}),blockType:'output.answer'}),undefined);
});
