import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBlock, validateGraph, type Block, type Edge, type Graph } from '../src/domain';
import type { EngineEvent } from '../src/engine/types';

function step(from: string, to: string): Edge[] {
  return [
    { id:from+'-'+to+'-flow', from, to, kind:'flow', out:'next', input:'in' },
    { id:from+'-'+to+'-data', from, to, kind:'data', out:'value', input:'input' },
  ];
}

type Execute = (graph: Graph, input: string) => Promise<{state: string; events: EngineEvent[]}>;
const task = '도서관 행사 안내에 사용할 행사표기와 담당 확인문구를 전달하세요.';
const question = '팀 목표에 지정한 행사표기를 그대로 적어주세요. 담당자에게 전달된 Skill에 확인문구가 있으면 그대로 적고, 없으면 “지정 없음”이라고 적어주세요.';
const input = createBlock('input.user_request', {id:'input'});
const answer = createBlock('output.answer', {id:'answer'});

function agent(type: string, id: string, role: string, nested: boolean): Block {
  const leaf = id+'-task';
  return createBlock(type, {
    id, title:role, config:{role, instruction:task},
    graph:nested ? {
      nodes:[input, createBlock('ai.single_task', {id:leaf, config:{goal:task}}), answer],
      edges:[...step('input',leaf), ...step(leaf,'answer')],
    } : undefined,
  });
}

async function runTeam(execute: Execute, members: Block[], recipients: Block[], request: string) {
  const inner: Graph = {
    nodes:[
      input, createBlock('control.parallel', {id:'split'}), ...members,
      createBlock('control.join', {id:'join', config:{partialFailure:'fail'}}), answer,
    ],
    edges:[
      ...step('input','split'), ...members.flatMap(member=>[...step('split',member.id), ...step(member.id,'join')]), ...step('join','answer'),
    ],
  };
  // Fresh labels appear only in the parent bindings. Neither lane sees its sibling's answer.
  const label = (prefix: string) => prefix + '-' + randomUUID().slice(0,8);
  const teamLabel = label('행사');
  const team = createBlock('agent.team', {
    id:'team', config:{goal:'모든 담당자는 이번 행사의 행사표기 '+teamLabel+'를 답변에 정확히 포함하세요.'}, graph:inner,
  });
  const graph: Graph = {nodes:[input, team, answer], edges:[...step('input','team'), ...step('team','answer')]};
  const skillLabels = new Map<string,string>();
  for (const [index,recipient] of recipients.entries()) {
    const skillLabel = label('접수');
    const skill = createBlock('instruction.skill', {
      id:'desk-'+(index+1), title:'행사 접수 지침 '+(index+1), config:{version:'1', content:'# 행사 접수\n담당 확인문구는 '+skillLabel+'입니다. 이 문구를 원문 그대로 안내하세요.'},
    });
    graph.nodes.push(skill);
    graph.edges.push({id:skill.id+'-team', from:skill.id, to:'team', kind:'reference', out:'ref', input:'skill'});
    team.graph!.nodes.find(node=>node.id===recipient.id)!.config.inheritedSkillIds = ['block:'+skill.id];
    skillLabels.set(recipient.id,skillLabel);
  }
  assert.deepEqual(validateGraph(graph), []);
  const run = await execute(graph, request);
  assert.equal(run.state, 'completed');
  for (const member of members) {
    // Read the generating block, including the leaf inside a delegated Workflow.
    const nodeId = member.graph ? member.id+'-task' : member.id;
    const results = run.events.filter(event => event.kind === 'result' && event.nodeId === nodeId);
    assert.equal(results.length, 1, member.title+'의 모델 결과 개수');
    const data = results[0].data;
    assert.ok(data && typeof data === 'object' && 'value' in data && typeof data.value === 'string');
    assert.ok(data.value.includes(teamLabel), member.title+'의 답변에 팀 목표의 행사표기가 없습니다. '+data.value);
    for (const [owner,skillLabel] of skillLabels)
      assert.equal(data.value.includes(skillLabel), member.id === owner, member.title+'의 상위 Skill 선택과 답변이 다릅니다. '+data.value);
    if (!skillLabels.has(member.id)) assert.match(data.value, /지정\s*없음/, member.title+'의 미선택 응답: '+data.value);
    console.log('팀 지침 실측', JSON.stringify({담당:member.title, 방식:member.type, 상위Skill선택:skillLabels.has(member.id), 답변:data.value}));
  }
  return run.events;
}

export async function checkLiveTeamInheritance(execute: Execute) {
  const membership = agent('agent.delegate','membership','회원증 담당',true);
  const hours = agent('agent.delegate','hours','운영시간 담당',false);
  for (const recipient of [membership,hours])
    await runTeam(execute,[membership,hours],[recipient],question);
}

export async function checkLiveTeamModes(execute: Execute) {
  const handoff = agent('agent.handoff','handoff','행사 인계 담당',true);
  const dynamic = agent('agent.create_dynamic','dynamic','지점 행사 담당',true);
  const members = [handoff,dynamic], branch = '중앙도서관';
  const events = await runTeam(execute,members,members,branch);
  assert.ok(events.some(event=>event.kind==='role' && event.nodeId===handoff.id && event.detail==='담당 인계'));
  const generated = events.filter(event=>event.kind==='role' && event.nodeId===dynamic.id);
  assert.equal(generated.length,1);
  assert.deepEqual(generated[0].data, {target:branch, role:dynamic.title, wave:1, maxInFlightAgents:2});
}
