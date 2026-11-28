import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock, templates, type Graph } from '../../domain/index';
import { arranged, changeBlockMode, changeTerminalBehavior, compactDestinationLabels, editReplySettings, graphChanges, groupEdges, groupKey, materialPreview, nodeSummary, nodeTitle, replyDeadlineMinutes, routeLabelWidth, subgraph, titleById, updateSubgraph } from './graph';
import { extent, fittedView, groupedWireGeometry, H, nearestWires, nodeLayout, revealBlock, route, selectedPortDirections, wireCaptions, W } from './geometry';
import { overviewTargetLimits, placeNewBlock } from './node-layout';

test('같은 팀의 동명 블록만 구분하고 사용자가 이미 붙인 번호와 이름은 보존한다', () => {
  const block = (id:string,title:string) => createBlock('agent.task',{id,title});
  const left = block('left','안내 작성'), right = block('right','안내  작성');
  const graph:Graph = {nodes:[left, right, block('named','1번 · 안내 작성')],edges:[]};
  assert.deepEqual(graph.nodes.map(node=>titleById(graph,node.id)),['2번 · 안내 작성','3번 · 안내 작성','1번 · 안내 작성']);
  const renamed = {...graph,nodes:graph.nodes.map(node=>node.id==='left'?{...node,title:'다른 이름'}:node)};
  assert.equal(titleById(renamed,'right'),right.title);
  assert.equal(titleById({nodes:[left],edges:[]},left.id),left.title);
  assert.equal(titleById(graph,'missing'),'missing');
});

test('긴 목적지 제목에서 접수 번호보다 서로 다른 단어와 원래 동명 블록 번호를 먼저 읽을 수 있다', () => {
  const terms = ['주말예약', '평일예약', '야간열람', '점자대출'];
  const bodies = terms.map((word, i) => '접수번호 ' + (i + 1) + '번 ' + '도서관 상담 창구에서 접수한 '.repeat(12)
    + word + ' 문의 처리 기준과 추가 확인 내용'.repeat(12) + ' ' + (i + 11));
  const titles = [...bodies, '1번 · ' + bodies[0], '2번 · ' + bodies[0], '예약 상담'];
  const labels = compactDestinationLabels(titles);
  for (const [i, body] of bodies.entries()) assert.ok(labels.get(body)!.includes(terms[i]));
  for (const ordinal of ['1번 · ', '2번 · ']) {
    const label = labels.get(ordinal + bodies[0])!;
    assert.ok(label.startsWith(ordinal) && label.includes(terms[0]));
  }
  assert.equal(labels.get('예약 상담'), '예약 상담');
  assert.equal(new Set(labels.values()).size, titles.length);
  assert.ok([...labels.values()].every(label => routeLabelWidth(label) <= 168));
});

test('같은 단어들의 조합과 공백 없이 붙어 있는 목적지 이름도 구분한다', () => {
  const terms = ['주말 예약', '주말 열람', '평일 예약', '평일 열람'];
  const names = terms.map(term => '공통 안내 '.repeat(30) + term + ' 접수 창구'.repeat(30));
  const labels = compactDestinationLabels(names);
  names.forEach((name, i) => assert.ok(labels.get(name)!.includes(terms[i])));

  const unspaced = ['대출', '반납'].map(word => '도서관'.repeat(2500) + word + '담당'.repeat(2500));
  const unspacedLabels = compactDestinationLabels(unspaced);
  assert.ok(unspacedLabels.get(unspaced[0])!.includes('대출'));
  assert.ok(unspacedLabels.get(unspaced[1])!.includes('반납'));
});

test('숫자로 구분하는 목적지는 원문의 선행 0과 단위를 함께 보인다', () => {
  const numbers = ['001', '01', '1', '10', '11'];
  for (const titleFor of [
    (number: string) => '시립도서관에서 접수한 장기 대출 연장 요청 ' + number + '번 창구의 최종 회신',
    (number: string) => '시립도서관공공자료열람서비스예약상담요청번호' + number + '번분관보관자료의접수심사와처리결과안내',
  ]) {
    for (const siblings of [numbers, ['10', '11']]) {
      const titles = siblings.map(titleFor);
      const labels = compactDestinationLabels(titles);
      titles.forEach((title, i) => {
        const label = labels.get(title)!;
        assert.deepEqual(label.match(/\d+/g), [siblings[i]], title);
        assert.ok(label.includes(siblings[i] + '번'), label);
      });
    }
  }
});

test('여러 지점이 같은 창구 번호를 쓸 때 실제 지점과 창구 번호로 구분한다', () => {
  const cases = ['10', '11'].flatMap(branch => ['01', '02'].map(desk => ({
    title: branch + '지점 도서관에서 접수한 대출 연장 요청 ' + desk + '번 창구의 처리 결과를 이용자에게 회신',
    label: branch + '지점 · ' + desk + '번',
  })));
  const titles = cases.map(item => item.title);
  for (const ordered of [titles, [...titles].reverse()]) {
    const labels = compactDestinationLabels(ordered);
    for (const {title, label} of cases) assert.equal(labels.get(title), label);
  }
});

