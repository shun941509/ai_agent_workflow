import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activeExportPreparation, type ExportResource} from '../src/domain/agent-export';
import {resourcePreparation} from '../src/domain/export-resource-preparation';
import {connectBlocks, createBlock} from '../src/domain/graph';
import type {Graph} from '../src/domain/types';

function resource(key: string, kind: ExportResource['kind'], extra: Partial<ExportResource> = {}): ExportResource {
  return {key, kind, name:key, version:'2', steps:[], available:true, ...extra};
}

test('선택한 서버의 인증·수동 등록과 선택에서 뺀 서버의 익명 안내는 소비 단계에서만 나타난다', () => {
  const child: Graph = {nodes:[createBlock('tool.invoke', {id:'call',title:'도서 검색',config:{tool:'mcp.asset-private.lookup'}})],edges:[]};
  const graph: Graph = {nodes:[
    createBlock('connection.mcp', {id:'mcp',title:'비공개 서버명',config:{exportResource:'r-one',assetId:'asset-private'}}),
    createBlock('connection.mcp', {id:'other',title:'숨긴 연결 이름',config:{exportResource:'r-two',assetId:'another'}}),
    createBlock('agent.task', {id:'agent',title:'조사 담당',config:{allowedTools:['mcp.asset-private.lookup','mcp.another.query']}}),
    createBlock('workflow.tool', {id:'workflow',title:'목록 조회',graph:child}),
  ],edges:[]};
  graph.edges.push(...connectBlocks(graph,'workflow','agent'), ...connectBlocks(graph,'mcp','agent'), ...connectBlocks(graph,'other','agent'));
  const resources = [
    resource('r-one','mcp',{name:'비공개 서버명',mcpMode:'remote',requiresAuth:true,mcpUrl:'https://private.example/mcp'}),
    resource('r-two','mcp',{name:'숨긴 연결 이름',mcpMode:'manual'}),
  ];
  const notes = resourcePreparation(graph, resources);
  const omitted = activeExportPreparation(notes, []);
  assert.deepEqual(omitted.map(row => row.step), ['조사 담당','목록 조회 › 도서 검색']);
  assert.deepEqual(omitted.map(row => row.stepPath), [['2'],['3','0']]);
  assert.match(omitted[0].reason,/2개/);
  assert.match(omitted[0].action,/도구를 선택하면/);
  assert.doesNotMatch(JSON.stringify(omitted), /비공개 서버명|숨긴 연결 이름|asset-private|private\.example|lookup/);
  const included = activeExportPreparation(notes, ['r-one','r-two']);
  assert.ok(included.some(row => row.step === '목록 조회 › 도서 검색' && row.action.includes('인증')));
  assert.ok(included.some(row => row.step === '조사 담당' && row.action.includes('시작 명령')));
  assert.ok(!included.some(row => row.step === '목록 조회 › 도서 검색' && row.action.includes('시작 명령')));
});

test('같은 이름의 단계도 구분하며 선택 가능한 자료, 필수 스크립트, 선택 사항인 시험 파일을 따로 처리한다', () => {
  const skill = createBlock('instruction.skill',{id:'s',title:'작성법',config:{exportResource:'format',requiresScripts:true}});
  const graph: Graph = {nodes:[
    skill, createBlock('file.input',{id:'example',title:'시험 원고',config:{exportResource:'example'}}),
    createBlock('resource.context',{id:'d',title:'내부 규정',config:{exportResource:'doc'}}),
    createBlock('ai.single_task',{id:'a',title:'작성'}),
    createBlock('ai.single_task',{id:'b',title:'작성'}),
  ],edges:[]};
  graph.edges.push(...connectBlocks(graph,'s','a'), ...connectBlocks(graph,'d','b'));
  const notes = resourcePreparation(graph, [resource('format','skill'),resource('doc','document'),resource('example','document')]);
  const selected = activeExportPreparation(notes,['format','doc']);
  assert.deepEqual(selected.map(x => x.step), ['작성 (1)']);
  assert.match(selected[0].action,/스크립트/);
  const excluded = activeExportPreparation(notes,[]);
  assert.deepEqual(excluded.map(x => x.step), ['작성 (1)','작성 (2)']);
  assert.ok(!excluded.some(row => row.action.includes('스크립트')));
});

test('읽을 수 없는 자료판과 순환 하위 설계는 문제가 발생한 중첩 단계에 표시된다', () => {
  const graph: Graph = {nodes:[createBlock('agent.team', {id:'team',title:'검토 팀',graph:{nodes:[
    createBlock('knowledge.search',{id:'search',title:'원문 확인',config:{exportCollection:['edition']}}),
    createBlock('workflow.call',{id:'back',title:'원래 업무',config:{exportResource:'cycle'}}),
  ],edges:[]}})],edges:[]};
  const notes = activeExportPreparation(resourcePreparation(graph,[
    resource('edition','knowledge',{available:false}),resource('cycle','workflow',{available:false,unavailableReason:'recursive-workflow'}),
  ]),[]);
  assert.deepEqual(notes.map(x => x.step),['검토 팀 › 원문 확인','검토 팀 › 원래 업무']);
  assert.match(notes[0].action,/자료판 원문/);
  assert.match(notes[1].reason,/상위 Workflow/);
  assert.match(notes[1].action,/호출 대상/);
});

