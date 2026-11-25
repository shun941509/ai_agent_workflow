import assert from 'node:assert/strict';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {createBlock} from '../src/domain/graph';
import {swTeamTemplates} from '../src/domain/sw-team-templates';
import type {Edge, Graph} from '../src/domain/types';
import {parallelInstructions} from '../src/server/agent-parallel-instructions';
import {buildAgentZip} from '../src/server/agent-zip';

const block = (id: string, type: string, config = {}) => createBlock(type, {id, title:id, config});
function edge(from: string, to: string, kind: 'data' | 'flow' = 'flow'): Edge {
  return {id:[from,to,kind].join('-'), from, to, kind, out:kind === 'data' ? 'value' : 'next', input:kind === 'data' ? 'input' : 'in'};
}

test('실제 코드 검토 ZIP에서 두 위임 호출을 시작한 뒤 결과를 기다리고 두 의견을 합류에 전달한다', () => {
  const template = swTeamTemplates.find(item => item.id === 'sw-code-review')!;
  const files = unzipSync(buildAgentZip({title:template.title, graph:template.graph, resources:[], files:[]}));
  const pages = Object.entries(files).filter(([path]) => path === 'AGENTS.md' || /^workflow\/step-/.test(path))
    .map(([,data]) => strFromU8(data));
  const fork = pages.find(text => text.includes('같은 차수의 위임을 모두 시작한 뒤'))!;
  assert.ok(fork);
  assert.match(fork, /최대 2개/);
  assert.match(fork, /‘두 검토 의견 모으기’ \(join\)/);
  const join = pages.find(text => text.includes('전달된 입력값을 연결 순서대로'))!;
  assert.ok(join);
  assert.match(join, /‘개발자의 코드 검토’ \(developer\) → ‘QA의 시험 사례 검토’ \(qa\)/);
  assert.match(join, /합류를 실패로 처리/);
  assert.match(join, /줄바꿈으로 이어 붙인 텍스트/);
});

test('병렬 제한은 그래프 안의 첫 합류까지 적용하고, 합류 입력 순서는 연결 종류를 따른다', () => {
  const graph: Graph = {nodes:[
    block('outer','control.parallel',{maxConcurrency:0,failurePolicy:'stop'}),
    block('inner','control.parallel',{maxConcurrency:3}),
    block('a','agent.delegate'), block('b','agent.delegate'), block('c','ai.single_task'),
    block('first','control.join',{merge:'sections',partialFailure:'report'}), block('last','control.join'),
  ], edges:[
    edge('outer','inner'), edge('outer','c'), edge('inner','a'), edge('inner','b'),
    edge('a','first'), edge('b','first'), edge('b','first','data'), edge('a','first','data'),
    edge('first','last'), edge('c','last'),
  ]};
  const notes = parallelInstructions(graph);
  const outer = notes.get('outer')!.join('\n'), inner = notes.get('inner')!.join('\n');
  assert.match(outer, /최대 1개/);
  assert.match(outer, /새 작업을 중단/);
  assert.match(outer, /‘first’/);
  assert.match(outer, /‘last’/);
  assert.match(inner, /최대 3개/);
  assert.match(inner, /‘first’/);
  assert.doesNotMatch(inner, /‘last’/);
  const join = notes.get('first')!.join('\n');
  assert.match(join, /입력값을 연결 순서대로 모으세요 — ‘b’ \(b\) → ‘a’ \(a\)/);
  assert.match(join, /실행 경로의 결과를 연결 순서대로 모으세요 — ‘a’ \(a\) → ‘b’ \(b\)/);
  assert.match(join, /조건에서 제외된 경로는 건너뛰세요/);
  assert.match(join, /회신 후 이어가고 이미 완료한 작업의 결과는 재사용/);
  assert.match(join, /사유\(error\).*성공한 결과와 함께 보존/);
  assert.match(join, /항목 이름을 제목으로/);
  assert.match(notes.get('last')!.join('\n'), /자료형을 유지한 목록/);
});

test('일반 병렬 작업에는 역할 호출을 추가하지 않고 선택 밖의 MCP 이름은 노출하지 않는다', () => {
  const graph: Graph = {nodes:[
    block('fork','control.parallel'), block('summary','ai.single_task'), block('draft','agent.delegate',{role:' '}),
    block('join','control.join'), block('private-connector','connection.mcp'),
  ], edges:[edge('fork','summary'), edge('fork','draft'), edge('summary','join'), edge('private-connector','join','data')]};
  const notes = parallelInstructions(graph);
  assert.doesNotMatch(notes.get('fork')!.join('\n'), /하위 Agent/);
  assert.doesNotMatch(notes.get('join')!.join('\n'), /private-connector/);
  assert.deepEqual([...notes.keys()], ['fork','join']);
});