test('예약과 대출이 같은 001번을 쓰면 업무 이름과 원래 번호를 함께 보인다', () => {
  const titleFor = (service: string, number: string) => '시립도서관 통합 회원 서비스에서 이용자를 위한 '
    + service + ' 센터의 접수 번호 ' + number + '번 창구에 대해 입력 자료와 분관의 이용 기준을 대조하여 결과를 안내';
  const titles = [titleFor('예약','001'), titleFor('예약','002'), titleFor('대출','001'), titleFor('대출','003')];
  const labels = compactDestinationLabels(titles);
  for (const service of ['예약','대출']) {
    const label = labels.get(titleFor(service, '001'))!;
    assert.ok(label.includes(service) && label.endsWith(' · 001번'), label);
    assert.ok(routeLabelWidth(label) <= 168, label);
  }
  assert.equal(labels.get(titleFor('예약','002')), '002번');
  assert.equal(labels.get(titleFor('대출','003')), '003번');
});

test('목적지가 하나일 때도 긴 원문 가운데의 접수 번호를 보존한다', () => {
  const title = '도서관 예약 센터가 접수하는 자료 이용 요청 제001번의 신청 기록과 분관별 운영 시간을 대조하여 안내';
  const label = compactDestinationLabels([title]).get(title)!;
  assert.ok(label.includes('제001번') && routeLabelWidth(label) <= 168, label);
});

test('단위를 번호 앞에 쓴 지점01번과 창구02번은 원래 순서로 보인다', () => {
  const cases = ['01','02'].flatMap(branch => ['01','02'].map(desk => ({
    title: '도서관 통합 요청 접수처 지점' + branch + '번 창구' + desk + '번 접수 대장의 최종 처리 결과 안내',
    label: '지점' + branch + '번 · 창구' + desk + '번',
  })));
  const labels = compactDestinationLabels(cases.map(item => item.title));
  for (const {title, label} of cases) assert.equal(labels.get(title), label);
});

test('제001지점과 제01창구 앞에 붙은 설명은 식별 번호에 포함하지 않는다', () => {
  const titleFor = (branch: string, desk: string) => '도서관 업무에 대한 권역별 전담 운영 창구 제'
    + branch + '지점 제' + desk + '창구에서 접수한 신청 결과 안내';
  const first = titleFor('001', '01'), second = titleFor('010', '02');
  const labels = compactDestinationLabels([first, second]);
  assert.equal(labels.get(first), '제001지점 · 제01창구');
  assert.equal(labels.get(second), '제010지점 · 제02창구');
});

test('짧은 목적지 이름과 기존의 자동·수동 동명 번호는 온전히 보존한다', () => {
  const body = '시립도서관 통합 대상 서비스 접수 신청 담당 창구';
  const values = [body, body, '1번 · ' + body, '01번 · ' + body, '11번 · ' + body];
  const graph: Graph = {nodes:values.map((title, i) => createBlock('output.answer', {id:'end-'+i, title})), edges:[]};
  const titles = graph.nodes.map(node => titleById(graph, node.id));
  const shortNames = ['001번 창구', '10지점 · 01번'];
  const labels = compactDestinationLabels([...titles, ...shortNames]);
  for (const [i, prefix] of ['2번 · ', '3번 · ', '1번 · ', '01번 · ', '11번 · '].entries()) {
    assert.ok(labels.get(titles[i])!.startsWith(prefix));
  }
  for (const name of shortNames) assert.equal(labels.get(name), name);
});

test('종료 방식을 바꾸면 이전 안내 문구와 답변 형식, 사용자가 붙인 이름을 보존한다', () => {
  const answer = createBlock('output.answer', {id:'end', title:'예약 결과', x:320, y:140,
    config:{format:'markdown', message:'이미 종료한 예약입니다.', extra:{keep:true}}});
  assert.equal(nodeSummary(answer), '답변 반환');
  assert.equal(changeTerminalBehavior(answer, 'answer'), answer);

  let node = answer;
  for (const [status, label] of [
    ['success','완료 안내'], ['cancelled','실행 중지'], ['failed','실패 처리'],
  ] as const) {
    node = changeTerminalBehavior(node, status);
    assert.deepEqual(node, {...answer, type:'control.terminate', config:{...answer.config,status}});
    assert.equal(nodeSummary(node), label + ' · ' + answer.config.message);
    assert.equal(changeTerminalBehavior(node, status), node);
  }
  node = changeTerminalBehavior(node, 'answer');
  assert.deepEqual(node, {...answer, config:{...answer.config, status:'failed'}});
  assert.equal(nodeSummary(node), '답변 반환');
});

test('새 답변 전달 블록은 모든 종료 방식에서 기본 이름을 유지한다', () => {
  let node = createBlock('output.answer');
  for (const behavior of ['success','cancelled','failed','answer'] as const) {
    node = changeTerminalBehavior(node, behavior);
    assert.equal(node.title, '답변 전달');
  }
});

test('기존 종료 블록의 이름과 생략된 설정을 보존하고 답변으로 전환할 때 표시 형식을 넣는다', () => {
  const legacy = {...createBlock('control.terminate'), config:{message:'작업을 마쳤습니다.'}};
  const saved = structuredClone(legacy);
  assert.equal(nodeSummary(legacy), '완료 안내 · 작업을 마쳤습니다.');
  assert.equal(changeTerminalBehavior(legacy, 'success'), legacy);
  const answer = changeTerminalBehavior(legacy, 'answer');
  assert.equal(answer.title, legacy.title);
  assert.deepEqual(answer.config, {...legacy.config, format:'text'});
  assert.equal(changeTerminalBehavior(answer, 'cancelled').title, legacy.title);
  assert.deepEqual(legacy, saved);
});

