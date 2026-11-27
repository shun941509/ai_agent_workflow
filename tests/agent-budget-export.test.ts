import assert from 'node:assert/strict';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {connectBlocks, createBlock} from '../src/domain/graph';
import type {Block, Graph} from '../src/domain/types';
import {executeGraph, type EngineServices} from '../src/engine';
import {buildAgentZip} from '../src/server/agent-zip';

const block = (type:string, id:string, config = {}) => createBlock(type, {id, title:id, config});
function chain(nodes:Block[]):Graph {
  const graph:Graph = {nodes, edges:[]};
  for (let i = 1; i < nodes.length; i++) graph.edges.push(...connectBlocks(graph, nodes[i-1].id, nodes[i].id));
  return graph;
}
function extract(graph:Graph) {
  const files = unzipSync(buildAgentZip({title:'실행 한도', graph, resources:[], files:[]}));
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, strFromU8(data)]));
}

test('단일·분할 ZIP의 대표와 위임 역할이 같은 실행의 잔여 횟수와 동시 실행 자리를 사용한다', () => {
  const role = block('agent.delegate','review',{role:'검토자',instruction:'검토'});
  const graph = chain([block('input.user_request','in'), block('control.parallel','fork',{maxConcurrency:10}), role, block('output.answer','answer')]);
  for (const split of [false, true]) {
    if (split) graph.nodes[0].config.question = '여러 줄 입력\n'.repeat(205);
    const files = extract(graph);
    assert.equal(Boolean(files['workflow/index.md']), split);
    assert.match(files['AGENTS.md'], /전체 모델 호출 72회, 동시 실행 4개/);
    assert.match(files['AGENTS.md'], /클라이언트의 해당 한도가 더 낮으면 낮은 값/);
    assert.match(files['AGENTS.md'], /README\.md#run-limits/);
    const readme = files['README.md'];
    assert.match(readme, /id="run-limits"/);
    assert.match(readme,/실행 단계 512개, 외부 도구 호출 48회, 동적으로 생성한 담당자 24명/);
    assert.match(readme,/하위 설계 호출 깊이는 기본 8층/);
    for (const expected of ['사용 0회, 남음 72회', '사용 횟수를 1 올리고 잔여를 1 줄이세요', '하위 Workflow와 모든 담당자',
      '대표가 병렬 요청을 하나씩 확인', '진행 중인 호출은 같은 ID', '이미 차감한 같은 호출은 다시 차감하지',
      '다음 모델 작업에 필요한 잔여 횟수가 0이면', '클라이언트가 2개를 지원하면 한 차수에 최대 2개']) {
      assert.ok(readme.includes(expected), expected);
    }
    const roleFile = Object.keys(files).find(path => path.startsWith('agents/'))!;
    assert.match(files[roleFile], /\.\.\/README\.md#run-limits/);
    const fork = split ? files['workflow/step-002.md'] : files['AGENTS.md'];
    assert.match(fork, /블록 상한은 10개.*최대 4개/);
    assert.match(fork, /하위 Workflow 안의 작업은 그 층의 상한/);
  }
});

test('목표형 블록의 판단·완료 판정과 예전 설계의 유효 상한을 표시한다', () => {
  const goal = block('agent.task','draft',{goal:'팀의 의견을 요약'});
  delete goal.config.maxSteps;
  const dynamic = block('agent.create_dynamic','owners',{maxCreatedAgents:300, maxInFlightAgents:0});
  const graph = chain([block('input.user_request','start'), goal, dynamic, block('output.answer','end')]);
  const files = extract(graph);
  const instructions = Object.entries(files).filter(([p]) => p === 'AGENTS.md' || /workflow\/step-/.test(p)).map(([,v]) => v).join('\n');
  assert.match(instructions, /최대 판단 횟수 — 4/);
  assert.match(instructions, /전체 생성 상한 — 20/);
  assert.match(instructions, /동시 실행 상한 — 1/);
  assert.match(instructions, /초안·도구 선택에 1회.*완료 판정이 필요하면 별도로 1회/);
  assert.match(instructions,/마지막 판정까지 목표를 충족하지 못하면 단계 실패/);
  assert.match(instructions,/인용을 찾지 못하거나 원문과 다르면 근거 부족/);
  assert.match(instructions, /반복 진입·회신 후에도 남은 생성 수/);
});

test('Studio의 36회 목표형 초안·완료 판정으로 72회를 소진하면 다음 단발 호출을 시작하지 않는다', async () => {
  const goals = Array.from({length:36}, (_, i) => block('agent.task','goal-' + i,{goal:'결과 반환',maxSteps:1}));
  const graph = chain([block('input.user_request','start'), ...goals, block('ai.single_task','extra'), block('output.answer','end')]);
  let drafts = 0, reviews = 0;
  const services:EngineServices = {
    model:async input => {
      if (input.instruction.includes('완료 판정:')) {
        reviews++;
        return {text:JSON.stringify({status:'met',reason:'완료'})};
      }
      drafts++;
      return {text:'결과'};
    },
    tool:async () => null,
  };
  const result = await executeGraph(graph,{runId:'budget', input:'검토해 주세요'}, services);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /modelCalls 72/);
  assert.equal(result.checkpoint.counts.modelCalls, 72);
  assert.deepEqual([drafts,reviews], [36,36]);
  const files = extract(graph);
  assert.match(files['AGENTS.md'], /전체 모델 호출 72회/);
  assert.match(files['workflow/step-002.md'], /완료 판정이 필요하면 별도로 1회/);
});

test('상한 1인 상위 호출 안에서 하위 병렬 상한 10은 전체 기본 4개 또는 더 낮은 서비스 한도까지만 실행한다', async () => {
  const lanes = Array.from({length:6}, (_, i) => block('ai.single_task','lane-' + i));
  const child = chain([block('input.user_request','entry'), block('control.parallel','parallel',{maxConcurrency:10})]);
  child.nodes.push(...lanes, block('control.join','join'), block('output.answer','end'));
  for (const lane of lanes) {
    child.edges.push(...connectBlocks(child,'parallel',lane.id), ...connectBlocks(child,lane.id,'join'));
  }
  child.edges.push(...connectBlocks(child,'join','end'));
  const call = block('workflow.call','child');
  call.graph = child;
  const root = chain([block('input.user_request','entry'),block('control.parallel','outer',{maxConcurrency:1}),call,block('output.answer','end')]);
  for (const concurrency of [undefined, 2]) {
    let running = 0, peak = 0;
    const result = await executeGraph(root,{runId:'parallel',input:'확인'}, {
      limits:{concurrency}, tool:async () => null, model:async () => {
        peak = Math.max(peak, ++running);
        await new Promise(resolve => setTimeout(resolve, 2));
        running--;
        return {text:'완료'};
      },
    });
    assert.equal(result.status, 'completed', result.error ?? '하위 병렬 실행');
    assert.equal(peak, concurrency ?? 4);
    assert.equal(result.checkpoint.counts.modelCalls, 6);
  }
});

test('회신 후 남은 모델 호출 1회를 여러 병렬 단계가 요청해도 한 번만 시작한다', async () => {
  const graph = chain([block('input.user_request','in'), block('ai.single_task','already-done'), block('input.form','wait',{prompt:'계속할까요?'}),
    block('control.parallel','fork',{maxConcurrency:3})]);
  const calls = ['one','two','three'];
  graph.nodes.push(...calls.map(id => block('ai.single_task',id)), block('control.join','join'), block('output.answer','end'));
  for (const id of calls) graph.edges.push(...connectBlocks(graph,'fork',id), ...connectBlocks(graph,id,'join'));
  graph.edges.push(...connectBlocks(graph,'join','end'));
  const seen:string[] = [];
  const services:EngineServices = {limits:{modelCalls:2}, tool:async () => null, model:async input => {
    seen.push(input.instruction);
    return {text:'완료'};
  }};
  const request = {runId:'resume',input:'확인'};
  const waiting = await executeGraph(graph, request, services);
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.checkpoint.counts.modelCalls, 1);
  const result = await executeGraph(graph, {...request,checkpoint:waiting.checkpoint,reply:{waitId:waiting.wait!.id,value:'계속'}}, services);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /modelCalls 2/);
  assert.equal(result.checkpoint.counts.modelCalls, 2);
  assert.equal(seen.length, 2);
  assert.equal(seen.filter(prompt => prompt.includes('already-done')).length, 1);
});
