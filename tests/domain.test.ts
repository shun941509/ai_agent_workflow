import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog, connectBlocks, connectionOptions, createBlock, levels, migrateGraph, palette, portsFor, templates, terminalBehavior, terminalBehaviorOptions, validateGraph, type Graph } from '../src/domain';

test('32 menus cover terminal behaviors, existing modes, timed questions and property references',()=>{
  assert.equal(new Set(catalog.map(d=>d.type)).size,41);
  assert.equal(palette.length,32);
  assert.deepEqual(levels.map(l=>palette.filter(d=>d.level===l).length),[4,4,10,11,3]);
  assert.equal(catalog.filter(d=>!d.menuType).length,2);
  assert.equal(palette.filter(d=>d.modes?.length===2).length,5);
  const menuTypes=palette.flatMap(menu=>menu.modes?.map(mode=>mode.value)??[menu.type]);
  const legacyWait=catalog.find(d=>d.type==='control.wait')!;
  assert.equal(legacyWait.menuType,'input.form');
  const terminal=catalog.find(d=>d.type==='control.terminate')!;
  assert.equal(terminal.menuType,'output.answer');
  assert.deepEqual([...menuTypes, legacyWait.type, terminal.type].sort(),catalog.filter(d=>d.menuType).map(d=>d.type).sort());
  assert.deepEqual(terminalBehaviorOptions.map(mode=>mode.value),['answer','success','cancelled','failed']);
  assert.equal(terminalBehavior(createBlock('output.answer')), 'answer');
  for (const status of ['success','cancelled','failed'])
    assert.equal(terminalBehavior(createBlock('control.terminate',{config:{status}})),status);
  const select=palette.find(menu=>menu.type==='agent.select_candidate')!;
  assert.equal(select.name,'담당자·작업 선택');
  assert.deepEqual(select.modes,[
    {value:'agent.select_candidate',label:'담당자 한 명 선택'}, {value:'agent.coordinate',label:'작업 순서 정하기'},
  ]);
  assert.deepEqual(select.modes?.map(mode=>catalog.find(d=>d.type===mode.value)?.level),['고급','고급']);
  const tool=palette.find(menu=>menu.type==='tool.invoke')!;
  assert.deepEqual(tool.modes?.map(mode=>catalog.find(d=>d.type===mode.value)?.level),['중급','전문가']);
});

test('각 난이도에 지정된 제작 메뉴만 표시한다',()=>{
  const expected = {
    입문: ['input.user_request','output.answer','agent.task','resource.context'],
    초급: ['input.form','file.input','document.read','file.create'],
    중급: ['ai.classify','tool.invoke','data.transform','knowledge.search','control.branch',
      'approval.action','safety.redact','error.handle','data.validate','quality.evidence'],
    고급: ['control.trigger','agent.team','agent.select_candidate','agent.delegate','memory.access',
      'control.parallel','control.join','control.loop','workflow.call','review.human','quality.evaluate'],
    전문가: ['agent.create_dynamic','knowledge.manage','context.compress'],
  };
  for (const level of levels) {
    const actual = palette.filter(menu=>menu.level===level).map(menu=>menu.type);
    assert.deepEqual(actual.sort(),expected[level].sort(),level);
  }
});

test('merged palette menus preserve the type, settings and titles of imported workflows',()=>{
  const nodes=[
    createBlock('agent.select_candidate',{id:'a',title:'후보 탐색·선택',config:{candidates:['담당 A','담당 B'],criterion:'언어'}}),
    createBlock('agent.coordinate',{id:'b',title:'작업 조정',config:{tasks:['읽기','요약'],goal:'요약',maxSteps:2}}),
    createBlock('error.compensate',{id:'c',title:'예약 취소',config:{tool:'reservations.cancel',args:{reservationId:'r1'}}}),
    createBlock('control.wait',{id:'d',title:'조건 기다리기',config:{prompt:'검토 후 알려주세요',event:'원래 설정',timeoutMinutes:90}}),
  ];
  const graph={nodes,edges:connectBlocks({nodes,edges:[]},'b','d')};
  assert.deepEqual(migrateGraph(JSON.parse(JSON.stringify(graph))),graph);
  assert.equal(createBlock('control.wait').title,'회신 기다리기');
  assert.ok(!Object.hasOwn(createBlock('control.wait').config,'event'));
});

