import assert from 'node:assert/strict';
import {posix} from 'node:path';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import type { ExportPackage } from '../src/domain/agent-export';
import { connectBlocks, createBlock } from '../src/domain/graph';
import { swImpactTemplate } from '../src/domain/sw-impact-template';
import type { Graph } from '../src/domain/types';
import { buildAgentZip } from '../src/server/agent-zip';

function samplePackage(): ExportPackage {
  const graph: Graph = {
    nodes: [
      createBlock('input.user_request', {id: 'input'}),
      createBlock('control.branch', {id: 'branch', title: '예약 확인', config: {operator: 'equals', expected: '예약'}}),
      createBlock('control.terminate', {id: 'accept', title: '확인', config: {message: '예약을 확인했습니다.'}}),
      createBlock('control.terminate', {id: 'other', title: '일반', config: {message: '일반 문의입니다.'}}),
    ],
    edges: [],
  };
  graph.edges.push(...connectBlocks(graph, 'input', 'branch'));
  for (const [route, target] of [['yes', 'accept'], ['no', 'other']]) {
    graph.edges.push(...connectBlocks(graph, 'branch', target, [{kind: 'flow', out: route, input: 'in'}]));
  }
  return {title: '안내 Agent', graph, resources: [], files: []};
}

function markdownTargets(name: string, text: string) {
  return Array.from(text.matchAll(/\]\(<?([^\s#)>]+\.md)(?:#[^)>]+)?>?\)/g), match =>
    posix.normalize(posix.join(posix.dirname(name), decodeURIComponent(match[1]))));
}

// Follow the same relative Markdown links as a reader starting in the extracted folder.
function reachableStages(files: ReturnType<typeof unzipSync>) {
  const stages = new Map<string, string>();
  const pending = ['AGENTS.md'];
  while (pending.length) {
    const name = pending.pop()!;
    if (stages.has(name)) continue;
    const content = strFromU8(files[name]);
    stages.set(name, content);
    for (const target of markdownTargets(name, content)) {
      assert.ok(files[target], name + ' → ' + target);
      if (target.startsWith('workflow/')) pending.push(target);
    }
  }
  const paths = Object.keys(files).filter(path => path.startsWith('workflow/') && path.endsWith('.md'));
  assert.ok(paths.length > 0, '단계 파일이 있어야 합니다.');
  for (const path of paths) assert.ok(stages.has(path), '도달할 수 없는 단계 파일 ' + path);
  return stages;
}

test('빈 자료 선택으로 내보낸 ZIP은 세 클라이언트용 지침과 원래 두 분기만으로 작업을 시작할 수 있다', () => {
  const pkg = samplePackage();
  const files = unzipSync(buildAgentZip(pkg));
  assert.deepEqual(Object.keys(files).sort(), ['AGENTS.md', 'CLAUDE.md', 'README.md']);
  assert.equal(strFromU8(files['CLAUDE.md']), '@AGENTS.md\n');
  const instructions = strFromU8(files['AGENTS.md']);
  assert.match(instructions, /예약 확인/);
  assert.match(instructions, /비교 기준 — 예약/);
  assert.match(instructions, /맞음 → 확인/);
  assert.match(instructions, /→ 일반 \(other,/);
  assert.match(instructions, /사용자가 대화에서 직접 회신할 때까지/);
  assert.match(strFromU8(files['README.md']), /Codex, Claude Code 또는 OpenCode/);
});

test('공통 지침에는 제외한 자료를 다시 연결할 단계가 남고 선택한 파일만 ZIP에 들어간다', async () => {
  const pkg = samplePackage();
  const document = {kind: 'document' as const, version: '2', available: true, steps: ['예약 확인']};
  pkg.resources = [
    {...document, key: 'public', name: '예약 안내', included: true, files: ['resources/public/source.md']},
    {...document, key: 'internal', name: '내부 기준', included: false, files: ['resources/internal/source.md']},
  ];
  pkg.files = [{path: pkg.resources[0].files[0], data: Buffer.from('반납일까지 수령').toString('base64')}];
  const files = unzipSync(await buildAgentZip(pkg));
  assert.equal(strFromU8(files['resources/public/source.md']), '반납일까지 수령');
  assert.equal(files['resources/internal/source.md'], undefined);
  assert.match(strFromU8(files['AGENTS.md']), /내부 기준[\s\S]*예약 확인[\s\S]*resources\/internal\/source.md/);
});

test('하위 Agent의 작업에 연결한 Skill 경로가 표시되고 선택하지 않은 MCP 세부 정보는 빠진다', () => {
  const pkg = samplePackage();
  const skill = createBlock('instruction.skill', {id:'skill', config:{exportResource:'s'}});
  const mcp = createBlock('connection.mcp', {id:'server', title:'비공개 연결', config:{exportResource:'m',assetId:'secret-id', version:1}});
  const task = createBlock('agent.task', {id:'task', title:'규정 검토', config:{allowedTools:['mcp.secret-id.private_lookup']}});
  const child: Graph = {nodes:[skill,mcp,task],edges:[]};
  child.edges.push(...connectBlocks(child, skill.id, task.id), ...connectBlocks(child, mcp.id, task.id));
  const call = createBlock('workflow.call', {id:'child',title:'규정 확인'});
  call.graph = child;
  pkg.graph.nodes.push(call);
  pkg.resources = [
    {kind:'skill', key:'s', name:'policy', available:true, version:'1', steps:['규정 검토'], included:true, files:['resources/s/SKILL.md']},
    {kind:'mcp', key:'m', name:mcp.title, available:true, version:'1', steps:['규정 검토'], included:false, files:[]},
  ];
  pkg.files = [{path:'resources/s/SKILL.md',data:Buffer.from('규정을 대조하세요.').toString('base64')}];
  const files = unzipSync(buildAgentZip(pkg));
  const instructions = strFromU8(files['AGENTS.md']);
  assert.match(instructions, /### 규정 확인 \/ 규정 검토[\s\S]*?\.agents\/skills\/policy\/SKILL\.md/);
  assert.ok(files['.claude/skills/policy/SKILL.md']);
  assert.doesNotMatch(instructions, /비공개 연결|secret-id|private_lookup/);
  assert.match(instructions, /사용자에게 연결을 요청/);
  assert.equal(files['.mcp.json'], undefined);

  const second = createBlock('workflow.call', {id:'second', title:call.title});
  second.graph = {nodes:[createBlock('agent.task', {id:task.id, title:task.title, config:{
    goal:'별도 담당자의 작업 ' + '법'.repeat(5500),
  }})], edges:[]};
  pkg.graph.nodes.push(second);
  task.config.goal = '첫 담당자의 규정 검토';
  const split = unzipSync(buildAgentZip(pkg));
  const stages = reachableStages(split);
  const taskPage = [...stages.values()].find(page => page.includes(task.config.goal));
  assert.ok(taskPage?.includes('.agents/skills/policy/SKILL.md'));
  const secondPage = [...stages.values()].find(page => page.includes('별도 담당자의 작업'));
  assert.ok(secondPage && !secondPage.includes('.agents/skills/policy/SKILL.md'));
  assert.doesNotMatch([...stages.values()].join('\n'), /비공개 연결|secret-id|private_lookup/);
});

test('출시 판단 설계는 상위 QA 자료와 하위 결과의 필드 및 사용자 질문을 그대로 연결한다', () => {
  const graph = structuredClone(swImpactTemplate.graph);
  const document = graph.nodes.find(node => node.id === 'qa-log')!;
  const source = 'resources/qa/source.md';
  document.config.exportResource = 'qa';
  const pkg: ExportPackage = {
    title: swImpactTemplate.title, graph,
    resources: [{key:'qa', name:document.title, kind:'document', version:'1',
      steps:[document.title], included:true, available:true, files:[source]}],
    files: [{path:source, data:Buffer.from(document.config.content).toString('base64')}],
  };
  const files = unzipSync(buildAgentZip(pkg));
  const stages = reachableStages(files);
  const root = stages.get('AGENTS.md')!;
  assert.match(root, /자리표시자이면 값의 원래 자료형/);
  assert.match(root, /범위 밖이면 맡은 업무를 안내하고 종료/);
  assert.match(root, /승인/);
  assert.doesNotMatch(root, /\[\{\{input\}\} QA\]/);
  const search = [...stages.values()].find(text => text.includes('[{{input}} QA]'));
  assert.ok(search?.includes(source), '하위 작업이 상위 QA 원문을 읽을 수 있어야 합니다.');
  const instructions = [...stages.values()].join('\n');
  assert.match(instructions, /사용자에게 처리할 대상을 선택/);
  assert.match(instructions, /results 목록.*excluded 목록/);
  assert.match(instructions, /sourceLines 목록/);
  assert.match(instructions, /result\.sourceLines/);
});

test('200줄까지 한 파일을 사용하고 다음 줄부터 단계 파일을 연결한다', () => {
  const pkg = samplePackage();
  const step = pkg.graph.nodes.find(node => node.id === 'accept')!;
  const original = strFromU8(unzipSync(buildAgentZip(pkg))['AGENTS.md']);
  const lines = original.replace(/\n$/, '').split('\n').length;
  step.config.message += '\n검토 항목'.repeat(200 - lines);
  const small = unzipSync(buildAgentZip(pkg));
  assert.equal(strFromU8(small['AGENTS.md']).trimEnd().split('\n').length, 200);
  assert.ok(!Object.keys(small).some(path => path.startsWith('workflow/')));
  step.config.message += '\n마지막 검토 항목';
  const large = unzipSync(buildAgentZip(pkg));
  const stages = reachableStages(large);
  assert.ok(!stages.get('AGENTS.md')!.includes('마지막 검토 항목'));
  assert.ok([...stages.values()].some(text => text.includes('마지막 검토 항목')));
  const branch = [...stages.entries()].find(([, text]) => text.includes('비교 기준 — 예약'));
  assert.ok(branch);
  for (const [label, result] of [['맞음', '마지막 검토 항목'], ['그 밖의 경우', '일반 문의입니다.']]) {
    const line: string | undefined = branch[1].split('\n').find(text => text.includes('실행 경로') && text.includes(label));
    assert.ok(line, '분기 ' + label);
    const targets = markdownTargets(branch[0], line);
    assert.ok([branch[0], ...targets].some(path => stages.get(path)?.includes(result)), label + ' → ' + result);
  }
  assert.equal(strFromU8(large['CLAUDE.md']), '@AGENTS.md\n');
});

test('200줄 미만의 한글 지침도 UTF-8 16 KiB까지 단일 파일로 보존하고 초과하면 분리한다', () => {
  const pkg = samplePackage();
  const step = pkg.graph.nodes.find(node => node.id === 'accept')!;
  step.config.message += '\n### 승인 후 기록\n';
  const before = unzipSync(buildAgentZip(pkg))['AGENTS.md'];
  const remaining = 16 * 1024 - before.byteLength;
  const padding = '한'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3);
  step.config.message += padding;
  const small = unzipSync(buildAgentZip(pkg));
  assert.equal(small['AGENTS.md'].byteLength, 16 * 1024);
  assert.ok(!Object.keys(small).some(path => path.startsWith('workflow/')));
  step.config.message += '!';
  const large = unzipSync(buildAgentZip(pkg));
  const stages = reachableStages(large);
  assert.ok(large['AGENTS.md'].byteLength < 16 * 1024);
  assert.doesNotMatch(stages.get('AGENTS.md')!, /### 승인 후 기록/);
  assert.ok([...stages.values()].some(text => text.includes('### 승인 후 기록') && text.includes(padding + '!')));
});

test('긴 담당 업무와 많은 시작점이 있어도 첫 문서에서 전체 지침에 도달할 수 있다', () => {
  const pkg = samplePackage();
  const purpose = '담당 업무의 시작. ' + '가'.repeat(8000) + ' 담당 업무의 끝.';
  pkg.graph.agentScope = {mode:'dedicated', purpose};
  for (let i = 0; i < 210; i++) {
    pkg.graph.nodes.push(createBlock('control.trigger', {id:'trigger-' + i, title:'접수 ' + i,
      config:{trigger:'event', event:'REQUEST_' + i}}));
  }
  const files = unzipSync(buildAgentZip(pkg));
  const stages = reachableStages(files);
  const root = stages.get('AGENTS.md')!;
  assert.ok(files['AGENTS.md'].byteLength <= 16 * 1024);
  assert.ok(root.trimEnd().split('\n').length <= 200);
  assert.ok([...stages.values()].some(page => page.includes(purpose)));
  assert.ok([...stages.values()].some(page => page.includes('REQUEST_209')));
});

test('기존 AI 역할·작업·선 설명, 평가 출력과 외부 변경 승인 규칙을 보존한다', () => {
  const pkg = samplePackage();
  const task = createBlock('ai.single_task', {id:'agent', config:{role:'자료 담당',task:'한 문장으로 요약'}});
  const evaluate = createBlock('quality.evaluate', {id:'score'});
  const publish = createBlock('knowledge.manage', {id:'publish', config:{storeKey:'규정', operation:'publish', version:'2'}});
  pkg.graph.nodes.push(task, evaluate, publish);
  const [edge] = connectBlocks(pkg.graph, task.id, evaluate.id);
  edge.label = '작성한 요약의 근거를 검토';
  pkg.graph.edges.push(edge);
  const instructions = strFromU8(unzipSync(buildAgentZip(pkg))['AGENTS.md']);
  for (const value of ['자료 담당','한 문장으로 요약','작성한 요약의 근거를 검토',
    '외부 상태를 바꾸거나 이전 작업을 되돌리기 전', '발행·철회하기 전에', 'score(0~100)', 'passed']) {
    assert.ok(instructions.includes(value), value);
  }
});
