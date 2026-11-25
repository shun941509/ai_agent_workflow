import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlock, type Graph} from '../../domain';
import {acceptsAsset, assetTargets, attachAssetEdition, attachWorkflowAsset, defaultAssetTarget, type SharedAssetPin} from './asset-attachment';

test('네 종류의 선택한 자료판을 해당 블록의 참조 입력에 연결한다', () => {
  const cases = [
    ['document', 'resource.context', 'context'], ['knowledge', 'resource.context', 'context'],
    ['skill', 'instruction.skill', 'skill'], ['mcp', 'connection.mcp', 'mcp'],
  ] as const;
  for (const [kind, type, input] of cases) {
    const target = createBlock(defaultAssetTarget(kind));
    const graph:Graph = {nodes:[target], edges:[]};
    const asset = {id:'original', name:'첫 번째로 게시한 이름', kind, version:2};
    const linked = attachAssetEdition(graph, target.id, asset);
    assert.equal(linked.source.type, type);
    assert.equal(linked.source.title, asset.name);
    assert.equal(linked.source.config.assetId, 'original');
    assert.equal(linked.source.config.version, 2);
    assert.deepEqual(linked.graph.edges.map(e => [e.kind, e.input, e.out, e.from, e.to]),
      [['reference', input, 'ref', linked.source.id, target.id]]);
    assert.equal(attachAssetEdition(linked.graph, target.id, asset).graph, linked.graph);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.edges.length, 0);
  }
});

test('기존 연결과 위치를 보존하며 같은 자료판을 두 블록에서 재사용한다', () => {
  const targets = [createBlock('agent.task'), createBlock('knowledge.search')];
  const pin:SharedAssetPin = {id:'book', name:'이용규정', kind:'document', version:2};
  const first = attachAssetEdition({nodes:targets, edges:[]}, targets[0].id, pin);
  const second = attachAssetEdition(first.graph, targets[1].id, pin);
  assert.equal(second.source, first.source);
  assert.equal(second.graph.nodes, first.graph.nodes);
  assert.deepEqual(second.graph.edges.map(e => [e.from, e.to]), targets.map(n => [first.source.id, n.id]));
  assert.equal(acceptsAsset(createBlock('quality.evidence'), 'document'), false);
  assert.throws(() => attachAssetEdition(second.graph, targets[1].id, {...pin, kind:'mcp'}), /받을 수 있는 블록/);
});

test('다른 MCP 판이 연결된 블록의 기존 도구 범위를 보호한다', () => {
  const first = createBlock('agent.task'), second = createBlock('tool.invoke');
  const pin:SharedAssetPin = {id:'connector', name:'목록 조회', kind:'mcp', version:1};
  const old = attachAssetEdition({nodes:[first, second], edges:[]}, first.id, pin);
  const newer = {...pin, version:2};
  assert.throws(() => attachAssetEdition(old.graph, first.id, newer), /다른 판/);
  const next = attachAssetEdition(old.graph, second.id, newer);
  assert.equal(old.source.config.version, 1);
  assert.equal(next.source.config.version, 2);
  assert.deepEqual(next.graph.edges.map(e => [e.from, e.to]), [[old.source.id, first.id], [next.source.id, second.id]]);
});

test('동명 팀과 재사용된 하위 블록 ID도 선택한 내부 Workflow에만 자료판을 연결한다', () => {
  const team = (id:string) => createBlock('agent.team', {id, title:'안내 팀',
    graph:{nodes:[createBlock('agent.task', {id:'worker', title:'답변 담당'})], edges:[]}});
  const root:Graph = {nodes:[team('a'), team('b'), createBlock('agent.task', {id:'["a","worker"]'})], edges:[]};
  const pin:SharedAssetPin = {kind:'document', id:'manual', name:'이용안내', version:3};
  const choices = assetTargets(root, pin.kind);
  assert.equal(new Set(choices.map(node => node.value)).size, 3);
  const target = choices.find(node => node.value === '["b","worker"]')!;
  assert.equal(target.label, '2번 · 안내 팀 › 답변 담당');
  const next = attachWorkflowAsset(root, pin, target);
  assert.deepEqual(next.path, ['b']);
  assert.equal(next.graph.nodes[0], root.nodes[0]);
  assert.equal(next.graph.nodes[2], root.nodes[2]);
  assert.deepEqual(next.graph.edges, []);
  const child = next.graph.nodes[1].graph!;
  assert.equal(child.nodes.find(node => node.id === next.source.id)?.config.version, 3);
  assert.deepEqual(child.edges.map(edge => [edge.from, edge.to, edge.input]), [[next.source.id, 'worker', 'context']]);
  assert.equal(attachWorkflowAsset(next.graph, pin, target).graph, next.graph);
  assert.throws(() => attachWorkflowAsset(root, pin, {path:['removed'], id:'worker'}), /블록을 선택/);
});

