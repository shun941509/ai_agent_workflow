import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectBlocks, createBlock, type Graph } from '../src/domain';
import { executeGraph, type ModelInput } from '../src/engine';
import { modelGraph, reviewProposal } from '../src/server/proposal';
import { propose } from '../src/server/model';
import { usage } from '../src/server/auth';
import { legacyGuestSession } from './legacy-guest';
import { workDocumentGraph, workDocuments } from '../src/domain/work-documents';
import { newAgentPurpose } from '../src/domain/design-proposal';

test('홈에서 만든 Agent는 업무를 설명한 최초 요청과 보충 답변을 함께 보존한다', () => {
  const task = '회의 메모에서 결정 사항을 뽑아 줘';
  assert.equal(newAgentPurpose(task), task);
  assert.equal(newAgentPurpose(' 안녕하세요! ', task), task);
  const purpose = newAgentPurpose('회의 메모를 매주 받는데요', '결정 사항만 표로요');
  assert.match(purpose, /회의 메모를 매주 받는데요/);
  assert.match(purpose, /결정 사항만 표로요/);
  const long = newAgentPurpose('가'.repeat(12000), '나'.repeat(12000));
  assert.equal(long.length, 12000);
  assert.ok(long.includes('가') && long.includes('나'));
  const receipt: Graph = {nodes:[createBlock('agent.task', {config:{goal:'회의 메모에서 결정 사항을 뽑습니다.', instruction:'결정 사항만 표로 작성합니다.'}})], edges:[]};
  const recovered = newAgentPurpose('프랑스의 수도는 어디인가요?', '결정 사항만 표로요', receipt);
  assert.match(recovered, /회의 메모/);
  assert.match(recovered, /표로 작성/);
  assert.doesNotMatch(recovered, /프랑스/);
});

test('편집기와 업무 가이드의 모호한 변경은 한 번 묻고 구체적인 변경은 바로 제안한다', async t => {
  process.env.STUDIO_DATA_DIR = mkdtempSync(join(tmpdir(), 'studio-change-intent-'));
  process.env.OPENAI_API_KEY = 'offline-test-value';
  process.env.OPENAI_MODEL = 'test-model';
  const meeting = workDocuments.find(doc => doc.id === 'meeting-report')!;
  const graph: Graph = JSON.parse(JSON.stringify(workDocumentGraph(meeting)));
  const change = '담당자가 없는 항목은 미정으로 표시해 줘';
  const revised = structuredClone(graph);
  revised.nodes.find(node => node.id === 'report')!.config.instruction = change;
  const model = t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options.body)).input);
    const result = (input.clarificationAnswer ?? input.request) === change ? {...revised, purpose:'모델이 새로 지정한 담당 업무'} : {clarification:true};
    return Response.json({output:[{type:'message', content:[{type:'output_text', text:JSON.stringify(result)}]}]});
  });
  for (const changeContext of ['editor', meeting.id]) {
    const actor = legacyGuestSession().user;
    const initial = {prompt:'안녕하세요', graph, changeContext, requestKey:'greet'};
    const calls = model.mock.callCount();
    assert.deepEqual(await propose(actor, initial), {clarification:true});
    assert.equal(model.mock.callCount(), calls);
    await assert.rejects(propose(actor, {...initial, requestKey:'unclear', clarificationAnswer:'아무거나'}), {status:422});
    const answer = {...initial, requestKey:'clarified', clarificationAnswer:change};
    assert.deepEqual(await propose(actor, answer), {graph:revised});
    assert.deepEqual(await propose(actor, answer), {graph:revised});
    assert.deepEqual(await propose(actor, {...initial, requestKey:'direct', prompt:change}), {graph:revised});
  }
});