test('기존 오류 처리 전략은 저장된 값을 바꾸지 않고 실제 후속 진행 또는 중단을 표시한다', () => {
  for (const strategy of ['report','fallback','continue','stop']) {
    const node = createBlock('error.handle', {config:{strategy}});
    assert.equal(nodeSummary(node), strategy === 'stop' ? '실패 시 중단' : '실패 시 후속 단계로 계속');
    assert.equal(node.config.strategy, strategy);
  }
});

test('질문에 설정한 회신 기한은 캔버스에 표시되고 해제해도 양식은 유지된다', () => {
  const question = createBlock('input.form', {title:'수령 지점 회신', config:{fields:['지점'], prompt:'방문 지점은 어디인가요?'}});
  assert.equal(replyDeadlineMinutes(question), 0);
  const timed = editReplySettings(question, {replyTimeoutMinutes:30});
  assert.equal(timed.type, 'input.form');
  assert.equal(nodeTitle(timed), '수령 지점 회신');
  assert.match(nodeSummary(timed), /회신 기한 30분/);
  const untimed = editReplySettings(timed, {replyTimeoutMinutes:0});
  assert.deepEqual(untimed.config.fields, ['지점']);
  assert.equal(nodeSummary(untimed), question.config.prompt);
});

test('예전 대기 블록의 기한은 양식으로 바꾸거나 해제할 때까지 원래 방식으로 편집된다', () => {
  const wait = createBlock('control.wait', {id:'기존', title:'회신 확인', x:23, y:70});
  wait.config = {prompt:'지점을 알려 주세요.', event:'예전 설정'};
  assert.equal(replyDeadlineMinutes(wait), 60);
  const edited = editReplySettings(wait, {replyTimeoutMinutes:15});
  assert.deepEqual(edited, {...wait, config:{...wait.config, timeoutMinutes:15}});
  const form = editReplySettings(edited, {fields:['지점']});
  assert.deepEqual(form, {...wait, type:'input.form', config:{...wait.config, fields:['지점'], replyTimeoutMinutes:15}});
  const disabled = editReplySettings(wait, {replyTimeoutMinutes:0});
  assert.deepEqual(disabled, {...wait, type:'input.form', config:{...wait.config, fields:[], replyTimeoutMinutes:0}});
  assert.equal(replyDeadlineMinutes(wait), 60);
});

test('선택 방식을 바꿀 때 입력 목록·판단 기준·작업 한도와 블록 식별자를 유지한다', () => {
  const original = createBlock('agent.coordinate', {title:'지역별 담당', x:140, config:{
    tasks:['검색','검토'], goal:'지역별 처리', maxSteps:2, candidates:['이전 설정'], criterion:'이전 기준',
  }});
  const candidate = changeBlockMode(original, 'agent.select_candidate');
  assert.equal(candidate.id, original.id);
  assert.equal(candidate.x, original.x);
  assert.equal(candidate.title, original.title);
  assert.deepEqual(candidate.config, {candidates:['검색','검토'], criterion:'지역별 처리', maxSteps:2});
  const edited = {...candidate, config:{...candidate.config, candidates:['편집한 담당'], criterion:'수정한 기준'}};
  const tasks = changeBlockMode(edited, 'agent.coordinate');
  assert.deepEqual(tasks.config, {tasks:['편집한 담당'], goal:'수정한 기준', maxSteps:2});
  assert.equal(changeBlockMode({...original, title:'작업 조정'}, 'agent.select_candidate').title, '담당자 한 명 선택');
});

test('도구와 보상 작업은 실제 행동이나 사용자 이름을 표시하고 승인 대상을 보존한다', () => {
  const tool = createBlock('tool.invoke', {config:{tool:'reservations.cancel',args:{id:'R-1'}}});
  const compensation = changeBlockMode(tool,'error.compensate');
  assert.deepEqual(compensation.config, tool.config);
  assert.equal(compensation.title, '보상 작업');
  assert.equal(nodeTitle(compensation), '예약 취소');
  assert.equal(nodeTitle({...compensation,title:'회의실 예약 되돌리기'}), '회의실 예약 되돌리기');
  assert.equal(nodeTitle({...compensation,config:{tool:'mcp.asset-1.books.cancel'}}), 'books.cancel');
});

test('동적 생성 블록에는 선택한 전체·동시 한도 및 일부 실패 정책을 표시한다', () => {
  const node = createBlock('agent.create_dynamic', {config:{role:'지점 담당', maxCreatedAgents:4, maxInFlightAgents:2, failurePolicy:'collect'}});
  assert.equal(nodeSummary(node), '총 4명 · 동시 2명 · 일부 결과 수집');
  node.config = {...node.config, maxCreatedAgents:3, maxInFlightAgents:1, failurePolicy:'stop'};
  assert.equal(nodeSummary(node), '총 3명 · 동시 1명 · 미완료 시 중단');
  node.config = {role:'지점 담당', maxAgents:2};
  assert.equal(nodeSummary(node), '지점 담당 · 최대 2명');
});