test('질문 양식은 기한 없이 시작하고 분 단위의 선택 기한을 검사한다',()=>{
  const input=createBlock('input.user_request');
  const question=createBlock('input.form',{config:{prompt:'수령 지점은 어디인가요?',fields:['지점']}});
  const answer=createBlock('output.answer');
  const graph:Graph={nodes:[input,question,answer],edges:[]};
  graph.edges.push(...connectBlocks(graph,input.id,question.id));
  graph.edges.push(...connectBlocks(graph,question.id,answer.id));
  assert.equal(question.config.replyTimeoutMinutes,0);
  for(const minutes of [0,1,30,10080]){
    question.config.replyTimeoutMinutes=minutes;
    assert.deepEqual(validateGraph(graph),[]);
  }
  delete question.config.replyTimeoutMinutes;
  assert.deepEqual(validateGraph(graph),[]);
  for(const minutes of [-1,1.5,10081,'30']){
    question.config.replyTimeoutMinutes=minutes;
    assert.ok(validateGraph(graph).some(issue=>issue.nodeId===question.id && issue.message.includes('회신 기한')));
  }
});

test('오류 처리의 새 선택지만 표시하고 기존 전략도 값을 바꾸지 않고 검증한다',()=>{
  const definition=catalog.find(d=>d.type==='error.handle')!;
  assert.deepEqual(definition.fields.find(f=>f.key==='strategy')!.options?.map(o=>o.value),['continue','stop']);
  const start=createBlock('input.user_request'), handler=createBlock('error.handle'), answer=createBlock('output.answer');
  const graph:Graph={nodes:[start,handler,answer],edges:[]};
  graph.edges.push(...connectBlocks(graph,start.id,handler.id),...connectBlocks(graph,handler.id,answer.id));
  assert.equal(handler.config.strategy,'continue');
  for (const strategy of ['continue','stop','report','fallback']) {
    handler.config.strategy=strategy;
    assert.deepEqual(validateGraph(graph),[]);
    assert.deepEqual(migrateGraph(graph),graph);
    assert.equal(handler.config.strategy,strategy);
  }
  handler.config.strategy='other';
  assert.ok(validateGraph(graph).some(issue=>issue.nodeId===handler.id && issue.message.includes('처리 방식')));
});

test('all thirteen templates use blocks appropriate to their level, including nested teams',()=>{
  assert.deepEqual(levels.map(l=>templates.filter(t=>t.level===l).length),[2,2,3,3,3]);
  for(const lesson of templates) {
    assert.deepEqual(validateGraph(lesson.graph),[],lesson.id);
    function checkLevel(graph:Graph) {
      for(const node of graph.nodes) {
        const definition=catalog.find(item=>item.type===node.type)!;
        assert.ok(levels.indexOf(definition.level)<=levels.indexOf(lesson.level),
          lesson.title+' 실습의 '+node.title+' 블록은 '+definition.level+'부터 추천됩니다.');
        if(node.graph) checkLevel(node.graph);
      }
    }
    checkLevel(lesson.graph);
  }
  const advanced=templates.find(t=>t.id==='peer-review')!.graph.nodes.find(b=>b.type==='agent.team')!;
  const cross=advanced.graph!.edges.filter(e=>e.kind==='data' && e.to.startsWith('review-') && e.input==='input');
  assert.deepEqual(cross.map(e=>[e.from,e.to]),[['clarity','review-facts'],['facts','review-clarity']]);
  for(const edge of cross){
    const draft=advanced.graph!.nodes.find(node=>node.id===edge.from)!;
    const reviewer=advanced.graph!.nodes.find(node=>node.id===edge.to)!;
    assert.equal(draft.y,reviewer.y);
    assert.ok(draft.x<reviewer.x);
  }
});