test('팀에서 선택한 Skill은 상속한 담당 단계에만 준비 안내를 표시한다', () => {
  const graph: Graph = {nodes:[
    createBlock('instruction.skill',{id:'style',title:'작성법',config:{exportResource:'style'}}),
    createBlock('agent.team',{id:'team',title:'작성 팀',graph:{nodes:[
      createBlock('ai.single_task',{id:'chosen',title:'형식 검사',config:{inheritedSkillIds:['block:style']}}),
      createBlock('ai.single_task',{id:'other',title:'요약'}),
    ],edges:[]}}),
  ],edges:[]};
  graph.edges.push(...connectBlocks(graph,'style','team'));
  const notes = resourcePreparation(graph,[resource('style','skill')]);
  assert.deepEqual(activeExportPreparation(notes,[]).map(row => row.step),['작성 팀 › 형식 검사']);
  assert.deepEqual(activeExportPreparation(notes,['style']),[]);
});

test('쓰지 않는 자료와 시험용 원문, 단발 AI에 연결한 MCP는 실행 준비를 요구하지 않는다',()=>{
  const graph:Graph={nodes:[
    createBlock('resource.context',{id:'d',config:{exportResource:'doc'}}),
    createBlock('instruction.skill',{id:'s',config:{exportResource:'skill',requiresScripts:true}}),
    createBlock('file.input',{id:'sample',config:{exportResource:'example'}}),
    createBlock('connection.mcp',{id:'m',config:{exportResource:'mcp',assetId:'private'}}),
    createBlock('ai.single_task',{id:'a'}), createBlock('agent.task',{id:'b',config:{allowedTools:[]}}),
  ],edges:[]};
  graph.edges.push(...connectBlocks(graph,'m','a'), ...connectBlocks(graph,'m','b'));
  const items=resourcePreparation(graph,[resource('doc','document'),resource('skill','skill'),
    resource('example','document'),resource('mcp','mcp',{mcpMode:'manual'})]);
  assert.deepEqual(items,[]);
});

test('여러 Agent가 같은 Workflow를 호출하면 각 호출자에게서 물려받는 원문을 구분한다',()=>{
  const child:Graph={nodes:[createBlock('ai.single_task',{id:'writer',title:'요약'})],edges:[]};
  const graph:Graph={nodes:[
    createBlock('resource.context',{id:'a',config:{exportResource:'one'}}),
    createBlock('resource.context',{id:'b',config:{exportResource:'two'}}),
    createBlock('agent.task',{id:'first',title:'출고 담당'}),
    createBlock('agent.task',{id:'second',title:'입고 담당'}),
    createBlock('workflow.tool',{id:'workflow',title:'물류 확인',graph:child}),
  ],edges:[]};
  for(const [from,to] of [['a','first'],['b','second'],['workflow','first'],['workflow','second']])
    graph.edges.push(...connectBlocks(graph,from,to));
  const items=activeExportPreparation(resourcePreparation(graph,[resource('one','document'),resource('two','document')]),['two']);
  const use=items.find(item=>item.step==='물류 확인 › 요약');
  assert.match(use!.action,/출고 담당/);
  assert.doesNotMatch(use!.action,/입고 담당/);
});

test('같은 MCP의 여러 판 중 이번 호출에서 선택한 판만 준비한다',()=>{
  const tool='mcp.versions.lookup';
  for(const type of ['tool.invoke','approval.action','error.compensate','agent.task']) {
    const graph:Graph={nodes:[
      createBlock(type,{id:'call',config:type==='agent.task' ? {allowedTools:[tool]} : {tool}}),
      ...['one','two'].map((key,index)=>createBlock('connection.mcp',{id:key,
        config:{assetId:'versions',version:index+1,exportResource:key}})),
    ],edges:[]};
    for(const id of ['one','two']) graph.edges.push(...connectBlocks(graph,id,'call'));
    const first=resource('one','mcp',{version:'1',name:'읽기 도구',mcpMode:'manual'});
    const second=resource('two','mcp',{version:'2',name:'읽기 도구',mcpMode:'remote'});
    const remote=activeExportPreparation(resourcePreparation(graph,[first,second]),['two']);
    assert.equal(remote.length,1,type);
    assert.match(remote[0].action,/ZIP에 포함되지 않은 판을 선택했을 때/);
    assert.doesNotMatch(remote[0].action,/읽기 도구|1판|2판/);
    const manual=activeExportPreparation(resourcePreparation(graph,[first,{...second,mcpMode:'manual'}]),['one','two']);
    assert.equal(manual.length,2,type);
    assert.match(manual[0].action,/1판을 선택했을 때.*시작 명령/);
    assert.match(manual[1].action,/2판을 선택했을 때.*시작 명령/);
    const auth=activeExportPreparation(resourcePreparation(graph,[first,{...second,requiresAuth:true}]),['two']);
    assert.ok(auth.some(item=>/2판을 선택했을 때.*인증 정보/.test(item.action)));
  }
});