test('같은 두 블록으로 가는 두 분기 이름과 전달값을 한 선에서 보존한다', () => {
  const from = createBlock('control.branch', { id:'classify', config:{yesLabel:'자료 있음', noLabel:'다시 확인'} });
  const to = createBlock('output.answer', { id:'result' });
  const graph:Graph = {nodes:[from,to],edges:[
    {id:'yes',from:from.id,to:to.id,kind:'flow',out:'yes',input:'in',label:'공통 안내'},
    {id:'no',from:from.id,to:to.id,kind:'flow',out:'no',input:'in',label:'공통 안내'},
    {id:'value',from:from.id,to:to.id,kind:'data',out:'value',input:'input'},
  ]};
  const links = groupEdges(graph);
  assert.equal(links.length, 1);
  assert.equal(links[0].members.length, 3);
  assert.match(links[0].caption,/자료 있음/);
  assert.match(links[0].caption,/다시 확인/);
});

test('팀의 하위 블록을 편집하면 같은 ID가 있는 다른 팀을 보존한다', () => {
  const member = createBlock('agent.task', {id:'shared-id',title:'담당자',config:{goal:'문의 읽기'}});
  const team = (id:string) => createBlock('agent.team',{id,graph:{nodes:[member],edges:[]}});
  const graph:Graph = {nodes:[team('a'),team('b')],edges:[]};
  const change:Graph = {nodes:[{...member,config:{...member.config,goal:'운영 시간 확인'}}],edges:[]};
  const after = updateSubgraph(graph,['b'],change);
  assert.equal(subgraph(after,['b']).nodes[0].config.goal,'운영 시간 확인');
  assert.equal(subgraph(after,['a']).nodes[0].config.goal,'문의 읽기');
  assert.match(graphChanges(graph,after).join('\n'),/문의 읽기 → 운영 시간 확인/);
});

test('진행 조건은 실제 출력 포트를 따르고 분류 블록에서 나가는 데이터선에는 붙지 않는다', () => {
  const classifier = createBlock('ai.classify', {id:'classifier', config:{categories:['대출 → 반납']}});
  const step = createBlock('agent.task', {id:'step'});
  const report = createBlock('output.answer', {id:'report'});
  const graph: Graph = {nodes:[classifier, step, report], edges:[
    {id:'condition', from:'classifier', to:'step', kind:'flow', out:'category:대출 → 반납', input:'in', label:'편집용 메모'},
    {id:'category', from:'classifier', to:'report', kind:'data', out:'value', input:'input'},
  ]};
  const [conditional, value] = groupEdges(graph);
  assert.equal(conditional.branchLabel, '대출 → 반납');
  assert.equal(value.branchLabel, '');
  assert.deepEqual(value.flowConditions, []);
});

test('같은 줄을 건너뛰는 데이터는 같은 입출력 점에서 중간 블록을 우회한다', () => {
  const input = createBlock('input.user_request', {id:'input', x:0, y:0});
  const gate = createBlock('control.branch', {id:'gate', x:250, y:0, config:{path:'권수',operator:'greater',expected:'5'}});
  const output = createBlock('output.answer', {id:'output', x:500, y:0});
  const graph: Graph = {nodes:[input,gate,output],edges:[
    {id:'next', from:'input', to:'gate', kind:'flow', out:'next', input:'in'},
    {id:'value', from:'input', to:'gate', kind:'data', out:'value', input:'input'},
    {id:'yes', from:'gate', to:'output', kind:'flow', out:'yes', input:'in'},
    {id:'original', from:'input', to:'output', kind:'data', out:'value', input:'input'},
  ]};
  const groups = groupEdges(graph), positions = new Map(graph.nodes.map(node => [node.id,node]));
  const wires = groupedWireGeometry(groups, positions);
  assert.equal(wires.size, 3);
  assert.equal(groups.find(group => group.from === 'gate')?.branchLabel, '권수 > 5');
  const data = wires.get(groupKey('input','output'))!;
  assert.deepEqual(data.from, wires.get(groupKey('input','gate'))!.from);
  assert.deepEqual(data.to, wires.get(groupKey('gate','output'))!.to);
  assert.ok(data.label.y < gate.y || data.label.y > gate.y + nodeLayout(gate).height);
});

test('하나의 연결점에서 길게 겹치는 선은 앵커를 보존하면서 별도 구간으로 갈라진다', () => {
  const source = createBlock('agent.task', {id:'source', x:0, y:0});
  const first = createBlock('agent.task', {id:'first', x:320, y:180});
  const second = createBlock('agent.task', {id:'second', x:320, y:380});
  const graph: Graph = {nodes:[source,first,second], edges:[first,second].map(node => ({
    id:node.id, kind:'flow', from:source.id, to:node.id, out:'next', input:'in',
  }))};
  const groups = groupEdges(graph), positions = new Map(graph.nodes.map(n => [n.id, n]));
  const together = groupedWireGeometry(groups, positions);
  const alone = groupedWireGeometry([groups[1]], positions).get(groups[1].id)!;
  const separated = together.get(groups[1].id)!;
  assert.deepEqual(separated.from, together.get(groups[0].id)!.from);
  assert.deepEqual(separated.to, alone.to);
  assert.notEqual(separated.d, alone.d);
  assert.equal(together.get(groups[0].id)!.d, groupedWireGeometry([groups[0]], positions).get(groups[0].id)!.d);
});

test('같은 축을 되짚는 중간점은 막다른 꼬리 없이 두 끝점 사이의 직선으로 그린다', () => {
  assert.equal(route({x:0, y:12}, {x:50, y:12}, 40), 'M0 12 L50 12');
});

