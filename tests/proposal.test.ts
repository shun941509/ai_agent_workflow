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
      model: async request => { requests.push(request); return { text: '녹음기 · 일정 미확정' }; },
      tool: async () => { throw new Error('도구를 사용하는 설계가 아닙니다.'); },
    });
    assert.equal(run.status, 'completed');
    assert.equal(requests.length, 1);
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