test('a text transform can collect several inputs when converting whole values',()=>{
  const transform=createBlock('data.transform',{config:{operation:'text'}});
  const input=()=>portsFor(transform).inputs.find(port=>port.id==='input')!;
  assert.equal(input().multiple,true);
  transform.config.path='quote';
  assert.equal(input().multiple,false);
  transform.config.path='';
  for(const operation of ['select','rename']){
    transform.config.operation=operation;
    assert.equal(input().multiple,false);
  }
});

test('primary value and flow are created together, ref by itself, occupied or ambiguous routes need a choice',()=>{
  const g=structuredClone(templates[0].graph);
  g.edges=[];
  const added=connectBlocks(g,'input','agent');
  assert.deepEqual(added.map(e=>[e.kind,e.out,e.input]),[['flow','next','in'],['data','value','input']]);
  assert.deepEqual(connectBlocks(g,'rules','agent').map(e=>e.kind),['reference']);
  g.edges.push(...added);
  const second=createBlock('input.user_request',{id:'second'});g.nodes.push(second);
  assert.ok(connectionOptions(g,'second','agent').filter(o=>o.kind==='data').every(o=>!o.automatic));
  const branch=createBlock('control.branch',{id:'branch'});g.nodes.push(branch);
  assert.ok(connectionOptions(g,'branch','agent').filter(o=>o.kind==='flow').every(o=>!o.automatic));
});

test('a named output offers its own route and compatible data, and cannot silently turn into a data-only connection', () => {
  const classifier = createBlock('ai.classify', { config: { categories: ['규정', '예약'] } });
  const target = createBlock('agent.task');
  const graph: Graph = { nodes: [classifier, target], edges: [] };
  const optionsFor = (out: string) => connectionOptions(graph, classifier.id, target.id, out);
  const picked = optionsFor('category:예약').filter(option => option.automatic);
  assert.deepEqual(picked.map(o => [o.kind, o.out, o.input]), [
    ['flow', 'category:예약', 'in'], ['data', 'value', 'input'],
  ]);
  graph.edges.push(...connectBlocks(graph, classifier.id, target.id, picked.filter(o => o.kind === 'flow')));
  assert.deepEqual(optionsFor('category:예약'), []);
  assert.deepEqual(optionsFor('category:삭제된 범주'), []);
  assert.deepEqual(optionsFor('other').filter(o => o.kind === 'flow').map(o => o.out), ['other']);
  assert.ok(connectionOptions(graph, classifier.id, target.id).some(o => o.kind === 'data'));
  const handler = createBlock('error.handle');
  graph.nodes.push(handler);
  assert.deepEqual(connectionOptions(graph, classifier.id, handler.id, 'other'), []);
  assert.ok(connectionOptions(graph, classifier.id, handler.id).some(o => o.kind === 'flow'));
});

test('identical display names keep their distinct branch and fallback port IDs', () => {
  const gate = createBlock('control.branch', { config: { yesLabel: '안내', noLabel: '안내' } });
  const classify = createBlock('ai.classify', { config: { categories: ['미분류'] } });
  const routes = (node: typeof gate) => portsFor(node).outputs.filter(p => p.kind === 'flow').map(p => [p.id, p.label]);
  assert.deepEqual(routes(gate), [['yes', '안내 (조건 일치)'], ['no', '안내 (그 밖의 경우)']]);
  assert.deepEqual(routes(classify), [['category:미분류', '미분류'], ['other', '미분류 (기본 경로)']]);
});