test('분류 경로와 미분류가 같은 목적지에 닿을 때 이름 붙은 두 점에서 한 화살표로 합쳐진다', () => {
  const classifier = createBlock('ai.classify', {id:'c', x:0, y:30, config:{categories:['규정','예약']}});
  const search = createBlock('knowledge.search', {id:'search', x:300, y:10});
  const report = createBlock('output.answer', {id:'answer', x:300, y:190});
  const graph: Graph = { nodes:[classifier, search, report], edges:[
    {id:'fallback', from:'c', to:'search', kind:'flow', out:'other', input:'in'},
    {id:'rules', from:'c', to:'search', kind:'flow', out:'category:규정', input:'in'},
    {id:'data', from:'c', to:'search', kind:'data', out:'value', input:'input'},
    {id:'report', from:'c', to:'answer', kind:'data', out:'value', input:'input'},
  ]};
  const {routes, height} = nodeLayout(classifier);
  assert.deepEqual(routes.map(r => r.label), ['규정','예약','미분류']);
  assert.equal(extent([classifier]).h, height);
  const wires = groupedWireGeometry(groupEdges(graph), new Map(graph.nodes.map(n => [n.id,n])));
  const wire = wires.get(groupKey('c','search'))!;
  assert.deepEqual(wire.sources, [routes[0], routes[2]].map(r => ({x:W, y:classifier.y + r.y})));
  assert.ok(wire.stems.length);
  assert.deepEqual(wire.to, { x:search.x, y:search.y + H / 2 });
  const dataOnly = wires.get(groupKey('c','answer'))!;
  assert.deepEqual(dataOnly.sources, [{ x:W, y:classifier.y + H / 2 }]);
  assert.deepEqual(dataOnly.stems, []);
});

test('자동 정렬은 같은 열에 있는 분류 블록의 모든 경로 아래에 다음 블록을 놓는다', () => {
  const classifier = createBlock('ai.classify', {config:{categories:Array.from({length:10}, (_,i) => '경로 ' + i)}});
  const sibling = createBlock('agent.task');
  const [first, second] = arranged({nodes:[classifier,sibling], edges:[]}).nodes;
  assert.equal(first.x, second.x);
  assert.ok(second.y >= first.y + nodeLayout(first).height);
});

test('블록 추가는 분류 경로와 겹치는 새 카드만 같은 열의 빈자리로 내린다', () => {
  const classifier = createBlock('ai.classify', {x:50,y:60,config:{categories:['규정','예약','반납']}});
  const below = createBlock('ai.single_task', {x:65,y:260});
  const adjacent = createBlock('agent.task', {x:260,y:340});
  const added = createBlock('agent.task', {x:50,y:185});
  const placed = placeNewBlock(added, [below, adjacent, classifier]);
  assert.equal(placed.x, added.x);
  assert.ok(placed.y >= below.y + H);
  assert.equal(added.y, 185);
  assert.equal(classifier.y, 60);
  assert.equal(placeNewBlock(adjacent, [classifier, below, placed]), adjacent);
});

test('초급 연결도는 저장한 배치를 유지하며 모든 카드와 단일 출력을 선택할 공간을 확보한다', () => {
  const graph = templates.find(lesson => lesson.id === 'beginner')!.graph;
  const before = structuredClone(graph);
  const limits = overviewTargetLimits(graph.nodes);
  assert.equal(limits.size, 6);
  for (const node of graph.nodes) {
    const limit = limits.get(node.id)!;
    assert.ok((nodeLayout(node).height + limit.above + limit.below) * 0.299 >= 30, node.id);
    assert.equal(limit.maxPortOutside, 34, node.id);
  }
  assert.equal(limits.get('file')!.above + limits.get('file')!.below + H, 128);
  assert.deepEqual(graph, before);
});

test('좁은 열은 두 카드의 높이를 나눠 쓰고 인접한 출력은 연결선 통로의 절반을 비운다', () => {
  const upper = createBlock('ai.single_task', {id:'upper', x:-30, y:-50});
  const lower = createBlock('resource.context', {id:'lower', x:-30, y:upper.y + H + 12});
  const beside = createBlock('agent.task', {id:'beside', x:upper.x + W + 20, y:upper.y});
  const limits = overviewTargetLimits([lower, beside, upper]);
  assert.equal(limits.get(upper.id)!.below, 4);
  assert.equal(limits.get(lower.id)!.above, 4);
  assert.equal(limits.get(upper.id)!.above, 40);
  assert.equal(limits.get(upper.id)!.maxPortOutside, 10);

  const overlap = {...lower, y: upper.y};
  const crowded = overviewTargetLimits([upper, overlap]);
  assert.deepEqual(crowded.get(upper.id), {above:0, below:0, maxPortOutside:0});
  assert.deepEqual(crowded.get(lower.id), {above:0, below:0, maxPortOutside:0});
});

