import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlock, templates, type Graph } from '../src/domain';
import { executeGraph, type EngineServices } from '../src/engine';
import { dynamicLessonChecks } from '../src/domain/dynamic-lesson-policy';

const lesson = templates.find(template => template.id === 'dynamic')!;
const tool: EngineServices['tool'] = async () => { throw Error('예상하지 않은 도구 호출'); };

test('동시 3명은 자유 실험으로 안내하고 기본 실습으로 돌아갈 설정을 제시한다', () => {
  const policy = {maxCreatedAgents:4, maxInFlightAgents:3, failurePolicy:'collect' as const};
  const checks = dynamicLessonChecks(policy).join('\n');
  assert.match(checks, /자유 실험/);
  assert.match(checks, /동시 실행 상한.*2명/);
  assert.doesNotMatch(dynamicLessonChecks({...policy,maxInFlightAgents:2}).join('\n'), /자유 실험/);
});

test('강변을 먼저 고르면 중단 기록이 첫 차수의 근거 부족, 다음 차수 미시작, 선택 제외를 구분한다', async () => {
  const graph = structuredClone(lesson.graph);
  const spawn = graph.nodes.find(node => node.id === 'spawn')!;
  Object.assign(spawn.config, {maxCreatedAgents:2, maxInFlightAgents:1, failurePolicy:'stop'});
  const service: EngineServices = {tool, model:async () => { throw Error('자료가 없는 지점은 모델 호출이 필요하지 않습니다.'); }};
  const request = {runId:'ordered-stop', input:lesson.question};
  const first = await executeGraph(graph, request, service);
  assert.equal(first.status, 'waiting');
  const run = await executeGraph(graph, {...request, checkpoint:first.checkpoint,
    reply:{waitId:first.wait!.id,value:JSON.stringify(['강변도서관','중앙도서관'])}}, service);
  assert.equal(run.status, 'failed');
  assert.match(run.error!, /중단 정책.*강변도서관.*근거 부족/);
  const stop = run.events.find(event => event.nodeId === 'spawn' && event.kind === 'stop');
  assert.deepEqual(stop?.data, {wave:1, target:'강변도서관', reason:'근거 부족',
    notStarted:['중앙도서관'], excluded:['호수도서관','숲도서관']});
  assert.deepEqual(run.events.filter(event => event.nodeId === 'spawn' && event.kind === 'role').map(event => event.detail), ['강변도서관 담당 Agent 생성 · 1차']);
  assert.equal(run.events.some(event => event.nodeId === 'summary'), false);
});

test('조사 실패, 원문 부족, 확인된 결과는 개별 지점의 상태로 남는다', async () => {
  const service: EngineServices = {
    tool,
    model: async request => {
      if (!request.instruction.includes('"references"')) return { text: request.input };
      if (request.input === '호수도서관') throw Error('조사 서비스 연결 실패');
      const quote = request.input === '중앙도서관'
        ? '중앙도서관은 평일 오전 9시에 엽니다.'
        : '숲도서관은 월요일에 휴관합니다.';
      assert.ok(request.context.includes(quote));
      return { text: JSON.stringify({status: 'verified', references: [{index: 0, quote}]}) };
    },
  };
  const run = await executeGraph(lesson.graph, {runId: 'branch-errors', input: lesson.question}, service);
  assert.equal(run.status, 'completed', run.error ?? '');
  const rows = JSON.parse(run.output).results;
  assert.deepEqual(rows.map((row: {status: string}) => row.status), ['verified', 'failed', 'verified', 'insufficient']);
  assert.match(rows[1].error, /조사 서비스 연결 실패/);
  assert.equal(rows[3].error, '근거 부족');
  assert.deepEqual(rows[3].result.passages, []);
});

test('결과 수집 정책도 실행 전체의 예산 소진과 사용자 중지를 따라야 한다', async () => {
  const input = lesson.question;
  const model: EngineServices['model'] = async () => ({text: '{"status":"insufficient","references":[]}'});
  const budget = await executeGraph(lesson.graph, {runId: 'branch-budget', input}, {tool, model, limits: {agents: 1}});
  assert.equal(budget.status, 'failed');
  assert.match(budget.error!, /한도/);
  assert.equal(budget.events.some(event => event.nodeId === 'summary'), false);

  let stopped = false;
  const stoppedRun = await executeGraph(lesson.graph, {runId: 'branch-stop', input}, {
    tool, isStopped: () => stopped, model: async request => { stopped = true; return model(request); },
  });
  assert.equal(stoppedRun.status, 'stopped');
  assert.equal(stoppedRun.events.some(event => event.nodeId === 'summary'), false);
});

test('결과 수집 중 두 하위 담당자의 추가 질문을 같은 실행에서 각각 재개한다', async () => {
  const graph = structuredClone(lesson.graph);
  const spawn = graph.nodes.find(node => node.id === 'spawn')!;
  spawn.config.resultRequirement = 'output';
  const child: Graph = {
    nodes: [
      createBlock('input.user_request', {id: 'site'}),
      createBlock('input.form', {id: 'ask', config: {prompt: '{{input}} 조사 결과를 입력하세요.'}}),
      createBlock('output.answer', {id: 'answer'}),
    ],
    edges: [],
  };
  for (const [from, to] of [['site', 'ask'], ['ask', 'answer']]) {
    child.edges.push({id: from+'-flow', from, to, kind:'flow', out:'next', input:'in'});
    child.edges.push({id: from+'-data', from, to, kind:'data', out:'value', input:'input'});
  }
  spawn.graph = child;
  const service: EngineServices = {tool, model: async request => ({text: request.input})};
  const request = {runId: 'branch-wait', input:'중앙도서관, 호수도서관'};
  let run = await executeGraph(graph, request, service);
  for (const value of ['첫째 회신', '둘째 회신']) {
    assert.equal(run.status, 'waiting');
    run = await executeGraph(graph, {...request, checkpoint:run.checkpoint, reply:{waitId:run.wait!.id,value}}, service);
  }
  assert.equal(run.status, 'completed', run.error ?? '');
  assert.deepEqual(JSON.parse(run.output).results.map((row: {result:string}) => row.result), ['첫째 회신', '둘째 회신']);
  assert.equal(run.checkpoint.counts.agents, 2);
});
