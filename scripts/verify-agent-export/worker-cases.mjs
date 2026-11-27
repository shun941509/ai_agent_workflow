import assert from 'node:assert/strict';
import {connectBlocks, createBlock} from '../../src/domain/index.ts';

function block(type, id, config = {}, graph) {
  return createBlock(type, {id, config, graph});
}

function wire(nodes, pairs = nodes.slice(1).map((node, i) => [nodes[i].id, node.id])) {
  const graph = {nodes, edges: []};
  for (const [from, to] of pairs) graph.edges.push(...connectBlocks(graph, from, to));
  return graph;
}

function connectRoute(graph, from, to, out) {
  graph.edges.push(...connectBlocks(graph, from, to, [{kind:'flow', out, input:'in'}]));
}

function connectValue(graph, from, to) {
  graph.edges.push(...connectBlocks(graph, from, to, [{kind:'data', out:'value', input:'input'}]));
}

function connectExits(graph, from, routes) {
  for (const out of routes) connectRoute(graph, from, 'end', out);
  connectValue(graph, from, 'end');
}

const ask = () => block('input.user_request','q');
const end = (id = 'end') => block('output.answer',id,{format:'json'});
const value = (run, id) => run.checkpoint.steps['root/' + id].values.value;
const attachment = (fileName, data) => JSON.stringify({fileName, content:JSON.stringify(data)});