test('같은 줄에서 가장자리만 겹친 카드는 위아래로 커지고 깊이 겹친 카드는 기존 경계를 지킨다', () => {
  const material = createBlock('resource.context', {id:'material', x:0, y:0});
  const skill = createBlock('instruction.skill', {id:'skill', x:210, y:0});
  const next = createBlock('agent.task', {id:'next', x:420, y:0});
  const below = createBlock('agent.task', {id:'below', x:0, y:120});
  const minimumHeight = 94;
  const limits = overviewTargetLimits([next, skill, below, material], minimumHeight);
  const left = limits.get(material.id)!, right = limits.get(skill.id)!;
  assert.equal(left.maxPortOutside, 0);
  assert.ok(nodeLayout(material).height + left.above + left.below >= minimumHeight);
  assert.ok(nodeLayout(skill).height + right.above + right.below >= minimumHeight);
  assert.ok(nodeLayout(material).height + left.below < below.y - limits.get(below.id)!.above);
  assert.ok(right.namePortOutside! > right.maxPortOutside);
  assert.ok(skill.x + nodeLayout(skill).width + right.namePortOutside! < next.x);

  const overlap = overviewTargetLimits([material, {...skill, x:150}], minimumHeight);
  for (const id of [material.id, skill.id]) assert.deepEqual(overlap.get(id), {above:0, below:0, maxPortOutside:0});
});

test('분류 경로 옆에서는 기존 출력 행의 선택 영역을 여유 공간에서 제외한다', () => {
  const branch = createBlock('ai.classify', {id:'classify', x:0, y:0, config:{categories:['예약','문의','반납']}});
  const lower = createBlock('agent.task', {id:'lower', x:W + 6, y:nodeLayout(branch).height + 12});
  const away = createBlock('agent.task', {id:'away', x:W + 6, y:lower.y + 150});
  const limits = overviewTargetLimits([away, lower, branch]);
  assert.equal(limits.has(branch.id), false);
  assert.equal(limits.get(lower.id)!.above, 8);
  assert.equal(limits.get(lower.id)!.below, 40);
  assert.deepEqual(limits.get(away.id), {above:40, below:40, maxPortOutside:34});
});

test('밀집 분기 바로 아래 카드는 이웃의 최소 높이를 지키며 남는 공간을 받는다', () => {
  const branch = createBlock('ai.classify', {id:'router', x:0, y:0});
  const nodes = [branch, ...['one','two','three'].map((id, i) =>
    createBlock('agent.task', {id, x:0, y:nodeLayout(branch).height + i * 120}))];
  const minimumHeight = 94;
  const limits = overviewTargetLimits(nodes, minimumHeight);
  const one = limits.get('one')!, two = limits.get('two')!;
  assert.equal(one.above, 0);
  assert.ok(one.below > two.above);
  assert.ok(H + one.above + one.below >= minimumHeight);
  assert.ok(H + two.above + two.below >= minimumHeight);
  assert.ok(one.below + two.above <= 120 - H - 4);
});

test('자동 정렬은 블록 배치만 바꾸고 연결 종류와 전달 항목을 보존한다', () => {
  const input = createBlock('input.user_request',{id:'in'});
  const output = createBlock('output.answer',{id:'out'});
  const graph:Graph={nodes:[output,input],edges:[
    {id:'flow',from:'in',to:'out',kind:'flow',out:'next',input:'in'},
    {id:'data',from:'in',to:'out',kind:'data',out:'value',input:'input'},
  ]};
  const after = arranged(graph);
  assert.deepEqual(graph.edges,after.edges);
  assert.ok(after.nodes.find(n=>n.id==='in')!.x<after.nodes.find(n=>n.id==='out')!.x);
});

test('자료 블록은 실제 원문 첫 문장만 보여주며 등록 자료는 선택한 판의 원문을 사용한다', () => {
  const material = createBlock('resource.context', {id:'doc', config:{content:'  “대출 한도는 3권입니다.” 다음 규정입니다.'}});
  assert.equal(materialPreview(material), '“대출 한도는 3권입니다.”');
  const pinned = {...material, config:{...material.config, assetId:'library-rules', version:2}};
  assert.equal(materialPreview(pinned), '');
  assert.equal(materialPreview(pinned, {doc:'연체료는 0.5달러입니다. 두 번째.'}), '연체료는 0.5달러입니다.');
  assert.equal(materialPreview({...material, config:{content:'\n다섯 권까지\n반납은 창구에서'}}), '다섯 권까지');
  assert.equal(materialPreview({...material, type:'instruction.skill'}), '');
  assert.equal(materialPreview({...material, type:'ai.single_task'}), '');
});

test('초급 템플릿과 자동 정렬에서 자료와 Skill이 안내 Agent 아래에 자리하고 선은 실제 포트에 닿는다', () => {
  const original = templates.find(lesson => lesson.id === 'beginner')!.graph;
  for (const graph of [original, arranged(original)]) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const agent = nodes.get('agent')!, rules = nodes.get('rules')!, skill = nodes.get('skill')!;
    const flow = ['input','agent','file','output'].map(id => nodes.get(id)!);
    for (let i = 1; i < flow.length; i++) {
      assert.equal(flow[i].y, flow[i - 1].y);
      assert.ok(flow[i].x > flow[i - 1].x + nodeLayout(flow[i - 1]).width);
    }
    assert.equal(agent.x, rules.x);
    assert.equal(agent.x, skill.x);
    assert.ok(rules.y > agent.y + nodeLayout(agent).height);
    assert.ok(skill.y > rules.y + nodeLayout(rules).height);
    const wire = groupedWireGeometry(groupEdges(graph), nodes).get(groupKey('rules','agent'))!;
    assert.deepEqual(wire.from, {x:rules.x + nodeLayout(rules).width, y:rules.y + nodeLayout(rules).portY});
    assert.deepEqual(wire.to, {x:agent.x, y:agent.y + nodeLayout(agent).portY});
  }
});

