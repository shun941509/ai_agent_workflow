import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph } from '../src/domain/graph';
import { swImpactTemplate } from '../src/domain/sw-impact-template';
import type { Graph } from '../src/domain/types';
import { executeGraph, type EngineServices } from '../src/engine';

const services: EngineServices = {
  tool: async () => { throw new Error('출시 판단 실습에서 외부 도구를 호출했습니다.'); },
  model: async request => {
    assert.match(request.instruction, /"references"/);
    const candidates = JSON.parse(request.context.slice(request.context.indexOf('['))) as {quote:string}[];
    assert.ok(candidates[0].quote.startsWith('[' + request.input + ' QA]'));
    const references = candidates.map(({quote}, index) => ({index, quote:quote.includes('실패.') ? '실패.' : '통과.'}));
    const status = new Set(references.map(ref => ref.quote)).size > 1 ? 'conflicting' : 'verified';
    return {text: JSON.stringify({status, references:[...references, references[0]]})};
  },
};

const chosen = ['목록','상세','알림'];
async function investigate(graph: Graph, runId:string, modules = chosen) {
  const request = {runId, input:swImpactTemplate.question};
  const selection = await executeGraph(graph, request, services);
  assert.ok(selection.wait?.kind === 'selection', selection.error ?? '조사 범위 선택이 필요합니다.');
  const investigation = await executeGraph(graph, {...request, checkpoint:selection.checkpoint,
    reply:{waitId:selection.wait.id, value:JSON.stringify(modules)}}, services);
  assert.ok(investigation.wait?.kind === 'question', investigation.error ?? '출시 판단 양식이 필요합니다.');
  return {request, selection:selection.wait, investigation, form:investigation.wait};
}

test('한도 안에서 고른 세 모듈의 QA 근거와 선택 제외 모듈을 보고 출시 판단과 이유를 남긴다', async () => {
  const graph = swImpactTemplate.graph;
  assert.deepEqual(validateGraph(graph), []);
  const {request, selection, investigation, form} = await investigate(graph, 'sw-impact-baseline');
  assert.deepEqual(selection.options, ['목록', '상세', '검색', '알림']);
  assert.equal(selection.selectionCount, 3);
  assert.equal(selection.selectionPolicy?.simultaneous, 2);
  assert.deepEqual(form.fields?.map(field => [field.name, field.required]),
    [['출시 판단',true],['판단 근거',true]]);
  const report = form.prompt;
  assert.match(report, /\[목록 QA\][^\n]*통과/);
  assert.match(report, /\[상세 QA\][^\n]*통과/);
  assert.match(report, /알림\s*[·\s]+근거 부족/);
  assert.match(report, /선택 제외[\s·]+검색/);
  assert.deepEqual(investigation.events.filter(event => event.kind === 'role').map(event => event.detail),
    ['목록 담당 Agent 생성 · 1차','상세 담당 Agent 생성 · 1차','알림 담당 Agent 생성 · 2차']);

  const reply = { '출시 판단':'보류', '판단 근거':'알림 QA가 기록되지 않아 출시를 보류한다.' };
  const decision = await executeGraph(graph, {...request, checkpoint:investigation.checkpoint,
    reply:{waitId:form.id, value:JSON.stringify(reply)}}, services);
  assert.equal(decision.status,'completed',decision.error ?? '');
  assert.match(decision.output,/출시 판단\s+보류/);
  assert.ok(decision.output.includes(reply['판단 근거']));
  assert.ok(decision.output.includes('[목록 QA] 완료한 일이 진행 중인 일 아래로 이동했다. 통과.'));
  assert.ok(decision.output.includes('[상세 QA] 완료한 일을 다시 열어도 완료 표시가 유지됐다. 통과.'));
  assert.match(decision.output,/알림\s*[·\s]+근거 부족/);
  assert.match(decision.output,/선택 제외[\s·]+검색/);
});