test('수정안의 입력별 완료 기준이 편집 가능한 텍스트로 보존되고 실행 모델에 우선순위 순서로 전달된다', async () => {
  for (const type of ['ai.single_task', 'agent.task']) {
    const original: Graph = {
      nodes: [
        createBlock('input.user_request', { id: 'source' }),
        createBlock(type, { id: 'extract', config: { goal: '출시 예정 상품만 표시', criterion: '출시일이 있어야 함' } }),
        createBlock('output.answer', { id: 'answer' }),
      ],
      edges: [],
    };
    original.edges.push(...connectBlocks(original, 'source', 'extract'), ...connectBlocks(original, 'extract', 'answer'));
    const revised = structuredClone(original);
    revised.nodes[1].config.goal = '상품별로 원문에 나온 출시 상태를 전달';
    const cases = [
      { when: '상품의 출시일이 미확정이라고 명시된 경우', result: '상품과 일정 미확정을 별도로 표시' },
      { when: '출시일이 확정된 상품', result: '상품과 출시일을 표시' },
      { when: '상품 기획에 대한 의견만 있는 경우', result: '제외' },
    ];
    revised.nodes[1].config.criterion = cases;
    const graph = reviewProposal(revised, original);
    const criterion = graph.nodes[1].config.criterion;
    assert.equal(typeof criterion, 'string');
    assert.deepEqual(criterion.split('\n').slice(1), cases.map(c => `- ${c.when} → ${c.result}`));
    assert.equal(original.nodes[1].config.criterion, '출시일이 있어야 함');
    const input = '녹음기 출시일은 아직 정해지지 않았습니다.';
    const requests: ModelInput[] = [];
    const run = await executeGraph(graph, { runId: 'criteria', input }, {
      model: async request => { requests.push(request); return { text: request.instruction.includes('완료 판정:')?'{"status":"met","reason":"미확정 일정 표시"}':'녹음기 · 일정 미확정' }; },
      tool: async () => { throw new Error('도구를 사용하는 설계가 아닙니다.'); },
    });
    assert.equal(run.status, 'completed');
    assert.equal(requests.length, type==='agent.task'?2:1);
    assert.equal(requests[0].input, input);
    assert.ok(requests[0].instruction.includes(criterion));
    assert.doesNotMatch(requests[0].instruction, /출시일이 있어야 함/);
    revised.nodes[1].config.criterion = [{ when: '불완전한 사례' }];
    assert.throws(() => reviewProposal(revised, original), /조건과 그에 따른 결과/);
  }
});

test('AI changes cannot borrow the parent scope or create privileged references', () => {
  const privateRole = createBlock('agent.task', {
    id: 'role',
    x: 40,
    y: 90,
    config: { allowedTools: ['reservations.list'] },
  });
  const doc = createBlock('resource.context', {
    id: 'doc',
    config: { assetId: 'a', version: 4, assetGrant: 'internal-grant' },
  });
  const team = createBlock('agent.team', {
    id: 'team',
    graph: {
      nodes: [
        createBlock('agent.task', { id: 'role', config: { allowedTools: [] } }),
      ],
      edges: [],
    },
  });
  const before: Graph = { nodes: [privateRole, doc, team], edges: [] };
  const proposal = structuredClone(before);
  proposal.nodes[0].config.allowedTools.push('reservations.create');
  proposal.nodes[0].x = 999;
  proposal.nodes[1].config.assetId = 'other';
  proposal.nodes[1].config.version = 30;
  proposal.nodes[2].graph!.nodes[0].config.allowedTools = ['reservations.list'];
  proposal.nodes.push(
    createBlock('tool.invoke', {
      id: 'do',
      config: { tool: 'reservations.cancel' },
    })
  );
  proposal.edges.push({
    id: 'grant',
    kind: 'reference',
    from: 'doc',
    to: 'role',
    out: 'ref',
    input: 'mcp',
  });
  const clean = reviewProposal(proposal, before);
  assert.deepEqual(clean.nodes[0].config.allowedTools, ['reservations.list']);
  assert.deepEqual(clean.nodes[2].graph!.nodes[0].config.allowedTools, []);
  assert.equal(clean.nodes[0].x, 40);
  assert.equal(clean.nodes[1].config.version, 4);
  assert.equal(clean.nodes[1].config.assetGrant, 'internal-grant');
  assert.equal(clean.nodes[3].config.tool, undefined);
  assert.equal(clean.edges.length, 0);
  assert.ok(!JSON.stringify(modelGraph(clean)).includes('internal-grant'));
});