test('넓은 그래프를 축소해도 인접 분기 이름이 서로 겹치지 않고 연결 경로는 그대로다', () => {
  const graph = templates.find(lesson => lesson.id === 'intermediate')!.graph;
  const groups = groupEdges(graph), lines = groupedWireGeometry(groups, new Map(graph.nodes.map(node => [node.id, node])));
  const before = structuredClone(lines);
  const fontSize = 27;
  const captions = wireCaptions(groups, lines, graph.nodes, fontSize);
  const lookup = captions.get(groupKey('intent','lookup'))!.label;
  const search = captions.get(groupKey('intent','search'))!.label;
  assert.ok(Math.abs(lookup.y - search.y) >= fontSize);
  assert.deepEqual(lines, before);
});

// 편집기 양쪽 패널을 연 720 × 900 PC 분할 창에서 측정한 캔버스 영역.
const splitEditorCanvas = {width:360, height:490};

test('긴 분류 이름에서 가운데의 서로 다른 단어를 행과 합류선에 남긴다', () => {
  const terms = ['대출 연장', '예약 변경', '회원 갱신', '대출 재신청'];
  const names = terms.map(term => '시립도서관 통합 서비스에서 접수한 ' + term + ' 요청에 대한 처리 상태 확인 및 결과 안내');
  const classifier = createBlock('ai.classify',{id:'classifier',config:{categories:names}});
  const targets = ['대출 상담','예약 담당','회원 담당'].map((title, i) =>
    createBlock('output.answer',{id:title,title,x:1300,y:i * 100}));
  const graph:Graph = {nodes:[classifier, ...targets],edges:names.map((name,i) => ({
    id:'route-'+i,from:classifier.id,out:'category:'+name,to:targets[i % 3].id,input:'in',kind:'flow',
  }))};
  const groups = groupEdges(graph);
  const lines = groupedWireGeometry(groups, new Map(graph.nodes.map(node => [node.id,node])));
  const view = {x:10,y:20,zoom:.21};
  const ports = selectedPortDirections(classifier.id,groups,lines,view,splitEditorCanvas,graph.nodes);
  const rows = ports.flatMap(port => port.route ? [port.route] : []);
  assert.deepEqual(rows.map(row => row.label), names);
  const captions = wireCaptions(groups,lines,graph.nodes,50,classifier.id,ports);
  for (const [i, row] of rows.entries()) {
    assert.ok(row.displayLabel.includes(terms[i]));
    assert.ok(captions.get(groupKey(classifier.id,targets[i % 3].id))!.text.includes(terms[i]));
  }
  const active = wireCaptions(groups,lines,graph.nodes,50,classifier.id,ports,rows[3].id);
  assert.equal(active.get(groupKey(classifier.id,targets[0].id))!.text,rows[3].displayLabel);
  assert.deepEqual(groups[0].flowConditions,[names[0],names[3]]);
});

test('펼친 모든 경로 행이 합류·분기 선과 화살촉을 피하고 상세를 열어도 같은 자리에 남는다', () => {
  const labels = ['대출 연장', '대출 재신청', '대출과 예약 확인', '예약과 회원 확인'];
  const classifier = createBlock('ai.classify',{id:'choice',x:390,y:160,config:{categories:labels}});
  const targets = ['loans','holds','account'].map((id,i) => createBlock('output.answer',{id,x:1480,y:[20,340,610][i]}));
  const nodes = [createBlock('input.user_request',{id:'ask',x:0,y:210}),classifier,...targets];
  const routes = nodeLayout(classifier).routes;
  const edges: Graph['edges'] = [[0],[0],[0,1],[1,2],[2]].flatMap((ids,i) => ids.map(j => ({
    id:`route-${i}-${j}`, kind:'flow', from:classifier.id, out:routes[i].id, to:targets[j].id, input:'in',
  })));
  const groups = groupEdges({nodes,edges});
  const lines = groupedWireGeometry(groups,new Map(nodes.map(node => [node.id,node])));
  for (const frame of [{width:804,height:675},splitEditorCanvas]) {
    const view = fittedView(nodes,frame);
    const getRows = (camera: typeof view, height: number) => selectedPortDirections(classifier.id,groups,lines,camera,
      {...frame,height},nodes).flatMap(port => port.route ? [port.route] : []);
    const rows = getRows(view,frame.height);
    assert.deepEqual(rows.map(row => row.id),routes.map(route => route.id));
    assert.deepEqual(getRows({...view,y:view.y - 40},frame.height - 92),rows);
    const padding = 6 / view.zoom;
    for (const row of rows) {
      const {x,y,width,height} = row.bounds;
      assert.ok(view.y + y * view.zoom >= 0 && view.y + (y + height) * view.zoom <= frame.height);
      for (const line of lines.values()) for (const path of line.centerlines) {
        for (let i = 1; i < path.length; i++) {
          const a = path[i-1], b = path[i];
          const samples = Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*view.zoom));
          for (let j=0;j<=samples;j++) {
            const px = a.x + (b.x-a.x)*j/samples, py = a.y + (b.y-a.y)*j/samples;
            assert.ok(px < x-padding || px > x+width+padding || py < y-padding || py > y+height+padding,
              row.label + ' 행이 연결선의 표시 공간을 가립니다.');
          }
        }
      }
    }
  }
});

