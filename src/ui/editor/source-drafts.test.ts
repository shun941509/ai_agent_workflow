import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlock, type Graph } from '../../domain/index';
import { prepareSourceSave, retainSourceDrafts, sourceDraftKey, type SourceDrafts } from './source-drafts';
import { firstSourceChange, sourceSnapshot } from './source-comparison';

const source = createBlock('resource.context', { id: 'rules', config: { content: '3권' } });
const child = { ...createBlock('agent.team', { id: 'team' }), graph: { nodes: [source], edges: [] } };
const root: Graph = { nodes: [source, child], edges: [] };
const drafts: SourceDrafts = {
  [sourceDraftKey([], 'rules')]: { path: [], id: 'rules', base: '3권', text: '5권' },
  [sourceDraftKey(['team'], 'rules')]: { path: ['team'], id: 'rules', base: '3권', text: ' 7권\n' },
};

test('프로젝트 저장은 경로가 다른 동명 블록의 원문 초안을 한 설계에 반영한다', () => {
  const { graph, invalid } = prepareSourceSave(root, drafts);
  assert.equal(invalid, undefined);
  assert.equal(graph.nodes[0].config.content, '5권');
  assert.equal(graph.nodes[1].graph!.nodes[0].config.content, ' 7권\n');
  assert.equal(source.config.content, '3권');
  assert.deepEqual(retainSourceDrafts(drafts, graph), {});
});

test('빈 초안이 있으면 원래 설계를 보존하고 해당 블록을 가리킨다', () => {
  const key = sourceDraftKey(['team'], 'rules');
  const invalidDraft = { ...drafts[key], text: ' \n' };
  const result = prepareSourceSave(root, { ...drafts, [key]: invalidDraft });
  assert.equal(result.graph, root);
  assert.equal(result.invalid, invalidDraft);
});

test('삭제한 내부 설계나 자료판으로 교체한 블록의 초안은 다른 원문을 덮어쓰지 않는다', () => {
  const linked = { ...source, config: { ...source.config, assetId: 'library' } };
  const graph: Graph = { nodes: [linked], edges: [] };
  assert.deepEqual(retainSourceDrafts(drafts, graph), {});
  assert.equal(prepareSourceSave(graph, drafts).graph, graph);
});

test('원문 비교는 긴 조항에서도 바뀐 대목과 해당 조항을 먼저 표시한다', () => {
  const before = '제1조 안내\n제31조 대출\n' + '대출 기준 '.repeat(24) + '3권입니다.';
  const change = firstSourceChange(before,before.replace('3권','5권'));
  assert.equal(change.label,'제31조');
  assert.match(change.before,/3권/);
  assert.match(change.after,/5권/);
  assert.equal(change.original.marked,'3');
  assert.equal(change.edited.marked,'5');
  const crossReference='제31조(대출) 제5조에 따라 3권까지 허용한다.';
  assert.equal(firstSourceChange(crossReference,crossReference.replace('3권','5권')).label,'제31조');
  assert.ok(change.before.length<100);
  const appended = firstSourceChange('규정','규정\n새 조항');
  assert.match(appended.after,/새 조항/);
});

test('마지막 시험 원문은 같은 이름의 하위 팀 자료를 경로로 구분한다', () => {
  const applied = sourceSnapshot(root);
  const edited = sourceSnapshot(prepareSourceSave(root,drafts).graph);
  assert.equal(applied[sourceDraftKey([], 'rules')].text,'3권');
  assert.equal(edited[sourceDraftKey(['team'], 'rules')].text,' 7권\n');
});