test('같은 짧은 인용이 여러 행에 있으면 각 QA 기록을 한 번씩 표시하고, 상충한 두 원문도 판단 근거로 남긴다', async () => {
  const graph = structuredClone(swImpactTemplate.graph);
  const qa = graph.nodes.find(node => node.title === '모듈별 QA 기록')!;
  const additional = '[목록 QA] 완료 취소 후 진행 중인 일로 돌아왔다. 통과.';
  const conflicting = '[상세 QA] 완료한 일을 다시 열었더니 완료 표시가 사라졌다. 실패.';
  const uncited = '[목록 QA] 여러 개의 일을 완료 처리하는 시험은 예정되어 있다.';
  qa.config.content += '\n' + [additional,uncited,conflicting].join('\n');
  const {form,request,investigation} = await investigate(graph, 'conflicting-qa');
  const decision = await executeGraph(graph,{...request, checkpoint:investigation.checkpoint,
    reply:{waitId:form.id,value:JSON.stringify({'출시 판단':'보류','판단 근거':'상세 모듈의 두 관찰이 상충한다.'})}},services);
  for (const report of [form.prompt,decision.output]) {
    for (const line of [
      '[목록 QA] 완료한 일이 진행 중인 일 아래로 이동했다. 통과.', additional,
      '[상세 QA] 완료한 일을 다시 열어도 완료 표시가 유지됐다. 통과.', conflicting,
    ]) assert.equal(report.split(line).length-1,1,report);
    assert.ok(!report.includes(uncited));
    assert.match(report,/상세\s+근거 상충/);
  }
});

test('같은 모듈로 다시 조사하면 추가한 알림 원문만 달라지고 실패 기록도 그대로 보인다', async () => {
  const graph = structuredClone(swImpactTemplate.graph);
  const qa = graph.nodes.find(node => node.title === '모듈별 QA 기록')!;
  const before = await investigate(graph, 'before-qa');
  const pass = '[알림 QA] 완료한 일의 예약 알림이 발송되지 않았다. 통과.';
  const fail = '[알림 QA] 완료한 일의 예약 알림이 계속 발송됐다. 실패.';
  assert.ok(swImpactTemplate.steps.some(step => step.includes(pass)));
  qa.config.content += '\n' + pass;
  const after = await investigate(graph, 'after-qa');
  assert.ok(after.form.prompt.includes(pass));
  assert.equal(before.form.prompt.replace(/알림\s+근거 부족/,pass), after.form.prompt);

  qa.config.content = qa.config.content.replace(pass, fail);
  const failedQa = await investigate(graph, 'failed-qa');
  assert.ok(failedQa.form.prompt.includes(fail));
  assert.doesNotMatch(failedQa.form.prompt, /\[알림 QA\][^\n]*통과/);
});

test('사본에서 고친 전체·동시 상한이 선택 수와 실제 담당자 생성 차수를 바꾼다', async () => {
  const graph = structuredClone(swImpactTemplate.graph);
  const team = graph.nodes.find(node => node.type === 'agent.create_dynamic')!;
  Object.assign(team.config,{maxCreatedAgents:2,maxInFlightAgents:1});
  const {selection,investigation,form} = await investigate(graph,'limited-qa',['검색','알림']);
  assert.equal(selection.selectionCount,2);
  assert.equal(selection.selectionPolicy?.simultaneous,1);
  assert.deepEqual(investigation.events.filter(event => event.kind === 'role').map(event => event.detail),
    ['검색 담당 Agent 생성 · 1차','알림 담당 Agent 생성 · 2차']);
  assert.match(form.prompt,/\[검색 QA\][^\n]*통과/);
  assert.match(form.prompt,/선택 제외\s+목록\s+상세/);
});

test('네 모듈 모두 조사할 수 있으면 선택 대기를 건너뛰고 빈 선택 제외 항목을 붙이지 않는다', async () => {
  const graph = structuredClone(swImpactTemplate.graph);
  graph.nodes.find(node => node.type === 'agent.create_dynamic')!.config.maxCreatedAgents = 4;
  const run = await executeGraph(graph,{runId:'all-modules',input:swImpactTemplate.question},services);
  assert.equal(run.wait?.kind,'question');
  assert.match(run.wait!.prompt,/\[검색 QA\][^\n]*통과/);
  assert.match(run.wait!.prompt,/알림\s+근거 부족/);
  assert.doesNotMatch(run.wait!.prompt,/선택 제외/);
});