test('넓은 팀은 입구에서 원래 글자 크기로 열고 전체 보기는 양 끝을 포함한다', () => {
  const root = templates.find(lesson => lesson.id === 'peer-review')!.graph;
  const team = root.nodes.find(node => node.graph)!.graph!;
  const frame = {width:690, height:460};
  const opening = fittedView(team.nodes, frame, true);
  const entry = team.nodes.find(node => node.type === 'input.user_request')!;
  assert.equal(opening.zoom, 1);
  assert.equal(entry.x + opening.x, 24);
  assert.ok(entry.y + opening.y >= 0 && entry.y + opening.y + H <= frame.height);
  const overview = fittedView(team.nodes, frame);
  const bounds = extent(team.nodes);
  assert.ok(overview.zoom < opening.zoom);
  assert.ok(bounds.x * overview.zoom + overview.x >= 23.9);
  assert.ok((bounds.x + bounds.w) * overview.zoom + overview.x <= frame.width - 23.9);
  const splitOverview = fittedView(team.nodes, splitEditorCanvas);
  assert.ok(splitOverview.zoom < overview.zoom);
  assert.ok(bounds.x * splitOverview.zoom + splitOverview.x >= 23.9);
  assert.ok((bounds.x + bounds.w) * splitOverview.zoom + splitOverview.x <= splitEditorCanvas.width - 23.9);
  assert.deepEqual(fittedView([entry], frame, true), fittedView([entry], frame));
});

test('초안 이름은 선택한 검토자로 들어오는 데이터선에만 붙고 이전 사본은 작성 블록 이름을 쓴다', () => {
  const team = templates.find(lesson => lesson.id === 'peer-review')!.graph.nodes.find(node => node.graph)!.graph!;
  const graph = structuredClone(team);
  const handoff = graph.edges.find(edge => edge.from === 'clarity' && edge.to === 'review-facts')!;
  delete handoff.label;
  const sender = graph.nodes.find(node => node.id === handoff.from)!;
  const receiver = graph.nodes.find(node => node.id === handoff.to)!;
  const groups = groupEdges(graph), lines = groupedWireGeometry(groups, new Map(graph.nodes.map(node => [node.id,node])));
  const key = groupKey(sender.id, receiver.id);
  const captions = wireCaptions(groups, lines, graph.nodes, 12, receiver.id);
  const caption = captions.get(key)!;
  assert.equal(caption.text, sender.title);
  assert.ok(caption.bounds.x + caption.bounds.width <= receiver.x);
  assert.equal(captions.has(groupKey('facts','review-clarity')), false);
  assert.equal(captions.has(groupKey('source', receiver.id)), false);
  assert.equal(captions.get(groupKey('input', receiver.id))?.text, '원래 질문');
  assert.equal(wireCaptions(groups, lines, graph.nodes, 12, sender.id).has(key), false);
  assert.equal(wireCaptions(groups, lines, graph.nodes, 12).has(key), false);
  const visible = revealBlock({x:-1500,y:0,zoom:1}, {width:560,height:450}, receiver, [caption.bounds]);
  assert.ok(caption.bounds.x + visible.x >= 12 && receiver.x + W + visible.x <= 548);
  assert.equal(visible.zoom, 1);
  assert.equal(revealBlock(visible, {width:560,height:450}, receiver, [caption.bounds]), visible);
});

test('선 클릭은 그리기 순서와 무관하게 가장 가까운 선을 고르고 겹친 위치만 후보로 제시한다', () => {
  const lines = new Map([
    ['first', {centerlines:[[{x:0,y:0}, {x:100,y:0}]]}],
    ['second', {centerlines:[[{x:0,y:5}, {x:100,y:5}]]}],
    ['branch', {centerlines:[[{x:50,y:-50}, {x:50,y:-10}], [{x:15,y:0}, {x:50,y:0}]]}],
  ]);
  assert.deepEqual(nearestWires(lines, {x:10,y:0.5}), ['first']);
  assert.deepEqual(nearestWires(lines, {x:10,y:4.5}), ['second']);
  assert.deepEqual(nearestWires(lines, {x:10,y:2.5}), ['first']);
  assert.deepEqual(nearestWires(lines, {x:20,y:1}).sort(), ['branch','first']);
});

test('직접 이름 붙인 일반 데이터선도 수신 블록 선택을 따르고 결합된 진행 경로는 그대로다', () => {
  const a = createBlock('data.transform', {id:'a'}), b = createBlock('output.answer', {id:'b',x:400});
  const graph: Graph = {nodes:[a,b],edges:[{id:'value',kind:'data',from:a.id,to:b.id,out:'value',input:'input',label:'완료된 예약'}]};
  const key = groupKey(a.id,b.id);
  const read = (id?: string) => {
    const groups = groupEdges(graph), lines = groupedWireGeometry(groups, new Map(graph.nodes.map(node => [node.id,node])));
    return wireCaptions(groups, lines, graph.nodes, 12, id).get(key);
  };
  assert.equal(read(b.id)?.text, '완료된 예약');
  assert.equal(read(a.id), undefined);
  graph.edges.push({id:'run',kind:'flow',from:a.id,to:b.id,out:'next',input:'in'});
  assert.equal(read(b.id), undefined);
});