test('proposal requests bind their input and charge independent guest quota exactly once', async () => {
  process.env.STUDIO_DATA_DIR = mkdtempSync(
    join(tmpdir(), 'studio-proposals-')
  );
  process.env.OPENAI_API_KEY = 'offline-test-value';
  process.env.OPENAI_MODEL = 'test-model';
  const fetchBefore = globalThis.fetch;
  const actor = legacyGuestSession().user,
    before: Graph = { nodes: [], edges: [] };
  const generated = {
    nodes: [createBlock('ai.single_task', { config: { goal: '회의 정리' } })],
    edges: [],
  };
  const body = {
    graph: before,
    prompt: '회의 내용을 정리하세요.',
    requestKey: 'same',
  };
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(generated) }],
          },
        ],
      });
    };
    await propose(actor, body);
    await propose(actor, body);
    assert.equal(calls, 1);
    await assert.rejects(
      propose(actor, { ...body, prompt: '다른 동작' }),
      /다른 설계/
    );
    assert.equal(usage(actor).design.used, 1);
    assert.equal(usage(actor).run.used, 0);
    globalThis.fetch = async () =>
      Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
    await assert.rejects(
      propose(actor, { ...body, requestKey: 'failed' }),
      /invalid_api_key/
    );
    assert.equal(usage(actor).design.used, 1);
    const cancel = new AbortController();
    globalThis.fetch = async (_url, options) => {
      cancel.abort();
      options?.signal?.throwIfAborted();
      throw new Error('취소된 제안이 모델로 전달됐습니다.');
    };
    await assert.rejects(propose(actor, {...body, requestKey:'cancelled'}, cancel.signal), {name:'AbortError'});
    assert.equal(usage(actor).design.used, 1);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('새 Agent의 인사말은 초안 대신 한 번 보충을 요청하고, 답변과 직접 요청은 초안을 받는다', async t => {
  process.env.STUDIO_DATA_DIR = mkdtempSync(join(tmpdir(), 'studio-agent-intent-'));
  process.env.OPENAI_API_KEY = 'offline-test-value';
  process.env.OPENAI_MODEL = 'test-model';
  const actor = legacyGuestSession().user;
  const first = {newAgent: true, graph: {nodes: [], edges: []}, prompt: '안녕하세요', requestKey: 'greet'};
  const task = '회의 메모에서 결정 사항을 뽑아 줘';
  const graph: Graph = {
    nodes: [
      createBlock('input.user_request', {id: 'input'}),
      createBlock('agent.task', {id: 'extract', config: {goal: task}}),
      createBlock('output.answer', {id: 'answer'}),
    ],
    edges: [],
  };
  graph.edges.push(...connectBlocks(graph, 'input', 'extract'), ...connectBlocks(graph, 'extract', 'answer'));
  const requests: {request: string; clarificationAnswer?: string}[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(options.body)).input);
    requests.push(input);
    return Response.json({output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(graph)}]}]});
  });
  assert.deepEqual(await propose(actor, first), {clarification: true});
  assert.deepEqual(await propose(actor, first), {clarification: true});
  assert.equal(requests.length, 0);
  const followup = {...first, clarificationAnswer: task, requestKey: 'clarified'};
  assert.deepEqual(await propose(actor, followup), {graph});
  assert.deepEqual(await propose(actor, followup), {graph});
  assert.deepEqual(await propose(actor, {...first, prompt: task, requestKey: 'direct'}), {graph});
  assert.deepEqual(requests.map(({request, clarificationAnswer}) => [request, clarificationAnswer]), [
    ['안녕하세요', task],
    [task, undefined],
  ]);
  await assert.rejects(propose(actor, {...followup, clarificationAnswer: '번역해 줘'}), /다른 설계/);
});

test('단발성 지식 질문에 보충을 한 번만 요청하고 같은 주제의 업무가 정해지면 초안을 반환한다', async t => {
  process.env.STUDIO_DATA_DIR = mkdtempSync(join(tmpdir(), 'studio-agent-clarification-'));
  process.env.OPENAI_API_KEY = 'offline-test-value';
  process.env.OPENAI_MODEL = 'test-model';
  const actor = legacyGuestSession().user;
  const initial = {newAgent: true, graph: {nodes: [], edges: []}, prompt: '프랑스의 수도는 어디인가요?', requestKey: 'unspecified'};
  const task = '수도 질문에 답해 줘';
  const graph: Graph = {nodes:[createBlock('input.user_request', {id:'in'}),
    createBlock('agent.task', {id:'task', config:{goal:task}}), createBlock('output.answer', {id:'out'})], edges:[]};
  graph.edges.push(...connectBlocks(graph, 'in', 'task'), ...connectBlocks(graph, 'task', 'out'));
  const model = t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const {request, clarificationAnswer} = JSON.parse(JSON.parse(String(options.body)).input);
    const result = (clarificationAnswer ?? request) === task ? {...graph, purpose:'입력한 나라의 수도를 안내합니다.'} : {clarification:true};
    return Response.json({output:[{type:'message', content:[{type:'output_text', text:JSON.stringify(result)}]}]});
  });
  assert.deepEqual(await propose(actor, initial), {clarification: true});
  assert.deepEqual(await propose(actor, initial), {clarification: true});
  assert.equal(model.mock.callCount(), 1);
  await assert.rejects(
    propose(actor, {...initial, clarificationAnswer: '그러면 이탈리아 수도는 어디예요?', requestKey: 'still-unspecified'}),
    {status: 422, message: '보충 설명에 Agent가 맡을 작업을 구체적으로 적어 주세요.'}
  );
  await assert.rejects(
    propose(actor, {...initial, clarificationAnswer: '가'.repeat(12001), requestKey: 'too-long'}),
    {status: 400}
  );
  assert.equal(model.mock.callCount(), 2);
  await assert.rejects(propose(actor, {...initial, newAgent:false, requestKey:'editor'}), /Workflow 구조/);
  const clarified = await propose(actor, {...initial, clarificationAnswer:task, requestKey:'follow-up-role'});
  assert.deepEqual(clarified, {graph:{...graph, agentScope:{mode:'dedicated', purpose:'입력한 나라의 수도를 안내합니다.'}}});
  assert.deepEqual(await propose(actor, {...initial, prompt:task, requestKey:'direct-role'}), {graph});
});