test('AI 분류 검사는 누락된 출력 경로를 구별하고 여러 경로가 같은 블록에 도착할 수 있다',()=>{
  const graph=structuredClone(templates.find(t=>t.id==='intermediate')!.graph);
  const classify=graph.nodes.find(node=>node.type==='ai.classify')!;
  classify.config.categories.push('연장');
  const namedIssues=()=>validateGraph(graph).filter(issue=>issue.nodeId===classify.id&&issue.routeId);
  assert.deepEqual(namedIssues().map(issue=>issue.routeId),['category:연장']);
  assert.match(namedIssues()[0].message,/연장.*다음 블록/);
  const shared=graph.edges.find(edge=>edge.from===classify.id&&edge.out==='other')!;
  graph.edges.push({...shared,id:'extension',out:'category:연장'});
  assert.deepEqual(validateGraph(graph),[]);
  graph.nodes.push(createBlock('error.handle',{id:'failure'}));
  shared.to='failure';
  assert.deepEqual(namedIssues().map(issue=>issue.routeId),['other']);
});

test('old preview layout, IDs, settings and logical wires survive import; obsolete code can be repaired',()=>{
  const legacy={layout:{b:{i:{x:-10,y:64}}},nodes:[
    {id:'i',kind:'input',type:'input.user_request',title:'질문'},
    {id:'a',kind:'agent',type:'agent.task',title:'안내',goal:'안내',instruction:'한 문장'},
    {id:'o',kind:'output',type:'output.answer',title:'답변'},
    {id:'r',kind:'resource',type:'resource.context',title:'규정',content:'본문'},
  ], edges:[{id:'first',from:'i',to:'a',kind:'flow'},{id:'second',from:'a',to:'o',kind:'data'},{id:'doc',from:'r',to:'a',kind:'reference'}]};
  const m=migrateGraph(legacy);assert.deepEqual(validateGraph(m),[]);
  assert.equal(m.nodes[0].x,-10);assert.equal(m.nodes[1].config.instruction,'한 문장');
  assert.deepEqual([m.nodes[1].x,m.nodes[1].y],[206,144]);
  assert.equal(m.edges.length,5);assert.equal(m.edges[0].id,'first');
  assert.deepEqual(migrateGraph(m),m);
  const oldCode=migrateGraph({nodes:[{id:'c',kind:'resource',type:'tool.code_task',title:'기존 계산',script:'1+1'}],edges:[]});
  assert.equal(oldCode.nodes[0].config.script,'1+1');
  assert.ok(validateGraph(oldCode).some(issue=>issue.nodeId==='c' && issue.message.includes('교체')));
});

test('field binding, route identity, missing data, cycles and nested issues are inspectable',()=>{
  const g=structuredClone(templates[0].graph);
  const edge=g.edges.find(e=>e.from==='agent'&&e.to==='output'&&e.kind==='data')!;
  edge.label='임의 설명';assert.deepEqual(validateGraph(g),[]);
  edge.out='missing';assert.ok(validateGraph(g).some(i=>i.edgeId===edge.id));
  g.edges=g.edges.filter(e=>e!==edge);
  assert.ok(validateGraph(g).some(i=>i.nodeId==='output' && i.message.includes('입력값')));
  const c=createBlock('ai.classify',{config:{categories:['기타','실패']}});assert.deepEqual(portsFor(c).outputs.filter(p=>p.id.startsWith('category')).map(p=>p.label),['기타','실패']);
  const a=createBlock('ai.single_task',{id:'b',config:{goal:'비교'}});g.nodes.push(a);
  g.edges.push({id:'ab',from:'agent',to:'b',kind:'flow',out:'next',input:'in'},{id:'ba',from:'b',to:'agent',kind:'flow',out:'next',input:'in'});
  assert.ok(validateGraph(g).some(i=>i.message.includes('순환')));
  g.edges=g.edges.map(e=>e.id==='ba'?{...e,kind:'data',out:'value',input:'question'}:e);
  assert.ok(validateGraph(g).some(i=>i.message.includes('순환')));
});
