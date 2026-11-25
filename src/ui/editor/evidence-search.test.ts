import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock, validateGraph, type Edge, type Graph } from '../../domain';
import { executeGraph } from '../../engine';
import { insertEvidenceSearch } from './evidence-search';

function originalGraph(): Graph {
  const edge = (id: string, from: string, to: string, kind: Edge['kind'], out: string, input: string): Edge =>
    ({ id, from, to, kind, out, input });
  return {
    nodes: [
      createBlock('input.user_request', { id: 'ask' }),
      createBlock('resource.context', { id: 'doc', config: { content: '대출 한도는 5권입니다.' } }),
      createBlock('quality.evidence', { id: 'check' }),
      createBlock('output.answer', { id: 'end' }),
    ],
    edges: [
      edge('start', 'ask', 'check', 'flow', 'next', 'in'),
      edge('query', 'ask', 'check', 'data', 'value', 'input'),
      edge('doc-ref', 'doc', 'check', 'reference', 'ref', 'context'),
      ...['verified', 'insufficient', 'conflicting'].map(route => edge(route, 'check', 'end', 'flow', route, 'in')),
      edge('result', 'check', 'end', 'data', 'value', 'input'),
    ],
  };
}

test('원문과 질문만 연결한 근거 확인을 고치면 같은 질문으로 검색하고 원문 위치를 인용한다', async () => {
  const original = originalGraph();
  assert.match(validateGraph(original).map(issue => issue.message).join(' '), /자료 검색/);
  const { graph, search } = insertEvidenceSearch(original, original.nodes[2]);
  assert.deepEqual(validateGraph(graph), []);
  assert.equal(original.nodes.length, 4);
  assert.equal(graph.edges.find(edge => edge.id === 'doc-ref')?.to, search.id);
  assert.deepEqual(graph.edges.filter(edge => edge.from === 'check'), original.edges.filter(edge => edge.from === 'check'));
  const result = await executeGraph(graph, { runId: 'evidence-repair', input: '대출 한도' }, {
    tool: async () => { throw Error('unexpected tool'); },
    model: async request => {
      assert.equal(request.input, '대출 한도');
      assert.match(request.context, /대출 한도는 5권입니다/);
      return { text: JSON.stringify({ status: 'verified', references: [{ index: 0, quote: '대출 한도는 5권입니다.' }] }) };
    },
  });
  assert.equal(result.status, 'completed', result.error ?? '');
  const answer = JSON.parse(result.output);
  assert.equal(answer.status, 'verified');
  assert.equal(answer.passages[0].location, '1행');
});

test('연결된 원문의 본문선과 참조선이 겹쳐도 한 원문만 검색하고 명시한 원래 질문을 보존한다', () => {
  const original = originalGraph();
  original.edges.find(e => e.id === 'query')!.from = 'doc';
  original.edges.push({ id:'question', from:'ask', to:'check', kind:'data', out:'value', input:'question' });
  const { graph, search } = insertEvidenceSearch(original, original.nodes[2]);
  assert.deepEqual(validateGraph(graph), []);
  assert.equal(graph.edges.filter(e => e.to === search.id && e.input === 'context').length, 1);
  assert.equal(graph.edges.find(e => e.to === search.id && e.input === 'input')?.from, 'ask');
  assert.deepEqual(graph.edges.find(e => e.id === 'question'), original.edges.at(-1));
});