export function workerCases(connector) {
  const cases = [];
  const add = (id, title, graph, input, check) => cases.push({id, title, graph, input, check});
  const child = wire([ask(), end()]);

  add('basic-trigger', '수동 시작과 답변', wire([
    block('control.trigger','trigger',{trigger:'manual'}),
    block('ai.single_task','answer',{goal:'입력 서식이 맞는지 확인하세요.'}), end(),
  ]), '서식 확인', run => assert.equal(value(run,'answer'),'확인됨'));

  const agent = wire([ask(), block('agent.task','job',{goal:'검토 절차에 따라 내부 도구에 서식을 전달하세요.',maxSteps:4}), end()]);
  agent.nodes.push(
    block('instruction.skill','guide',{content:'요청을 검토 도구로 한 번 전달한 뒤 결과를 정리하세요.'}),
    block('workflow.tool','internal',{name:'review',description:'제출된 서식을 검토합니다.'},child),
    block('connection.mcp','mcp',{assetId:connector.id,version:connector.version,server:connector.name}),
  );
  for (const id of ['guide','internal','mcp']) agent.edges.push(...connectBlocks(agent,id,'job'));
  add('agent-workflow-tool','Skill과 내부 검토 도구',agent,'대조',run => {
    assert.equal(value(run,'job'),'확인됨');
    assert.ok(Object.keys(run.checkpoint.steps).some(path => path.includes('/tool-')));
  });

  const classify = wire([ask(), block('ai.classify','classify',{categories:['일정','기타']}), end()], [['q','classify']]);
  connectExits(classify,'classify',['category:일정','category:기타','other']);
  add('classify','요청 분류',classify,'분류 입력',run => {
    assert.deepEqual(run.checkpoint.steps['root/classify'].routes,['category:일정']);
    assert.equal(value(run,'classify'),'분류 입력');
  });

  const condition = wire([ask(), block('control.branch','decide',{operator:'equals',expected:'맞음'}), end()], [['q','decide']]);
  connectExits(condition,'decide',['yes','no']);
  add('condition','조건별 결과',condition,'거짓',run => assert.deepEqual(run.checkpoint.steps['root/decide'].routes,['no']));

  add('file-transform','첨부에서 결과 파일까지',wire([
    block('file.input','attach',{accept:'.json',historyFields:'id'}),
    block('document.read','read',{format:'auto'}),
    block('data.validate','validate',{requiredFields:['id'],types:{id:'number'}}),
    block('data.transform','select',{operation:'select',path:'id'}),
    block('file.create','create',{format:'json',fileName:'id.json'}), end(),
  ]), attachment('input.JSON',{id:7}),run => assert.equal(value(run,'create').content,'7'));

  const evidence = wire([ask(), block('knowledge.search','search',{query:'연장',matchMode:'literal'}),
    block('quality.evidence','check',{requireOriginal:true,includeSourceLines:true}), end()], [['q','search'],['search','check']]);
  evidence.nodes.push(block('resource.context','rule',{content:'규정\n연장 2회'}));
  evidence.edges.push(...connectBlocks(evidence,'rule','search'));
  connectExits(evidence,'check',['verified','insufficient','conflicting']);
  add('evidence','대출 연장 규정 원문 확인',evidence,'연장 횟수',run => {
    assert.deepEqual(value(run,'check').sourceLines,['연장 2회']);
  });

  const knowledge = wire([ask(), block('knowledge.manage','index',{operation:'index',version:'7'}), end()]);
  knowledge.nodes.push(block('resource.context','ref',{content:'색인 원문'}));
  knowledge.edges.push(...connectBlocks(knowledge,'ref','index'));
  add('knowledge','자료판 색인',knowledge,'색인',run => assert.equal(value(run,'index').version,'7'));

  add('waits','접수와 담당자 검토',wire([ask(),
    block('input.form','form',{prompt:'도시 이름',fields:[{key:'city',label:'도시',required:true}]}),
    block('control.wait','signal',{prompt:'접수 확인'}), block('review.human','review',{prompt:'검토 의견'}), end(),
  ]),'확인',run => assert.equal(value(run,'review'),'좋습니다'));

  const approval = wire([ask(),
    block('approval.action','approve',{tool:'reservations.create',args:{book:'{{input}}',branch:'중앙'}}),
    block('tool.invoke','write',{tool:'reservations.create',args:{}}), end(), end('declined'),
  ], [['q','approve'],['write','end']]);
  for (const [out, to] of [['approved','write'],['rejected','declined']]) {
    connectRoute(approval,'approve',to,out);
    connectValue(approval,'approve',to);
  }
  add('approval','도서 예약 승인',approval,'샘플',run => assert.equal(value(run,'write').book,'샘플'));

  add('compensate','도서 예약과 보상 취소',wire([ask(),
    block('tool.invoke','book',{tool:'reservations.create',args:{book:'샘플',branch:'중앙'}}),
    block('error.compensate','cancel',{tool:'reservations.cancel',args:{reservationId:'{{input.reservationId}}'}}), end(),
  ]),'샘플',run => assert.equal(value(run,'cancel').status,'cancelled'));

  add('errors','누락 필드 오류 처리',wire([ask(),block('data.transform','bad',{operation:'select',path:'missing'}),end(),
    block('error.handle','recover',{strategy:'continue',message:'사유 {{error}}'}),end('result'),
  ],[['q','bad'],['bad','end'],['bad','recover'],['recover','result']]),'{}',run => assert.match(value(run,'recover'),/missing/));
  add('privacy','연락처 가리기',wire([ask(),block('safety.redact','mask',{operation:'mask',categories:['email']}),end()]),
    'name@example.org',run => assert.match(value(run,'mask'),/이메일 가림/));

  const parallel = wire([ask(),block('control.parallel','fork',{maxConcurrency:2}),
    block('agent.delegate','review',{role:'검토',instruction:'수량을 대조하세요.'}),
    block('agent.handoff','edit',{role:'편집',instruction:'이름을 대조하세요.'}),
    block('control.join','join',{merge:'array'}),end(),
  ],[['q','fork'],['fork','review'],['fork','edit'],['review','join'],['edit','join'],['join','end']]);
  add('parallel-team','병렬 검토팀과 합류',wire([ask(),block('agent.team','team',{goal:'두 검토 결과를 모으세요.'},parallel),end()]),
    '의뢰',run => assert.deepEqual(value(run,'team'),['확인됨','확인됨']));

  add('iterations','반복 항목과 하위 Workflow',wire([block('file.input','file'),block('document.read','read',{format:'json'}),
    block('control.loop','loop',{maxIterations:2},child),block('workflow.call','call',{},child),end(),
  ]),attachment('array.json',['A','B']),run => assert.deepEqual(value(run,'call'),['A','B']));
  add('selection','담당자 선택과 동적 배정',wire([ask(),
    block('agent.coordinate','list',{goal:'적합한 작업을 고르세요.',tasks:['A','B'],maxSteps:2}),
    block('agent.select_candidate','single',{criterion:'적합도',candidates:['A','B']}),
    block('agent.create_dynamic','delegate',{role:'담당',instruction:'선택된 대상을 확인하세요.'}),end(),
  ]),'의뢰',run => assert.equal(value(run,'delegate').results[0].target,'B'));
  add('storage','업무 값 기억',wire([ask(),block('memory.access','write',{operation:'write',key:'sample'}),
    block('memory.access','read',{operation:'read',key:'sample'}),end(),
  ]),'저장된 값',run => assert.equal(value(run,'read'),'저장된 값'));
  add('evaluation','평가와 문맥 압축',wire([ask(),block('quality.evaluate','evaluate',{criterion:'적합도',threshold:75}),
    block('context.compress','sum',{preserve:'점수',maxLength:80}),block('control.terminate','done',{status:'success',message:'마침'}),
  ]),'입력',run => {
    assert.equal(value(run,'evaluate').passed,false);
    assert.equal(value(run,'evaluate').threshold,75);
    assert.equal(run.output,'마침');
  });
  return cases;
}
